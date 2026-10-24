import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { pool } from "../../apps/server/dist/db/client.js";

const servers = ["http://server-1:4000", "http://server-2:4000", "http://server-3:4000"];
const origin = new URL(process.env.BETTER_AUTH_URL).origin;
const email = `reset-test-${randomUUID()}@example.com`;
const unknownEmail = `missing-${randomUUID()}@example.com`;
const password = randomBytes(24).toString("base64url");
const newPassword = randomBytes(24).toString("base64url");

async function request(index, path, body, cookie, ip = `198.32.${randomBytes(1)[0]}.${randomBytes(1)[0]}`) {
  return fetch(`${servers[index]}/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    headers: { origin, "x-real-ip": ip, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
    redirect: "manual",
  });
}

function cookies(response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

const seenTokens = new Set();

async function resetLink() {
  const mailbox = process.env.MAILPIT_URL ?? "http://mailpit:8025";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const query = encodeURIComponent(`to:${email} subject:"Reset your convoX password"`);
    const { messages } = await fetch(`${mailbox}/api/v1/search?query=${query}`).then((response) => response.json());
    if (messages?.length) {
      const message = await fetch(`${mailbox}/api/v1/message/${messages[0].ID}`).then((response) => response.json());
      const link = new URL(message.Text.match(/https?:\/\/\S+/)[0]);
      assert.equal(link.origin, origin);
      assert.equal(link.pathname, "/reset-password");
      const token = link.searchParams.get("token");
      assert.ok(token);
      if (!seenTokens.has(token)) {
        seenTokens.add(token);
        return link;
      }
    }
    await sleep(100);
  }
  assert.fail("password reset email must reach the isolated SMTP inbox");
}

try {
  const signup = await request(0, "sign-up/email", { name: "Reset fixture", email, password });
  assert.equal(signup.status, 200);
  const cookie = cookies(signup);
  const login = await request(1, "sign-in/email", { email, password });
  assert.equal(login.status, 200);
  const secondCookie = cookies(login);

  const known = await request(0, "request-password-reset", { email, redirectTo: `${origin}/reset-password` });
  assert.equal(known.status, 200, "password recovery must be enabled");
  const unknown = await request(1, "request-password-reset", { email: unknownEmail, redirectTo: `${origin}/reset-password` });
  assert.equal(unknown.status, 200);
  assert.deepEqual(await known.json(), await unknown.json(), "request responses must not disclose account existence");
  assert.equal((await request(2, "request-password-reset", { email, redirectTo: "https://untrusted.example/reset" })).status, 403);

  const link = await resetLink();
  const token = link.searchParams.get("token");
  for (const invalidPassword of ["short", "a".repeat(129)]) {
    assert.equal((await request(0, "reset-password", { token, newPassword: invalidPassword })).status, 400, "existing password bounds must hold");
  }
  const results = await Promise.all([0, 1].map((index) => request(index, "reset-password", { token, newPassword })));
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 400], "a reset token can succeed on only one replica");
  assert.equal((await request(2, "reset-password", { token, newPassword: password })).status, 400, "used tokens cannot be replayed");
  for (const sessionCookie of [cookie, secondCookie]) {
    for (let index = 0; index < servers.length; index += 1) {
      assert.equal(await (await request(index, "get-session", undefined, sessionCookie)).json(), null, "reset must revoke every session across replicas");
    }
  }
  assert.equal((await request(1, "sign-in/email", { email, password })).status, 401, "old password must stop working");
  assert.equal((await request(2, "sign-in/email", { email, password: newPassword })).status, 200, "new password must work");
  const loggedIn = await request(0, "sign-in/email", { email, password: newPassword });
  const activeCookie = cookies(loggedIn);
  const userId = (await loggedIn.json()).user.id;
  assert.equal((await (await request(1, "get-session", undefined, activeCookie)).json()).user.emailVerified, false, "reset must not bypass email verification");

  await request(0, "request-password-reset", { email });
  const expiredToken = (await resetLink()).searchParams.get("token");
  const expiredIdentifier = createHash("sha256").update(`reset-password:${expiredToken}`).digest("base64url");
  const stored = await pool.query("SELECT identifier FROM verification WHERE identifier=$1", [expiredIdentifier]);
  assert.equal(stored.rowCount, 1, "reset token identifiers must be hashed at rest");
  await pool.query("UPDATE verification SET expires_at=NOW()-INTERVAL '1 second' WHERE identifier=$1", [expiredIdentifier]);
  assert.equal((await request(2, "reset-password", { token: expiredToken, newPassword: password })).status, 400, "expired links cannot change passwords");

  await request(1, "request-password-reset", { email });
  const rollbackToken = (await resetLink()).searchParams.get("token");
  await pool.query(`CREATE FUNCTION task5_fail_password_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic password write failure'; END $$`);
  await pool.query("CREATE TRIGGER task5_fail_password_write BEFORE UPDATE OF password ON account FOR EACH ROW EXECUTE FUNCTION task5_fail_password_write()");
  const failedReset = await request(1, "reset-password", { token: rollbackToken, newPassword: password });
  assert.equal(failedReset.status, 500, "a password write failure must fail the reset");
  assert.ok((await (await request(2, "get-session", undefined, activeCookie)).json()).session, "failed reset must roll back session revocation");
  assert.equal((await request(0, "sign-in/email", { email, password: newPassword })).status, 200, "failed reset must retain the previous password");
  await pool.query("DROP TRIGGER task5_fail_password_write ON account");
  await pool.query("DROP FUNCTION task5_fail_password_write()");
  assert.equal((await request(2, "reset-password", { token: rollbackToken, newPassword: password })).status, 200, "failed writes must leave the same token retryable");

  // Reset only the fixture's bucket to test its complete per-account window independently.
  await pool.query("DELETE FROM rate_limit WHERE key=$1", [`reset:${userId}`]);
  const mailbox = process.env.MAILPIT_URL ?? "http://mailpit:8025";
  const query = encodeURIComponent(`to:${email} subject:"Reset your convoX password"`);
  const mailCount = async () => (await fetch(`${mailbox}/api/v1/search?query=${query}`).then((response) => response.json())).messages.length;
  const before = await mailCount();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request(attempt % 3, "request-password-reset", { email });
    assert.equal(response.status, 200, "account mail throttling must not disclose account existence");
  }
  assert.equal(await mailCount(), before + 3, "account mail delivery must be capped across IPs and replicas");
  const requestAddress = `198.33.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const submitAddress = `198.34.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request(attempt % 3, "request-password-reset", { email: unknownEmail }, undefined, requestAddress);
    assert.equal(response.status, attempt < 3 ? 200 : 429, "reset requests must share per-address limits across replicas");
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await request(attempt % 3, "reset-password", { token: "invalid", newPassword }, undefined, submitAddress);
    assert.equal(response.status, attempt < 5 ? 400 : 429, "reset submissions must be bounded across replicas");
  }
  console.log("Password reset passed: private requests, expiry/replay/concurrency, atomic rollback, shared limits and cross-replica session revocation.");
} finally {
  await pool.query("DROP TRIGGER IF EXISTS task5_fail_password_write ON account");
  await pool.query("DROP FUNCTION IF EXISTS task5_fail_password_write()");
  await pool.query('DELETE FROM verification WHERE value IN (SELECT id FROM "user" WHERE email=$1)', [email]);
  await pool.query('DELETE FROM "user" WHERE email=$1', [email]);
  await pool.end();
}
