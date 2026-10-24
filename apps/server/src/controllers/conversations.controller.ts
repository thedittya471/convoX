import type { Request, Response } from "express";
import { createConversationSchema, conversationListQuerySchema } from "@convox/contracts";
import { enforceChatLimit } from "../utils/rate-limit.js";
import { getVerifiedSession } from "../utils/verified-session.js";
import { config } from "../utils/config.js";
import { createDirectConversation, listConversations } from "../services/conversations.service.js";

export async function createConversation(request: Request, response: Response) {

  response.set("Cache-Control", "no-store");

  try {
    const session = await getVerifiedSession(request, response, "Sign in to start a conversation.");
    if (!session) return;

    if (request.get("X-Expected-User-Id") && request.get("X-Expected-User-Id") !== session.user.id) {
      return response.status(403).json({ error: "The signed-in account has changed." });
    }

    if (request.get("Origin") !== new URL(config.BETTER_AUTH_URL).origin) {
      return response.status(403).json({ error: "Invalid request origin." });
    }

    if (!await enforceChatLimit(response, "open", session.user.id, config.CHAT_OPENS_PER_MINUTE)) return;

    const parsed = createConversationSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.otherUserId === session.user.id) {
      return response.status(400).json({ error: "Provide the ID of a different user." });
    }

    const result = await createDirectConversation(session.user.id, parsed.data.otherUserId);
    if (!result) {
      return response.status(404).json({ error: "User not found." });
    }

    return response.status(result.created ? 201 : 200).json({ conversation: result.conversation });

  } catch {
    console.error(JSON.stringify({ event: "conversation_create_failed" }));
    return response.status(503).json({ error: "Could not open the conversation. Please try again." });
  }
}

export async function getConversations(request: Request, response: Response) {

  response.set("Cache-Control", "no-store");

  try {
    const session = await getVerifiedSession(request, response, "Sign in to view conversations.");
    if (!session) return;

    if (request.get("X-Expected-User-Id") && request.get("X-Expected-User-Id") !== session.user.id) {
      return response.status(403).json({ error: "The signed-in account has changed." });
    }

    if (!await enforceChatLimit(response, "read", session.user.id, config.CHAT_READS_PER_MINUTE)) return;

    const parsed = conversationListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return response.status(400).json({ error: "Invalid limit or cursor." });
    }

    return response.json(await listConversations(session.user.id, parsed.data));

  } catch {
    console.error(JSON.stringify({ event: "conversation_list_failed" }));
    return response.status(503).json({ error: "Could not list conversations. Please try again." });
  }
}
