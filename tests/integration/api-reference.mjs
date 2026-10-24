import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { verifyFixture } from "./verify-email.mjs";
import { createMessageSchema, messageResponseSchema, messageHistoryPageSchema, conversationResponseSchema, conversationListResponseSchema, userLookupResponseSchema } from "../../packages/contracts/dist/index.js";
import { pool } from "../../apps/server/dist/db/client.js";

const spec = JSON.parse(await readFile(new URL("../../docs/openapi.json", import.meta.url)));
const messagePath = spec.paths["/api/conversations/{id}/messages"];
const input = messagePath.post.requestBody.content["application/json"].example;
createMessageSchema.parse(input);
messageResponseSchema.parse(messagePath.post.responses["201"].content["application/json"].example);
messageHistoryPageSchema.parse(messagePath.get.responses["200"].content["application/json"].example);
const actors = [];
const origin = process.env.BETTER_AUTH_URL;
const request = (path, actor, body, generation) => fetch(`http://server-1:4000${path}`, {
  method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json", "x-real-ip": `198.27.${randomBytes(1)[0]}.${randomBytes(1)[0]}`, ...(actor ? { cookie: actor.cookie, "X-Expected-User-Id": actor.id } : {}), ...(generation ? { "X-History-Generation": generation } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
});
try {
  for (let i = 0; i < 2; i++) {
    const username = `reference_${randomUUID().slice(0, 8)}`;
    const email = `${username}@example.com`;
    const r = await request("/api/auth/sign-up/email", null, { email, username, name: "API reference fixture", password: randomBytes(20).toString("hex") });
    assert.equal(r.status, 200);
    actors.push({ ...(await r.json()).user, cookie: r.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ") });
    assert.match(actors.at(-1).cookie, /better-auth.session_token=/);
    await verifyFixture(email);
  }
  const [alice, bob] = actors;
  const lookup = await request(`/api/users/lookup?username=${bob.username}`, alice);
  assert.equal(lookup.status, 200);
  assert.equal(userLookupResponseSchema.parse(await lookup.json()).user.id, bob.id);
  const opened = await request("/api/conversations", alice, { otherUserId: bob.id });
  assert.equal(opened.status, 201);
  const id = conversationResponseSchema.parse(await opened.json()).conversation.id;
  const path = `/api/conversations/${id}/messages`;
  const bootstrap = await request(`${path}?recent=true`, alice);
  const generation = messageHistoryPageSchema.parse(await bootstrap.json()).generation;
  const first = await request(path, alice, input, generation);
  assert.equal(first.status, 201);
  const canonical = messageResponseSchema.parse(await first.json());
  const retry = await request(path, alice, input, generation);
  assert.equal(retry.status, 200);
  assert.deepEqual(messageResponseSchema.parse(await retry.json()), canonical);
  const history = await request(`${path}?after=0&limit=20&generation=${generation}`, bob);
  assert.equal(history.status, 200);
  assert.equal(messageHistoryPageSchema.parse(await history.json()).messages[0].id, canonical.message.id);
  const list = await request("/api/conversations?limit=20", alice);
  assert.equal(list.status, 200);
  assert.equal(conversationListResponseSchema.parse(await list.json()).conversations[0].id, id);
  assert.equal((await request(`${path}?after=2&generation=${generation}`, alice)).status, 409);
  assert.equal((await request(`${path}?limit=101`, alice)).status, 400);
  assert.equal((await request(`${path}?after=1&generation=${randomUUID()}`, alice)).status, 409);
  assert.equal((await request(path)).status, 401);
  console.log("API reference examples passed: canonical contracts, cookie auth, discovery, conversation, bootstrap, send/retry, history/list and documented errors");
} finally {
  const ids = actors.map((a) => a.id);
  await pool.query("DELETE FROM message WHERE sender_id=ANY($1::text[])", [ids]);
  await pool.query("DELETE FROM conversation WHERE direct_user_low_id=ANY($1::text[]) OR direct_user_high_id=ANY($1::text[])", [ids]);
  await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [ids]);
  await pool.end();
}
