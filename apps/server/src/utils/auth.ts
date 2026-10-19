import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { usernameSchema } from "@convox/contracts";
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
  plugins: [
    username({
      displayUsername: false,
      usernameValidator: (value) => usernameSchema.safeParse(value).success,
    })
  ],
  disabledPaths: ["/is-username-available", "/sign-in/username"],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128
  },
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
