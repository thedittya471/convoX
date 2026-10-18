import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../utils/config.js";
import * as schema from "./schema/auth.schema.js";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 2000,
  query_timeout: 2000,
  idleTimeoutMillis: 30000,
});
pool.on("error", () => console.error(JSON.stringify({ event: "database_pool_error" })));

export const db = drizzle(pool, { schema });
