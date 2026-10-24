import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export const metrics = {
  activeSockets: 0,
  accepted: 0,
  publishAttempts: 0,
  publishErrors: 0,
  publisherRetries: 0,
  redisErrors: 0,
  databaseErrors: 0,
  httpRequests: 0,
  httpErrors: 0,
};
const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
const routing = { count: 0, sum: 0, buckets: buckets.map(() => 0) };

export function observeRouting(seconds: number) {
  routing.count++;
  routing.sum += seconds;
  buckets.forEach((bound, index) => {
    if (seconds <= bound) {
      routing.buckets[index]++;
    }
  });
}

export function metricsAuthorized(header?: string) {
  if (!config.METRICS_TOKEN) {
    return false;
  }
  const provided = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${config.METRICS_TOKEN}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function metricsText(pending: number, oldestSeconds: number, outboxAvailable: boolean) {
  const label = `instance=${JSON.stringify(config.INSTANCE_ID)}`;
  const values: [string, number, "counter" | "gauge"][] = [
    ["active_sockets", metrics.activeSockets, "gauge"],
    ["durable_accepts_total", metrics.accepted, "counter"],
    ["publish_attempts_total", metrics.publishAttempts, "counter"],
    ["publish_errors_total", metrics.publishErrors, "counter"],
    ["publisher_retry_loops_total", metrics.publisherRetries, "counter"],
    ["redis_errors_total", metrics.redisErrors, "counter"],
    ["database_errors_total", metrics.databaseErrors, "counter"],
    ["http_requests_total", metrics.httpRequests, "counter"],
    ["http_errors_total", metrics.httpErrors, "counter"],
    ["outbox_pending", pending, "gauge"],
    ["outbox_oldest_age_seconds", oldestSeconds, "gauge"],
    ["outbox_collection_available", Number(outboxAvailable), "gauge"],
  ];
  const lines = values.flatMap(([name, value, type]) => [`# TYPE convox_${name} ${type}`, `convox_${name}{${label}} ${value}`]);
  lines.push("# TYPE convox_routing_seconds histogram");
  buckets.forEach((bound, index) => lines.push(`convox_routing_seconds_bucket{${label},le="${bound}"} ${routing.buckets[index]}`));
  lines.push(`convox_routing_seconds_bucket{${label},le="+Inf"} ${routing.count}`, `convox_routing_seconds_sum{${label}} ${routing.sum}`, `convox_routing_seconds_count{${label}} ${routing.count}`);
  return `${lines.join("\n")}\n`;
}
