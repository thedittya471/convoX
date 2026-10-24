import { conversationCursorSchema, conversationListResponseSchema, type Conversation } from "@convox/contracts";
import { checkConversationResponse, ConversationLookupError } from "./open-conversation";

export async function loadConversations(userId: string, cursor: string | null, signal: AbortSignal, request: typeof fetch = fetch) {
  const query = new URLSearchParams({ limit: "20" });

  if (cursor) {
    conversationCursorSchema.parse(cursor);
    query.set("cursor", cursor);
  }
  const response = await request(`/api/conversations?${query}`, { credentials: "include", cache: "no-store", headers: { "X-Expected-User-Id": userId }, signal });
  checkConversationResponse(response, "Conversations are unavailable. Please try again.");
  const parsed = conversationListResponseSchema.safeParse(await response.json());
  signal.throwIfAborted();

  if (!parsed.success || (parsed.data.nextCursor !== null && (!conversationCursorSchema.safeParse(parsed.data.nextCursor).success || parsed.data.nextCursor === cursor))) {
    throw new ConversationLookupError("Could not read the conversation list. Please try again.");
  }
  return parsed.data;
}

export function mergeConversations(current: Conversation[], incoming: Conversation[]): Conversation[] {
  const unique = new Map(current.map((conversation) => [conversation.id, conversation]));

  for (const conversation of incoming) unique.set(conversation.id, conversation);
  return [...unique.values()].sort((first, second) => second.createdAt.localeCompare(first.createdAt) || second.id.localeCompare(first.id));
}
