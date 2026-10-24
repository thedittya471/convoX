import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import { verifyFixture } from "./verify-email.mjs";
import { createRealtimeServer, connectRealtime } from "../../apps/server/dist/utils/realtime.js";
import { config } from "../../apps/server/dist/utils/config.js";
import { publisher, subscriber } from "../../apps/server/dist/utils/redis.js";
import { pool } from "../../apps/server/dist/db/client.js";
const require = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const { io } = require("socket.io-client");
const origin = new URL(config.BETTER_AUTH_URL).origin;
const email = `socket-limit-${randomUUID()}@example.com`;
const sockets = [];
const server = createServer();
const realtime = createRealtimeServer(server);
let actor;
async function connect(url, ip = "198.35.0.1") {
  const socket = io(url, { autoConnect: false, reconnection: false, transports: ["websocket"], extraHeaders: { origin, cookie: actor.cookie, "x-forwarded-for": ip } });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socket ready timed out")), 6000);
    socket.once("realtime:ready", () => { clearTimeout(timer); resolve(); });
    socket.once("connect_error", (error) => { clearTimeout(timer); reject(error); });
    socket.connect();
  });
  return socket;
}
try {
  const response = await fetch("http://server-1:4000/api/auth/sign-up/email", { method: "POST", headers: { origin, "content-type": "application/json", "x-real-ip": `198.35.${randomBytes(1)[0]}.${randomBytes(1)[0]}` }, body: JSON.stringify({ email, name: "Socket fixture", password: randomBytes(24).toString("base64url") }) });
  assert.equal(response.status, 200);
  actor = { ...(await response.json()).user, cookie: response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ") };
  await verifyFixture(email);
  const connected = await Promise.all(Array.from({ length: config.SOCKET_USER_LIMIT }, (_, i) => connect(`http://server-${i % 3 + 1}:4000`)));
  await assert.rejects(connect("http://server-1:4000"), (error) => error.data?.code === "CONNECTION_LIMIT");
  connected[0].disconnect();
  await sleep(300);
  const replacement = await connect("http://server-3:4000");
  replacement.disconnect();
  for (const socket of connected) socket.disconnect();
  await sleep(300);
  await connectRealtime(realtime);
  await new Promise((resolve) => server.listen(4011, "127.0.0.1", resolve));
  config.SOCKET_IP_LIMIT = 2;
  const first = await connect("http://127.0.0.1:4011", "198.35.0.2");
  const second = await connect("http://127.0.0.1:4011", "198.35.0.2");
  await assert.rejects(connect("http://127.0.0.1:4011", "198.35.0.2"), (error) => error.data?.code === "CONNECTION_LIMIT");
  first.disconnect(); second.disconnect();
  await sleep(300);
  const flood = await connect("http://127.0.0.1:4011", "198.35.0.4");
  for (let i = 0; i < 30; i++) flood.emit("unknown:event");
  await sleep(200);
  assert.equal(flood.connected, false, "excess transient events disconnect the sender");
  const stalled = await connect("http://127.0.0.1:4011", "198.35.0.3");
  const local = [...realtime.sockets.sockets.values()].find((socket) => socket.id === stalled.id);
  assert.ok(local);
  local.conn.transport.writable = false; // Deterministic Engine.IO transport stall without OS buffer-size assumptions.
  const before = process.memoryUsage().heapUsed;
  let sent = 0;
  while (local.connected && sent < 100) { local.emit("message:created", { encryptedPayload: "x".repeat(8192) }); sent++; }
  assert.equal(local.connected, false, "stalled transport must be disconnected at the byte limit");
  assert.ok(sent <= Math.ceil(config.SOCKET_OUTBOUND_BYTES / 8192) + 1);
  assert.ok(process.memoryUsage().heapUsed - before < 8 * 1024 * 1024, "bounded burst must not allocate unbounded queue memory");
  console.log(`Socket limit integration passed: shared account burst/release, IP cap, stalled reader disconnect after ${sent} packets and bounded heap growth.`);
} finally {
  for (const socket of sockets) socket.disconnect();
  await new Promise((resolve) => realtime.close(resolve));
  await Promise.all([publisher, subscriber].filter((client) => client.isOpen).map((client) => client.close()));
  if (actor) await pool.query('DELETE FROM "user" WHERE id=$1', [actor.id]);
  await pool.end();
}
