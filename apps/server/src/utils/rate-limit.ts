import { metrics } from "./metrics.js";
import { createHash, randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../db/client.js";
import { config } from "./config.js";

let nextCleanup = 0;

export async function claimQuota(scope: string, identity: string, limit: number) {
  const key = `chat:${scope}:${createHash("sha256").update(identity).digest("hex")}`;
  const result = await pool.query<{ count: number; retry_after: number }>(`
    INSERT INTO rate_limit (id, key, count, last_request)
    VALUES ($1, $2, 1, floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit.last_request <= EXCLUDED.last_request - 60000 THEN 1
        ELSE LEAST(rate_limit.count + 1, $3 + 1) END,
      last_request = CASE WHEN rate_limit.last_request <= EXCLUDED.last_request - 60000
        THEN EXCLUDED.last_request ELSE rate_limit.last_request END
    RETURNING count, GREATEST(1, ceil((last_request + 60000 - extract(epoch FROM clock_timestamp()) * 1000) / 1000))::int AS retry_after`, [randomUUID(), key, limit]);

  if (Date.now() >= nextCleanup) {
    nextCleanup = Date.now() + 60000;
    // Bound opportunistic cleanup and leave Better Auth's independently owned buckets alone.
    void pool.query(`DELETE FROM rate_limit WHERE id IN (
      SELECT id FROM rate_limit WHERE key LIKE 'chat:%'
      AND last_request < extract(epoch FROM statement_timestamp()) * 1000 - 3600000 LIMIT 1000
    )`).catch(() => console.error(JSON.stringify({ event: "chat_quota_cleanup_failed" })));
  }
  return { allowed: result.rows[0].count <= limit, retryAfter: result.rows[0].retry_after };
}

export async function enforceChatLimit(response: Response, scope: string, identity: string, limit: number) {
  response.set("Cache-Control", "no-store");

  try {
    const quota = await claimQuota(scope, identity, limit);

    if (quota.allowed) {
      return true;
    }
    response.set("Retry-After", String(quota.retryAfter)).status(429).json({ error: "Too many requests. Retry after the indicated delay.", retryAfter: quota.retryAfter });
  } catch {
    metrics.databaseErrors++;
    console.error(JSON.stringify({ event: "chat_quota_unavailable" }));
    response.set("Retry-After", "5").status(503).json({ error: "Request limits are temporarily unavailable. Retry shortly." });
  }
  return false;
}

export async function limitChatIp(request: Request, response: Response, next: NextFunction) {
  if (await enforceChatLimit(response, "ip", request.ip ?? request.socket.remoteAddress ?? "unknown", config.CHAT_IP_PER_MINUTE)) {
    next();
  }
}
