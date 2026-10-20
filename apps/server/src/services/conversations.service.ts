import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Conversation, ConversationListQuery } from "@convox/contracts";
import { db } from "../db/client.js";
import { user } from "../db/schema/auth.schema.js";
import { conversation } from "../db/schema/conversation.schema.js";

export async function createDirectConversation(userId: string, otherUserId: string) {

  const [directUserLowId, directUserHighId] = [userId, otherUserId]
    .sort((first, second) => Buffer.compare(Buffer.from(first), Buffer.from(second)));

  return db.transaction(async (transaction) => {

    const [peer] = await transaction.select({
      id: user.id,
      name: user.name,
      username: user.username
    })
      .from(user)
      .where(eq(user.id, otherUserId))
      .limit(1);

    if (!peer) {
      return null;
    }

    const [inserted] = await transaction.insert(conversation)
      .values({ id: randomUUID(), directUserLowId, directUserHighId })
      .onConflictDoNothing({ target: [conversation.directUserLowId, conversation.directUserHighId] })
      .returning();

    let saved = inserted;

    if (!inserted) {
      [saved] = await transaction.select()
        .from(conversation)
        .where(and(
          eq(conversation.directUserLowId, directUserLowId),
          eq(conversation.directUserHighId, directUserHighId)
        ))
        .limit(1);
    }

    if (!saved) {
      throw new Error("Conversation is no longer available");
    }

    return {
      created: Boolean(inserted),
      conversation: {
        id: saved.id,
        type: "direct",
        createdAt: saved.createdAt.toISOString(),
        peer
      } satisfies Conversation,
    };
  });
}

export async function listConversations(userId: string, { limit, cursor }: ConversationListQuery) {

  const rows = await db.select({
    id: conversation.id,
    createdAt: conversation.createdAt,
    peer: {
      id: user.id,
      name: user.name,
      username: user.username
    },
  })
    .from(conversation)
    .innerJoin(user, or(
      and(eq(conversation.directUserLowId, userId), eq(user.id, conversation.directUserHighId)),
      and(eq(conversation.directUserHighId, userId), eq(user.id, conversation.directUserLowId)),
    ))
    .where(and(
      or(eq(conversation.directUserLowId, userId), eq(conversation.directUserHighId, userId)),
      cursor ? or(
        lt(conversation.createdAt, new Date(cursor[0])),
        and(eq(conversation.createdAt, new Date(cursor[0])), lt(conversation.id, cursor[1])),
      ) : undefined,
    ))
    .orderBy(desc(conversation.createdAt), desc(conversation.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    conversations: page.map((row): Conversation => ({ ...row, type: "direct", createdAt: row.createdAt.toISOString() })),
    nextCursor: rows.length > limit && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
  };
}
