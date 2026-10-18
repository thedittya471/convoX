import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../../apps/server/dist/db/client.js";

const servers = ["http://server-1:4000", "http://server-2:4000", "http://server-3:4000"];
const origin = new URL(process.env.BETTER_AUTH_URL).origin;
const email = `auth-test-${randomUUID()}@example.com`;
const password = randomBytes(24).toString("base64url");
const address = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;

async function request(server, path, { body, cookie, requestOrigin = origin, ip = address } = {}) {
  return fetch(`${server}/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      origin: requestOrigin,
      "x-real-ip": ip,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
}

function cookies(response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

try {
  const denied = await request(servers[0], "sign-up/email", {
    body: { name: "Auth test", email, password },
    requestOrigin: "https://untrusted.example",
  });
  assert.equal(denied.status, 403, "untrusted browser origins must be rejected");

  const invalid = await request(servers[0], "sign-up/email", {
    body: { name: "Auth test", email, password: "short" },
  });
  assert.equal(invalid.status, 400, "short passwords must be rejected");

  const signup = await request(servers[0], "sign-up/email", { body: { name: "Auth test", email, password } });
  assert.equal(signup.status, 200, "registration must succeed");
  const identity = await signup.json();
  const cookie = cookies(signup);
  assert.ok(cookie, "registration must issue a session cookie");
  assert.match(signup.headers.getSetCookie().join(";"), /HttpOnly/i);
  assert.match(signup.headers.getSetCookie().join(";"), /SameSite=Lax/i);

  for (const server of servers) {
    const response = await request(server, "get-session", { cookie });
    assert.equal(response.status, 200);
    const session = await response.json();
    assert.equal(session.user.id, identity.user.id, "all instances must recognize the same session");
  }

  const proxied = await request("http://nginx", "get-session", { cookie });
  assert.equal(proxied.status, 200);
  assert.equal((await proxied.json()).user.id, identity.user.id, "the public proxy must preserve sessions");

  const stored = await pool.query('SELECT password FROM "account" WHERE user_id = $1', [identity.user.id]);
  assert.ok(stored.rows[0].password);
  assert.notEqual(stored.rows[0].password, password, "passwords must be hashed");

  const wrongPassword = await request(servers[1], "sign-in/email", { body: { email, password: `${password}wrong` } });
  assert.equal(wrongPassword.status, 401);

  const logout = await request(servers[1], "sign-out", { body: {}, cookie });
  assert.equal(logout.status, 200);
  const revoked = await request(servers[2], "get-session", { cookie });
  assert.equal(await revoked.json(), null, "logout must revoke the old cookie on another instance");

  const login = await request(servers[2], "sign-in/email", { body: { email, password } });
  assert.equal(login.status, 200);
  const loginCookie = cookies(login);
  await pool.query('UPDATE "session" SET expires_at = NOW() - INTERVAL \'1 minute\' WHERE user_id = $1', [identity.user.id]);
  const expired = await request(servers[0], "get-session", { cookie: loginCookie });
  assert.equal(await expired.json(), null, "expired sessions must be rejected");

  const rateAddress = `198.19.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await request(servers[attempt % servers.length], "sign-in/email", {
      body: { email, password: `${password}wrong` },
      ip: rateAddress,
    });
    assert.equal(response.status, attempt < 5 ? 401 : 429, "login limits must be shared across instances");
  }
  console.log("Auth integration passed: origins, password validation/hashing, shared sessions, login, logout, expiry, and shared rate limits.");
} finally {
  await pool.query('DELETE FROM "user" WHERE email = $1', [email]);
  await pool.end();
}
