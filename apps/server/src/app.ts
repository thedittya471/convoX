import express from "express";
import { toNodeHandler } from "better-auth/node";
import type { HealthResponse } from "@convox/contracts";
import { config } from "./utils/config.js";
import { pool } from "./db/client.js";
import { auth } from "./utils/auth.js";
import { usersRouter } from "./routes/users.js";
import { conversationsRouter } from "./routes/conversations.js";
import { publisher, subscriber } from "./utils/redis.js";

const app = express();

app.disable("x-powered-by");
app.all("/api/auth/*splat", toNodeHandler(auth));
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
