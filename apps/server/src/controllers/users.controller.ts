import type { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { usernameSchema } from "@convox/contracts";
import { auth } from "../utils/auth.js";
import { consumeLookupLimit, findUserByUsername } from "../services/users.service.js";

export async function lookupUser(request: Request, response: Response) {
  response.set("Cache-Control", "no-store");
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      return response.status(401).json({ error: "Sign in to find someone." });
    }

    const retryAfter = await consumeLookupLimit(session.user.id);
    if (retryAfter > 0) {
      return response.status(429).set("Retry-After", String(retryAfter))
        .json({ error: "Too many searches. Please wait a minute and try again." });
    }

    const parsed = usernameSchema.safeParse(request.query.username);
    if (!parsed.success) {
      return response.status(400).json({ error: "Use a username with 3–30 letters, numbers, underscores or dots." });
    }
    const found = await findUserByUsername(parsed.data, session.user.id);
    if (!found) {
      return response.status(404).json({ error: "No other user has that username." });
    }
    response.json({ user: found });
  } catch {
    console.error(JSON.stringify({ event: "user_lookup_failed" }));
    response.status(503).json({ error: "Search is temporarily unavailable. Please try again." });
  }
}
