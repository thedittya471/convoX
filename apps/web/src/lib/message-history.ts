import { conversationSchema, messageHistoryPageSchema, type Message } from "@convox/contracts";

export class HistoryError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function loadHistory(userId: string, conversationId: string, signal: AbortSignal,
  older?: { before: string; generation: string }, request: typeof fetch = fetch) {
  conversationSchema.shape.id.parse(conversationId);
  const query = new URLSearchParams({ limit: "50", ...(older ?? { recent: "true" }) });
  const response = await request(`/api/conversations/${conversationId}/messages?${query}`, {
    credentials: "include", cache: "no-store", headers: { "X-Expected-User-Id": userId }, signal,
  });
  if (!response.ok) throw new HistoryError(response.status === 404 ? "This conversation is no longer available." :
    [409, 410].includes(response.status) ? "History changed or is unavailable. Reload history; pending sends remain saved." :
    "Could not load messages. Please try again.", response.status);
  const page = messageHistoryPageSchema.parse(await response.json());
  signal.throwIfAborted();
  const end = older ? BigInt(older.before) - BigInt(1) : BigInt(page.headSequence);
  if (page.messages.length > 50 || (older && page.generation !== older.generation) ||
    page.messages.some((message, index) => message.conversationId !== conversationId ||
      BigInt(message.sequence) !== end - BigInt(page.messages.length - index - 1)) ||
    (page.messages.length === 0 && end !== BigInt(0)) || page.nextAfter !== null ||
    page.nextBefore !== (page.messages.length && BigInt(page.messages[0].sequence) > BigInt(1) ? page.messages[0].sequence : null)) {
    throw new Error("Invalid message history page.");
  }
  return page;
}

export const HISTORY_WINDOW = 200;
export function mergeHistory(current: Message[], incoming: Message[], direction: "older" | "live") {
  const rows = [...new Map([...current, ...incoming].map((message) => [message.sequence, message])).values()]
    .sort((left, right) => BigInt(left.sequence) < BigInt(right.sequence) ? -1 : BigInt(left.sequence) > BigInt(right.sequence) ? 1 : 0);
  return direction === "older" ? rows.slice(0, HISTORY_WINDOW) : rows.slice(-HISTORY_WINDOW);
}
