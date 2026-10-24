import { io, type Socket } from "socket.io-client";
import { conversationSchema, createMessageSchema, messageSchema, messageResponseSchema, messageListResponseSchema, messageSequenceSchema, messageHistoryErrorSchema, type Message, type RealtimeEvents } from "@convox/contracts";
import { loadPendingMessages, savePendingMessage, removePendingMessage, type PendingMessage } from "./message-outbox";

export type ChatState = {
  status: "connecting" | "syncing" | "connected" | "reconnecting" | "unauthenticated" | "error" | "recovery-required" | "unavailable" | "stopped";
  cursor: string;
  generation: string | null;
  pending: PendingMessage[];
  error: string | null;
};

type ChatOptions = {
  userId: string;
  conversationId: string;
  onMessages: (messages: Message[]) => void;
  onChange?: (state: ChatState) => void;
  after?: string;
  generation?: string;
  resumePending?: boolean;
  apiUrl?: string;
  socketUrl?: string;
  socket?: Socket<RealtimeEvents, Record<string, never>>;
  request?: typeof fetch;
};

export function createChatClient(options: ChatOptions) {

  const { userId, conversationId } = options;
  conversationSchema.shape.id.parse(conversationId);
  if (!userId) throw new Error("A signed-in user is required.");

  const origin = new URL(options.apiUrl ?? globalThis.location.origin).origin;
  const path = `${origin}/api/conversations/${conversationId}/messages`;
  const request = options.request ?? globalThis.fetch.bind(globalThis);
  const socket = options.socket ?? io(options.socketUrl ?? origin, {
    autoConnect: false, transports: ["websocket"], withCredentials: true,
    reconnectionDelay: 250, reconnectionDelayMax: 1000, timeout: 5000,
  });
  const controller = new AbortController();
  const buffer = new Map<string, Message>();
  let cursor = BigInt(messageSequenceSchema.parse(options.after ?? "0"));
  let generation = options.generation ? conversationSchema.shape.id.parse(options.generation) : undefined;
  if (cursor > BigInt(0) && !generation) throw new Error("A checkpoint requires its original history generation. Reload history.");
  let halted = false;
  let highest = cursor;
  let status: ChatState["status"] = "connecting";
  let error: string | null = null;
  let pending: PendingMessage[] = [];
  let stopped = false;
  let unauthorized = false;
  let ready = false;
  let syncing = false;
  let historyHealthy = false;
  let syncRequested = false;
  let sendRequested = false;
  let starting: Promise<void> | undefined;
  let syncingTask: Promise<void> | undefined;
  let sendingTask: Promise<void> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 500;

  function getState(): ChatState {

    return { status, cursor: cursor.toString(), generation: generation ?? null, pending: pending.map((entry) => ({ ...entry })), error };
  }

  function notify(nextStatus = status, nextError: string | null = error) {

    if (stopped) return;
    status = nextStatus;
    error = nextError;
    options.onChange?.(getState());
  }

  function requireAuth(reason = "Sign in again with the same account to resume pending sends.") {

    unauthorized = true;
    ready = false;
    controller.abort();
    socket.disconnect();
    if (retryTimer) clearTimeout(retryTimer);
    if (interval) clearInterval(interval);
    notify("unauthenticated", reason);
  }

  function halt(next: "recovery-required" | "unavailable", reason: string) {
    halted = true;
    ready = false;
    historyHealthy = false;
    buffer.clear();
    controller.abort();
    socket.disconnect();
    if (retryTimer) clearTimeout(retryTimer);
    if (interval) clearInterval(interval);
    notify(next, reason);
  }

  function retryLater() {

    if (stopped || unauthorized || halted || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (!socket.connected && !socket.active) socket.connect();
      void synchronize();
    }, retryDelay + Math.random() * 200);
    retryDelay = Math.min(retryDelay * 2, 8000);
  }

  async function api(url: string, init: RequestInit = {}) {

    const response = await request(url, {
      ...init, credentials: "include", cache: "no-store",
      headers: { ...init.headers, "X-Expected-User-Id": userId, ...(generation ? { "X-History-Generation": generation } : {}) },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    });
    if (!stopped && [401, 403].includes(response.status)) requireAuth();
    return response;
  }

  function merge(message: Message) {

    if (message.conversationId !== conversationId) throw new Error("Unexpected conversation in history.");
    const sequence = BigInt(message.sequence);
    if (sequence <= cursor) return;
    if (buffer.size >= 1000) buffer.clear();
    buffer.set(message.sequence, message);
    if (sequence > highest) highest = sequence;
  }

  function emitContiguous() {

    const batch: Message[] = [];
    let next = cursor + BigInt(1);
    while (buffer.has(next.toString())) {
      batch.push(buffer.get(next.toString())!);
      next += BigInt(1);
    }
    if (batch.length === 0) return;

    options.onMessages(batch.map((message) => ({ ...message })));
    for (const message of batch) buffer.delete(message.sequence);
    cursor = BigInt(batch[batch.length - 1].sequence);
    notify();
  }

  function synchronizeHistory(): Promise<void> {

    syncRequested = true;
    if (syncingTask || stopped || unauthorized || halted || !ready) return syncingTask ?? Promise.resolve();

    syncingTask = (async () => {
      syncing = true;
      historyHealthy = false;
      notify("syncing", null);
      while (syncRequested && !stopped && !unauthorized && !halted && ready) {
        syncRequested = false;
        let more = true;
        while (more && !stopped && !unauthorized && !halted && ready) {
          const after = cursor;
          const response = await api(`${path}?after=${after}&limit=100${generation ? `&generation=${encodeURIComponent(generation)}` : ""}`);
          if (stopped || unauthorized || halted) return;
          if (response.status === 404) return halt("unavailable", "This conversation is no longer available.");
          if ([409, 410].includes(response.status)) {
            const failure = messageHistoryErrorSchema.parse(await response.json());
            return halt("recovery-required", `${failure.error} Pending sends remain saved on this device.`);
          }
          if (!response.ok) throw new Error("Could not load message history.");
          const body = await response.json();
          if (generation && body.generation !== generation) return halt("recovery-required", "History changed. Reload history; pending sends remain saved.");
          generation ??= body.generation;
          const page = messageListResponseSchema.parse(body);
          if (stopped || unauthorized || halted) return;

          let expected = after + BigInt(1);
          for (const message of page.messages) {
            if (BigInt(message.sequence) !== expected) throw new Error("Message history contains a gap.");
            merge(message);
            expected += BigInt(1);
          }
          if (page.nextAfter !== null && (page.messages.length === 0 || page.nextAfter !== page.messages[page.messages.length - 1].sequence)) {
            throw new Error("Invalid history pagination.");
          }
          emitContiguous();
          if (page.messages.length === 0 && cursor < highest) throw new Error("Waiting for missing message history.");
          more = page.nextAfter !== null || cursor < highest;
        }
      }
      historyHealthy = ready;
      if (!pending.some((entry) => !entry.error)) retryDelay = 500;
      notify(ready ? "connected" : "reconnecting", null);
    })().catch(() => {
      if (!stopped && !unauthorized && !halted) {
        notify("error", "Could not synchronize messages. Retrying from the last complete sequence.");
        retryLater();
      }
    }).finally(() => {
      syncing = false;
      syncingTask = undefined;
      if (syncRequested && !retryTimer) void synchronizeHistory();
    });
    return syncingTask;
  }

  function flushPending(): Promise<void> {

    sendRequested = true;
    if (sendingTask || stopped || unauthorized || halted || !ready) return sendingTask ?? Promise.resolve();

    sendingTask = (async () => {
      while (sendRequested && !stopped && !unauthorized && !halted && ready) {
        sendRequested = false;
        pending = await loadPendingMessages(userId, conversationId);
        for (const entry of pending) {
          if (stopped || unauthorized || halted || !ready) return;
          if (entry.error) continue;
          if (generation && entry.generation !== generation) return halt("recovery-required", "Pending sends belong to an older or unknown history generation. Reload history and review them before resending.");
          const body = createMessageSchema.parse({ clientMessageId: entry.clientMessageId, encryptedPayload: entry.encryptedPayload });
          const response = await api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          if (stopped || unauthorized || halted) return;
          if (response.status === 409) {
            const failure = messageHistoryErrorSchema.safeParse(await response.clone().json());
            if (failure.success) return halt("recovery-required", "History changed. Reload history; pending sends remain saved.");
          }
          if (!response.ok) {
            if (response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status)) {
              await savePendingMessage({ ...entry, error: `Send rejected (${response.status}). Review this pending message before retrying.` });
              continue;
            }
            throw new Error("Could not send the message.");
          }
          const saved = messageResponseSchema.parse(await response.json()).message;
          if (stopped || unauthorized || halted) return;
          if (saved.senderId !== userId || saved.clientMessageId !== entry.clientMessageId || saved.encryptedPayload !== entry.encryptedPayload) {
            throw new Error("Unexpected send acknowledgement.");
          }
          merge(saved);
          if (!syncing) emitContiguous();
          await removePendingMessage(entry.queueId);
          if (!syncing && cursor < highest) void synchronizeHistory();
        }
      }
      pending = await loadPendingMessages(userId, conversationId);
      if (historyHealthy) retryDelay = 500;
      notify();
    })().catch(() => {
      if (!stopped && !unauthorized && !halted) {
        notify("error", "Connection interrupted. Pending sends remain saved on this device.");
        retryLater();
      }
    }).finally(() => {
      sendingTask = undefined;
      if (sendRequested && !retryTimer) void flushPending();
    });
    return sendingTask;
  }

  async function synchronize() {

    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    await synchronizeHistory();
    if (historyHealthy && options.resumePending !== false) await flushPending();
  }

  function onReady(value: { instanceId: string; userId: string; generation?: string }) {

    if (stopped || unauthorized || halted) return;
    if (!value || value.userId !== userId) return requireAuth();
    if (generation && value.generation !== generation) return halt("recovery-required", "History changed. Reload history; pending sends remain saved.");
    generation ??= value.generation;
    ready = true;
    void synchronize();
  }

  function onMessage(value: Message, eventGeneration?: string) {

    if (stopped || unauthorized || halted || !ready) return;
    if (generation && eventGeneration !== generation) return halt("recovery-required", "History changed. Reload history; pending sends remain saved.");
    const parsed = messageSchema.safeParse(value);
    if (!parsed.success || parsed.data.conversationId !== conversationId) return;
    try {
      merge(parsed.data);
      if (!syncing && historyHealthy) emitContiguous();
      if (!syncing && cursor < highest) void synchronizeHistory();
    } catch {
      notify("error", "Could not apply incoming messages. Retrying from the last complete sequence.");
      retryLater();
    }
  }

  function onDisconnect() {

    ready = false;
    historyHealthy = false;
    if (stopped || unauthorized || halted) return;
    notify("reconnecting");
    retryLater();
  }

  function onConnectError(value: Error & { data?: { code?: string } }) {

    if (value.data?.code === "UNAUTHENTICATED") requireAuth();
    else if (value.data?.code === "EMAIL_NOT_VERIFIED") requireAuth("Verify your email from your account, then reopen this conversation. Pending sends remain saved.");
    else onDisconnect();
  }

  function start() {

    if (stopped) return Promise.reject(new Error("Create a new client after stopping."));
    starting ??= (async () => {
      pending = await loadPendingMessages(userId, conversationId);
      if (stopped) return;
      socket.on("realtime:ready", onReady);
      socket.on("message:created", onMessage);
      socket.on("sync:required", synchronize);
      socket.on("auth:required", requireAuth);
      socket.on("disconnect", onDisconnect);
      socket.on("connect_error", onConnectError);
      notify("connecting", null);
      interval = setInterval(() => { void synchronize(); }, 15000 + Math.random() * 5000);
      socket.connect();
    })();
    return starting;
  }

  async function send(encryptedPayload: string) {

    if (!starting || stopped || unauthorized || halted) throw new Error("Start an authenticated client before sending.");
    await starting;
    if (stopped || unauthorized || halted) throw new Error("This conversation is no longer active.");
    if (!generation) throw new Error("Wait for history to synchronize before sending the first message.");
    const envelope = createMessageSchema.parse({ clientMessageId: crypto.randomUUID(), encryptedPayload });
    if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > 16384) {
      throw new RangeError("This message is too large to send. Shorten it and try again.");
    }
    const saved = await savePendingMessage({ ...envelope, userId, conversationId, error: null, generation });
    pending = [...pending.filter((entry) => entry.queueId !== saved.queueId), saved];
    notify();
    void flushPending();
    return envelope.clientMessageId;
  }

  async function retry(clientMessageId: string) {

    if (!starting || stopped || unauthorized || halted) throw new Error("Start an authenticated client before retrying.");
    await starting;
    const rows = await loadPendingMessages(userId, conversationId);
    const entry = rows.find((row) => row.clientMessageId === clientMessageId);
    if (!entry) throw new Error("Pending message not found.");
    await savePendingMessage({ ...entry, error: null });
    await flushPending();
  }

  async function stop() {

    stopped = true;
    ready = false;
    controller.abort();
    if (interval) clearInterval(interval);
    if (retryTimer) clearTimeout(retryTimer);
    socket.off("realtime:ready", onReady);
    socket.off("message:created", onMessage);
    socket.off("sync:required", synchronize);
    socket.off("auth:required", requireAuth);
    socket.off("disconnect", onDisconnect);
    socket.off("connect_error", onConnectError);
    socket.disconnect();
    await Promise.allSettled([starting, syncingTask, sendingTask]);
    buffer.clear();
    status = "stopped";
  }

  return { start, stop, send, retry, synchronize, getState };
}
