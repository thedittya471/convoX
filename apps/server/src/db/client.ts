import { metrics } from "../utils/metrics.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../utils/config.js";
import * as authSchema from "./schema/auth.schema.js";
import * as conversationSchema from "./schema/conversation.schema.js";
import * as messageSchema from "./schema/message.schema.js";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 2000,
  query_timeout: 2000,
  idleTimeoutMillis: 30000,
});

pool.on("error", () => { metrics.databaseErrors++; console.error(JSON.stringify({ event: "database_pool_error", instanceId: config.INSTANCE_ID })); });

export const db = drizzle(pool, {
  schema: {
    ...authSchema,
    ...conversationSchema,
    ...messageSchema
  }
});
