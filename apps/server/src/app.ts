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
import { publisher, subscriber } from "./utils/redis.js";

const app = express();

app.disable("x-powered-by");
app.use((request, response, next) => {
  if (!request.path.startsWith("/internal/") && !request.path.startsWith("/api/health/")) response.once("finish", () => {
    metrics.httpRequests++;
    if (response.statusCode >= 500) metrics.httpErrors++;
  });
  next();
});
app.get("/internal/metrics", async (request, response) => {
  response.set("Cache-Control", "no-store");
  if (!metricsAuthorized(request.get("authorization"))) return response.sendStatus(404);
  try {
    const result = await pool.query("SELECT count(*)::int AS pending, COALESCE(extract(epoch FROM now()-min(created_at)),0)::float AS age FROM message_outbox WHERE published_at IS NULL");
    response.type("text/plain; version=0.0.4").send(metricsText(result.rows[0].pending, Math.max(0, result.rows[0].age), true));
  } catch {
    metrics.databaseErrors++;
    response.type("text/plain; version=0.0.4").send(metricsText(NaN, NaN, false));
  }
});
// Only the private, firewalled gateway may supply forwarded client addresses.
app.set("trust proxy", "loopback, linklocal, uniquelocal");
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

  const databaseReady = await pool.query("SELECT 1").then(() => true, () => false);
  const ready = databaseReady && publisher.isReady && subscriber.isReady;

  response.status(ready ? 200 : 503).set("Cache-Control", "no-store").json({
    status: ready ? "ok" : "unavailable",
    instanceId: config.INSTANCE_ID,
  } satisfies HealthResponse);
});

export default app;
