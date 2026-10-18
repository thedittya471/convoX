import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { config } from "./config.js";
import { db } from "../db/client.js";
import * as schema from "../db/schema/auth.schema.js";

export const auth = betterAuth({
  appName: "convoX",
  baseURL: config.BETTER_AUTH_URL,
  secret: config.BETTER_AUTH_SECRET,
  trustedOrigins: [new URL(config.BETTER_AUTH_URL).origin],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  advanced: {
    useSecureCookies: new URL(config.BETTER_AUTH_URL).protocol === "https:",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    ipAddress: { ipAddressHeaders: ["x-real-ip"] },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
    },
  },
});
