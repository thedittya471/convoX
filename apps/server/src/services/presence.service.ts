import { randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { activityTiming, activityWatchSchema, typingCommandSchema, type PresenceSnapshot } from "@convox/contracts";
import { db } from "../db/client.js";
import { conversation } from "../db/schema/conversation.schema.js";
import { session, user } from "../db/schema/auth.schema.js";
import { publisher, subscriber } from "../utils/redis.js";
import type { RealtimeSocket } from "../utils/realtime.js";

const refreshLease = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[2]), ARGV[1])
local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
redis.call('PEXPIRE', KEYS[1], tonumber(latest[2]) - now)
return 1`;
const readLease = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
return redis.call('ZCARD', KEYS[1])`;
const readTyping = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local last = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
if #last == 0 then return 0 end
return math.max(0, tonumber(last[2]) - now)`;
const typingLeaseKey = (id: string, userId: string) => `typing:${id}:${userId}`;
const leaseKey = (userId: string) => `presence:${userId}`;

export function trackPresence(socket: RealtimeSocket) {
  const token = randomUUID();
  const ownKey = leaseKey(socket.data.userId);
  let typingKey: string | undefined;
  let typingRequest: { active: boolean; at: number } | undefined;
  let lastTyping = 0;
  let lastTypingStop = 0;
  let watched: string | undefined;
  let lastWatch = 0;
  let busy = false;
  let closed = false;

  function emit(state: PresenceSnapshot["state"]) {
    if (!watched || closed || !socket.connected) return;
    const value = { conversationId: watched, state };
    socket.emit("presence:changed", value);

    if (state === "unavailable") socket.emit("typing:changed", { conversationId: watched, expiresInMs: 0 });
  }

  async function tick() {
    if (busy || closed) return;
    busy = true;
    const selected = watched;
    let writtenTypingKey: string | undefined;

    try {
      const [active] = await db.select({ id: session.id }).from(session).innerJoin(user, eq(user.id, session.userId))
        .where(and(eq(session.id, socket.data.sessionId), eq(session.userId, socket.data.userId), gt(session.expiresAt, new Date()), eq(user.emailVerified, true)));

      if (closed) return;

      if (!active) {
        socket.emit("auth:required");
        socket.disconnect(true);
        return;
      }

      if (!publisher.isReady || !subscriber.isReady) throw new Error("Activity is unavailable");
      await publisher.eval(refreshLease, { keys: [ownKey], arguments: [token, String(activityTiming.leaseMs)] });

      if (!selected || selected !== watched || closed) return;
      const [row] = await db.select().from(conversation).where(eq(conversation.id, selected));

      if (selected !== watched || closed) return;

      if (!row || ![row.directUserLowId, row.directUserHighId].includes(socket.data.userId)) {
        emit("unavailable");
        watched = undefined;
        return;
      }
      const activity = typingRequest;
      typingRequest = undefined;

      if (activity) {
        writtenTypingKey = typingLeaseKey(selected, socket.data.userId);
        typingKey = writtenTypingKey;
        const ttl = activityTiming.typingMs - (Date.now() - activity.at);

        if (activity.active && ttl > 0) await publisher.eval(refreshLease, { keys: [writtenTypingKey], arguments: [token, String(ttl)] });
        else await publisher.zRem(writtenTypingKey, token);
      }
      const peerId = row.directUserLowId === socket.data.userId ? row.directUserHighId : row.directUserLowId;
      const count = await publisher.eval(readLease, { keys: [leaseKey(peerId)], arguments: [] });
      const expiresInMs = Number(await publisher.eval(readTyping, { keys: [typingLeaseKey(selected, peerId)], arguments: [] }));

      if (selected === watched && !closed) {
        emit(Number(count) > 0 ? "online" : "offline");
        socket.emit("typing:changed", { conversationId: selected, expiresInMs });
      }
    } catch {
      typingRequest = undefined;

      if (selected === watched) emit("unavailable");
    } finally {
      busy = false;

      if (!closed && (selected !== watched || typingRequest)) void tick();

      if ((closed || selected !== watched) && writtenTypingKey && publisher.isReady) void publisher.zRem(writtenTypingKey, token).catch(() => { });
      // Disconnect can race a pending refresh: remove this token once more after it finishes.
      if (closed && publisher.isReady) void publisher.zRem(ownKey, token).catch(() => { });
    }
  }

  socket.on("activity:watch", (value) => {
    if (Date.now() - lastWatch < 1000) return;
    lastWatch = Date.now();

    if (typingKey && publisher.isReady) void publisher.zRem(typingKey, token).catch(() => { });
    typingKey = undefined;
    typingRequest = undefined;
    const parsed = activityWatchSchema.safeParse(value);
    watched = parsed.success ? parsed.data.conversationId : undefined;
    emit("unavailable");
    void tick();
  });
  socket.on("typing:set", (value) => {
    const parsed = typingCommandSchema.safeParse(value);

    if (!parsed.success || parsed.data.conversationId !== watched || closed) return;
    const now = Date.now();

    if (parsed.data.active && now - lastTyping < activityTiming.typingThrottleMs) return;

    if (!parsed.data.active && now - lastTypingStop < 250) return;

    if (!parsed.data.active) lastTypingStop = now;

    if (!parsed.data.active && !typingKey && !typingRequest?.active) return;

    if (parsed.data.active) lastTyping = now;
    typingRequest = { active: parsed.data.active, at: now };
    void tick();
  });
  const timer = setInterval(() => void tick(), activityTiming.pollMs);
  timer.unref();
  socket.once("disconnect", () => {
    closed = true;
    clearInterval(timer);

    if (typingKey && publisher.isReady) void publisher.zRem(typingKey, token).catch(() => { });

    if (publisher.isReady) void publisher.zRem(ownKey, token).catch(() => { });
  });
  void tick();
}
