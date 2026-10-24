"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Message } from "@convox/contracts";
import { createChatClient, type ChatState } from "@/lib/chat-client";
import { HistoryError, loadHistory, mergeHistory } from "@/lib/message-history";

export function Chat({ userId, conversationId, peerName, onAuthRequired }: {
  userId: string; conversationId: string; peerName: string; onAuthRequired: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const before = messages.length && BigInt(messages[0].sequence) > BigInt(1) ? messages[0].sequence : null;
  const [generation, setGeneration] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Loading history…");
  const [reset, setReset] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [newMessages, setNewMessages] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const browsingOlder = useRef(false);
  const active = useRef<AbortController | null>(null);
  const client = useRef<ReturnType<typeof createChatClient> | null>(null);

  function handleFailure(failure: unknown) {
    if (failure instanceof HistoryError && [401, 403].includes(failure.status)) return onAuthRequired();
    if (failure instanceof HistoryError && [404, 409, 410].includes(failure.status)) {
      void client.current?.stop();
      active.current?.abort();
      setMessages([]);
      setReset(failure.status !== 404);
      setUnavailable(failure.status === 404);
      setLoading(false);
    }
    setError(failure instanceof HistoryError ? failure.message : "Could not load messages. Please try again.");
  }

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    let current: ReturnType<typeof createChatClient> | null = null;
    void loadHistory(userId, conversationId, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])).then(async (page) => {
      if (controller.signal.aborted) return;
      setMessages(page.messages);
      setGeneration(page.generation);
      setLoading(false);
      current = createChatClient({ userId, conversationId, after: page.headSequence, generation: page.generation,
        // History viewing must not resend a pre-restore queue without explicit reconciliation.
        resumePending: false,
        onMessages: (batch) => {
          if (controller.signal.aborted) return;
          if (browsingOlder.current) setNewMessages(true);
          else setMessages((rows) => mergeHistory(rows, batch, "live"));
        },
        onChange: (state: ChatState) => {
          if (controller.signal.aborted) return;
          if (state.status === "unauthenticated") return onAuthRequired();
          if (["recovery-required", "unavailable"].includes(state.status)) {
            setLoading(false);
            setMessages([]);
            setReset(state.status === "recovery-required");
            setUnavailable(state.status === "unavailable");
            controller.abort();
            void current?.stop();
          }
          setStatus(state.status === "connected" ? "History is up to date." : state.status === "recovery-required" ? "History must be reloaded." : "Synchronizing history…");
          setError(state.error ?? "");
        },
      });
      client.current = current;
      try { await current.start(); }
      catch {
        if (controller.signal.aborted) return;
        setStatus("Live updates are unavailable.");
        setError("Local message storage is unavailable. Loaded history is shown; enable storage and reload to resume live updates. Saved pending sends have not been deleted.");
      }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) {
        if (failure instanceof HistoryError && [401, 403].includes(failure.status)) onAuthRequired();
        else {
          setError(failure instanceof Error ? failure.message : "Could not load messages.");
          setReset(true);
          setUnavailable(failure instanceof HistoryError && failure.status === 404);
        }
        setLoading(false);
      }
    });
    return () => { controller.abort(); void current?.stop(); };
  }, [userId, conversationId, attempt, onAuthRequired]);

  useLayoutEffect(() => {
    if (!anchor.current || !viewport.current) return;
    const row = viewport.current.querySelector<HTMLElement>(`[data-message-id="${anchor.current.id}"]`);
    if (row) viewport.current.scrollTop += row.getBoundingClientRect().top - anchor.current.top;
    anchor.current = null;
  }, [messages]);

  function reload() {
    active.current?.abort();
    void client.current?.stop();
    browsingOlder.current = false;
    anchor.current = null;
    setMessages([]); setError(""); setReset(false); setNewMessages(false); setLoading(true);
    setAttempt((value) => value + 1);
  }

  async function loadOlder() {
    if (!before || loading || !active.current) return;
    const controller = active.current;
    const visible = [...(viewport.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [])]
      .find((row) => row.getBoundingClientRect().bottom > (viewport.current?.getBoundingClientRect().top ?? 0));
    if (visible) anchor.current = { id: visible.dataset.messageId!, top: visible.getBoundingClientRect().top };
    browsingOlder.current = true;
    setLoading(true); setError("");
    try {
      const page = await loadHistory(userId, conversationId, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), { before, generation });
      if (controller.signal.aborted) return;
      browsingOlder.current = true;
      setMessages((rows) => mergeHistory(rows, page.messages, "older"));
    } catch (failure) {
      anchor.current = null;
      if (!controller.signal.aborted) handleFailure(failure);
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }

  return <section aria-label={`Messages with ${peerName}`}>
    <p role="status">{loading ? "Loading messages…" : status}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!unavailable && <button type="button" className="primary-button" disabled={loading} onClick={reload}>{reset ? "Reload history" : newMessages ? "View new messages" : "Return to recent messages"}</button>}
    {!reset && !unavailable && <>
      <div className="message-history" ref={viewport} tabIndex={0} role="region" aria-label="Message history">
        {before && <button type="button" className="primary-button" disabled={loading} onClick={() => void loadOlder()}>Load older messages</button>}
        <ol>{messages.map((message) => <li key={message.id} data-message-id={message.id}>
          <p className="message-sender">{message.senderId === userId ? "You" : peerName} · <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time></p>
          <p className="message-content">{message.encryptedPayload}</p>
        </li>)}</ol>
        {!loading && messages.length === 0 && <p>No messages yet.</p>}
      </div>
      <p>Up to 200 messages are shown at a time.</p>
    </>}
  </section>;
}
