import { httpReady, realtimeReady } from "./utils/readiness.js";
import { randomUUID } from "node:crypto";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import type { HealthResponse } from "@convox/contracts";
import { metrics, metricsAuthorized, metricsText } from "./utils/metrics.js";
import { limitChatIp } from "./utils/rate-limit.js";
import { config } from "./utils/config.js";
import { pool } from "./db/client.js";
import { auth } from "./utils/auth.js";
import { usersRouter } from "./routes/users.js";
import { conversationsRouter } from "./routes/conversations.js";

const app = express();

app.disable("x-powered-by");
app.use((request, response, next) => {
  response.locals.requestId = randomUUID();
  response.set("X-Request-ID", response.locals.requestId);

  if (!request.path.startsWith("/internal/") && !request.path.startsWith("/api/health/")) {
    response.once("finish", () => {
      metrics.httpRequests++;

      if (response.statusCode >= 500) {
        metrics.httpErrors++;
        console.error(JSON.stringify({
          event: "http_request_failed",
          instanceId: config.INSTANCE_ID,
          requestId: response.locals.requestId,
          status: response.statusCode
        }));
      }
    });
  }
  next();
});

app.get("/internal/metrics", async (request, response) => {
  response.set("Cache-Control", "no-store");

  if (!metricsAuthorized(request.get("authorization"))) {
    return response.sendStatus(404);
  }

  try {
    const result = await pool.query("SELECT count(*)::int AS pending, COALESCE(extract(epoch FROM now()-min(created_at)),0)::float AS age FROM message_outbox WHERE published_at IS NULL");
    response.type("text/plain; version=0.0.4").send(metricsText(result.rows[0].pending, Math.max(0, result.rows[0].age), true));
  } catch {
    metrics.databaseErrors++;
    response.type("text/plain; version=0.0.4").send(metricsText(NaN, NaN, false));
  }
});

// Only the private, firewalled gateway may supply forwarded client addresses.
app.set("trust proxy", config.TRUSTED_PROXY_CIDRS.split(",").map((entry) => entry.trim()));
app.use(async (request, response, next) => {
  if (!request.path.startsWith("/api/") || request.path.startsWith("/api/health/") || await httpReady()) {
    return next();
  }
  response
    .set({ "Cache-Control": "no-store", "Retry-After": "1", "X-Convox-Not-Accepted": "1" })
    .status(503)
    .json({ error: "This instance is not ready. Retry with the same message ID." });
});

app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(["/api/users", "/api/conversations"], limitChatIp);
app.use(express.json({ limit: "16kb" }));
app.use("/api/users", usersRouter);
app.use("/api/conversations", conversationsRouter);

app.get("/api/health/live", (_request, response) => {
  response.set("Cache-Control", "no-store").json({
    status: "ok",
    instanceId: config.INSTANCE_ID,
  } satisfies HealthResponse);
});

app.get("/api/health/ready", async (_request, response) => {
  const ready = await httpReady();

  response.status(ready ? 200 : 503).set("Cache-Control", "no-store").json({
    status: ready ? "ok" : "unavailable",
    instanceId: config.INSTANCE_ID,
  } satisfies HealthResponse);
});

app.get("/api/health/realtime", async (_request, response) => {
  const ready = await realtimeReady();
  response.status(ready ? 200 : 503).set("Cache-Control", "no-store").json({
    status: ready ? "ok" : "unavailable",
    instanceId: config.INSTANCE_ID,
  } satisfies HealthResponse);
});

export default app;
