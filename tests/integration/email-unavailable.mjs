import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../../apps/server/dist/db/client.js";

// Run inside server-1 only while the isolated test SMTP container is stopped.
const email = `smtp-failure-${randomUUID()}@example.com`;
const origin = new URL(process.env.BETTER_AUTH_URL).origin;
try {
  const signup = await fetch("http://server-1:4000/api/auth/sign-up/email", {
    method: "POST", headers: { origin, "content-type": "application/json", "x-real-ip": "198.31.0.1" },
    body: JSON.stringify({ name: "SMTP failure fixture", email, password: randomUUID() }),
  });
  assert.equal(signup.status, 200, "failed initial mail must preserve account creation");
  const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  assert.ok(cookie, "the owner must still be able to access resend controls");
  const resend = await fetch("http://server-2:4000/api/auth/send-verification-email", {
    method: "POST", headers: { origin, cookie, "content-type": "application/json", "x-real-ip": "198.31.0.2" }, body: JSON.stringify({ email }),
  });
  assert.equal(resend.status, 503, "failed authenticated delivery must be actionable");
  assert.equal((await fetch("http://server-3:4000/api/conversations", { headers: { cookie } })).status, 403, "mail failure must not bypass verification");
  console.log("SMTP outage passed: account/login retained, resend fails safely, chat gate stays closed.");
} finally {
  await pool.query('DELETE FROM verification WHERE value IN (SELECT id FROM "user" WHERE email=$1)', [email]);
  await pool.query('DELETE FROM "user" WHERE email=$1', [email]);
  await pool.end();
}
