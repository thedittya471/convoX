"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getGlobalBroadcastChannel } from "better-auth/client";
import type { Conversation } from "@convox/contracts";
import { Chat } from "./chat";
import { StartConversation } from "./start-conversation";
import { loadConversations, mergeConversations } from "@/lib/conversation-list";
import { ConversationLookupError } from "@/lib/open-conversation";

export function Conversations({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const active = useRef<AbortController | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);

  const leaveChat = useCallback(() => {
    active.current?.abort();
    setRows([]);
    setSelected(null);
    setLoading(false);
    setBlocked(true);
  }, []);

  useEffect(() => getGlobalBroadcastChannel().subscribe((message) => {
    if (message.data?.trigger === "signout" || message.data?.trigger === "getSession") leaveChat();
  }), [leaveChat]);

  const requestPage = useCallback((after: string | null, controller: AbortController) => {
    return loadConversations(userId, after, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])).then((page) => {
      if (controller.signal.aborted) return;
      setRows((current) => mergeConversations(current, page.conversations));
      setCursor(page.nextCursor);
      setLoaded(true);
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      if (failure instanceof ConversationLookupError && [401, 403].includes(failure.status ?? 0)) leaveChat();
      else setError("Could not load conversations. Your selection is preserved. Please try again.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
  }, [leaveChat, userId]);

  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    void requestPage(null, controller);
    return () => controller.abort();
  }, [requestPage]);
  useEffect(() => {
    if (selected) detailHeading.current?.focus();
  }, [selected]);
  useEffect(() => () => active.current?.abort(), []);

  function loadMore() {
    if (loading) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError("");
    void requestPage(cursor, controller);
  }

  if (blocked) return <p role="alert">Sign-in or email verification is required. Pending messages remain saved for the original account. <button className="primary-button" type="button" onClick={() => window.location.reload()}>Refresh your account</button> to sign in or verify your email.</p>;

  return (
    <section aria-label="Your conversations">
      <StartConversation userId={userId} onAuthRequired={leaveChat} onOpen={(conversation) => {
        setRows((current) => mergeConversations(current, [conversation]));
        setSelected(conversation);
      }} />
      <div className="conversation-browser">
        <section aria-labelledby="conversations-heading">
          <h2 id="conversations-heading" ref={listHeading} tabIndex={-1}>Conversations</h2>
          {loaded && rows.length === 0 && <p>No conversations yet. Find someone above to start one.</p>}
          <ul className="conversation-list">
            {rows.map((conversation) => <li key={conversation.id}><button type="button" aria-pressed={selected?.id === conversation.id} onClick={() => setSelected(conversation)}>{conversation.peer.name}{conversation.peer.username ? ` (@${conversation.peer.username})` : " (no username)"}</button></li>)}
          </ul>
          {loading && <p role="status">Loading conversations…</p>}
          {error && <p role="alert" className="form-error">{error}</p>}
          {!loading && (error || cursor) && <button className="primary-button" type="button" onClick={loadMore}>{error ? "Retry loading" : "Load more"}</button>}
        </section>
        <section aria-labelledby="conversation-heading">
          <h2 id="conversation-heading" ref={detailHeading} tabIndex={-1}>{selected ? selected.peer.name : "Choose a conversation"}</h2>
          {selected ? <>
            <p>{selected.peer.username ? `@${selected.peer.username}` : "This participant has not chosen a username."}</p>
            <Chat key={`${userId}:${selected.id}`} userId={userId} conversationId={selected.id} peerName={selected.peer.name} onAuthRequired={leaveChat} />
            <button className="primary-button" type="button" onClick={() => { setSelected(null); listHeading.current?.focus(); }}>Back to conversations</button>
          </> : <p>Select a participant from the list or find someone above.</p>}
        </section>
      </div>
    </section>
  );
}
