import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { verifyFixture } from "./verify-email.mjs";

const execute = promisify(execFile);
if (!process.argv.includes("--run")) {
  const child = spawn("docker", ["compose", "exec", "-T", "server-2", "node", "tests/integration/activity.mjs", "--run", ...process.argv.slice(2)], { stdio: ["pipe", "pipe", "inherit"] });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Activity suite exited ${code}`)));
  });
  try {
    const output = (async () => {
      for await (const line of createInterface({ input: child.stdout })) {
        if (["CRASH", "STOP_REDIS", "START_REDIS"].includes(line)) {
          const args = line === "CRASH" ? ["kill", "-s", "SIGKILL", "server-3"] : [line === "STOP_REDIS" ? "stop" : "start", "redis"];
          await execute("docker", ["compose", ...args], { timeout: 20000 });
          child.stdin.write("done\n");
        } else console.log(line);
      }
    })();
    await Promise.all([completed, output]);
  } finally {
    child.stdin.end();
    await execute("docker", ["compose", "--profile", "stack", "up", "-d", "--wait", "--wait-timeout", "45", "redis", "server-3"], { timeout: 55000 });
  }
} else await run();

async function run() {
  const require = createRequire(new URL("../../apps/server/package.json", import.meta.url));
  const { io } = require("socket.io-client");
  const { pool } = await import("../../apps/server/dist/db/client.js");
  const origin = new URL(process.env.BETTER_AUTH_URL).origin;
  const servers = ["http://server-1:4000", "http://server-2:4000", "http://server-3:4000"];
  const actors = [], sockets = [];
  let id;
  async function until(check, message, timeout = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await check()) return; await sleep(80); }
    assert.fail(message);
  }
  async function command(value) {
    const resumed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Controller timed out: ${value}`)), 30000);
      process.stdin.once("data", () => { clearTimeout(timer); resolve(); });
    });
    console.log(value); await resumed;
  }
  async function connect(actor, server) {
    const socket = io(server, { autoConnect: false, transports: ["websocket"], reconnection: false, extraHeaders: { origin, cookie: actor.cookie } });
    sockets.push(socket);
    socket.snapshots = [];
    socket.typing = [];
    socket.on("typing:changed", (value) => socket.typing.push(value));
    socket.on("presence:changed", (value) => socket.snapshots.push(value));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No realtime ready")), 6000);
      socket.once("realtime:ready", () => { clearTimeout(timer); resolve(); });
      socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
      socket.connect();
    });
    return socket;
  }
  const state = (socket) => socket.snapshots.at(-1)?.state;
  try {
    for (let index = 0; index < 3; index++) {
      const email = `activity-${randomUUID()}@example.com`;
      const response = await fetch(`${servers[index]}/api/auth/sign-up/email`, { method: "POST", headers: { origin, "content-type": "application/json", "x-real-ip": `198.25.${randomBytes(1)[0]}.${randomBytes(1)[0]}` }, body: JSON.stringify({ email, name: "Activity fixture", password: randomBytes(24).toString("base64url") }) });
      assert.equal(response.status, 200);
      const actor = (await response.json()).user;
      actors.push({ ...actor, cookie: response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ") });
      await verifyFixture(email);
    }
    const [alice, bob, outsider] = actors;
    const response = await fetch(`${servers[0]}/api/conversations`, { method: "POST", headers: { origin, cookie: alice.cookie, "content-type": "application/json" }, body: JSON.stringify({ otherUserId: bob.id }) });
    assert.equal(response.status, 201);
    id = (await response.json()).conversation.id;
    const observer = await connect(alice, servers[0]);
    const denied = await connect(outsider, servers[1]);
    denied.emit("activity:watch", { conversationId: id });
    observer.emit("activity:watch", { conversationId: id });
    await until(() => state(observer) === "offline", "peer initially offline");
    if (process.argv.includes("typing")) {
      const first = await connect(bob, servers[0]);
      const second = await connect(bob, servers[2]);
      first.emit("activity:watch", { conversationId: id });
      second.emit("activity:watch", { conversationId: id });
      await until(() => [first, second].every((socket) => state(socket) === "online"), "typing senders authorized");
      const active = (socket) => socket.emit("typing:set", { conversationId: id, active: true });
      const stop = (socket) => socket.emit("typing:set", { conversationId: id, active: false });
      const remaining = () => observer.typing.at(-1)?.expiresInMs ?? 0;
      denied.emit("typing:set", { conversationId: id, active: true });
      denied.emit("typing:set", { conversationId: id, active: "yes" });
      await sleep(2200);
      assert.equal(remaining(), 0, "outsider cannot create typing state");
      active(first);
      await until(() => remaining() > 0, "authorized typing arrives");
      stop(first);
      await until(() => remaining() === 0, "explicit stop clears typing");
      await sleep(2100);
      active(first);
      await until(() => remaining() > 0, "typing restarts");
      const started = Date.now();
      for (let i = 0; i < 100; i++) active(first);
      await until(() => remaining() === 0, "inactivity expires despite throttled burst", 9000);
      assert.ok(Date.now() - started < 9000);
      active(first); active(second);
      await until(() => remaining() > 0, "multi-tab typing starts");
      stop(first);
      await sleep(2200);
      assert.ok(remaining() > 0, "one tab stop must preserve the other typing lease");
      first.disconnect();
      active(second);
      await until(() => remaining() > 3000, "refresh final typing lease");
      const crashed = Date.now();
      await command("CRASH");
      await until(() => remaining() === 0, "crashed typing expires", 9000);
      assert.ok(Date.now() - crashed < 9000);
      const recovered = await connect(bob, servers[1]);
      recovered.emit("activity:watch", { conversationId: id });
      await until(() => state(recovered) === "online", "replacement authorized");
      active(recovered);
      await until(() => remaining() > 0, "typing recovers on another replica");
      await command("STOP_REDIS");
      await until(() => state(observer) === "unavailable" && remaining() === 0, "routing loss invalidates typing");
      await command("START_REDIS");
      await until(() => state(observer) === "online", "routing recovers", 15000);
      assert.equal(remaining(), 0, "old typing is not replayed after broker recovery");
      assert.equal(Number((await pool.query("SELECT count(*) FROM message WHERE conversation_id=$1", [id])).rows[0].count), 0, "typing never becomes durable history");
      assert.ok(denied.typing.every((value) => value.expiresInMs === 0));
      console.log("Typing integration passed: authorization, bounded burst, explicit stop, inactivity, multi-tab ownership, crash expiry, Redis invalidation/recovery and no durable history.");
      return;
    }
    const first = await connect(bob, servers[0]);
    const surviving = await connect(bob, servers[2]);
    await until(() => state(observer) === "online", "cross-replica peer online");
    first.disconnect();
    await sleep(5500);
    assert.equal(state(observer), "online", "closing one tab must not remove the other lease");
    assert.ok(denied.snapshots.every((item) => item.state === "unavailable"), "outsider receives no peer state");
    const crashed = Date.now();
    await command("CRASH");
    await until(() => state(observer) === "offline", "crashed final lease expires", 30000);
    assert.ok(Date.now() - crashed < 30000, "observer learns offline within 30 seconds");
    assert.equal(surviving.connected, false);
    const old = await connect(bob, servers[0]);
    const newer = await connect(bob, servers[1]);
    old.disconnect();
    await until(() => state(observer) === "online", "reconnect token survives old disconnect");
    await command("STOP_REDIS");
    await until(() => state(observer) === "unavailable", "broker loss must not claim offline");
    await command("START_REDIS");
    await until(() => state(observer) === "online", "live connections rebuild after Redis restart", 15000);
    await pool.query('DELETE FROM "session" WHERE user_id = $1', [bob.id]);
    await until(() => !newer.connected, "revoked session disconnects even without message traffic");
    await until(() => state(observer) === "offline", "revoked final connection lease removed");
    console.log("Presence integration passed: participant authorization, independent cross-replica tabs, reconnect ownership, crash expiry <30s, Redis unavailable/recovery and session revocation.");
  } finally {
    process.stdin.pause();
    for (const socket of sockets) socket.disconnect();
    if (id) await pool.query("DELETE FROM conversation WHERE id = $1", [id]);
    await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [actors.map((a) => a.id)]);
    await pool.end();
  }
}
