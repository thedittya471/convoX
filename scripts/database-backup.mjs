import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdtemp, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

// Requires a local PostgreSQL container with its existing operator credentials.
const [mode, container, database, location, keyPath] = process.argv.slice(2);
if (!["backup", "restore"].includes(mode) || !container || !/^[a-zA-Z0-9_]+$/.test(database ?? "") || !location || !keyPath) {
  throw new Error("Usage: node scripts/database-backup.mjs backup|restore CONTAINER DATABASE DIRECTORY|FILE KEY_FILE");
}
const keyInfo = await stat(keyPath);
if (!keyInfo.isFile() || (keyInfo.mode & 0o077) !== 0) throw new Error("Key file must be private (0600/0400)");
const key = await readFile(keyPath);
if (key.length !== 32) throw new Error("Key file must contain exactly 32 random bytes");
const target = resolve(location);
process.umask(0o077);

function pg(command, args, input = "ignore") {
  const child = spawn("docker", ["exec", ...(input === "pipe" ? ["-i"] : []), container, command, "-U", process.env.PGUSER ?? "convox", ...args], { stdio: [input, "pipe", "pipe"] });
  // Drain diagnostics without exposing potentially sensitive database contents.
  child.stderr.resume();
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}); backup/target must be inspected`)));
  });
  done.catch(() => {});
  return { child, done };
}

if (mode === "backup") {
  const info = await stat(target);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0) throw new Error("Backup directory must be private (0700)");
  const cutoff = new Date();
  const filename = `convox-${cutoff.toISOString().replaceAll(":", "-")}.dump.gcm`;
  const finalPath = join(target, filename);
  const partial = `${finalPath}.partial`;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const dump = pg("pg_dump", ["-d", database, "-Fc", "--no-owner", "--no-acl"]);
  try {
    await Promise.all([pipeline(dump.child.stdout, cipher, createWriteStream(partial, { flags: "wx", mode: 0o600 })), dump.done]);
    const file = await open(partial, "a");
    try {
      await file.write(Buffer.concat([iv, cipher.getAuthTag()]));
      await file.sync();
    } finally { await file.close(); }
    await rename(partial, finalPath);
    // Only our completed backup files expire, and only after a successful new backup.
    for (const name of await readdir(target)) {
      if (!/^convox-\d{4}-\d\d-\d\dT[\d.-]+Z\.dump\.gcm$/.test(name)) continue;
      const path = join(target, name);
      if ((await stat(path)).mtimeMs < cutoff.getTime() - 7 * 86400000) await rm(path);
    }
    console.log(JSON.stringify({ backup: finalPath, cutoffNoLaterThan: cutoff.toISOString(), completedAt: new Date().toISOString() }));
  } finally {
    dump.child.kill();
    await rm(partial, { force: true });
  }
} else {
  const started = performance.now();
  const size = (await stat(target)).size;
  if (size < 29) throw new Error("Invalid encrypted backup");
  const file = await open(target, "r");
  const footer = Buffer.alloc(28);
  try { await file.read(footer, 0, 28, size - 28); } finally { await file.close(); }
  const decipher = createDecipheriv("aes-256-gcm", key, footer.subarray(0, 12));
  decipher.setAuthTag(footer.subarray(12));
  const scratch = await mkdtemp(join(tmpdir(), "convox-restore-"));
  await chmod(scratch, 0o700);
  try {
    const dumpPath = join(scratch, "verified.dump");
    // Authenticate the entire archive before any database writes.
    await pipeline(createReadStream(target, { end: size - 29 }), decipher, createWriteStream(dumpPath, { mode: 0o600, flags: "wx" }));
    const probe = pg("psql", ["-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c", "SELECT count(*) FROM pg_class WHERE relnamespace IN (SELECT oid FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema')"]);
    let objects = "";
    for await (const chunk of probe.child.stdout) objects += chunk;
    await probe.done;
    if (objects.trim() !== "0") throw new Error("Restore requires an empty, separately created database");
    const restore = pg("pg_restore", ["-d", database, "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"], "pipe");
    restore.child.stdout.resume();
    await Promise.all([pipeline(createReadStream(dumpPath), restore.child.stdin), restore.done]);
    const rotate = pg("psql", ["-d", database, "-v", "ON_ERROR_STOP=1", "-c", "DO $$ BEGIN UPDATE history SET generation = gen_random_uuid() WHERE singleton = true; IF NOT FOUND THEN RAISE EXCEPTION 'Missing history generation'; END IF; END $$;"]);
    rotate.child.stdout.resume();
    await rotate.done;
    console.log(JSON.stringify({ restored: true, generationRotated: true, elapsedMs: Math.round(performance.now() - started) }));
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
