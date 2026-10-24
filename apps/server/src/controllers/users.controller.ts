import type { Request, Response } from "express";
import { config } from "../utils/config.js";
import { usernameSchema } from "@convox/contracts";
import { enforceChatLimit } from "../utils/rate-limit.js";
import { getVerifiedSession } from "../utils/verified-session.js";
import { findUserByUsername } from "../services/users.service.js";

export async function lookupUser(request: Request, response: Response) {
  response.set("Cache-Control", "no-store");

  try {
    const session = await getVerifiedSession(request, response, "Sign in to find someone.");

    if (!session) return;

    if (!await enforceChatLimit(response, "lookup", session.user.id, config.CHAT_LOOKUPS_PER_MINUTE)) return;

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
