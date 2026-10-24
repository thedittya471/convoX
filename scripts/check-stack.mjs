import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
const execute = promisify(execFile);

function sanitize(value, secrets) {
  let text = String(value ?? "");
  for (const secret of secrets) text = text.replaceAll(secret, "[redacted]");
  return text
    .replace(/((?:__Secure-)?better-auth\.[\w.-]+=)[^;\s"']+/g, "$1[redacted]")
    .replace(/([?&](?:token|code|key)=)[^&\s"'<>]+/gi, "$1[redacted]")
    .replace(/("(?:password|newPassword|token|accessToken|refreshToken|secret)"\s*:\s*")[^"]*/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, "$1[redacted]");
}

if (process.argv.includes("--self-test")) {
  const cleaned = sanitize('private better-auth.session_token=cookie; ?token=link&x=1 {"password":"value"} Bearer abc.def', ["private"]);
  for (const secret of ["private", "cookie", "link", "value", "abc.def"]) assert.ok(!cleaned.includes(secret));
  assert.ok(cleaned.includes("&x=1"));
  console.log("CI artifact sanitization self-check passed");
} else {
  await checkStack();
}

async function checkStack() {
  process.umask(0o077);
  const directory = await mkdtemp(join(tmpdir(), "convox-ci-"));
  const project = `convox-test-ci-${randomBytes(6).toString("hex")}`;
  const artifacts = resolve(process.env.CI_RESULTS ?? "test-results/ci");
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  await chmod(artifacts, 0o700);
  const secrets = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex")];
  const serverEnv = join(directory, "server.env");
  await writeFile(serverEnv, `BETTER_AUTH_SECRET=${secrets[0]}\nMETRICS_TOKEN=${secrets[1]}\nBETTER_AUTH_URL=http://localhost:8080\nSMTP_HOST=mailpit\nSMTP_PORT=1025\nSMTP_TLS=local\nSMTP_FROM=convox@example.com\n`, { mode: 0o600 });
  const serverImage = `${project}-server:local`, webImage = `${project}-web:local`;
  const override = join(directory, "override.yaml");
  let yaml = `services:\n  postgres:\n    ports: !reset []\n  redis:\n    ports: !reset []\n  mailpit:\n    ports: !reset []\n  nginx:\n    ports: !override ["127.0.0.1:0:80"]\n  web:\n    image: ${webImage}\n`;
  for (let i = 1; i <= 3; i++) yaml += `  server-${i}:\n    image: ${serverImage}\n    env_file: !override [${JSON.stringify(serverEnv)}]\n`;
  await writeFile(override, yaml, { mode: 0o600 });
  const env = { ...process.env, COMPOSE_PROJECT_NAME: project, COMPOSE_FILE: `${resolve("compose.yaml")}:${override}` };
  const results = [];
  const { stdout: commit } = await execute("git", ["rev-parse", "HEAD"]);
  const { stdout: changes } = await execute("git", ["status", "--porcelain"]);
  let failure, cleaned = false;
  async function run(name, command, args, { extraEnv = {}, timeout = 120000 } = {}) {
    const started = performance.now();
    try {
      const result = await execute(command, args, { env: { ...env, ...extraEnv }, timeout, maxBuffer: 4 * 1024 * 1024 });
      await writeFile(join(artifacts, `${name}.log`), sanitize(result.stdout + result.stderr, secrets), { mode: 0o600 });
      results.push({ name, passed: true, elapsedMs: Math.round(performance.now() - started) });
      console.log(`${name}: passed`);
      return result.stdout.trim();
    } catch (error) {
      await writeFile(join(artifacts, `${name}.log`), sanitize((error.stdout ?? "") + (error.stderr ?? ""), secrets), { mode: 0o600 });
      results.push({ name, passed: false, elapsedMs: Math.round(performance.now() - started) });
      throw new Error(`${name} failed; inspect its sanitized artifact`, { cause: error.code });
    }
  }
  const compose = (name, args, options) => run(name, "docker", ["compose", ...args], options);
  try {
    await compose("compose", ["--profile", "stack", "--profile", "mail", "config", "--quiet"]);
    await run("audit", "pnpm", ["audit", "--prod", "--audit-level=high", "--json"]);
    await compose("build", ["--profile", "stack", "build", "server-1", "web"], { timeout: 600000 });
    await compose("dependencies", ["--profile", "mail", "up", "-d", "--wait", "postgres", "redis", "mailpit"]);
    await compose("migrate", ["run", "--rm", "--no-deps", "-w", "/app/apps/server", "server-1", "node", "node_modules/drizzle-kit/bin.cjs", "migrate"]);
    await compose("startup", ["--profile", "stack", "--profile", "mail", "up", "-d", "--no-build", "--wait", "--wait-timeout", "90"]);
    const address = await compose("gateway-port", ["port", "nginx", "80"]);
    env.SMOKE_URL = `http://${address}`;
    for (const name of ["smoke", "auth", "conversations", "messages", "realtime", "client-sync", "presence", "typing", "limits", "sockets", "metrics", "gateway", "outages", "api-reference"]) {
      await run(name, "pnpm", [`test:${name}`], { timeout: 180000 });
    }
    await compose("smtp-stop", ["stop", "mailpit"]);
    try { await compose("smtp-outage", ["exec", "-T", "server-1", "node", "tests/integration/email-unavailable.mjs"]); }
    finally { await compose("smtp-return", ["start", "mailpit"]); }
    await compose("backup-fence", ["stop", "server-1", "server-2", "server-3"]);
    const helper = `${project}-backup-helper`;
    await compose("backup-helper", ["run", "-d", "--name", helper, "--no-deps", "--entrypoint", "sleep", "server-2", "infinity"]);
    await run("backup", "pnpm", ["test:backup"], { extraEnv: { BACKUP_TEST_CONTAINER: `${project}-postgres-1`, BACKUP_TEST_APP_CONTAINER: helper } });
    await compose("backup-return", ["--profile", "stack", "up", "-d", "--no-build", "--wait", "--wait-timeout", "45", "server-1", "server-2", "server-3"]);
  } catch (error) { failure = error; }
  finally {
    try {
      await compose("cleanup", ["--profile", "stack", "--profile", "mail", "down", "--volumes", "--remove-orphans"]);
      cleaned = true;
    } catch (error) { failure ??= error; }
    await rm(directory, { recursive: true, force: true });
    // Remove only this runner's image tags; other projects/images are never pruned.
    await execute("docker", ["image", "rm", serverImage, webImage], { timeout: 30000 }).catch(() => {});
    await writeFile(join(artifacts, "summary.json"), JSON.stringify({ commit: commit.trim(), workingTreeChanges: changes.trim().split("\n").filter(Boolean), node: process.version, project, cleaned, results, passed: !failure }, null, 2) + "\n", { mode: 0o600 });
  }
  if (failure) throw failure;
  console.log(`CI stack passed; artifacts: ${artifacts}`);
}
