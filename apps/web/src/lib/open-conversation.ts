import { conversationResponseSchema, userLookupResponseSchema, usernameSchema } from "@convox/contracts";

export class ConversationLookupError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export function checkConversationResponse(response: Response, missing: string) {
  if (response.ok) return;
  if (response.status === 401) throw new ConversationLookupError("Your session expired. Sign in again to continue.", 401);
  if (response.status === 403) throw new ConversationLookupError("Verify your email from your account before opening a conversation.", 403);
  if (response.status === 404) throw new ConversationLookupError(missing);
  if (response.status === 429) throw new ConversationLookupError("Too many attempts. Wait a minute and try again.");
  throw new ConversationLookupError("Conversations are temporarily unavailable. Please try again.");
}

export async function openConversation(username: string, userId: string, signal: AbortSignal, request: typeof fetch = fetch) {
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) throw new ConversationLookupError("Use an exact username with 3–30 letters, numbers, underscores or dots.");
  const lookup = await request(`/api/users/lookup?username=${encodeURIComponent(parsed.data)}`, {
    credentials: "include", cache: "no-store", signal,
  });
  checkConversationResponse(lookup, "No other user has that exact username. Enter someone else’s username, not your own.");
  const found = userLookupResponseSchema.safeParse(await lookup.json());
  signal.throwIfAborted();
  if (!found.success) throw new ConversationLookupError("Could not read the search result. Please try again.");
  if (found.data.user.id === userId) throw new ConversationLookupError("You cannot open a conversation with yourself.");

  const response = await request("/api/conversations", {
    method: "POST", credentials: "include", cache: "no-store", signal,
    headers: { "Content-Type": "application/json", "X-Expected-User-Id": userId },
    body: JSON.stringify({ otherUserId: found.data.user.id }),
  });
  checkConversationResponse(response, "That account is no longer available. Search again.");
  const opened = conversationResponseSchema.safeParse(await response.json());
  signal.throwIfAborted();
  if (!opened.success || opened.data.conversation.peer.id !== found.data.user.id) {
    throw new ConversationLookupError("Could not confirm the conversation. Please try again.");
  }
  return opened.data.conversation;
}
