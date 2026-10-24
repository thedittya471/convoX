import { lifecycle } from "./utils/readiness.js";
import { createServer } from "node:http";
import app from "./app.js";
import { config } from "./utils/config.js";
import { pool } from "./db/client.js";
import { publisher, subscriber } from "./utils/redis.js";
import { createRealtimeServer, connectRealtime, publishMessage } from "./utils/realtime.js";
import { startOutboxPublisher } from "./services/outbox.service.js";

const server = createServer(app);
const io = createRealtimeServer(server);
let stopPublisher: (() => Promise<void>) | undefined;
let stopping = false;

async function shutdown(exitCode: number) {

  if (stopping) {
    return;
  }

  stopping = true;
  lifecycle.draining = true;
  console.log(JSON.stringify({ event: "draining", instanceId: config.INSTANCE_ID }));
  io.local.disconnectSockets(true);

  const deadline = setTimeout(() => process.exit(1), 8000);
  deadline.unref();

  try {
    await stopPublisher?.();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.all([publisher, subscriber].filter((client) => client.isOpen).map((client) => client.close()));
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
  await connectRealtime(io);
  stopPublisher = startOutboxPublisher((message, participants) => publishMessage(io, message, participants));

  server.listen(config.PORT, "0.0.0.0", () => {

    console.log(JSON.stringify({
      event: "listening",
      instanceId: config.INSTANCE_ID,
      port: config.PORT
    }));
  });

} catch {
  console.error(JSON.stringify({ event: "startup_failed", instanceId: config.INSTANCE_ID }));
  await shutdown(1);
}
