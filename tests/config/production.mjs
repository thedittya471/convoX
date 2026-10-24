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

const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { createHash } = await import("node:crypto");
const directory = mkdtempSync(join(tmpdir(), "convox-production-"));
try {
  const files = Object.fromEntries(["SERVER_ENV_FILE", "DATABASE_PASSWORD_FILE", "REDIS_ACL_FILE", "TLS_CERTIFICATE_FILE", "TLS_PRIVATE_KEY_FILE"].map((name) => [name, join(directory, name)]));
  const certificate = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", files.TLS_PRIVATE_KEY_FILE, "-out", files.TLS_CERTIFICATE_FILE, "-subj", "/CN=chat.example.test", "-addext", "subjectAltName=DNS:chat.example.test", "-days", "1"], { encoding: "utf8" });
  assert.equal(certificate.status, 0, "local synthetic certificate generation must succeed");
  writeFileSync(files.SERVER_ENV_FILE, Object.entries(base).map(([name, value]) => `${name}=${value}`).join("\n"), { mode: 0o600 });
  writeFileSync(files.DATABASE_PASSWORD_FILE, "synthetic-db-secret", { mode: 0o600 });
  const hash = createHash("sha256").update("synthetic-redis-secret").digest("hex");
  writeFileSync(files.REDIS_ACL_FILE, `user default on #${hash} ~* &* +@all\n`, { mode: 0o600 });
  for (const file of Object.values(files)) chmodSync(file, 0o600);
  const inputs = { PUBLIC_HOST: "chat.example.test", EDGE_SUBNET: "172.30.0.0/24", ...files };
  for (const name of ["NODE_IMAGE", "SERVER_IMAGE", "WEB_IMAGE", "POSTGRES_IMAGE", "REDIS_IMAGE", "NGINX_IMAGE"]) inputs[name] = `example.invalid/fixture@sha256:${"a".repeat(64)}`;
  const path = join(directory, ".env.production");
  const save = () => writeFileSync(path, Object.entries(inputs).map(([name, value]) => `${name}=${value}`).join("\n"), { mode: 0o600 });
  const run = () => spawnSync(process.execPath, ["scripts/validate-production.mjs", path], { encoding: "utf8" });
  save();
  const nginx = spawnSync("docker", ["run", "--rm", "--pull", "never", "--network", "none", "--env", "PUBLIC_HOST=chat.example.test",
    "--volume", `${process.cwd()}/infra/nginx.production.conf.template:/etc/nginx/templates/default.conf.template:ro`,
    "--volume", `${files.TLS_CERTIFICATE_FILE}:/run/secrets/tls_certificate:ro`,
    "--volume", `${files.TLS_PRIVATE_KEY_FILE}:/run/secrets/tls_private_key:ro`,
    "nginx:1.28-bookworm", "nginx", "-t"], { encoding: "utf8" });
  assert.equal(nginx.status, 0, "NGINX TLS configuration syntax must pass (requires the local nginx:1.28-bookworm test image)");
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  inputs.SERVER_IMAGE = "example.invalid/fixture:latest"; save();
  const invalid = run();
  assert.notEqual(invalid.status, 0);
  assert.ok(!invalid.stderr.includes(base.BETTER_AUTH_SECRET));
  inputs.SERVER_IMAGE = inputs.WEB_IMAGE; save();
  chmodSync(files.SERVER_ENV_FILE, 0o644);
  assert.notEqual(run().status, 0, "world-readable credentials must be rejected");
  console.log("Production template tests passed: Compose render/private ports, TLS pair/hostname, matching dependency secrets, immutable pins and file permissions; NGINX syntax checked with synthetic TLS; no deployment started.");
} finally { rmSync(directory, { recursive: true, force: true }); }
