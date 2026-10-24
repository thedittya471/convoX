import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatStatus, connectionAnnouncement } from "../src/components/chat-status.tsx";

test("connection states render distinct text with a polite atomic announcement", () => {
  const states = ["connecting", "syncing", "connected", "reconnecting", "unavailable", "unauthenticated", "recovery-required"];
  const rendered = states.map((status) => renderToStaticMarkup(createElement(ChatStatus, { status })));
  assert.equal(new Set(rendered).size, states.length);
  for (const html of rendered) {
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /aria-atomic="true"/);
    assert.doesNotMatch(html, /role="alert"/);
  }
  assert.match(rendered[5], /Sign-in or email verification required/);
  assert.doesNotMatch(rendered[2], /delivered|read by/i);
});

test("repeated recovery phases share an announcement instead of announcing every transition", () => {
  assert.equal(connectionAnnouncement("connecting"), connectionAnnouncement("syncing"));
  assert.equal(connectionAnnouncement("reconnecting"), connectionAnnouncement("error"));
  assert.notEqual(connectionAnnouncement("connected"), connectionAnnouncement("reconnecting"));
});
