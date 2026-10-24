import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

const baseUrl = process.env.SMOKE_URL ?? "http://localhost:8080";
let frontendReady = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    frontendReady = (await fetch(baseUrl, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    frontendReady = false;
  }
  if (frontendReady) break;
  await setTimeout(500);
}
assert.ok(frontendReady, "Next.js must respond successfully through NGINX");
const artwork = await fetch(`${baseUrl}/images/auth-ribbons.webp`, { signal: AbortSignal.timeout(5000) });
assert.equal(artwork.status, 200, "auth artwork must be served through NGINX");
assert.match(artwork.headers.get("content-type") ?? "", /image\/webp/);
for (const [path, heading] of [["/login", "Welcome back"], ["/signup", "Create your account"]]) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `${path} must be available through NGINX`);
  assert.ok((await response.text()).includes(heading), `${path} must render its auth heading`);
}
for (const path of ["/forgot-password", "/reset-password"]) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `${path} must be available through NGINX`);
  if (path === "/reset-password") {
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
}
const instances = new Set();
for (let attempt = 0; attempt < 12; attempt += 1) {
  const response = await fetch(`${baseUrl}/api/health/ready`, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200, "backend dependencies must be ready");
  const health = await response.json();
  assert.equal(health.status, "ok");
  instances.add(health.instanceId);
}
assert.deepEqual([...instances].sort(), ["server-1", "server-2", "server-3"]);
const execute = promisify(execFile);
try {
  await execute("docker", ["compose", "stop", "server-1"], { timeout: 20000 });
  const { stdout: containerId } = await execute("docker", ["compose", "ps", "-aq", "server-1"]);
  const { stdout: exitCode } = await execute("docker", ["inspect", "--format", "{{.State.ExitCode}}", containerId.trim()]);
  assert.equal(exitCode.trim(), "0", "backend must shut down cleanly");
} finally {
  await execute("docker", ["compose", "--profile", "stack", "up", "-d", "--wait", "--wait-timeout", "30", "server-1"], { timeout: 40000 });
}
console.log("Smoke check passed: frontend auth routes, PostgreSQL readiness, three backend instances, and graceful shutdown/restart.");
