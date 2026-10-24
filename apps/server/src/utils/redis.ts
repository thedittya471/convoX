import { metrics } from "./metrics.js";
import { createClient } from "redis";
import { config } from "./config.js";

export const publisher = createClient({
  url: config.REDIS_URL,
  disableOfflineQueue: true,
  commandOptions: { timeout: 2000 },
  socket: { connectTimeout: 2000 },
});

export const subscriber = publisher.duplicate();

for (const client of [publisher, subscriber]) {
  client.on("error", () => { metrics.redisErrors++; console.error(JSON.stringify({ event: "redis_error", instanceId: config.INSTANCE_ID })); });
}
