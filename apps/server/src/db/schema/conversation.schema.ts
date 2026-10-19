import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.schema.js";

export const conversationType = pgEnum("conversation_type", ["direct", "group"]);

export const conversation = pgTable("conversation", {
  id: uuid("id").primaryKey(),
  type: conversationType("type").notNull(),
  directUserLowId: text("direct_user_low_id").references(() => user.id, { onDelete: "restrict" }),
  directUserHighId: text("direct_user_high_id").references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("conversation_direct_pair_idx").on(table.directUserLowId, table.directUserHighId),
  index("conversation_direct_high_user_idx").on(table.directUserHighId),
  index("conversation_created_idx").on(table.createdAt.desc(), table.id.desc()),
  check("conversation_direct_pair_check", sql`
    (${table.type} = 'direct' AND ${table.directUserLowId} IS NOT NULL AND ${table.directUserHighId} IS NOT NULL
      AND ${table.directUserLowId} COLLATE "C" < ${table.directUserHighId} COLLATE "C")
    OR (${table.type} = 'group' AND ${table.directUserLowId} IS NULL AND ${table.directUserHighId} IS NULL)
  `),
]);

export const conversationMember = pgTable("conversation_member", {
  conversationId: uuid("conversation_id").notNull().references(() => conversation.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  joinedAt: timestamp("joined_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.userId] }),
  index("conversation_member_user_idx").on(table.userId, table.conversationId),
]);
