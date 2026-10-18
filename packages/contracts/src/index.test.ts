import assert from "node:assert/strict";
import { test } from "node:test";
import { healthResponseSchema } from "./index.js";

test("health responses require a known status and an instance identity", () => {
  assert.equal(healthResponseSchema.safeParse({ status: "ok", instanceId: "server-1" }).success, true);
  assert.equal(healthResponseSchema.safeParse({ status: "ready", instanceId: "server-1" }).success, false);
  assert.equal(healthResponseSchema.safeParse({ status: "ok", instanceId: "" }).success, false);
});
