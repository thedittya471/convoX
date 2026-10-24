import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "../../apps/server/dist/db/client.js";
import { claimQuota, enforceChatLimit } from "../../apps/server/dist/utils/rate-limit.js";
import { config } from "../../apps/server/dist/utils/config.js";

const identity = `quota-test-${randomUUID()}`;
const ip = `198.26.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const otherIp = `203.0.113.${Math.floor(Math.random() * 255)}`;
const key = (scope, subject) => `chat:${scope}:${createHash("sha256").update(subject).digest("hex")}`;
const servers = ["http://server-1:4000", "http://server-2:4000", "http://server-3:4000"];
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
  const originalQuery = pool.query;
  let status, guidance;
  const response = { set(name, value) { if (name === "Retry-After") guidance = value; return this; }, status(value) { status = value; return this; }, json() { return this; } };
  try {
    pool.query = async () => { throw new Error("Synthetic database outage"); };
    assert.equal(await enforceChatLimit(response, "fixture", identity, 3), false);
    assert.equal(status, 503);
    assert.equal(guidance, "5");
  } finally { pool.query = originalQuery; }
  console.log("Rate-limit integration passed: atomic races, independent identities, refill, cross-replica pre-auth bursts, Retry-After and fail-closed dependency handling.");
} finally {
  await pool.query("DELETE FROM rate_limit WHERE key = ANY($1::text[])", [[key("fixture", identity), key("fixture", `${identity}-other`), key("ip", ip), key("ip", otherIp)]]);
  await pool.end();
}
