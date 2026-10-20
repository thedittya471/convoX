import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.schema.js";

export const conversation = pgTable("conversation", {
  id: uuid("id").primaryKey(),
  directUserLowId: text("direct_user_low_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  directUserHighId: text("direct_user_high_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("conversation_direct_pair_idx").on(table.directUserLowId, table.directUserHighId),
  index("conversation_direct_high_user_idx").on(table.directUserHighId),
  index("conversation_created_idx").on(table.createdAt.desc(), table.id.desc()),
  check("conversation_direct_pair_check", sql`${table.directUserLowId} COLLATE "C" < ${table.directUserHighId} COLLATE "C"`),
]);
