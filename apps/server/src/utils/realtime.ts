import { httpReady, realtimeReady } from "./readiness.js";
import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";
import { Server, type Socket } from "socket.io";
import { createShardedAdapter } from "@socket.io/redis-adapter";
import { fromNodeHeaders } from "better-auth/node";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { Message, RealtimeEvents, ActivityCommands } from "@convox/contracts";
import { trackPresence } from "../services/presence.service.js";
import { metrics, observeRouting } from "./metrics.js";
import { claimQuota } from "./rate-limit.js";
import { reserveConnection, boundOutbound, socketIp } from "./socket-limits.js";
import { auth } from "./auth.js";
import { config } from "./config.js";
import { publisher, subscriber } from "./redis.js";
import { db } from "../db/client.js";
import { history } from "../db/schema/history.schema.js";
import { session, user } from "../db/schema/auth.schema.js";

type ClusterEvents = {
  "message:dispatch": (message: Message, participants: string[], acknowledge: (error: string | null) => void) => void;
};

type SocketIdentity = { userId: string; sessionId: string };
type RealtimeServer = Server<ActivityCommands, RealtimeEvents, ClusterEvents, SocketIdentity>;
export type RealtimeSocket = Socket<ActivityCommands, RealtimeEvents, ClusterEvents, SocketIdentity>;

export function createRealtimeServer(server: HttpServer): RealtimeServer {
  const origin = new URL(config.BETTER_AUTH_URL).origin;
  const io: RealtimeServer = new Server(server, {
    transports: ["websocket"],
    serveClient: false,
    maxHttpBufferSize: 16384,
    pingInterval: 2000,
    pingTimeout: 3000,
    cors: { origin, credentials: true },
    allowRequest: (request, allow) => {
      if (request.headers.origin !== origin || !publisher.isReady || !subscriber.isReady) {
        return allow(null, false);
      }
      void realtimeReady()
        .then(async (ready) => {
          if (!ready) {
            return false;
          }

          const quota = await claimQuota("ip", socketIp(request), config.CHAT_IP_PER_MINUTE);
          return quota.allowed;
        })
        .then(
          (allowed) => allow(null, allowed),
          () => allow(null, false),
        );
    },
  });

  io.engine.use(async (_request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (await httpReady()) {
      return next();
    }
    response.writeHead(503, { "Retry-After": "1", "X-Convox-Not-Accepted": "1" });
    response.end();
  });
  io.use(async (socket, next) => {
    try {
      const identity = await auth.api.getSession({ headers: fromNodeHeaders(socket.request.headers) });

      if (!identity) {
        return next(Object.assign(new Error("Sign in to receive messages."), { data: { code: "UNAUTHENTICATED" } }));
      }

      if (!identity.user.emailVerified) {
        return next(Object.assign(new Error("Verify your email before using chat."), { data: { code: "EMAIL_NOT_VERIFIED" } }));
      }

      if (!await reserveConnection(socket, identity.user.id)) {
        return next(Object.assign(new Error("Connection limit reached. Retry shortly."), { data: { code: "CONNECTION_LIMIT" } }));
      }

      socket.data = { userId: identity.user.id, sessionId: identity.session.id };
      next();
    } catch {
      next(new Error("Could not authenticate the connection."));
    }
  });

  io.on("connection", async (socket) => {
    metrics.activeSockets++;
    socket.once("disconnect", () => {
      metrics.activeSockets--;
    });
    boundOutbound(socket);
    let eventWindow = Date.now();
    let events = 0;
    socket.use((_packet, next) => {
      if (Date.now() - eventWindow >= 1000) {
        eventWindow = Date.now();
        events = 0;
      }

      if (++events > 20) {
        return socket.disconnect(true);
      }
      next();
    });

    try {
      const [current] = await db.select().from(history);

      if (!current) {
        throw new Error("History generation is unavailable");
      }
      await socket.join(`user:${socket.data.userId}`);
      trackPresence(socket);
      socket.emit("realtime:ready", { instanceId: config.INSTANCE_ID, userId: socket.data.userId, generation: current.generation });
    } catch {
      socket.disconnect(true);
    }
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

  const sessionIds = [...new Set(sockets.map((socket) => socket.data.sessionId))];
  const active = await db.select({ id: session.id })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(and(
      inArray(session.id, sessionIds),
      gt(session.expiresAt, new Date()),
      eq(user.emailVerified, true),
    ));
  const [current] = await db.select().from(history);

  if (!current) {
    throw new Error("History generation is unavailable");
  }
  const activeIds = new Set(active.map((row) => row.id));

  for (const socket of sockets) {
    if (activeIds.has(socket.data.sessionId)) {
      socket.emit("message:created", message, current.generation);
    } else {
      socket.emit("auth:required");
      socket.disconnect(true);
    }
  }
}

export async function publishMessage(io: RealtimeServer, message: Message, participants: string[]) {
  const started = performance.now();

  try {
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
  } finally {
    observeRouting((performance.now() - started) / 1000);
  }
}
