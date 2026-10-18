import express from "express";
import type { HealthResponse } from "@convox/contracts";
import { config } from "./config.js";
import { pool } from "./db/client.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get("/api/health/live", (_request, response) => {
  response.set("Cache-Control", "no-store").json({
    status: "ok",
    instanceId: config.INSTANCE_ID,
  } satisfies HealthResponse);
});

app.get("/api/health/ready", async (_request, response) => {
  const ready = await pool.query("SELECT 1").then(() => true, () => false);
  response.status(ready ? 200 : 503).set("Cache-Control", "no-store").json({
    status: ready ? "ok" : "unavailable",
    instanceId: config.INSTANCE_ID,
  } satisfies HealthResponse);
});

export default app;
