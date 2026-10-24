import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import "fake-indexeddb/auto";
import { createChatClient } from "../src/lib/chat-client.ts";

const testGeneration = randomUUID();

class TestSocket extends EventEmitter {
  connected = false;
  constructor(userId) { super(); this.userId = userId; this.generation = testGeneration; }
  emit(event, ...args) {
    if (event === "realtime:ready") args[0] = { generation: this.generation, ...args[0] };
    if (event === "message:created" && args[1] === undefined) args[1] = this.generation;
    return super.emit(event, ...args);
  }
  connect() {
    this.connected = true;
    queueMicrotask(() => this.emit("realtime:ready", { instanceId: "test", userId: this.userId, ...(this.generation ? { generation: this.generation } : {}) }));
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
    const response = { ...(socket.generation ? { generation: socket.generation } : {}), messages: page, nextAfter: rows.some((row) => BigInt(row.sequence) > BigInt(page.at(-1)?.sequence ?? after)) ? page.at(-1).sequence : null };
    if (intercept) await intercept(response);
    return Response.json(response);
  }

  function client(overrides = {}) {
    return createChatClient({ userId, conversationId, generation: socket.generation, apiUrl: "http://chat.test", socket, request,
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
  const client = setup.client({ request: async () => Response.json({ messages: [setup.message(2)], nextAfter: null, generation: setup.socket.generation }) });
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
  setup.socket.generation = randomUUID();
  const client = setup.client({ after: "9007199254740992", generation: setup.socket.generation });
  try {
    await client.start();
    await until(() => client.getState().status === "connected");
    setup.socket.emit("message:created", setup.message("9007199254740993"), setup.socket.generation);
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

test("an unverified socket identity stops retries with verification guidance", async () => {
  const setup = fixture();
  const client = setup.client();
  try {
    await client.start();
    await until(() => client.getState().status === "connected");
    setup.socket.emit("connect_error", Object.assign(new Error("Verify email"), { data: { code: "EMAIL_NOT_VERIFIED" } }));
    assert.equal(client.getState().status, "unauthenticated");
    assert.match(client.getState().error, /verify your email/i);
    await assert.rejects(() => client.send("must-not-send"));
  } finally { await client.stop(); }
});

test("explicit history recovery errors halt retries and preserve pending identities", async () => {
  for (const [status, code] of [[409, "CURSOR_AHEAD"], [410, "HISTORY_UNAVAILABLE"], [409, "HISTORY_RESET"]]) {
    const setup = fixture();
    const { savePendingMessage, loadPendingMessages } = await import("../src/lib/message-outbox.ts");
    const pending = { userId: setup.userId, conversationId: setup.conversationId, clientMessageId: randomUUID(), encryptedPayload: "keep-this-pending", error: null };
    await savePendingMessage(pending);
    const client = setup.client({ request: async () => Response.json({ code, error: "Reload history." }, { status }) });
    try {
      await client.start();
      await until(() => client.getState().status === "recovery-required");
      await client.synchronize();
      assert.equal(setup.socket.connected, false);
      assert.equal((await loadPendingMessages(setup.userId, setup.conversationId))[0].clientMessageId, pending.clientMessageId);
      assert.equal(setup.attempts.length, 0);
    } finally { await client.stop(); }
  }
});

test("an open client rejects a restored generation even with an unchanged numeric head", async () => {
  const setup = fixture();
  const generation = randomUUID();
  setup.socket.connect = function () {
    this.connected = true;
    queueMicrotask(() => this.emit("realtime:ready", { userId: setup.userId, instanceId: "test", generation }));
    return this;
  };
  const client = setup.client({ generation, after: "1", resumePending: false,
    request: async () => Response.json({ messages: [], nextAfter: null, generation }) });
  try {
    await client.start();
    await until(() => client.getState().status === "connected");
    setup.socket.emit("message:created", setup.message(2), randomUUID());
    assert.equal(client.getState().status, "recovery-required");
    assert.deepEqual(setup.received, []);
    assert.equal(client.getState().cursor, "1");
  } finally { await client.stop(); }
});

test("unavailable local storage never starts live delivery or removes pending data", async () => {
  const setup = fixture();
  const storage = globalThis.indexedDB;
  const client = setup.client();
  try {
    globalThis.indexedDB = undefined;
    await assert.rejects(client.start());
    assert.equal(setup.socket.connected, false);
  } finally { globalThis.indexedDB = storage; await client.stop(); }
});


test("a resumed numeric checkpoint cannot adopt a new generation", () => {
  const setup = fixture();
  assert.throws(() => setup.client({ after: "1", generation: undefined }), /original history generation/);
});


test("a fresh client never resends an old-generation or unversioned pending entry", async () => {
  const { savePendingMessage, loadPendingMessages } = await import("../src/lib/message-outbox.ts");
  for (const oldGeneration of [randomUUID(), undefined]) {
    const setup = fixture();
    setup.socket.generation = randomUUID();
    const pending = { userId: setup.userId, conversationId: setup.conversationId, clientMessageId: randomUUID(), encryptedPayload: "preserve-original-envelope", error: null, ...(oldGeneration ? { generation: oldGeneration } : {}) };
    await savePendingMessage(pending);
    const client = setup.client();
    try {
      await client.start();
      await until(() => client.getState().status === "recovery-required");
      assert.equal(setup.attempts.length, 0);
      const [saved] = await loadPendingMessages(setup.userId, setup.conversationId);
      assert.equal(saved.clientMessageId, pending.clientMessageId);
      assert.equal(saved.encryptedPayload, pending.encryptedPayload);
      assert.equal(saved.generation, oldGeneration);
    } finally { await client.stop(); }
  }
});


test("a first send cannot create an unversioned queue before the initial handshake", async () => {
  const setup = fixture();
  setup.socket.connect = function () { return this; };
  const client = setup.client({ generation: undefined });
  try {
    await client.start();
    await assert.rejects(client.send("keep draft"), /Wait for history/);
    assert.equal(client.getState().pending.length, 0);
  } finally { await client.stop(); }
});


test("local persistence failure creates no pending entry or network send", async () => {
  const setup = fixture();
  const client = setup.client();
  const put = IDBObjectStore.prototype.put;
  try {
    await client.start();
    await until(() => client.getState().status === "connected");
    IDBObjectStore.prototype.put = function () { throw new DOMException("Device storage is full", "QuotaExceededError"); };
    await assert.rejects(client.send("draft must remain"), { name: "QuotaExceededError" });
    assert.equal(client.getState().pending.length, 0);
    assert.equal(setup.attempts.length, 0);
  } finally { IDBObjectStore.prototype.put = put; await client.stop(); }
});

test("message payload validation preserves Unicode and enforces character and request byte limits", async () => {
  const setup = fixture();
  setup.offline(true);
  const client = setup.client();
  try {
    await client.start();
    const text = "😀".repeat(4000);
    await client.send(text);
    assert.equal(client.getState().pending[0].encryptedPayload, text);
    await assert.rejects(client.send("a".repeat(8193)));
    await assert.rejects(client.send("😀".repeat(8192)), RangeError);
    await assert.rejects(client.send("\u0001".repeat(8192)), RangeError);
    await assert.rejects(client.send(""));
    assert.equal(client.getState().pending.length, 1);
  } finally { await client.stop(); }
});

test("429 and server failures preserve uncertain sends until the same entry is accepted", async () => {
  for (const status of [429, 503]) {
    const setup = fixture();
    const client = setup.client();
    try {
      await client.start();
      await until(() => client.getState().status === "connected");
      setup.status(status);
      const id = await client.send("uncertain-send");
      await until(() => client.getState().status === "error");
      const [pending] = client.getState().pending;
      assert.equal(pending.clientMessageId, id);
      assert.equal(pending.error, null, "a transient response must not label the send rejected");
      setup.status(200);
      await client.synchronize();
      await until(() => client.getState().pending.length === 0);
      assert.equal(setup.rows[0].clientMessageId, id);
      assert.equal(setup.rows[0].encryptedPayload, pending.encryptedPayload);
    } finally { await client.stop(); }
  }
});

test("retrying a rejected send while disconnected preserves its queue identity and publishes pending feedback", async () => {
  const setup = fixture();
  const client = setup.client();
  try {
    await client.start();
    await until(() => client.getState().status === "connected");
    setup.status(409);
    const id = await client.send("retry-the-original");
    await until(() => client.getState().pending.some((row) => row.error));
    const [original] = client.getState().pending;
    setup.socket.disconnect();
    await client.retry(id);
    const [retry] = client.getState().pending;
    assert.equal(retry.error, null);
    assert.equal(retry.queueId, original.queueId);
    assert.equal(retry.clientMessageId, original.clientMessageId);
    assert.equal(retry.encryptedPayload, original.encryptedPayload);
    setup.status(200);
    setup.socket.connect();
    await until(() => client.getState().pending.length === 0);
    assert.equal(setup.rows[0].clientMessageId, id);
  } finally { await client.stop(); }
});

test("a revoked session stops sending and retains its unconfirmed queue", async () => {
  const setup = fixture();
  const client = setup.client();
  try {
    await client.start();
    await until(() => client.getState().status === "connected");
    setup.status(401);
    const id = await client.send("recover-after-sign-in");
    await until(() => client.getState().status === "unauthenticated");
    assert.equal(setup.socket.connected, false);
    assert.equal(client.getState().pending[0].clientMessageId, id);
    assert.equal(client.getState().pending[0].error, null);
    await assert.rejects(client.retry(id), /authenticated/);
  } finally { await client.stop(); }
});

test("stopping one view leaves another view active and preserves both saved sends", async () => {
  const setup = fixture();
  setup.offline(true);
  const first = setup.client();
  const otherSocket = new TestSocket(setup.userId);
  const secondReceived = [];
  const second = setup.client({ socket: otherSocket, onMessages: (batch) => secondReceived.push(...batch) });
  try {
    await Promise.all([first.start(), second.start()]);
    const ids = await Promise.all([first.send("first-view"), second.send("second-view")]);
    await first.stop();
    assert.equal(setup.socket.listenerCount("message:created"), 0);
    assert.equal(setup.socket.listenerCount("realtime:ready"), 0);
    assert.equal(setup.socket.connected, false);
    setup.offline(false);
    await second.synchronize();
    await until(() => second.getState().pending.length === 0 && setup.rows.length === 2);
    assert.deepEqual(new Set(setup.rows.map((row) => row.clientMessageId)), new Set(ids));
    const late = setup.message(3);
    setup.rows.push(late);
    setup.socket.emit("message:created", late);
    otherSocket.emit("message:created", late);
    await until(() => second.getState().cursor === "3");
    assert.deepEqual(setup.received, []);
    assert.equal(secondReceived.at(-1).id, late.id);
    await assert.rejects(first.send("stopped view"), /authenticated/);
    assert.equal(first.getState().status, "stopped");
  } finally { await Promise.all([first.stop(), second.stop()]); }
});

test("presence watches only the active conversation and clears on disconnect and stop", async () => {
  const setup = fixture();
  const watches = [];
  setup.socket.on("activity:watch", (value) => watches.push(value));
  const client = setup.client();
  try {
    await client.start();
    await until(() => client.getState().status === "connected");
    assert.deepEqual(watches, [{ conversationId: setup.conversationId }]);
    setup.socket.emit("presence:changed", { conversationId: randomUUID(), state: "online" });
    assert.equal(client.getState().presence, "unavailable");
    setup.socket.emit("presence:changed", { conversationId: setup.conversationId, state: "online" });
    assert.equal(client.getState().presence, "online");
    setup.socket.disconnect();
    assert.equal(client.getState().presence, "unavailable");
    await client.stop();
    assert.equal(setup.socket.listenerCount("presence:changed"), 0);
    setup.socket.emit("presence:changed", { conversationId: setup.conversationId, state: "online" });
    assert.equal(client.getState().presence, "unavailable");
  } finally { await client.stop(); }
});

test("presence becomes unavailable when activity snapshots stop arriving", async (context) => {
  const setup = fixture();
  const client = setup.client();
  try {
    await client.start();
    await until(() => client.getState().status === "connected");
    context.mock.timers.enable({ apis: ["setTimeout"] });
    setup.socket.emit("presence:changed", { conversationId: setup.conversationId, state: "online" });
    assert.equal(client.getState().presence, "online");
    context.mock.timers.tick(11001);
    assert.equal(client.getState().presence, "unavailable");
  } finally { await client.stop(); context.mock.timers.reset(); }
});
