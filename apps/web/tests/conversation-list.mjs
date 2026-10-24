import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConversations, mergeConversations } from "../src/lib/conversation-list.ts";

const first = { id: "00000000-0000-4000-8000-000000000002", type: "direct", createdAt: "2026-01-01T00:00:00.123Z", peer: { id: "peer", username: null, name: "Peer" } };
const second = { ...first, id: "00000000-0000-4000-8000-000000000001" };
const cursor = `${first.createdAt}_${first.id}`;

test("conversation pages are bounded, authenticated and use the exact cursor", async () => {
  const page = await loadConversations("me", cursor, new AbortController().signal, async (url, options) => {
    const query = new URL(url, "http://localhost").searchParams;
    assert.equal(query.get("limit"), "20");
    assert.equal(query.get("cursor"), cursor);
    assert.equal(options.headers["X-Expected-User-Id"], "me");
    assert.equal(options.credentials, "include");
    assert.equal(options.cache, "no-store");
    return Response.json({ conversations: [second], nextCursor: null });
  });
  assert.deepEqual(page.conversations, [second]);
});

test("overlapping pages and reopened pairs deduplicate with timestamp/ID ordering", () => {
  const updated = { ...first, peer: { ...first.peer, name: "Updated" } };
  assert.deepEqual(mergeConversations([second, first], [updated]), [updated, second]);
});

test("auth failures, cancelled pages and non-advancing cursors cannot apply a list", async () => {
  for (const status of [401, 403]) {
    await assert.rejects(loadConversations("me", null, new AbortController().signal, async () => new Response(null, { status })), (error) => error.status === status);
  }
  await assert.rejects(loadConversations("me", cursor, new AbortController().signal, async () => Response.json({ conversations: [], nextCursor: cursor })));
  const controller = new AbortController();
  await assert.rejects(loadConversations("me", null, controller.signal, async () => {
    controller.abort();
    return Response.json({ conversations: [first], nextCursor: null });
  }));
});
