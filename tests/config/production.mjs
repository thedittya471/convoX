import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const base = {
  DEPLOYMENT_MODE: "production", BETTER_AUTH_URL: "https://chat.example.test",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"), METRICS_TOKEN: randomBytes(32).toString("base64url"),
  DATABASE_URL: "postgresql://convox:synthetic-db-secret@postgres/convox", REDIS_URL: "redis://:synthetic-redis-secret@redis:6379",
  SMTP_HOST: "smtp.example.test", SMTP_FROM: "chat@example.test", TRUSTED_PROXY_CIDRS: "172.30.0.0/24",
};
function validate(overrides) {
  return spawnSync(process.execPath, ["apps/server/dist/utils/config.js"], { env: { ...base, ...overrides }, encoding: "utf8" });
}
assert.equal(validate({}).status, 0);
for (const [field, value] of [["BETTER_AUTH_URL", "http://chat.example.test"], ["BETTER_AUTH_URL", "https://chat.example.test/callback"], ["DATABASE_URL", "postgresql://convox:convox_dev@postgres/convox"], ["REDIS_URL", "redis://redis:6379"], ["REDIS_URL", "redis://:%@redis:6379"], ["BETTER_AUTH_SECRET", "x".repeat(32)], ["METRICS_TOKEN", base.BETTER_AUTH_SECRET], ["SMTP_HOST", ""], ["SMTP_TLS", "local"], ["TRUSTED_PROXY_CIDRS", "0.0.0.0/0"], ["TRUSTED_PROXY_CIDRS", "invalid"], ["TRUSTED_PROXY_CIDRS", "10.0.0.0/99"]]) {
  const result = validate({ [field]: value });
  assert.notEqual(result.status, 0, `${field} must fail closed`);
  assert.match(result.stderr, /invalid_configuration/);
  assert.ok(!result.stderr.includes(base.BETTER_AUTH_SECRET), "errors must not print secrets");
}
console.log("Production startup guards passed: HTTPS origin, independent secrets, authenticated dependencies, SMTP and narrow valid proxy trust.");
