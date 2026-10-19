import { randomUUID } from "node:crypto";
import { lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { rateLimit } from "../db/schema/auth.schema.js";

const windowMs = 60_000;

export async function consumeRateLimit(key: string, maxRequests: number): Promise<number> {

  const now = Date.now();
  const expired = lte(rateLimit.lastRequest, now - windowMs);

  const [limit] = await db.insert(rateLimit)
    .values({ id: randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${expired} then ${now} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count, lastRequest: rateLimit.lastRequest });

  if (limit.count <= maxRequests) {
    return 0;
  }

  return Math.max(1, Math.ceil((limit.lastRequest + windowMs - now) / 1000));
}
