import { createServer } from "node:http";
import app from "./app.js";
import { config } from "./utils/config.js";
import { pool } from "./db/client.js";

const server = createServer(app);
let stopping = false;

async function shutdown(exitCode: number) {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 8000);
  deadline.unref();
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    clearTimeout(deadline);
    process.exitCode = exitCode;
  } catch {
    console.error(JSON.stringify({ event: "shutdown_failed", instanceId: config.INSTANCE_ID }));
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));
server.on("error", () => {
  console.error(JSON.stringify({ event: "http_server_error", instanceId: config.INSTANCE_ID }));
  void shutdown(1);
});

try {
  await pool.query("SELECT 1");
  server.listen(config.PORT, "0.0.0.0", () => {
    console.log(JSON.stringify({ event: "listening", instanceId: config.INSTANCE_ID, port: config.PORT }));
  });
} catch {
  console.error(JSON.stringify({ event: "startup_failed", instanceId: config.INSTANCE_ID }));
  await shutdown(1);
}
