import type { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { createConversationSchema, conversationListQuerySchema } from "@convox/contracts";
import { auth } from "../utils/auth.js";
import { config } from "../utils/config.js";
import { createDirectConversation, listConversations } from "../services/conversations.service.js";

export async function createConversation(request: Request, response: Response) {

  response.set("Cache-Control", "no-store");

  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers)
    });

    if (!session) {
      return response.status(401).json({ error: "Sign in to start a conversation." });
    }

    if (request.get("Origin") !== new URL(config.BETTER_AUTH_URL).origin) {
      return response.status(403).json({ error: "Invalid request origin." });
    }

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
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers)
    });

    if (!session) {
      return response.status(401).json({ error: "Sign in to view conversations." });
    }

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
