import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createShardedAdapter } from "@socket.io/redis-adapter";
import { fromNodeHeaders } from "better-auth/node";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { Message, RealtimeEvents } from "@convox/contracts";
import { auth } from "./auth.js";
import { config } from "./config.js";
import { publisher, subscriber } from "./redis.js";
import { db } from "../db/client.js";
import { session, user } from "../db/schema/auth.schema.js";

type ClusterEvents = {
  "message:dispatch": (message: Message, participants: string[], acknowledge: (error: string | null) => void) => void;
};

type RealtimeServer = Server<Record<string, never>, RealtimeEvents, ClusterEvents, { userId: string; sessionId: string }>;

export function createRealtimeServer(server: HttpServer): RealtimeServer {

  const origin = new URL(config.BETTER_AUTH_URL).origin;
  const io: RealtimeServer = new Server(server, {
    transports: ["websocket"],
    serveClient: false,
    maxHttpBufferSize: 16384,
    pingInterval: 2000,
    pingTimeout: 3000,
    cors: { origin, credentials: true },
    allowRequest: (request, allow) => allow(null, request.headers.origin === origin && publisher.isReady && subscriber.isReady),
  });

  io.use(async (socket, next) => {

    try {
      const identity = await auth.api.getSession({ headers: fromNodeHeaders(socket.request.headers) });

      if (!identity) {
        return next(Object.assign(new Error("Sign in to receive messages."), { data: { code: "UNAUTHENTICATED" } }));
      }

      if (!identity.user.emailVerified) return next(Object.assign(new Error("Verify your email before using chat."), { data: { code: "EMAIL_NOT_VERIFIED" } }));

      socket.data = { userId: identity.user.id, sessionId: identity.session.id };
      next();

    } catch {
      next(new Error("Could not authenticate the connection."));
    }
  });

  io.on("connection", async (socket) => {

    await socket.join(`user:${socket.data.userId}`);
    socket.emit("realtime:ready", { instanceId: config.INSTANCE_ID, userId: socket.data.userId });
  });

  io.on("message:dispatch", async (message, participants, acknowledge) => {

    try {
      await deliverLocally(io, message, participants);
      acknowledge(null);

    } catch {
      acknowledge("Could not dispatch the message.");
    }
  });

  subscriber.on("ready", () => io.local.emit("sync:required"));

  return io;
}

export async function connectRealtime(io: RealtimeServer) {

  await Promise.all([publisher.connect(), subscriber.connect()]);
  io.adapter(createShardedAdapter(publisher, subscriber, { channelPrefix: "convox", subscriptionMode: "static" }));
  await subscriber.ping();
}

async function deliverLocally(io: RealtimeServer, message: Message, participants: string[]) {

  const sockets = await io.local.in(participants.map((id) => `user:${id}`)).fetchSockets();

  if (sockets.length === 0) {
    return;
  }

  const active = await db.select({ id: session.id }).from(session).innerJoin(user, eq(user.id, session.userId))
    .where(and(inArray(session.id, [...new Set(sockets.map((socket) => socket.data.sessionId))]), gt(session.expiresAt, new Date()), eq(user.emailVerified, true)));
  const activeIds = new Set(active.map((row) => row.id));

  for (const socket of sockets) {
    if (activeIds.has(socket.data.sessionId)) {
      socket.emit("message:created", message);
    } else {
      socket.emit("auth:required");
      socket.disconnect(true);
    }
  }
}

export async function publishMessage(io: RealtimeServer, message: Message, participants: string[]) {

  if (!publisher.isReady || !subscriber.isReady) {
    throw new Error("Realtime routing is unavailable");
  }

  await new Promise<void>((resolve, reject) => {

    const deadline = setTimeout(() => reject(new Error("Realtime dispatch timed out")), 6000);
    const acknowledge = (error: Error | null, responses: (string | null)[] = []) => {
      clearTimeout(deadline);

      if (error || responses.some((value) => value !== null)) {
        reject(error ?? new Error("A server could not dispatch the message"));
      } else {
        resolve();
      }
    };

    Promise.resolve(io.sockets.adapter.serverSideEmit(["message:dispatch", message, participants, acknowledge]))
      .catch(acknowledge);
  });

  await deliverLocally(io, message, participants);
}
