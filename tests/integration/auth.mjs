import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../../apps/server/dist/db/client.js";

const servers = ["http://server-1:4000", "http://server-2:4000", "http://server-3:4000"];
const origin = new URL(process.env.BETTER_AUTH_URL).origin;
const email = `auth-test-${randomUUID()}@example.com`;
const targetEmail = `auth-test-${randomUUID()}@example.com`;
const duplicateEmail = `auth-test-${randomUUID()}@example.com`;
const targetUsername = `lookup_${randomBytes(8).toString("hex")}`;
const legacyUsername = `legacy_${randomBytes(8).toString("hex")}`;
const fixtureIds = [];
const password = randomBytes(24).toString("base64url");
const address = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;

async function request(server, path, { body, cookie, requestOrigin = origin, ip = address } = {}) {
  return fetch(`${server}${path.startsWith("/") ? path : `/api/auth/${path}`}`, {
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
  fixtureIds.push(identity.user.id);
  const cookie = cookies(signup);
  assert.ok(cookie, "registration must issue a session cookie");
  assert.match(signup.headers.getSetCookie().join(";"), /HttpOnly/i);
  assert.match(signup.headers.getSetCookie().join(";"), /SameSite=Lax/i);

  const targetSignup = await request(servers[1], "sign-up/email", {
    body: { name: "Discovery target", email: targetEmail, password, username: targetUsername.toUpperCase() },
    ip: `198.20.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
  });
  assert.equal(targetSignup.status, 200);
  const target = await targetSignup.json();
  fixtureIds.push(target.user.id);
  assert.equal(target.user.username, targetUsername, "usernames must be normalized on creation");
  const targetCookie = cookies(targetSignup);
  const lookupPath = `/api/users/lookup?username=${targetUsername.toUpperCase()}`;
  const anonymousLookup = await request(servers[0], lookupPath);
  assert.equal(anonymousLookup.status, 401, "discovery requires a valid session");

  for (const server of [...servers, "http://nginx"]) {
    const lookup = await request(server, lookupPath, { cookie });
    assert.equal(lookup.status, 200);
    assert.equal(lookup.headers.get("cache-control"), "no-store");
    assert.deepEqual(await lookup.json(), {
      user: { id: target.user.id, username: targetUsername, name: "Discovery target" },
    }, "only public fields may be returned, never email or session fields");
  }
  for (const invalidPath of ["/api/users/lookup", "/api/users/lookup?username=ab", "/api/users/lookup?username=alice%40example.com", "/api/users/lookup?username=alice&username=bob"]) {
    assert.equal((await request(servers[0], invalidPath, { cookie })).status, 400);
  }
  assert.equal((await request(servers[0], lookupPath, { cookie: targetCookie })).status, 404, "self lookup must not return a chat target");
  assert.equal((await request(servers[0], `/api/users/lookup?username=${targetUsername.slice(0, -1)}`, { cookie })).status, 404, "lookup must not match prefixes");
  const duplicate = await request(servers[0], "sign-up/email", {
    body: { name: "Duplicate", email: duplicateEmail, password, username: targetUsername.toUpperCase() },
    ip: `198.21.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
  });
  assert.equal(duplicate.status, 400, "case variants must not create duplicate usernames");

  const invalidClaim = await request(servers[0], "update-user", { cookie, body: { username: "invalid name" } });
  assert.equal(invalidClaim.status, 400);
  const duplicateClaim = await request(servers[0], "update-user", { cookie, body: { username: targetUsername } });
  assert.equal(duplicateClaim.status, 400);
  const claim = await request(servers[0], "update-user", { cookie, body: { username: legacyUsername.toUpperCase() } });
  assert.equal(claim.status, 200, "existing accounts must be able to choose a username");
  const claimedSession = await request(servers[2], "get-session", { cookie });
  assert.equal((await claimedSession.json()).user.username, legacyUsername);
  assert.equal((await request(servers[0], "is-username-available", { body: { username: targetUsername } })).status, 404, "public availability endpoint must stay disabled");

  await pool.query("DELETE FROM rate_limit WHERE key = $1", [`user-lookup:${identity.user.id}`]);
  for (let attempt = 0; attempt < 31; attempt += 1) {
    const lookup = await request(servers[attempt % servers.length], lookupPath, { cookie });
    assert.equal(lookup.status, attempt < 30 ? 200 : 429, "discovery limits must be shared across instances");
    if (attempt === 30) assert.ok(Number(lookup.headers.get("retry-after")) > 0);
  }
  await pool.query("UPDATE rate_limit SET last_request = $1 WHERE key = $2", [Date.now() - 61000, `user-lookup:${identity.user.id}`]);
  assert.equal((await request(servers[2], lookupPath, { cookie })).status, 200, "lookup limits must reset after their window");

  await pool.query("DELETE FROM rate_limit WHERE key = $1", [`user-lookup:${identity.user.id}`]);
  const concurrentLookups = await Promise.all(Array.from({ length: 36 }, (_value, attempt) =>
    request(servers[attempt % servers.length], lookupPath, { cookie })));
  assert.equal(concurrentLookups.filter((response) => response.status === 200).length, 30, "concurrent searches must not bypass the shared limit");
  assert.equal(concurrentLookups.filter((response) => response.status === 429).length, 6);
  const counter = await pool.query("SELECT count FROM rate_limit WHERE key = $1", [`user-lookup:${identity.user.id}`]);
  assert.equal(counter.rows[0].count, 36, "concurrent updates must not lose increments");

  const raceUsername = `race_${randomBytes(8).toString("hex")}`;
  const race = await Promise.all([
    request(servers[0], "update-user", { cookie, body: { username: raceUsername } }),
    request(servers[1], "update-user", { cookie: targetCookie, body: { username: raceUsername.toUpperCase() } }),
  ]);
  assert.equal(race.filter((response) => response.status === 200).length, 1, "only one concurrent claim may succeed");
  const owners = await pool.query('SELECT id FROM "user" WHERE username = $1', [raceUsername]);
  assert.equal(owners.rowCount, 1, "the database must enforce uniqueness under concurrency");

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
  assert.equal((await request(servers[2], lookupPath, { cookie })).status, 401, "revoked sessions must not search");

  const login = await request(servers[2], "sign-in/email", { body: { email, password } });
  assert.equal(login.status, 200);
  const loginCookie = cookies(login);
  await pool.query('UPDATE "session" SET expires_at = NOW() - INTERVAL \'1 minute\' WHERE user_id = $1', [identity.user.id]);
  const expired = await request(servers[0], "get-session", { cookie: loginCookie });
  assert.equal(await expired.json(), null, "expired sessions must be rejected");
  assert.equal((await request(servers[0], lookupPath, { cookie: loginCookie })).status, 401, "expired sessions must not search");

  const rateAddress = `198.19.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await request(servers[attempt % servers.length], "sign-in/email", {
      body: { email, password: `${password}wrong` },
      ip: rateAddress,
    });
    assert.equal(response.status, attempt < 5 ? 401 : 429, "login limits must be shared across instances");
  }
  console.log("Auth integration passed: auth lifecycle, username validation/uniqueness/concurrent claims, private authenticated discovery, and shared rate limits.");
} finally {
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [[email, targetEmail, duplicateEmail]]);
  await pool.query("DELETE FROM rate_limit WHERE key = ANY($1::text[])", [fixtureIds.map((id) => `user-lookup:${id}`)]);
  await pool.end();
}
