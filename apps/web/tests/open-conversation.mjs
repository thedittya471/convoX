import assert from "node:assert/strict";
import { test } from "node:test";
import { openConversation } from "../src/lib/open-conversation.ts";

const peer = { id: "peer", username: "alice", name: "Alice" };
const conversation = { id: "00000000-0000-4000-8000-000000000001", type: "direct", createdAt: "2026-01-01T00:00:00.123Z", peer };

test("exact lookup normalizes names and opens by stable user ID", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push([url, options]);
    return Response.json(url.startsWith("/api/users") ? { user: peer } : { conversation });
  };
  assert.deepEqual(await openConversation("ALICE", "me", new AbortController().signal, request), conversation);
  assert.equal(calls[0][0], "/api/users/lookup?username=alice");
  assert.deepEqual(JSON.parse(calls[1][1].body), { otherUserId: "peer" });
  assert.ok(calls.every(([, options]) => options.credentials === "include" && options.cache === "no-store"));
});

test("invalid, missing, expired and self lookups cannot create conversations", async () => {
  await assert.rejects(openConversation("bad name", "me", new AbortController().signal, () => assert.fail("invalid names must not request")), /exact username/);
  for (const status of [401, 403, 404, 503]) {
    let calls = 0;
    await assert.rejects(openConversation("alice", "me", new AbortController().signal, async () => { calls++; return new Response(null, { status }); }));
    assert.equal(calls, 1);
  }
  await assert.rejects(openConversation("alice", "peer", new AbortController().signal, async () => Response.json({ user: peer })), /yourself/);
});

test("cancelled lookup cannot open a stale result even if its response arrives late", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(openConversation("alice", "me", controller.signal, async () => {
    calls++;
    controller.abort();
    return Response.json({ user: peer });
  }));
  assert.equal(calls, 1);
});
