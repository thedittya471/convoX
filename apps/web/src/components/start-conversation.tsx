"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Conversation } from "@convox/contracts";
import { ConversationLookupError, openConversation } from "@/lib/open-conversation";

export function StartConversation({ userId, onOpen, onAuthRequired }: { userId: string; onOpen: (conversation: Conversation) => void; onAuthRequired: () => void }) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");

    try {
      const opened = await openConversation(username, userId, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));

      if (!controller.signal.aborted) onOpen(opened);
    } catch (failure) {
      if (!controller.signal.aborted && failure instanceof ConversationLookupError && [401, 403].includes(failure.status ?? 0)) onAuthRequired();

      if (!controller.signal.aborted) setError(failure instanceof ConversationLookupError ? failure.message : "Could not open the conversation. Check your connection and try again.");
    } finally {
      if (active.current === controller) setBusy(false);
    }
  }

  return (
    <section className="account-notice" aria-labelledby="find-heading">
      <h2 id="find-heading">Find someone</h2>
      <p>Enter another person’s exact username to create or reopen your conversation. You can search even if you haven’t chosen your own username.</p>
      <form onSubmit={submit} aria-busy={busy}>
        <div className="form-field">
          <label htmlFor="find-username">Their username</label>
          <input id="find-username" value={username} onChange={(event) => {
            active.current?.abort();
            active.current = null;
            setBusy(false);
            setError("");
            setUsername(event.target.value);
          }} autoCapitalize="none" autoComplete="off" spellCheck={false} minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" required />
        </div>
        <button className="primary-button" disabled={busy} type="submit">{busy ? "Finding and opening…" : "Open conversation"}</button>
      </form>
      {error && <><p ref={feedback} tabIndex={-1} className="form-error" role="alert">{error}</p><p><a href="/login">Sign in again</a> if your session expired, or refresh your account to check verification.</p></>}
    </section>
  );
}
