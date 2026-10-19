import { and, eq, ne } from "drizzle-orm";
import type { PublicUser } from "@convox/contracts";
import { db } from "../db/client.js";
import { user } from "../db/schema/auth.schema.js";

export async function findUserByUsername(username: string, currentUserId: string): Promise<PublicUser | null> {

  const [found] = await db.select({
    id: user.id,
    username: user.username,
    name: user.name
  })
    .from(user)
    .where(and(eq(user.username, username), ne(user.id, currentUserId)))
    .limit(1);

  return found?.username ? { ...found, username: found.username } : null;
}
