import { verifyFixture } from "./verify-email.mjs";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

const execute = promisify(execFile);

if (process.argv.includes("--claim")) {
  const { publishNextMessage } = await import("../../apps/server/dist/services/outbox.service.js");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await publishNextMessage(async (message) => {
      assert.equal(message.id, process.argv.at(-1), "only the synthetic message may be claimed");
      console.log("OUTBOX_CLAIMED");
      await new Promise(() => {});
    });
    await sleep(50);
  }
  throw new Error("Expected an outbox claim to remain open until the process is killed");
} else if (process.argv.includes("--run")) {
  await run();
} else {
  const child = spawn("docker", ["compose", "exec", "-T", "server-2", "node", "tests/integration/realtime.mjs", "--run"], { stdio: ["pipe", "pipe", "inherit"] });
  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Realtime integration exited with ${code}`)));
  });
  let claiming = false;
  try {
    const output = (async () => {
      for await (const line of createInterface({ input: child.stdout })) {
        if (line === "STOP_REDIS") {
          await execute("docker", ["compose", "stop", "redis"], { timeout: 20000 });
          child.stdin.write("stopped\n");
        } else if (line.startsWith("CRASH_PUBLISHER:")) {
          const id = line.slice("CRASH_PUBLISHER:".length);
          claiming = true;
          const claim = spawn("docker", ["compose", "exec", "-T", "server-1", "node", "tests/integration/realtime.mjs", "--claim", id], { stdio: ["ignore", "pipe", "inherit"] });
          const exited = new Promise((resolve) => claim.once("exit", resolve));
          await new Promise((resolve, reject) => {
            const deadline = setTimeout(() => reject(new Error("No publisher claim acquired")), 10000);
            claim.once("error", (error) => { clearTimeout(deadline); reject(error); });
            claim.stdout.once("data", () => { clearTimeout(deadline); resolve(); });
          });
          await execute("docker", ["compose", "kill", "-s", "SIGKILL", "server-1"], { timeout: 20000 });
          await exited;
          claiming = false;
          await execute("docker", ["compose", "start", "redis"], { timeout: 20000 });
          await execute("docker", ["compose", "--profile", "stack", "up", "-d", "--wait", "--wait-timeout", "30", "server-1"], { timeout: 40000 });
          child.stdin.end("restarted\n");
        } else {
          console.log(line);
        }
      }
    })();
    await Promise.all([completion, output]);
  } finally {
    child.stdin.end();
    if (claiming) {
      await execute("docker", ["compose", "kill", "-s", "SIGKILL", "server-1"], { timeout: 20000 }).catch(() => {});
    }
    await execute("docker", ["compose", "--profile", "stack", "up", "-d", "--wait", "--wait-timeout", "30", "redis", "server-1"], { timeout: 40000 });
  }
}

async function run() {
  const require = createRequire(new URL("../../apps/server/package.json", import.meta.url));
  const { io } = require("socket.io-client");
  const { messageSchema } = await import("../../packages/contracts/dist/index.js");
  const { pool } = await import("../../apps/server/dist/db/client.js");
  const servers = ["http://server-1:4000", "http://server-2:4000", "http://server-3:4000"];
  const origin = new URL(process.env.BETTER_AUTH_URL).origin;
  const suffix = randomUUID();
  const emails = Array.from({ length: 3 }, (_value, index) => `realtime-test-${suffix}-${index}@example.com`);
  const actors = [];
  const sockets = [];
  async function metricSnapshots() {
    if (!process.env.METRICS_TOKEN) return null;
    return Promise.all(servers.map(async (server) => {
      const response = await fetch(`${server}/internal/metrics`, { headers: { authorization: `Bearer ${process.env.METRICS_TOKEN}` } });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.doesNotMatch(text, /user_id|message_id|conversation_id|session_token|encryptedPayload/);
      return Object.fromEntries([...text.matchAll(/^convox_(\w+)\{[^}]*\} (\d+(?:\.\d+)?)$/gm)].map((match) => [match[1], Number(match[2])]));
    }));
  }
  const baselineMetrics = await metricSnapshots();

  async function until(check, description, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return;
      await sleep(50);
    }
    assert.fail(description);
  }

  function connect(actor, server, requestOrigin = origin) {
    const socket = io(server, { path: "/socket.io", transports: ["websocket"], autoConnect: false, reconnection: false,
      extraHeaders: { ...(actor ? { cookie: actor.cookie } : {}), ...(requestOrigin ? { origin: requestOrigin } : {}) },
    });
    sockets.push(socket);
    socket.received = [];
    socket.on("message:created", (message) => socket.received.push(messageSchema.parse(message)));
    return { socket, ready: new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Socket did not become ready at ${server}`)), 5000);
      socket.once("realtime:ready", (value) => { clearTimeout(deadline); resolve(value); });
      socket.once("connect_error", (error) => { clearTimeout(deadline); reject(error); });
      socket.connect();
    }) };
  }

  async function request(path, actor, body, server = servers[0]) {
    return fetch(`${server}${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { origin, cookie: actor.cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
    });
  }

  async function command(value) {
    const resumed = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Controller timed out: ${value}`)), 90000);
      process.stdin.once("data", () => { clearTimeout(deadline); resolve(); });
    });
    console.log(value);
    await resumed;
  }

  try {
    for (const [index, email] of emails.entries()) {
      const response = await fetch(`${servers[index]}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-real-ip": `198.24.${randomBytes(1)[0]}.${randomBytes(1)[0]}` }, body: JSON.stringify({ name: `Realtime fixture ${index}`, email, password: randomBytes(24).toString("base64url") }) });
      assert.equal(response.status, 200);
      actors.push({ ...(await response.json()).user, cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
      if (index === 0) {
        const unverified = connect(actors[0], servers[1]);
        await assert.rejects(unverified.ready, (error) => error.data?.code === "EMAIL_NOT_VERIFIED");
        unverified.socket.disconnect();
      }
      await verifyFixture(email);
    }
    const [alice, bob, outsider] = actors;
    for (const [actor, requestOrigin] of [[null, origin], [alice, "https://untrusted.example"], [alice, null]]) {
      const denied = connect(actor, servers[0], requestOrigin);
      await assert.rejects(denied.ready);
      denied.socket.disconnect();
    }
    const first = connect(alice, servers[0]);
    assert.equal((await first.ready).instanceId, "server-1");
    const second = connect(bob, servers[2]);
    assert.equal((await second.ready).instanceId, "server-3");
    const extra = connect(alice, servers[1]);
    await extra.ready;
    const stranger = connect(outsider, servers[1]);
    await stranger.ready;
    const gateway = connect(alice, "http://nginx");
    await gateway.ready;
    stranger.socket.emit("join", `user:${alice.id}`);

    const opened = await request("/api/conversations", alice, { otherUserId: bob.id });
    assert.equal(opened.status, 201);
    const id = (await opened.json()).conversation.id;
    const path = `/api/conversations/${id}/messages`;
    const body = { clientMessageId: randomUUID(), encryptedPayload: "opaque-realtime-fixture" };
    const response = await request(path, alice, body);
    assert.equal(response.status, 201);
    const saved = (await response.json()).message;
    await until(() => [first, second, extra, gateway].every((client) => client.socket.received.some((item) => item.id === saved.id)), "all participant devices must receive a cross-instance event");
    await until(async () => (await pool.query("SELECT published_at FROM message_outbox WHERE message_id = $1", [saved.id])).rows[0].published_at !== null, "publication must be recorded");
    const retry = await request(path, alice, body, servers[2]);
    assert.equal(retry.status, 200);
    await sleep(300);
    if (baselineMetrics) {
      const current = await metricSnapshots();
      assert.equal(current.reduce((sum, row, index) => sum + row.durable_accepts_total - baselineMetrics[index].durable_accepts_total, 0), 1, "idempotent retry must not count as a new durable accept");
      assert.equal(current[0].durable_accepts_total - baselineMetrics[0].durable_accepts_total, 1);
      assert.equal(current.reduce((sum, row) => sum + row.active_sockets, 0), 5);
      assert.ok(current.reduce((sum, row) => sum + row.routing_seconds_count, 0) >= 1);
      assert.ok(current.every((row) => row.outbox_collection_available === 1));
      assert.equal((await fetch(`${servers[0]}/internal/metrics`)).status, 404);
      assert.equal((await fetch("http://nginx/internal/metrics", { headers: { authorization: `Bearer ${process.env.METRICS_TOKEN}` } })).status, 404);
    }
    assert.equal(second.socket.received.filter((item) => item.id === saved.id).length, 1);

    await pool.query("UPDATE message_outbox SET published_at = NULL WHERE message_id = $1", [saved.id]);
    await until(() => second.socket.received.filter((item) => item.id === saved.id).length === 2, "republication must retain the same message identity");
    assert.equal(new Map(second.socket.received.map((item) => [item.id, item])).size, 1, "clients can deduplicate at-least-once events by ID");

    let syncRequired = false;
    second.socket.on("sync:required", () => { syncRequired = true; });
    await command("STOP_REDIS");
    const queued = await request(path, alice, { clientMessageId: randomUUID(), encryptedPayload: "opaque-publisher-crash-fixture" }, servers[1]);
    assert.equal(queued.status, 201, "Redis downtime must not prevent durable acceptance");
    const pending = (await queued.json()).message;
    await pool.query("UPDATE message_outbox SET created_at = '1970-01-01' WHERE message_id = $1", [pending.id]);
    await sleep(300);
    assert.equal((await pool.query("SELECT published_at FROM message_outbox WHERE message_id = $1", [pending.id])).rows[0].published_at, null);
    assert.equal(second.socket.received.some((item) => item.id === pending.id), false);
    await command(`CRASH_PUBLISHER:${pending.id}`);
    await until(async () => (await pool.query("SELECT published_at FROM message_outbox WHERE message_id = $1", [pending.id])).rows[0].published_at !== null, "recovered message must be marked published");
    assert.equal(syncRequired, true, "broker recovery must ask connected clients to synchronize history");
    const history = await request(`${path}?after=${saved.sequence}&generation=${(await pool.query("SELECT generation FROM history")).rows[0].generation}`, bob, undefined, servers[2]);
    assert.deepEqual((await history.json()).messages.map((item) => item.id), [pending.id]);
    const recovered = await request(`${path}?after=${saved.sequence}&generation=${(await pool.query("SELECT generation FROM history")).rows[0].generation}`, alice, undefined, servers[1]);
    assert.deepEqual((await recovered.json()).messages.map((item) => item.id), [pending.id], "both participants must recover the message even if they resubscribe after publication");
    const afterRecovery = await request(path, alice, { clientMessageId: randomUUID(), encryptedPayload: "opaque-after-recovery" }, servers[1]);
    assert.equal(afterRecovery.status, 201);
    const live = (await afterRecovery.json()).message;
    await until(() => second.socket.received.some((item) => item.id === live.id) && extra.socket.received.some((item) => item.id === live.id), "cross-instance live delivery must resume after Redis recovery");

    const signOut = await request("/api/auth/sign-out", bob, {}, servers[2]);
    assert.equal(signOut.status, 200);
    const afterLogout = await request(path, alice, { clientMessageId: randomUUID(), encryptedPayload: "opaque-after-logout" }, servers[1]);
    assert.equal(afterLogout.status, 201);
    const privateMessage = (await afterLogout.json()).message;
    await until(() => !second.socket.connected, "revoked sessions must be disconnected before further delivery");
    assert.equal(second.socket.received.some((item) => item.id === privateMessage.id), false);
    const revoked = connect(bob, servers[2]);
    await assert.rejects(revoked.ready);
    await pool.query('UPDATE "session" SET expires_at = NOW() - INTERVAL \'1 second\' WHERE user_id = $1', [outsider.id]);
    const expired = connect(outsider, servers[1]);
    await assert.rejects(expired.ready);
    assert.deepEqual(stranger.socket.received, [], "a client-supplied room name must not expose another user's messages");
    console.log("Realtime integration passed: authenticated WebSockets, NGINX upgrades, cross-instance/device delivery, retry identity, session revocation, Redis recovery and crash-safe outbox publishing.");
  } finally {
    process.stdin.pause();
    for (const socket of sockets) socket.disconnect();
    const ids = actors.map((actor) => actor.id);
    await pool.query("DELETE FROM message WHERE sender_id = ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM conversation WHERE direct_user_low_id = ANY($1::text[]) OR direct_user_high_id = ANY($1::text[])", [ids]);
    await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [emails]);
    await pool.end();
  }
}
