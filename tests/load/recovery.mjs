import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

// Extends the load driver with the real application client; no browser is used.
export async function createRecovery({ actors, pairs, pool, origin, receive }) {
  const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  require("fake-indexeddb/auto");
  const { createChatClient } = await import("../../apps/web/src/lib/chat-client.ts");
  const generation = (await pool.query("SELECT generation FROM history")).rows[0].generation;
  const views = [], probes = new Map(), recovered = new Map(), errors = [];
  const fault = { started: null, affected: [], lostResponse: false, heldHistory: false, offlineMs: null, typingClearedMs: null, rejoined: false };
  let loseIndex = -1, holdIndex = -1;
  const ghost = (i) => i >= 5 && i < 10;
  const url = (i) => i < 5 ? "http://server-1:4000" : ghost(i) ? "http://server-3:4000" : "http://nginx";
  const until = async (check, timeout = 10000) => {
    const end = performance.now() + timeout;
    while (performance.now() < end) { if (await check()) return; await sleep(20); }
    throw new Error("Recovery deadline exceeded");
  };
  async function command(value) {
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fault controller timed out")), 30000);
      process.stdin.once("data", () => { clearTimeout(timer); resolve(); });
    });
    console.log(value);
    await done;
  }
  async function prove(i) {
    const view = views[i];
    view.proving = true;
    let sent, reply, peer;
    try {
      peer = views[Math.floor(i / 10) * 10 + (Math.floor(i / 5) % 2 ? 0 : 5)];
      sent = await view.client.send(`recovery-probe:${i}`);
      await until(() => peer.seen.has(sent));
      reply = await peer.client.send(`recovery-reply:${i}`);
      // The reply crosses an applied contiguous cursor; concurrent views may queue new sends.
      await until(() => view.seen.has(reply) && view.client.getState().status === "connected");
      recovered.set(i, { elapsedMs: performance.now() - fault.started, instance: view.instance, sent, reply, cursor: view.client.getState().cursor });
    } catch (error) { errors.push({ view: i, error: error.message, state: { ...view.client.getState(), pending: view.client.getState().pending.map((p) => ({ id: p.clientMessageId, error: p.error })) }, sentSeen: peer?.seen.has(sent), replySeen: view.seen.has(reply), peerState: { status: peer?.client.getState().status, pendingCount: peer?.client.getState().pending.length } }); }
  }
  async function attach(socket, i, checkpoint) {
    const actor = actors[Math.floor(i / 5)], pair = pairs[Math.floor(i / 10)];
    const view = views[i] ?? { seen: new Map(), instance: null, proving: false, duplicates: 0 };
    views[i] = view;
    view.socket = socket;
    socket.on("realtime:ready", (value) => { view.instance = value.instanceId; });
    const clientRequest = async (input, options = {}) => {
      const headers = new Headers(options.headers);
      headers.set("cookie", actor.cookie);
      headers.set("origin", origin);
      const response = await fetch(input, { ...options, headers });
      if (options.method === "POST") {
        const body = JSON.parse(options.body);
        const probe = probes.get(body.clientMessageId) ?? { id: body.clientMessageId, attempts: 0, accepted: false };
        probes.set(probe.id, probe);
        probe.attempts++;
        if (response.ok) { probe.accepted = true; probe.canonical = (await response.clone().json()).message.id; }
        if (i === loseIndex && !fault.lostResponse && response.ok) {
          fault.lostResponse = true;
          fault.affected = views.flatMap((v, index) => v.instance === "server-3" && !ghost(index) ? [index] : []);
          fault.started = performance.now();
          await command("KILL_SERVER_3");
          throw new TypeError("Synthetic lost acknowledgement after commit");
        }
      } else if (i === holdIndex && fault.started && !fault.heldHistory && response.ok) {
        fault.heldHistory = true;
        await sleep(250);
      }
      return response;
    };
    view.client = createChatClient({ userId: actor.id, conversationId: pair.id, generation,
      after: checkpoint ?? "0", apiUrl: "http://nginx", socket, request: clientRequest,
      onMessages: (batch) => {
        for (const message of batch) {
          if (view.seen.has(message.clientMessageId)) view.duplicates++;
          view.seen.set(message.clientMessageId, message.id);
          receive(i, message);
        }
      },
      onChange: (state) => {
        if (i === 0 && fault.started) {
          if (!state.typing && fault.typingClearedMs === null) fault.typingClearedMs = performance.now() - fault.started;
          if (state.presence === "offline" && fault.offlineMs === null) fault.offlineMs = performance.now() - fault.started;
        }
        if (fault.started && fault.affected.includes(i) && !view.proving && view.instance !== "server-3" && state.status === "connected" && state.pending.length === 0) void prove(i);
      },
    });
    if (ghost(i)) socket.once("disconnect", () => { if (fault.started) void view.client.stop(); });
    await view.client.start();
    await until(() => view.client.getState().status === "connected");
  }
  return { url, attach, fault, views, probes, recovered, errors, until, command,
    async run() {
      await sleep(10000);
      // A user whose only five connections are on the doomed replica stays offline
      // long enough to measure presence and typing expiry, then explicitly returns.
      views[5].client.setTyping(true);
      await until(() => views[0].client.getState().typing);
      loseIndex = views.findIndex((v, i) => i >= 10 && v.instance === "server-3");
      assert.ok(loseIndex >= 10);
      holdIndex = loseIndex;
      await views[loseIndex].client.send("uncertain-at-crash");
      await until(() => fault.started !== null);
      await until(() => recovered.size === fault.affected.length || errors.length > 0, 15000);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      assert.ok([...recovered.values()].every((v) => v.elapsedMs < 10000), "every recovering client must complete send/receive within 10 seconds");
      await until(() => !views[0].client.getState().typing, 9000);
      assert.notEqual(fault.typingClearedMs, null);
      assert.ok(fault.typingClearedMs < 9000);
      await until(() => views[0].client.getState().presence === "offline", 30000 - (performance.now() - fault.started));
      assert.notEqual(fault.offlineMs, null);
      assert.ok(fault.offlineMs < 30000);
      for (let i = 5; i < 10; i++) {
        const checkpoint = views[i].client.getState().cursor;
        const socket = require("socket.io-client").io("http://nginx", { autoConnect: false, transports: ["websocket"], extraHeaders: { origin, cookie: actors[1].cookie } });
        await attach(socket, i, checkpoint);
      }
      await command("RESTART_SERVER_3");
      await until(async () => (await fetch("http://server-3:4000/api/health/realtime", { signal: AbortSignal.timeout(2000) }).catch(() => ({ ok: false }))).ok);
      const check = require("socket.io-client").io("http://server-3:4000", { autoConnect: false, transports: ["websocket"], reconnection: false, extraHeaders: { origin, cookie: actors[0].cookie } });
      try {
        await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Rejoin handshake failed")), 5000); check.once("realtime:ready", (v) => { clearTimeout(timer); assert.equal(v.instanceId, "server-3"); resolve(); }); check.connect(); });
        const id = await views[0].client.send("after-instance-rejoin");
        await until(() => views[5].seen.has(id));
        fault.rejoined = true;
      } finally { check.disconnect(); }
    },
    async finish() {
      const ids = [...probes.keys()];
      const result = await pool.query("SELECT client_message_id, count(*)::int AS copies FROM message WHERE client_message_id=ANY($1::uuid[]) AND sender_id=ANY($2::text[]) GROUP BY client_message_id", [ids, actors.map((a) => a.id)]);
      assert.equal(result.rowCount, ids.length, "all uncertain sends and probes must exist");
      assert.ok(result.rows.every((r) => r.copies === 1));
      assert.ok(views.every((v) => v.duplicates === 0), "applied messages must not duplicate");
      assert.ok(fault.lostResponse && fault.heldHistory && fault.rejoined);
      const samples = [...recovered.values()].map((r) => r.elapsedMs).sort((a, b) => a - b);
      return { ...fault, recovered: [...recovered], probes: [...probes.values()], errors, appliedDuplicates: views.reduce((n, v) => n + v.duplicates, 0), p95Ms: samples[Math.ceil(samples.length * .95) - 1], worstMs: samples.at(-1), passed: errors.length === 0 && recovered.size === fault.affected.length && samples.at(-1) < 10000 };
    },
    async stop() { process.stdin.pause(); await Promise.allSettled(views.map((v) => v.client.stop())); },
  };
}
