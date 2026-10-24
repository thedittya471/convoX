import { publisher, subscriber } from "./redis.js";
import { pool } from "../db/client.js";
import { metrics } from "./metrics.js";

export const lifecycle = { draining: false };
let checkedAt = -Infinity;
let healthy = false;
let checking: Promise<boolean> | undefined;
export async function httpReady() {
  if (lifecycle.draining) return false;
  if (performance.now() - checkedAt < 250) return healthy;
  checking ??= pool.query("SELECT 1").then(() => true, () => { metrics.databaseErrors++; return false; }).then((value) => {
    healthy = value;
    checkedAt = performance.now();
    return value;
  }).finally(() => { checking = undefined; });
  return await checking && !lifecycle.draining;
}

export async function realtimeReady() {
  if (!await httpReady() || !publisher.isReady || !subscriber.isReady) return false;
  return Promise.all([publisher.ping(), subscriber.ping()]).then(() => !lifecycle.draining, () => false);
}
