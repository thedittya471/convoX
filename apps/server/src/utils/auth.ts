import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { APIError, createAuthMiddleware, createEmailVerificationToken, getSessionFromCtx } from "better-auth/api";
import { sendVerificationEmail } from "./email.js";
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
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    expiresIn: 3600,
    sendVerificationEmail: async ({ user, url }, request) => {
      const token = await createEmailVerificationToken(config.BETTER_AUTH_SECRET, user.email, undefined, 3600, { jti: randomUUID() });
      const id = createHash("sha256").update(token).digest("hex");
      await db.delete(schema.verification).where(and(eq(schema.verification.identifier, `email:${user.id}`), lte(schema.verification.expiresAt, new Date())));
      await db.insert(schema.verification).values({ id, identifier: `email:${user.id}`, value: user.id, expiresAt: new Date(Date.now() + 3600000) }).onConflictDoNothing();
      try {
        const link = new URL(url);
        link.searchParams.set("token", token);
        link.searchParams.set("callbackURL", `${new URL(config.BETTER_AUTH_URL).origin}/?verification=complete`);
        await sendVerificationEmail(user.email, link.toString());
      } catch {
        console.error(JSON.stringify({ event: "verification_email_failed", instanceId: config.INSTANCE_ID }));
        // Signup keeps the new account usable for login and an authenticated resend.
        if (!request?.url.includes("/sign-up/email")) throw new APIError("SERVICE_UNAVAILABLE", { message: "Could not send the verification email. Please try again." });
      }
    },
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path === "/send-verification-email") {
        const identity = await getSessionFromCtx(context);
        // Only authenticated owners can trigger delivery; anonymous requests are indistinguishable.
        if (!identity) return context.json({ status: true });
        if (typeof context.body?.email !== "string" || identity.user.email.toLowerCase() !== context.body.email.toLowerCase()) throw new APIError("BAD_REQUEST", { message: "Use your signed-in email address." });
        const now = Date.now();
        const [limit] = await db.insert(schema.rateLimit).values({ id: randomUUID(), key: `verify:${identity.user.id}`, count: 1, lastRequest: now })
          .onConflictDoUpdate({ target: schema.rateLimit.key, set: {
            count: sql`CASE WHEN ${schema.rateLimit.lastRequest} <= ${now - 60000} THEN 1 ELSE ${schema.rateLimit.count} + 1 END`,
            lastRequest: sql`CASE WHEN ${schema.rateLimit.lastRequest} <= ${now - 60000} THEN ${now} ELSE ${schema.rateLimit.lastRequest} END`,
          } }).returning({ count: schema.rateLimit.count });
        if (limit.count > 3) throw new APIError("TOO_MANY_REQUESTS", { message: "Wait a minute before requesting another email." });
      }
      if (context.path === "/verify-email") {
        let callback: URL;
        try { callback = new URL(String(context.query?.callbackURL ?? "/"), config.BETTER_AUTH_URL); }
        catch { throw new APIError("BAD_REQUEST", { message: "Invalid callback." }); }
        if (callback.origin !== new URL(config.BETTER_AUTH_URL).origin) throw new APIError("FORBIDDEN", { message: "Invalid callback." });
        const id = createHash("sha256").update(String(context.query?.token ?? "")).digest("hex");
        const [consumed] = await db.delete(schema.verification).where(and(eq(schema.verification.id, id), gt(schema.verification.expiresAt, new Date()))).returning({ id: schema.verification.id });
        if (!consumed) throw context.redirect(`${new URL(config.BETTER_AUTH_URL).origin}/?verification=invalid`);
      }
    }),
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
      "/send-verification-email": { window: 60, max: 3 },
      "/verify-email": { window: 60, max: 20 },
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
    },
  },
});
