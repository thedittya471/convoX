import { randomUUID } from "node:crypto";
import { and, eq, lte, ne, sql } from "drizzle-orm";
import type { PublicUser } from "@convox/contracts";
import { db } from "../db/client.js";
import { rateLimit, user } from "../db/schema/auth.schema.js";

const lookupWindowMs = 60_000;
const maxLookups = 30;

export async function consumeLookupLimit(userId: string): Promise<number> {
  const now = Date.now();
  const key = `user-lookup:${userId}`;
  const expired = lte(rateLimit.lastRequest, now - lookupWindowMs);
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

  if (limit.count <= maxLookups) return 0;

  const windowEndsAt = limit.lastRequest + lookupWindowMs;
  return Math.max(1, Math.ceil((windowEndsAt - now) / 1000));
}

export async function findUserByUsername(username: string, currentUserId: string): Promise<PublicUser | null> {
  const [found] = await db.select({ id: user.id, username: user.username, name: user.name })
    .from(user).where(and(eq(user.username, username), ne(user.id, currentUserId))).limit(1);

  return found?.username ? { ...found, username: found.username } : null;
}
