import { createHash, randomUUID } from "node:crypto";
import { BlockList } from "node:net";
import type { IncomingMessage } from "node:http";
import type { RealtimeSocket } from "./realtime.js";
import { config } from "./config.js";
import { publisher } from "./redis.js";

const proxies = new BlockList();
for (const entry of config.TRUSTED_PROXY_CIDRS.split(",")) {
  const [address, prefix] = entry.trim().split("/");
  const family = address.includes(":") ? "ipv6" : "ipv4";
  if (prefix === undefined) proxies.addAddress(address, family);
  else proxies.addSubnet(address, Number(prefix), family);
}
export function socketIp(request: IncomingMessage) {
  const remote = (request.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
  if (!proxies.check(remote, remote.includes(":") ? "ipv6" : "ipv4")) return remote;
  return String(request.headers["x-forwarded-for"] ?? remote).split(",").at(-1)!.trim();
}

const reserve = `
local t = redis.call('TIME')
local now = t[1]*1000 + math.floor(t[2]/1000)
for i=1,2 do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now)
  if not redis.call('ZSCORE', KEYS[i], ARGV[1]) and redis.call('ZCARD', KEYS[i]) >= tonumber(ARGV[i+1]) then return 0 end
end
for i=1,2 do
  redis.call('ZADD', KEYS[i], now+20000, ARGV[1])
  redis.call('PEXPIRE', KEYS[i], 20000)
end
return 1`;

export async function reserveConnection(socket: RealtimeSocket, userId: string) {
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  // Same hash slot keeps the two-limit reservation atomic on Redis Cluster too.
  const keys = [`socket:{limits}:user:${hash(userId)}`, `socket:{limits}:ip:${hash(socketIp(socket.request))}`];
  const token = randomUUID();
  const args = { keys, arguments: [token, String(config.SOCKET_USER_LIMIT), String(config.SOCKET_IP_LIMIT)] };
  if (!publisher.isReady || Number(await publisher.eval(reserve, args)) !== 1) return false;
  let closed = false, busy = false;
  const release = () => { if (publisher.isReady) for (const key of keys) void publisher.zRem(key, token).catch(() => {}); };
  const timer = setInterval(async () => {
    if (busy || closed) return;
    busy = true;
    try {
      if (!publisher.isReady) return;
      if (Number(await publisher.eval(reserve, args)) !== 1) socket.disconnect(true);
    } catch { /* Routing loss is unavailable; recheck ownership after Redis recovers. */ }
    finally { busy = false; if (closed) release(); }
  }, 2000);
  timer.unref();
  socket.conn.once("close", () => { closed = true; clearInterval(timer); release(); });
  if (socket.conn.readyState === "closed") { closed = true; clearInterval(timer); release(); return false; }
  return true;
}

export function boundOutbound(socket: RealtimeSocket) {
  // Engine.IO exposes its WebSocket on the upgrade request; track engine packets separately.
  const websocket = (socket.request as IncomingMessage & { websocket?: { bufferedAmount: number; terminate: () => void } }).websocket;
  let queued = 0;
  let closing = false;
  function check() {
    if (closing || queued + (websocket?.bufferedAmount ?? 0) <= config.SOCKET_OUTBOUND_BYTES) return;
    closing = true;
    console.error(JSON.stringify({ event: "slow_socket_closed", instanceId: config.INSTANCE_ID, connectionId: socket.id }));
    socket.disconnect(true);
    websocket?.terminate();
  }
  socket.conn.on("packetCreate", (packet: { data?: unknown }) => {
    const data = packet.data;
    queued += (typeof data === "string" ? Buffer.byteLength(data) : ArrayBuffer.isView(data) ? data.byteLength : 0) + 16;
    check();
  });
  socket.conn.on("flush", () => { queued = 0; });
  const timer = setInterval(check, 100);
  timer.unref();
  socket.conn.once("close", () => clearInterval(timer));
}
