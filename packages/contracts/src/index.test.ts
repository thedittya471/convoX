import assert from "node:assert/strict";
import { test } from "node:test";
import { healthResponseSchema, usernameSchema, createConversationSchema, conversationListQuerySchema, conversationSchema } from "./index.js";

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
