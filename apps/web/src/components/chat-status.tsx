"use client";

import { useEffect, useState } from "react";
import type { ChatState } from "../lib/chat-client";

type Status = ChatState["status"] | "loading";
export const connectionLabels: Record<Status, string> = {
  loading: "Loading messages…",
  connecting: "Connecting to chat…",
  syncing: "Synchronizing messages…",
  connected: "Connected. History is up to date.",
  reconnecting: "Connection interrupted. Reconnecting automatically…",
  error: "Connection or synchronization interrupted. Retrying automatically…",
  unauthenticated: "Sign-in or email verification required. Pending messages remain saved.",
  unavailable: "Chat is unavailable.",
  "recovery-required": "History must be reloaded. Pending messages remain saved.",
  stopped: "Chat connection stopped.",
};

export function connectionAnnouncement(status: Status) {
  if (["connecting", "syncing"].includes(status)) return "Connecting and synchronizing messages.";
  if (["error", "reconnecting"].includes(status)) return "Connection interrupted. Recovering automatically; pending messages remain saved.";
  return connectionLabels[status];
}

export function ChatStatus({ status }: { status: Status }) {
  const nextAnnouncement = connectionAnnouncement(status);
  const [announcement, setAnnouncement] = useState(nextAnnouncement);
  useEffect(() => {
    const timer = setTimeout(() => setAnnouncement(nextAnnouncement), 1500);
    return () => clearTimeout(timer);
  }, [nextAnnouncement]);
  return <>
    <p>{connectionLabels[status]}</p>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
  </>;
}
