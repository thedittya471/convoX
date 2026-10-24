import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const container = process.env.BACKUP_TEST_CONTAINER;
assert.ok(container, "Set BACKUP_TEST_CONTAINER to a disposable migrated PostgreSQL container");
const appContainer = process.env.BACKUP_TEST_APP_CONTAINER;
assert.ok(appContainer, "Set BACKUP_TEST_APP_CONTAINER to a disposable app container");
const scratch = mkdtempSync(join(tmpdir(), "convox-backup-test-"));
const key = join(scratch, "key");
writeFileSync(key, randomBytes(32), { mode: 0o600 });
const sql = (db, query) => execFileSync("docker", ["exec", container, "psql", "-U", "convox", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
const run = (mode, db, path) => JSON.parse(execFileSync(process.execPath, ["scripts/database-backup.mjs", mode, container, db, path, key], { encoding: "utf8" }));
const restored = `restore_${Date.now()}`;
const started = performance.now();
try {
  sql("convox", `INSERT INTO "user" (id,name,email,email_verified) VALUES ('backup-a','Backup A','backup-a@example.com',true),('backup-b','Backup B','backup-b@example.com',true);
    INSERT INTO conversation (id,direct_user_low_id,direct_user_high_id,last_message_sequence) VALUES ('00000000-0000-4000-8000-000000000001','backup-a','backup-b',1);
    INSERT INTO message (id,conversation_id,sender_id,client_message_id,sequence,encrypted_payload) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','backup-a','00000000-0000-4000-8000-000000000003',1,'retained fixture');
    INSERT INTO message_outbox (message_id) SELECT id FROM message WHERE sender_id='backup-a';`);
  const passwordHash = execFileSync("docker", ["exec", "-w", "/app/apps/server", appContainer, "node", "--input-type=module", "-e", "import { hashPassword } from 'better-auth/crypto'; console.log(await hashPassword('backup-fixture-password-123'));"], { encoding: "utf8" }).trim();
  assert.match(passwordHash, /^[a-f0-9:]+$/);
  sql("convox", `INSERT INTO account (id,account_id,provider_id,user_id,password) VALUES ('backup-account','backup-a','credential','backup-a','${passwordHash}')`);
  const generation = sql("convox", "SELECT generation FROM history");
  const backup = run("backup", "convox", scratch);
  sql("convox", `CREATE DATABASE ${restored}`);
  const result = run("restore", restored, backup.backup);
  assert.notEqual(sql(restored, "SELECT generation FROM history"), generation);
  assert.equal(sql(restored, `SELECT count(*) FROM "user" WHERE id IN ('backup-a','backup-b')`), "2");
  assert.equal(sql(restored, "SELECT last_message_sequence FROM conversation"), "1");
  assert.equal(sql(restored, "SELECT sequence || ':' || encrypted_payload FROM message"), "1:retained fixture");
  assert.equal(sql(restored, "SELECT count(*) FROM message_outbox WHERE published_at IS NULL"), "1");
  execFileSync("docker", ["exec", "-e", `DATABASE_URL=postgresql://convox:convox_dev@postgres:5432/${restored}`, appContainer, "node", "tests/operations/restored.mjs"], { stdio: "inherit" });
  assert.throws(() => sql(restored, "INSERT INTO message SELECT * FROM message"));
  assert.throws(() => run("restore", restored, backup.backup), "nonempty target must be refused");
  const corrupted = readFileSync(backup.backup);
  corrupted[0] ^= 1;
  const bad = join(scratch, "tampered.gcm");
  writeFileSync(bad, corrupted);
  assert.throws(() => run("restore", restored, bad), "tampering must be rejected before writes");
  console.log(JSON.stringify({ ...result, rehearsalMs: Math.round(performance.now() - started), cutoff: backup.cutoffNoLaterThan, files: readdirSync(scratch).length }));
} finally {
  sql("convox", `DROP DATABASE IF EXISTS ${restored} WITH (FORCE)`);
  sql("convox", `DELETE FROM message_outbox WHERE message_id IN (SELECT id FROM message WHERE sender_id='backup-a'); DELETE FROM message WHERE sender_id='backup-a'; DELETE FROM conversation WHERE direct_user_low_id='backup-a'; DELETE FROM "user" WHERE id IN ('backup-a','backup-b');`);
  rmSync(scratch, { recursive: true, force: true });
}
