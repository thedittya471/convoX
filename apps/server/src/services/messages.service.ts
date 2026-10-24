import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, lt, lte, or } from "drizzle-orm";
import type { CreateMessage, Message, MessageListQuery } from "@convox/contracts";
import { db } from "../db/client.js";
import { conversation } from "../db/schema/conversation.schema.js";
import { history } from "../db/schema/history.schema.js";
import { message, messageOutbox } from "../db/schema/message.schema.js";

export function serializeMessage(row: typeof message.$inferSelect): Message {

  return { ...row, sequence: row.sequence.toString(), createdAt: row.createdAt.toISOString() };
}

export async function createMessage(userId: string, conversationId: string, input: CreateMessage, expectedGeneration?: string) {

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

    if (expectedGeneration) {
      const [current] = await transaction.select().from(history).for("share");
      if (!current) throw new Error("History generation is unavailable");
      if (current.generation !== expectedGeneration) return { code: "HISTORY_RESET" as const, error: "History changed. Reload history before sending." };
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

export async function listMessages(userId: string, conversationId: string, query: MessageListQuery) {

  // One snapshot keeps the counter, cursor validation and page consistent during sends.
  return db.transaction(async (transaction) => {
    const [chat] = await transaction.select({ head: conversation.lastMessageSequence })
      .from(conversation)
      .where(and(eq(conversation.id, conversationId),
        or(eq(conversation.directUserLowId, userId), eq(conversation.directUserHighId, userId))));
    if (!chat) return null;

    const [current] = await transaction.select().from(history);
    if (!current) throw new Error("History generation is unavailable");
    if ((query.generation && query.generation !== current.generation) ||
      (!query.generation && (query.before !== undefined || (query.after !== undefined && query.after !== "0")))) {
      return { code: "HISTORY_RESET" as const, error: "History changed or the checkpoint has no generation. Reload history; pending sends are preserved." };
    }
    const backwards = query.recent !== undefined || query.before !== undefined;
    const cursor = BigInt(query.before ?? query.after ?? "0");
    if (cursor > chat.head) return { code: "CURSOR_AHEAD" as const, error: "The cursor exceeds the current history. Rebuild history." };
    const unavailable = { code: "HISTORY_UNAVAILABLE" as const, error: "Required message history is unavailable. Rebuild history." };
    if (cursor > 0n) {
      const [boundary] = await transaction.select({ id: message.id }).from(message)
        .where(and(eq(message.conversationId, conversationId), eq(message.sequence, cursor)));
      if (!boundary) return unavailable;
    }

    const boundary = backwards ? (query.before === undefined ? chat.head + 1n : cursor) : cursor;
    const rows = await transaction.select().from(message)
      .where(and(eq(message.conversationId, conversationId), lte(message.sequence, chat.head),
        backwards ? lt(message.sequence, boundary) : gt(message.sequence, boundary)))
      .orderBy(backwards ? desc(message.sequence) : asc(message.sequence))
      .limit(query.limit + 1);
    const available = backwards ? boundary - 1n : chat.head - boundary;
    const expectedCount = Number(available < BigInt(query.limit + 1) ? available : BigInt(query.limit + 1));
    if (rows.length !== expectedCount || rows.some((row, index) =>
      row.sequence !== (backwards ? boundary - BigInt(index + 1) : boundary + BigInt(index + 1)))) return unavailable;

    const page = rows.slice(0, query.limit);
    const more = rows.length > query.limit;
    if (backwards) page.reverse();
    return {
      messages: page.map(serializeMessage),
      nextAfter: !backwards && more ? page[page.length - 1].sequence.toString() : null,
      nextBefore: backwards && more ? page[0].sequence.toString() : null,
      headSequence: chat.head.toString(),
      generation: current.generation,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
