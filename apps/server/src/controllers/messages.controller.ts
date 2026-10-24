import type { Request, Response } from "express";
import { createMessageSchema, messageListQuerySchema, conversationSchema } from "@convox/contracts";
import { getVerifiedSession } from "../utils/verified-session.js";
import { config } from "../utils/config.js";
import { createMessage, listMessages } from "../services/messages.service.js";

export async function sendMessage(request: Request, response: Response) {

  response.set("Cache-Control", "no-store");

  try {
    const session = await getVerifiedSession(request, response, "Sign in to send messages.");
    if (!session) return;

    if (request.get("X-Expected-User-Id") && request.get("X-Expected-User-Id") !== session.user.id) {
      return response.status(403).json({ error: "The signed-in account has changed." });
    }

    if (request.get("Origin") !== new URL(config.BETTER_AUTH_URL).origin) {
      return response.status(403).json({ error: "Invalid request origin." });
    }

    const id = conversationSchema.shape.id.safeParse(request.params.id);
    const parsed = createMessageSchema.safeParse(request.body);

    if (!id.success || !parsed.success) {
      return response.status(400).json({ error: "Provide a valid conversation ID, client message ID and encrypted payload." });
    }

    const result = await createMessage(session.user.id, id.data, parsed.data);

    if (!result) {
      return response.status(404).json({ error: "Conversation not found." });
    }

    if (result.conflict) {
      return response.status(409).json({ error: "This client message ID was already used for a different message." });
    }

    return response.status(result.created ? 201 : 200).json({ message: result.message });

  } catch {
    console.error(JSON.stringify({ event: "message_create_failed" }));
    return response.status(503).json({ error: "Could not save the message. Retry with the same client message ID." });
  }
}

export async function getMessages(request: Request, response: Response) {

  response.set("Cache-Control", "no-store");

  try {
    const session = await getVerifiedSession(request, response, "Sign in to view messages.");
    if (!session) return;

    if (request.get("X-Expected-User-Id") && request.get("X-Expected-User-Id") !== session.user.id) {
      return response.status(403).json({ error: "The signed-in account has changed." });
    }

    const id = conversationSchema.shape.id.safeParse(request.params.id);
    const parsed = messageListQuerySchema.safeParse(request.query);

    if (!id.success || !parsed.success) {
      return response.status(400).json({ error: "Invalid conversation ID, limit or sequence cursor." });
    }

    const result = await listMessages(session.user.id, id.data, parsed.data);

    if (!result) {
      return response.status(404).json({ error: "Conversation not found." });
    }

    if ("code" in result) {
      return response.status(result.code === "CURSOR_AHEAD" ? 409 : 410).json(result);
    }

    return response.json(result);

  } catch {
    console.error(JSON.stringify({ event: "message_list_failed" }));
    return response.status(503).json({ error: "Could not list messages. Please try again." });
  }
}
