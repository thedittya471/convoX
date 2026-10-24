import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { verifyFixture } from "./verify-email.mjs";

if (!process.argv.includes("--run")) {
  assert.ok(process.env.COMPOSE_PROJECT_NAME?.startsWith("convox-test-") || process.env.COMPOSE_PROJECT_NAME === "convox-release", "Fault tests require an explicitly named disposable project");
  const compose = (...args) => execFileSync("docker", ["compose", ...args], { stdio: "ignore", timeout: 60000 });
  const child = spawn("docker", ["compose", "exec", "-T", "server-2", "node", "tests/integration/dependency-outage.mjs", "--run"], { stdio: ["pipe", "pipe", "inherit"] });
  const done = new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Fault worker exited ${code}`))); });
  done.catch(() => {});
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const command = { STOP_DATABASE: ["stop", "postgres"], START_DATABASE: ["start", "postgres"], STOP_REDIS: ["stop", "redis"], START_REDIS: ["start", "redis"] }[line];
      if (command) { compose(...command); child.stdin.write("done\n"); } else console.log(line);
    }
    await done;
  } finally { child.stdin.end(); compose("start", "postgres", "redis"); }
} else {
  const { pool } = await import("../../apps/server/dist/db/client.js");
  const servers = ["http://server-1:4000", "http://server-3:4000"];
  const origin = process.env.BETTER_AUTH_URL;
  const actors = [];
  const fixtureIp = `198.29.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const request = (path, actor, body, server = servers[0]) => fetch(`${server}${path}`, {
    method: body ? "POST" : "GET", headers: { "x-real-ip": fixtureIp, origin, "content-type": "application/json", ...(actor ? { cookie: actor.cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000),
  });
  async function control(command) {
    const resumed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fault controller timed out")), 30000);
      process.stdin.once("data", () => { clearTimeout(timer); resolve(); });
    });
    console.log(command);
    await resumed;
  }
  async function until(check) {
    const deadline = performance.now() + 20000;
    while (performance.now() < deadline) { try { if (await check()) return; } catch {} await sleep(100); }
    assert.fail("Dependency did not recover within 20 seconds");
  }
  try {
    for (let i = 0; i < 2; i++) {
      const email = `outage-${randomUUID()}@example.com`;
      const response = await request("/api/auth/sign-up/email", null, { email, name: "Outage fixture", password: randomBytes(20).toString("hex") });
      assert.equal(response.status, 200);
      actors.push({ ...(await response.json()).user, cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
      await verifyFixture(email);
    }
    const opened = await request("/api/conversations", actors[0], { otherUserId: actors[1].id });
    assert.equal(opened.status, 201);
    const id = (await opened.json()).conversation.id;
    const path = `/api/conversations/${id}/messages`;
    const body = { clientMessageId: randomUUID(), encryptedPayload: "ambiguous acknowledgement" };
    // Intentionally discard the first response body, as a lost acknowledgement.
    assert.equal((await request(path, actors[0], body)).status, 201);
    await control("STOP_DATABASE");
    const start = performance.now();
    const failedId = randomUUID();
    const failures = await Promise.all(Array.from({ length: 12 }, () => request(path, actors[0], { ...body, clientMessageId: failedId })));
    assert.ok(failures.every((r) => r.status === 503), "storage loss must never acknowledge persistence");
    assert.ok(performance.now() - start < 8000, "database outage requests must remain bounded");
    await control("START_DATABASE");
    await until(async () => (await Promise.all(servers.map((server) => request("/api/health/ready", null, undefined, server)))).every((r) => r.ok));
    const retry = await request(path, actors[0], body, servers[1]);
    assert.equal(retry.status, 200);
    assert.equal((await pool.query("SELECT count(*) FROM message WHERE client_message_id=$1", [failedId])).rows[0].count, "0");
    assert.equal((await pool.query("SELECT count(*) FROM message WHERE client_message_id=$1", [body.clientMessageId])).rows[0].count, "1");
    await control("STOP_REDIS");
    await until(async () => (await request("/api/health/realtime")).status === 503);
    assert.equal((await request("/api/health/ready")).status, 200);
    const queued = { clientMessageId: randomUUID(), encryptedPayload: "durable during routing outage" };
    const accepted = await request(path, actors[0], queued);
    assert.equal(accepted.status, 201);
    const message = (await accepted.json()).message;
    assert.equal((await request(`${path}?recent=true`, actors[1])).status, 200);
    assert.equal((await pool.query("SELECT published_at FROM message_outbox WHERE message_id=$1", [message.id])).rows[0].published_at, null);
    await control("START_REDIS");
    await until(async () => (await request("/api/health/realtime")).ok);
    await until(async () => (await pool.query("SELECT published_at FROM message_outbox WHERE message_id=$1", [message.id])).rows[0].published_at !== null);
    assert.equal((await request(path, actors[0], queued, servers[1])).status, 200);
    console.log("Dependency outage passed: bounded database failures, lost-ack reconciliation, durable Redis-outage acceptance and outbox recovery");
  } finally {
    process.stdin.pause();
    const ids = actors.map((a) => a.id);
    await pool.query("DELETE FROM message WHERE sender_id=ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM conversation WHERE direct_user_low_id=ANY($1::text[]) OR direct_user_high_id=ANY($1::text[])", [ids]);
    await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [ids]);
    await pool.end();
  }
}
