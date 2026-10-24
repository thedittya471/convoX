import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { verifyFixture } from "./verify-email.mjs";
import { pool } from "../../apps/server/dist/db/client.js";
import { claimQuota, enforceChatLimit } from "../../apps/server/dist/utils/rate-limit.js";
import { config } from "../../apps/server/dist/utils/config.js";

const identity = `quota-test-${randomUUID()}`;
const ip = `198.26.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const otherIp = `203.0.113.${Math.floor(Math.random() * 255)}`;
const key = (scope, subject) => `chat:${scope}:${createHash("sha256").update(subject).digest("hex")}`;
const servers = ["http://server-1:4000", "http://server-2:4000", "http://server-3:4000"];
const actors = [];
let conversationId;
try {
  const claims = await Promise.all(Array.from({ length: 20 }, () => claimQuota("fixture", identity, 3)));
  assert.equal(claims.filter((value) => value.allowed).length, 3, "atomic concurrent claims cannot exceed quota");
  assert.equal((await claimQuota("fixture", `${identity}-other`, 3)).allowed, true, "identities have independent buckets");
  assert.ok(claims.every((value) => value.retryAfter >= 1 && value.retryAfter <= 60));
  await pool.query("UPDATE rate_limit SET last_request = last_request - 60001 WHERE key=$1", [key("fixture", identity)]);
  assert.equal((await claimQuota("fixture", identity, 3)).allowed, true, "expired fixed window refills");
  let accepted = 0, rejected = 0;
  for (let offset = 0; offset < config.CHAT_IP_PER_MINUTE + 3; offset += 15) {
    const batch = await Promise.all(Array.from({ length: Math.min(15, config.CHAT_IP_PER_MINUTE + 3 - offset) }, (_, index) => fetch(`${servers[(offset + index) % 3]}/api/conversations`, { headers: { "x-forwarded-for": ip }, signal: AbortSignal.timeout(10000) })));
    for (const response of batch) {
      if (response.status === 401) accepted++;
      else {
        assert.equal(response.status, 429);
        assert.ok(Number(response.headers.get("retry-after")) > 0);
        rejected++;
      }
    }
  }
  assert.equal(accepted, config.CHAT_IP_PER_MINUTE, "shared pre-auth quota spans all three replicas");
  assert.equal(rejected, 3);
  const independent = await fetch(`${servers[0]}/api/conversations`, { headers: { "x-forwarded-for": otherIp } });
  assert.equal(independent.status, 401, "another IP reaches authentication");
  const origin = new URL(process.env.BETTER_AUTH_URL).origin;
  for (let index = 0; index < 2; index++) {
    const email = `quota-${randomUUID()}@example.com`;
    const username = `quota_${randomBytes(8).toString("hex")}`;
    const response = await fetch(`${servers[index]}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-real-ip": `198.27.${randomBytes(1)[0]}.${randomBytes(1)[0]}` }, body: JSON.stringify({ email, username, name: "Quota fixture", password: randomBytes(24).toString("base64url") }) });
    assert.equal(response.status, 200);
    actors.push({ ...(await response.json()).user, cookie: response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ") });
    await verifyFixture(email);
  }
  const [alice, bob] = actors;
  async function request(path, actor, body, index = 0) {
    return fetch(`${servers[index % 3]}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin, cookie: actor.cookie, "x-forwarded-for": `198.28.${index % 3}.1`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  }
  const opened = await request("/api/conversations", alice, { otherUserId: bob.id });
  assert.equal(opened.status, 201);
  conversationId = (await opened.json()).conversation.id;
  let savedBody, savedMessage;
  for (const [scope, limit, path, body] of [
    ["lookup", config.CHAT_LOOKUPS_PER_MINUTE, `/api/users/lookup?username=${bob.username}`],
    ["open", config.CHAT_OPENS_PER_MINUTE, "/api/conversations", { otherUserId: bob.id }],
    ["read", config.CHAT_READS_PER_MINUTE, "/api/conversations"],
    ["send", config.CHAT_SENDS_PER_MINUTE, `/api/conversations/${conversationId}/messages`, true],
  ]) {
    await claimQuota(scope, alice.id, limit);
    await pool.query("UPDATE rate_limit SET count=$1 WHERE key=$2", [limit - 2, key(scope, alice.id)]);
    const attempts = Array.from({ length: 6 }, () => body === true ? { clientMessageId: randomUUID(), encryptedPayload: "Quota fixture" } : body);
    const responses = await Promise.all(attempts.map((value, index) => request(path, alice, value, index)));
    assert.equal(responses.filter((value) => value.ok).length, 2, `${scope} quota is atomic across replicas and client addresses`);
    assert.equal(responses.filter((value) => value.status === 429).length, 4);
    for (const response of responses.filter((value) => value.status === 429)) assert.ok(Number(response.headers.get("retry-after")) > 0);
    if (scope === "send") {
      const index = responses.findIndex((value) => value.ok);
      savedBody = attempts[index]; savedMessage = (await responses[index].json()).message;
      assert.equal((await pool.query("SELECT id FROM message WHERE conversation_id=$1", [conversationId])).rowCount, 2, "rejected attempts must not create messages");
      assert.equal((await request(path, alice, savedBody)).status, 429, "idempotent attempts still observe abuse limits");
      await pool.query("UPDATE rate_limit SET last_request=last_request-60001 WHERE key=$1", [key(scope, alice.id)]);
      const retry = await request(path, alice, savedBody, 2);
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).message.id, savedMessage.id, "retry after refill retains canonical identity");
    }
  }
  assert.equal((await request(`/api/conversations/${conversationId}/messages`, alice)).status, 429, "history and conversation lists share one read quota");
  assert.equal((await request(`/api/users/lookup?username=${alice.username}`, bob)).status, 200, "another account remains independent");
  const originalQuery = pool.query;
  let status, guidance;
  const response = { set(name, value) { if (name === "Retry-After") guidance = value; return this; }, status(value) { status = value; return this; }, json() { return this; } };
  try {
    pool.query = async () => { throw new Error("Synthetic database outage"); };
    assert.equal(await enforceChatLimit(response, "fixture", identity, 3), false);
    assert.equal(status, 503);
    assert.equal(guidance, "5");
  } finally { pool.query = originalQuery; }
  console.log("Rate-limit integration passed: atomic races, independent identities, refill, cross-replica IP/account bursts, rejected-send safety, idempotent retry identity, shared reads, Retry-After and fail-closed dependency handling.");
} finally {
  const actorIds = actors.map((actor) => actor.id);
  if (conversationId) {
    await pool.query("DELETE FROM message WHERE conversation_id=$1", [conversationId]);
    await pool.query("DELETE FROM conversation WHERE id=$1", [conversationId]);
  }
  await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [actorIds]);
  const accountKeys = actorIds.flatMap((id) => ["lookup", "open", "read", "send"].map((scope) => key(scope, id)));
  accountKeys.push(...[0, 1, 2].map((index) => key("ip", `198.28.${index}.1`)));
  await pool.query("DELETE FROM rate_limit WHERE key = ANY($1::text[])", [accountKeys]);
  await pool.query("DELETE FROM rate_limit WHERE key = ANY($1::text[])", [[key("fixture", identity), key("fixture", `${identity}-other`), key("ip", ip), key("ip", otherIp)]]);
  await pool.end();
}
