import { sql } from "drizzle-orm";
import { boolean, check, pgTable, uuid } from "drizzle-orm/pg-core";

export const history = pgTable("history", {
  singleton: boolean("singleton").primaryKey().default(true),
  generation: uuid("generation").notNull().defaultRandom(),
}, (table) => [check("history_singleton", sql`${table.singleton} = true`)]);
