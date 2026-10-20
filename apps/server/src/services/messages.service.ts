import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, or } from "drizzle-orm";
import type { CreateMessage, Message, MessageListQuery } from "@convox/contracts";
import { db } from "../db/client.js";
import { conversation } from "../db/schema/conversation.schema.js";
import { message, messageOutbox } from "../db/schema/message.schema.js";

function serializeMessage(row: typeof message.$inferSelect): Message {

  return { ...row, sequence: row.sequence.toString(), createdAt: row.createdAt.toISOString() };
}

export async function createMessage(userId: string, conversationId: string, input: CreateMessage) {

  return db.transaction(async (transaction) => {

    const [chat] = await transaction.select()
      .from(conversation)
      .where(and(
        eq(conversation.id, conversationId),
        or(eq(conversation.directUserLowId, userId), eq(conversation.directUserHighId, userId))
      ))
      .for("update");

    if (!chat) {
      return null;
    }

    const sequence = chat.lastMessageSequence + 1n;
    const [inserted] = await transaction.insert(message)
      .values({ id: randomUUID(), conversationId, senderId: userId, ...input, sequence })
      .onConflictDoNothing({ target: [message.senderId, message.clientMessageId] })
      .returning();

    if (!inserted) {
      const [existing] = await transaction.select()
        .from(message)
        .where(and(eq(message.senderId, userId), eq(message.clientMessageId, input.clientMessageId)));

      if (!existing) {
        throw new Error("Retried message is no longer available");
      }

      if (existing.conversationId !== conversationId || existing.encryptedPayload !== input.encryptedPayload) {
        return { conflict: true as const };
      }

      return { conflict: false as const, created: false, message: serializeMessage(existing) };
    }

    await transaction.update(conversation).set({ lastMessageSequence: sequence }).where(eq(conversation.id, conversationId));
    await transaction.insert(messageOutbox).values({ messageId: inserted.id });

    return { conflict: false as const, created: true, message: serializeMessage(inserted) };
  });
}

export async function listMessages(userId: string, conversationId: string, { limit, after }: MessageListQuery) {

  const [chat] = await db.select({ id: conversation.id })
    .from(conversation)
    .where(and(
      eq(conversation.id, conversationId),
      or(eq(conversation.directUserLowId, userId), eq(conversation.directUserHighId, userId))
    ));

  if (!chat) {
    return null;
  }

  const rows = await db.select().from(message)
    .where(and(eq(message.conversationId, conversationId), gt(message.sequence, BigInt(after))))
    .orderBy(asc(message.sequence))
    .limit(limit + 1);

  const page = rows.slice(0, limit);

  return {
    messages: page.map(serializeMessage),
    nextAfter: rows.length > limit ? page[page.length - 1].sequence.toString() : null,
  };
}
