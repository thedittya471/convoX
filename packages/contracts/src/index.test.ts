import assert from "node:assert/strict";
import { test } from "node:test";
import { healthResponseSchema, usernameSchema } from "./index.js";

test("health responses require a known status and an instance identity", () => {
  assert.equal(healthResponseSchema.safeParse({ status: "ok", instanceId: "server-1" }).success, true);
  assert.equal(healthResponseSchema.safeParse({ status: "ready", instanceId: "server-1" }).success, false);
  assert.equal(healthResponseSchema.safeParse({ status: "ok", instanceId: "" }).success, false);
});

test("usernames normalize case and reject invalid names", () => {
  assert.equal(usernameSchema.parse("Alice_123.Test"), "alice_123.test");
  for (const invalid of ["ab", "a".repeat(31), "hello world", " alice", "álîce", "alice@example.com"]) {
    assert.equal(usernameSchema.safeParse(invalid).success, false);
  }
});
