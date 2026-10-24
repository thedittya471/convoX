import assert from "node:assert/strict";
import { readFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash, X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import { execFileSync, spawnSync } from "node:child_process";
const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const { parse } = require("dotenv");
try {
  const path = resolve(process.argv[2] ?? ".env.production");
  const env = parse(readFileSync(path));
  assert.match(env.PUBLIC_HOST ?? "", /^(?=.{1,253}$)[a-z0-9]+(?:[.-][a-z0-9]+)*$/i, "PUBLIC_HOST must be a hostname");
  for (const name of ["NODE_IMAGE", "SERVER_IMAGE", "WEB_IMAGE", "POSTGRES_IMAGE", "REDIS_IMAGE", "NGINX_IMAGE"]) assert.match(env[name] ?? "", /@sha256:[a-f0-9]{64}$/, `${name} must be digest-pinned`);
  const contents = {};
  for (const name of ["SERVER_ENV_FILE", "DATABASE_PASSWORD_FILE", "REDIS_ACL_FILE", "TLS_CERTIFICATE_FILE", "TLS_PRIVATE_KEY_FILE"]) {
    const stat = lstatSync(env[name]);
    assert.ok(stat.isFile() && (stat.mode & 0o077) === 0, `${name} must be a private regular file`);
    contents[name] = readFileSync(env[name], "utf8");
  }
  const serverEnv = parse(contents.SERVER_ENV_FILE);
  assert.equal(serverEnv.BETTER_AUTH_URL, `https://${env.PUBLIC_HOST}`, "public origin must match TLS hostname");
  assert.equal(serverEnv.TRUSTED_PROXY_CIDRS, env.EDGE_SUBNET ?? "172.30.0.0/24", "proxy trust must match the private edge subnet");
  const database = new URL(serverEnv.DATABASE_URL), redis = new URL(serverEnv.REDIS_URL);
  assert.ok(database.hostname === "postgres" && database.username === "convox" && database.pathname === "/convox" && ["", "5432"].includes(database.port), "database URL must match this template's private service");
  assert.ok(redis.protocol === "redis:" && redis.hostname === "redis" && ["", "default"].includes(redis.username) && ["", "6379"].includes(redis.port), "Redis URL must match this template's private ACL service");
  assert.equal(decodeURIComponent(database.password), contents.DATABASE_PASSWORD_FILE.trim(), "database secret files must agree");
  const redisHash = createHash("sha256").update(decodeURIComponent(redis.password)).digest("hex");
  assert.ok(contents.REDIS_ACL_FILE.trim() === `user default on #${redisHash} ~* &* +@all`, "Redis ACL must require the configured password hash");
  const certificate = new X509Certificate(contents.TLS_CERTIFICATE_FILE);
  assert.ok(certificate.checkHost(env.PUBLIC_HOST), "certificate must cover public hostname");
  assert.ok(Date.parse(certificate.validFrom) <= Date.now() && Date.parse(certificate.validTo) > Date.now(), "certificate must be current");
  createSecureContext({ cert: contents.TLS_CERTIFICATE_FILE, key: contents.TLS_PRIVATE_KEY_FILE });
  const guards = spawnSync(process.execPath, ["apps/server/dist/utils/config.js"], { env: { ...serverEnv, DEPLOYMENT_MODE: "production" }, encoding: "utf8" });
  assert.equal(guards.status, 0, "server production configuration rejected (check required fields)");
  const rendered = JSON.parse(execFileSync("docker", ["compose", "--env-file", path, "-f", "compose.production.yaml", "config", "--format", "json"], { env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  for (const [name, service] of Object.entries(rendered.services)) {
    if (name !== "nginx") assert.equal(service.ports?.length ?? 0, 0, `${name} must have no published ports`);
  }
  assert.equal(rendered.networks.data.internal, true);
  assert.deepEqual(rendered.services.nginx.ports.map((port) => port.target).sort((a, b) => a - b), [80, 443]);
  console.log("Production template validated: pinned references, private ports/files, matching secrets, TLS key/hostname and startup guards. Staging qualification remains required.");
} catch {
  // Validation errors can contain assertion operands or parsed Compose environment values.
  console.error("Production configuration validation failed. Check pins, required files/permissions, hostname/certificate, matching secrets and production guard fields. No secret values were printed.");
  process.exitCode = 1;
}
