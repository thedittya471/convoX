import { verifyFixture } from "./verify-email.mjs";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

const execute = promisify(execFile);

if (process.argv.includes("--run")) {
  await run();
} else {
  const child = spawn("docker", ["compose", "exec", "-T", "server-2", "node", "--import", "/app/apps/web/node_modules/tsx/dist/loader.mjs", "tests/integration/client-sync.mjs", "--run"], { stdio: ["pipe", "pipe", "inherit"] });
  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Client synchronization integration exited with ${code}`)));
  });
  let killed;
  try {
    const output = (async () => {
      for await (const line of createInterface({ input: child.stdout })) {
        if (line.startsWith("KILL:")) {
          killed = line.slice("KILL:".length);
          assert.ok(["server-1", "server-3"].includes(killed));
          await execute("docker", ["compose", "kill", "-s", "SIGKILL", killed], { timeout: 20000 });
          child.stdin.end("killed\n");
        } else {
          console.log(line);
        }
      }
    })();
    await Promise.all([completion, output]);
  } finally {
    child.stdin.end();
    if (killed) await execute("docker", ["compose", "--profile", "stack", "up", "-d", "--wait", "--wait-timeout", "30", killed], { timeout: 40000 });
  }
}

async function run() {
  const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  require("fake-indexeddb/auto");
  const { io } = require("socket.io-client");
  const { createChatClient } = await import("../../apps/web/src/lib/chat-client.ts");
  const { pool } = await import("../../apps/server/dist/db/client.js");
  const origin = new URL(process.env.BETTER_AUTH_URL).origin;
  const suffix = randomUUID();
  const emails = [0, 1].map((index) => `client-sync-${suffix}-${index}@example.com`);
  const actors = [];
  const clients = [];
  const originalGeneration = (await pool.query("SELECT generation FROM history")).rows[0].generation;
  const received = new Map();
  const sentBodies = [];
  let current;
  let activeInstance;
  let holdHistory = false;
  let historyWaiting = false;
  let releaseHistory;
  let loseResponse = false;
  let cookieOwner;

  async function until(check, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await check()) return;
      await sleep(20);
    }
    assert.fail(`Client did not recover: ${JSON.stringify(current?.getState())}`);
  }

  async function request(path, actor, body, expectedUserId) {
    return fetch(`http://server-2:4000${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { origin, cookie: actor.cookie, ...(expectedUserId ? { "X-Expected-User-Id": expectedUserId } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
    });
  }

  try {
    for (const [index, email] of emails.entries()) {
      const response = await fetch("http://server-2:4000/api/auth/sign-up/email", { method: "POST", headers: { origin, "content-type": "application/json", "x-real-ip": `198.25.${randomBytes(1)[0]}.${randomBytes(1)[0]}` }, body: JSON.stringify({ name: `Client sync fixture ${index}`, email, password: randomBytes(24).toString("base64url") }) });
      assert.equal(response.status, 200);
      actors.push({ ...(await response.json()).user, cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
      await verifyFixture(email);
    }
    const [alice, bob] = actors;
    cookieOwner = alice;
    const opened = await request("/api/conversations", alice, { otherUserId: bob.id });
    assert.equal(opened.status, 201);
    const conversationId = (await opened.json()).conversation.id;
    const path = `/api/conversations/${conversationId}/messages`;

    async function sendFromBob(label) {
      const response = await request(path, bob, { clientMessageId: randomUUID(), encryptedPayload: label });
      assert.equal(response.status, 201);
      return (await response.json()).message;
    }

    async function clientRequest(input, options) {
      const headers = new Headers(options.headers);
      headers.set("cookie", cookieOwner.cookie);
      headers.set("origin", origin);
      const response = await fetch(input, { ...options, headers });
      if (options.method === "POST") {
        sentBodies.push(JSON.parse(options.body));
        if (loseResponse && response.ok) { loseResponse = false; throw new TypeError("Synthetic lost response after commit"); }
      } else if (holdHistory && response.ok) {
        holdHistory = false;
        historyWaiting = true;
        await new Promise((resolve) => { releaseHistory = resolve; });
      }
      return response;
    }

    let generation = (await pool.query("SELECT generation FROM history")).rows[0].generation;
    function createClient(after = "0", overrides = {}) {
      const socket = io("http://nginx", { transports: ["websocket"], autoConnect: false, extraHeaders: { cookie: alice.cookie, origin }, reconnectionDelay: 250, reconnectionDelayMax: 1000, timeout: 2000 });
      socket.on("realtime:ready", (value) => { activeInstance = value.instanceId; });
      const client = createChatClient({ userId: alice.id, conversationId, after, generation, apiUrl: "http://nginx", socket, request: clientRequest,
        onMessages: (batch) => { for (const message of batch) { assert.equal(received.has(message.id), false, "one client lifecycle must emit a message only once"); received.set(message.id, message); } }, ...overrides,
      });
      clients.push(client);
      return client;
    }

    await sendFromBob("opaque-before-connection");
    holdHistory = true;
    current = createClient();
    await current.start();
    await until(() => historyWaiting);
    await sendFromBob("opaque-during-history");
    await sleep(100);
    assert.equal(received.size, 0, "live events must stay buffered during history catch-up");
    releaseHistory();
    await until(() => current.getState().cursor === "2");

    loseResponse = true;
    const clientMessageId = await current.send("opaque-retry-envelope");
    await until(() => sentBodies.length === 1);
    await current.stop();
    received.clear();
    current = createClient();
    await current.start();
    await until(() => current.getState().pending.length === 0 && current.getState().cursor === "3");
    await until(() => current.getState().status === "connected");
    assert.deepEqual(sentBodies[1], sentBodies[0]);
    assert.equal((await pool.query("SELECT id FROM message WHERE sender_id = $1 AND client_message_id = $2", [alice.id, clientMessageId])).rowCount, 1);

    for (let attempt = 0; activeInstance === "server-2" && attempt < 8; attempt += 1) {
      const after = current.getState().cursor;
      await current.stop();
      current = createClient(after);
      await current.start();
      await until(() => current.getState().status === "connected");
    }
    assert.ok(["server-1", "server-3"].includes(activeInstance));
    const failedInstance = activeInstance;
    holdHistory = true;
    historyWaiting = false;
    const killed = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Fault controller did not respond")), 30000);
      process.stdin.once("data", () => { clearTimeout(deadline); resolve(); });
    });
    console.log(`KILL:${failedInstance}`);
    await killed;
    for (let index = 0; index < 5; index += 1) await sendFromBob(`opaque-during-recovery-${index}`);
    await until(() => activeInstance !== failedInstance && historyWaiting, 15000);
    releaseHistory();
    await until(() => current.getState().cursor === "8" && current.getState().status === "connected");
    const persisted = await request(`${path}?after=0&limit=100`, alice);
    assert.deepEqual([...received.values()].map((row) => row.id), (await persisted.json()).messages.map((row) => row.id));
    assert.equal(received.size, 8);

    const otherReceived = [];
    const otherView = createClient("8", { onMessages: (batch) => otherReceived.push(...batch) });
    await otherView.start();
    await until(() => otherView.getState().status === "connected");
    await current.stop();
    const afterClosing = await sendFromBob("other-view-remains-active");
    await until(() => otherView.getState().cursor === afterClosing.sequence);
    assert.deepEqual(otherReceived.map((message) => message.id), [afterClosing.id]);
    assert.equal(received.size, 8, "closing one view prevents late history from reaching it");
    current = otherView;

    cookieOwner = bob;
    const switched = await current.send("opaque-account-switch-must-not-send");
    await until(() => current.getState().status === "unauthenticated");
    assert.equal((await pool.query("SELECT id FROM message WHERE client_message_id = $1", [switched])).rowCount, 0, "an account switch must not send another user's queued envelope");
    assert.ok(current.getState().pending.some((row) => row.clientMessageId === switched));
    await current.stop();
    cookieOwner = alice;
    current = createClient("9", { resumePending: false });
    await current.start();
    await until(() => current.getState().status === "connected");
    await pool.query("UPDATE history SET generation = gen_random_uuid()");
    await current.synchronize();
    assert.equal(current.getState().status, "recovery-required", "quiet open clients must detect restored history");
    assert.ok(current.getState().pending.some((row) => row.clientMessageId === switched));
    await current.stop();
    current = createClient("9", { resumePending: false });
    await current.start();
    await until(() => current.getState().status === "recovery-required");
    await current.stop();
    const bootstrap = await request(`${path}?recent=true&limit=50`, alice);
    assert.equal(bootstrap.status, 200);
    const fresh = await bootstrap.json();
    generation = fresh.generation;
    received.clear();
    for (const row of fresh.messages) received.set(row.id, row);
    current = createClient(fresh.headSequence, { resumePending: false });
    await current.start();
    await until(() => current.getState().status === "connected");
    assert.ok(current.getState().pending.some((row) => row.clientMessageId === switched));
    assert.equal((await pool.query("SELECT id FROM message WHERE client_message_id = $1", [switched])).rowCount, 0, "rebuilding history must not recreate queued or previously accepted messages");
    console.log("Client sync integration passed: buffered catch-up, durable identical retries, gateway failover, gap-free ordered recovery and account-switch protection, independent view cleanup, generation invalidation and explicit bootstrap with preserved pending sends.");
  } finally {
    releaseHistory?.();
    await Promise.all(clients.map((client) => client.stop()));
    process.stdin.pause();
    await pool.query("UPDATE history SET generation = $1", [originalGeneration]);
    const ids = actors.map((actor) => actor.id);
    await pool.query("DELETE FROM message WHERE sender_id = ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM conversation WHERE direct_user_low_id = ANY($1::text[]) OR direct_user_high_id = ANY($1::text[])", [ids]);
    await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [emails]);
    await pool.end();
  }
}
