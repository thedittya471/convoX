import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { loadHistory, mergeHistory, HistoryError } from "../src/lib/message-history.ts";
const conversationId = randomUUID();
const generation = randomUUID();
const message = (sequence) => ({ id: randomUUID(), conversationId, senderId: "user", clientMessageId: randomUUID(), sequence: String(sequence), encryptedPayload: `<script>${sequence}</script>`, createdAt: "2026-01-01T00:00:00.123Z" });
test("history bootstrap validates its applied checkpoint and exclusive older boundary", async () => {
  const response = { messages: [message(3), message(4)], nextBefore: "3", nextAfter: null, headSequence: "4", generation };
  const request = async (url, init) => {
    assert.match(url, /recent=true/);
    assert.equal(init.credentials, "include");
    assert.equal(init.headers["X-Expected-User-Id"], "user");
    return Response.json(response);
  };
  assert.equal((await loadHistory("user", conversationId, new AbortController().signal, undefined, request)).headSequence, "4");
  const older = await loadHistory("user", conversationId, new AbortController().signal, { before: "3", generation }, async (url) => {
    assert.match(url, /before=3/);
    return Response.json({ ...response, messages: [message(1), message(2)], nextBefore: null });
  });
  assert.equal(older.messages[1].sequence, "2");
  for (const invalid of [{ ...response, headSequence: "5" }, { ...response, messages: [message(2), message(4)] }, { ...response, nextBefore: "2" }]) {
    await assert.rejects(loadHistory("user", conversationId, new AbortController().signal, undefined, async () => Response.json(invalid)));
  }
});
test("history errors and cancelled account/conversation requests never apply pages", async () => {
  for (const status of [401, 403, 404, 409, 410, 503]) {
    await assert.rejects(loadHistory("user", conversationId, new AbortController().signal, undefined, async () => new Response(null, { status })), (error) => error instanceof HistoryError && error.status === status);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadHistory("user", conversationId, controller.signal, undefined, async () => Response.json({ messages: [], nextBefore: null, nextAfter: null, headSequence: "0", generation })), { name: "AbortError" });
});
test("history windows deduplicate overlaps and stay bounded in both directions", () => {
  const rows = Array.from({ length: 250 }, (_, index) => message(index + 1));
  const recent = mergeHistory([], rows, "live");
  assert.equal(recent.length, 200);
  assert.equal(recent[0].sequence, "51");
  const older = mergeHistory(recent, rows.slice(0, 60), "older");
  assert.equal(older.length, 200);
  assert.deepEqual(older.map((row) => row.sequence), rows.slice(0, 200).map((row) => row.sequence));
});
