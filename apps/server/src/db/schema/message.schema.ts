import { sql } from "drizzle-orm";
import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.schema.js";
import { conversation } from "./conversation.schema.js";

export const message = pgTable("message", {
  id: uuid("id").primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversation.id, { onDelete: "restrict" }),
  senderId: text("sender_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  clientMessageId: uuid("client_message_id").notNull(),
  sequence: bigint("sequence", { mode: "bigint" }).notNull(),
  encryptedPayload: text("encrypted_payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("message_sender_client_idx").on(table.senderId, table.clientMessageId),
  uniqueIndex("message_conversation_sequence_idx").on(table.conversationId, table.sequence),
  check("message_sequence_positive", sql`${table.sequence} > 0`),
]);

export const messageOutbox = pgTable("message_outbox", {
  messageId: uuid("message_id").primaryKey().references(() => message.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true, precision: 3 }),
}, (table) => [
  index("message_outbox_pending_idx").on(table.createdAt, table.messageId).where(sql`${table.publishedAt} IS NULL`),
]);
