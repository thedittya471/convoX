import assert from "node:assert/strict";
import { test } from "node:test";
import { healthResponseSchema, usernameSchema, createConversationSchema, conversationListQuerySchema, conversationSchema, createMessageSchema, messageListQuerySchema, messageSchema, messageHistoryErrorSchema, messageHistoryPageSchema } from "./index.js";

test("health responses require a known status and an instance identity", () => {
  assert.equal(healthResponseSchema.safeParse({ status: "ok", instanceId: "server-1" }).success, true);
  assert.equal(healthResponseSchema.safeParse({ status: "ready", instanceId: "server-1" }).success, false);
  assert.equal(healthResponseSchema.safeParse({ status: "ok", instanceId: "" }).success, false);
});

test("conversation creation accepts only the other user's ID", () => {
  assert.equal(createConversationSchema.safeParse({ otherUserId: "user-2" }).success, true);
  for (const invalid of [{}, { otherUserId: "" }, { otherUserId: 12 }, { otherUserId: "user-2", userId: "user-1" }, { otherUserId: "user-2", type: "group" }]) {
    assert.equal(createConversationSchema.safeParse(invalid).success, false);
  }
});

test("conversation pagination validates bounded limits and exact cursors", () => {
  const cursor = "2026-01-01T00:00:00.123Z_00000000-0000-4000-8000-000000000001";
  assert.deepEqual(conversationListQuerySchema.parse({ limit: "2", cursor }), {
    limit: 2, cursor: ["2026-01-01T00:00:00.123Z", "00000000-0000-4000-8000-000000000001"],
  });
  assert.equal(conversationListQuerySchema.parse({}).limit, 20);
  for (const invalid of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: "invalid" }, { cursor: `${cursor}_extra` }, { userId: "someone-else" }, { limit: ["1", "2"] }]) {
    assert.equal(conversationListQuerySchema.safeParse(invalid).success, false);
  }
});

test("conversation responses describe only direct chats with a peer", () => {
  const conversation = {
    id: "00000000-0000-4000-8000-000000000001",
    type: "direct",
    createdAt: "2026-01-01T00:00:00.123Z",
    peer: { id: "user-2", name: "Bob", username: null },
  };
  assert.equal(conversationSchema.safeParse(conversation).success, true);
  assert.equal(conversationSchema.safeParse({ ...conversation, type: "group" }).success, false);
  assert.equal(conversationSchema.safeParse({ ...conversation, peer: null }).success, false);
});

test("usernames normalize case and reject invalid names", () => {
  assert.equal(usernameSchema.parse("Alice_123.Test"), "alice_123.test");
  for (const invalid of ["ab", "a".repeat(31), "hello world", " alice", "álîce", "alice@example.com"]) {
    assert.equal(usernameSchema.safeParse(invalid).success, false);
  }
});

test("message sends require a stable client ID and a bounded opaque payload", () => {
  const body = { clientMessageId: "00000000-0000-4000-8000-000000000001", encryptedPayload: "opaque-client-envelope" };
  assert.deepEqual(createMessageSchema.parse(body), body);
  for (const invalid of [{}, { ...body, clientMessageId: "invalid" }, { ...body, encryptedPayload: "" }, { ...body, encryptedPayload: "a".repeat(8193) }, { ...body, senderId: "other-user" }]) {
    assert.equal(createMessageSchema.safeParse(invalid).success, false);
  }
});

test("message cursors preserve bigint precision and reject ambiguous pagination", () => {
  assert.deepEqual(messageListQuerySchema.parse({}), { limit: 20, after: "0" });
  assert.equal(messageListQuerySchema.parse({ after: "9223372036854775807" }).after, "9223372036854775807");
  for (const invalid of [{ after: "9223372036854775808" }, { after: "01" }, { after: "-1" }, { after: "1.5" }, { after: ["1", "2"] }, { limit: 0 }, { limit: 101 }, { limit: ["1", "2"] }]) {
    assert.equal(messageListQuerySchema.safeParse(invalid).success, false);
  }
  assert.equal(messageSchema.safeParse({ id: "00000000-0000-4000-8000-000000000001", conversationId: "00000000-0000-4000-8000-000000000002", senderId: "user-1", clientMessageId: "00000000-0000-4000-8000-000000000003", sequence: "9007199254740993", encryptedPayload: "opaque", createdAt: "2026-01-01T00:00:00.123Z" }).success, true);
});


test("recent and older history modes have exclusive bounded cursors", () => {
  assert.deepEqual(messageListQuerySchema.parse({ recent: "true", limit: "2" }), { recent: "true", limit: 2 });
  assert.deepEqual(messageListQuerySchema.parse({ before: "9007199254740993" }), { before: "9007199254740993", limit: 20 });
  for (const value of [{ before: "0" }, { before: "2", after: "0" }, { recent: "true", after: "0" }, { recent: "true", before: "2" }, { recent: "false" }, { recent: ["true", "true"] }]) {
    assert.equal(messageListQuerySchema.safeParse(value).success, false);
  }
});


test("history pages and recovery errors carry explicit boundaries", () => {
  assert.equal(messageHistoryPageSchema.safeParse({ messages: [], nextAfter: null, nextBefore: null, headSequence: "0", generation: "00000000-0000-4000-8000-000000000001" }).success, true);
  for (const code of ["CURSOR_AHEAD", "HISTORY_UNAVAILABLE", "HISTORY_RESET"]) assert.equal(messageHistoryErrorSchema.safeParse({ code, error: "Rebuild history." }).success, true);
  assert.equal(messageHistoryErrorSchema.safeParse({ code: "UNKNOWN", error: "Retry" }).success, false);
});
