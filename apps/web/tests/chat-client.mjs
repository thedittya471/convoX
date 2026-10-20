import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import "fake-indexeddb/auto";
import { createChatClient } from "../src/lib/chat-client.ts";

class TestSocket extends EventEmitter {
  connected = false;
  constructor(userId) { super(); this.userId = userId; }
  connect() {
    this.connected = true;
    queueMicrotask(() => this.emit("realtime:ready", { instanceId: "test", userId: this.userId }));
    return this;
  }
  disconnect() { this.connected = false; this.emit("disconnect", "io client disconnect"); return this; }
}

async function until(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(10);
  }
  assert.fail("Client did not reach the expected state");
}

function fixture() {
  const userId = randomUUID();
  const conversationId = randomUUID();
  const socket = new TestSocket(userId);
  const rows = [];
  const received = [];
  const attempts = [];
  let failAfterCommit = false;
  let offline = false;
  let status = 200;
  let intercept;

  function message(sequence, values = {}) {
    return { id: randomUUID(), conversationId, senderId: userId, clientMessageId: randomUUID(), encryptedPayload: `opaque-${sequence}`, sequence: String(sequence), createdAt: "2026-01-01T00:00:00.123Z", ...values };
  }

  async function request(input, options) {
    assert.equal(new Headers(options.headers).get("X-Expected-User-Id"), userId);
    if (offline) throw new TypeError("Synthetic network interruption");
    if (status !== 200) return Response.json({ error: "Synthetic failure" }, { status });
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      attempts.push(body);
      let saved = rows.find((row) => row.clientMessageId === body.clientMessageId);
      const created = !saved;
      if (!saved) { saved = message(rows.length + 1, body); rows.push(saved); }
      if (failAfterCommit) { failAfterCommit = false; throw new TypeError("Response lost after commit"); }
      return Response.json({ message: saved }, { status: created ? 201 : 200 });
    }
    const after = BigInt(new URL(input).searchParams.get("after"));
    const page = rows.filter((row) => BigInt(row.sequence) > after).slice(0, 2);
    const response = { messages: page, nextAfter: rows.some((row) => BigInt(row.sequence) > BigInt(page.at(-1)?.sequence ?? after)) ? page.at(-1).sequence : null };
    if (intercept) await intercept(response);
    return Response.json(response);
  }

  function client(overrides = {}) {
    return createChatClient({ userId, conversationId, apiUrl: "http://chat.test", socket, request,
      onMessages: (batch) => received.push(...batch), ...overrides,
    });
  }

  return { userId, conversationId, socket, rows, received, attempts, message, client,
    offline: (value) => { offline = value; },
    failAfterCommit: () => { failAfterCommit = true; },
    status: (value) => { status = value; },
    intercept: (value) => { intercept = value; },
  };
}

test("catch-up buffers live events, fills gaps and emits each sequence once", async () => {
  const setup = fixture();
  setup.rows.push(...[1, 2, 3, 4].map((sequence) => setup.message(sequence)));
  let release;
  let entered = false;
  setup.intercept(async () => {
    if (!entered) { entered = true; await new Promise((resolve) => { release = resolve; }); }
  });
  const client = setup.client();
  try {
    await client.start();
    await until(() => entered);
    setup.socket.emit("message:created", setup.rows[3]);
    setup.socket.emit("message:created", setup.rows[2]);
    setup.socket.emit("message:created", setup.rows[3]);
    assert.deepEqual(setup.received, []);
    release();
    await until(() => client.getState().cursor === "4");
    setup.socket.emit("message:created", setup.rows[0]);
    setup.socket.emit("message:created", setup.rows[3]);
    setup.rows.push(setup.message(5), setup.message(6));
    setup.socket.emit("message:created", setup.rows[5]);
    await until(() => client.getState().cursor === "6");
    assert.deepEqual(setup.received.map((row) => row.sequence), ["1", "2", "3", "4", "5", "6"]);
    assert.equal(new Set(setup.received.map((row) => row.id)).size, 6);
  } finally { release?.(); await client.stop(); }
});

test("lost send responses survive client restart with identical IDs and envelopes", async () => {
  const setup = fixture();
  setup.failAfterCommit();
  let client = setup.client();
  try {
    await client.start();
    const id = await client.send("opaque-stable-envelope");
    await until(() => setup.attempts.length === 1 && setup.rows.length === 1);
    await client.stop();
    setup.received.length = 0;
    client = setup.client({ socket: new TestSocket(setup.userId) });
    await client.start();
    await until(() => client.getState().pending.length === 0 && setup.attempts.length >= 2);
    assert.equal(setup.attempts[0].clientMessageId, id);
    assert.deepEqual(setup.attempts[1], setup.attempts[0]);
    assert.equal(setup.rows.length, 1);
    assert.equal(setup.received.length, 1);
  } finally { await client.stop(); }
});

test("sync notifications recover missed events, and stopped clients emit nothing", async () => {
  const setup = fixture();
  const client = setup.client();
  await client.start();
  await until(() => client.getState().status === "connected");
  setup.rows.push(setup.message(1));
  setup.socket.emit("sync:required");
  await until(() => client.getState().cursor === "1");
  setup.rows.push(setup.message(2));
  setup.socket.emit("realtime:ready", { instanceId: "different-instance", userId: setup.userId });
  await until(() => client.getState().cursor === "2");
  await client.stop();
  setup.socket.emit("message:created", setup.message(3));
  assert.equal(setup.received.length, 2);
  assert.equal(client.getState().status, "stopped");
});

test("pending messages stay scoped to their user and simultaneous queues do not overwrite", async () => {
  const setup = fixture();
  setup.offline(true);
  const first = setup.client();
  const second = setup.client({ socket: new TestSocket(setup.userId) });
  const different = setup.client({ userId: randomUUID(), socket: new TestSocket("different-user") });
  try {
    await Promise.all([first.start(), second.start()]);
    await Promise.all([first.send("opaque-one"), second.send("opaque-two")]);
    await first.stop();
    await second.stop();
    await different.start();
    assert.equal(different.getState().pending.length, 0);
    const restored = setup.client({ socket: new TestSocket(setup.userId) });
    try {
      await restored.start();
      assert.equal(restored.getState().pending.length, 2);
    } finally { await restored.stop(); }
  } finally { await Promise.all([first.stop(), second.stop(), different.stop()]); }
});

test("conflicts are retained as failed, not silently discarded or retried forever", async () => {
  const setup = fixture();
  const client = setup.client();
  try {
    await client.start();
    await until(() => client.getState().status === "connected");
    setup.status(409);
    const id = await client.send("opaque-conflict");
    await until(() => client.getState().pending.some((row) => row.clientMessageId === id && row.error));
    setup.status(200);
    await client.retry(id);
    await until(() => client.getState().pending.length === 0);
    assert.equal(setup.rows[0].clientMessageId, id);
  } finally { await client.stop(); }
});

test("authentication mismatch stops synchronization and sends", async () => {
  const setup = fixture();
  const client = setup.client({ socket: new TestSocket("wrong-account") });
  try {
    await client.start();
    await until(() => client.getState().status === "unauthenticated");
    assert.equal(setup.received.length, 0);
    await assert.rejects(() => client.send("opaque-not-sent"));
  } finally { await client.stop(); }
});

test("invalid history cannot advance the contiguous cursor", async () => {
  const setup = fixture();
  const client = setup.client({ request: async () => Response.json({ messages: [setup.message(2)], nextAfter: null }) });
  try {
    await client.start();
    await until(() => client.getState().status === "error");
    assert.equal(client.getState().cursor, "0");
    assert.deepEqual(setup.received, []);
  } finally { await client.stop(); }
});

test("stopping during a history request prevents late callbacks", async () => {
  const setup = fixture();
  setup.rows.push(setup.message(1));
  let release;
  setup.intercept(() => new Promise((resolve) => { release = resolve; }));
  const client = setup.client();
  await client.start();
  await until(() => release);
  const stopping = client.stop();
  release();
  await stopping;
  assert.equal(client.getState().cursor, "0");
  assert.deepEqual(setup.received, []);
});

test("sequence handling preserves precision beyond JavaScript's safe integer range", async () => {
  const setup = fixture();
  const client = setup.client({ after: "9007199254740992" });
  try {
    await client.start();
    await until(() => client.getState().status === "connected");
    setup.socket.emit("message:created", setup.message("9007199254740993"));
    assert.equal(client.getState().cursor, "9007199254740993");
    assert.equal(setup.received[0].sequence, "9007199254740993");
  } finally { await client.stop(); }
});

test("a failed message consumer does not acknowledge a sequence it could not apply", async () => {
  const setup = fixture();
  let failing = true;
  const client = setup.client({ onMessages: (batch) => {
    if (failing) throw new Error("Synthetic consumer failure");
    setup.received.push(...batch);
  } });
  try {
    await client.start();
    await until(() => client.getState().status === "connected");
    setup.rows.push(setup.message(1));
    setup.socket.emit("message:created", setup.rows[0]);
    assert.equal(client.getState().cursor, "0");
    failing = false;
    await client.synchronize();
    assert.equal(client.getState().cursor, "1");
    assert.equal(setup.received.length, 1);
  } finally { await client.stop(); }
});
