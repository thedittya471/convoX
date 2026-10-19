import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mock } from "node:test";
import { conversationListResponseSchema, conversationResponseSchema } from "../../packages/contracts/dist/index.js";
import { db, pool } from "../../apps/server/dist/db/client.js";
import { conversation, conversationMember } from "../../apps/server/dist/db/schema/conversation.schema.js";
import { createDirectConversation } from "../../apps/server/dist/services/conversations.service.js";

const servers = ["http://server-1:4000", "http://server-2:4000", "http://server-3:4000"];
const origin = new URL(process.env.BETTER_AUTH_URL).origin;
const suffix = randomUUID();
const emails = Array.from({ length: 5 }, (_value, index) => `conversation-test-${suffix}-${index}@example.com`);
const actors = [];
const groupId = randomUUID();
const password = randomBytes(24).toString("base64url");

async function request(path, { actor, body, server = servers[0], requestOrigin = origin } = {}) {
  return fetch(`${server}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(requestOrigin ? { origin: requestOrigin } : {}),
      ...(actor ? { cookie: actor.cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
}

async function readConversation(response) {
  assert.ok([200, 201].includes(response.status), `create/open status: ${response.status}`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  conversationResponseSchema.parse(body);
  assert.deepEqual(Object.keys(body.conversation).sort(), ["createdAt", "id", "peer", "type"]);
  assert.deepEqual(Object.keys(body.conversation.peer).sort(), ["id", "name", "username"]);
  return body.conversation;
}

async function readList(actor, query = "", server = servers[0]) {
  const response = await request(`/api/conversations${query}`, { actor, server });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  conversationListResponseSchema.parse(body);
  for (const item of body.conversations) {
    assert.deepEqual(Object.keys(item).sort(), ["createdAt", "id", "peer", "type"]);
    assert.equal(item.type, "direct");
    assert.deepEqual(Object.keys(item.peer).sort(), ["id", "name", "username"]);
  }
  return body;
}

try {
  for (const [index, email] of emails.entries()) {
    const response = await fetch(`${servers[index % servers.length]}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-real-ip": `198.23.${randomBytes(1)[0]}.${randomBytes(1)[0]}` },
      body: JSON.stringify({ name: `Conversation fixture ${index}`, email, password,
        ...(index === 1 ? { username: `conv_${suffix.replaceAll("-", "").slice(0, 12)}` } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    const identity = await response.json();
    actors.push({ ...identity.user, cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
  }
  const [first, second, third, fourth, outsider] = actors;
  assert.equal((await request("/api/conversations")).status, 401);
  assert.equal((await request("/api/conversations", { body: { otherUserId: second.id } })).status, 401);
  for (const requestOrigin of [null, "https://untrusted.example"]) {
    assert.equal((await request("/api/conversations", { actor: first, body: { otherUserId: second.id }, requestOrigin })).status, 403);
  }
  for (const body of [{}, { otherUserId: "" }, { otherUserId: 12 }, { otherUserId: first.id }, { otherUserId: second.id, userId: third.id }, { otherUserId: second.id, type: "group" }]) {
    assert.equal((await request("/api/conversations", { actor: first, body })).status, 400);
  }
  assert.equal((await request("/api/conversations", { actor: first, body: { otherUserId: `missing-${suffix}` } })).status, 404);

  const simultaneous = await Promise.all(Array.from({ length: 12 }, (_value, index) => {
    const actor = index % 2 ? first : second;
    const target = index % 2 ? second : first;
    return request("/api/conversations", { actor, body: { otherUserId: target.id }, server: servers[index % servers.length] });
  }));
  assert.equal(simultaneous.filter((response) => response.status === 201).length, 1, "only one create may win across instances and reversed pairs");
  assert.equal(simultaneous.filter((response) => response.status === 200).length, 11);
  const simultaneousBodies = await Promise.all(simultaneous.map(readConversation));
  const directId = simultaneousBodies[0].id;
  assert.ok(simultaneousBodies.every((item) => item.id === directId));
  simultaneousBodies.forEach((item, index) => assert.equal(item.peer.id, index % 2 ? second.id : first.id));
  const members = await pool.query("SELECT user_id FROM conversation_member WHERE conversation_id = $1", [directId]);
  assert.deepEqual(members.rows.map((member) => member.user_id).sort(), [first.id, second.id].sort());
  await assert.rejects(() => pool.query("INSERT INTO conversation_member (conversation_id, user_id) VALUES ($1, $2)", [directId, first.id]),
    (error) => error.code === "23505", "memberships must be unique");
  await assert.rejects(() => pool.query("INSERT INTO conversation (id, type, direct_user_low_id, direct_user_high_id) VALUES ($1, 'direct', $2, $2)", [randomUUID(), first.id]),
    (error) => error.code === "23514", "a direct conversation cannot have the same user twice");
  await assert.rejects(() => pool.query('DELETE FROM "user" WHERE id = $1', [first.id]),
    (error) => error.code === "23503", "user deletion must not silently erase conversations");
  const repeated = await request("/api/conversations", { actor: first, body: { otherUserId: second.id } });
  assert.equal(repeated.status, 200);
  assert.equal((await readConversation(repeated)).id, directId);
  assert.equal((await request("/api/conversations", { actor: first, body: { otherUserId: second.id, members: [third.id] } })).status, 400);
  assert.equal((await request(`/api/conversations/${directId}/members`, { actor: first, body: { userId: third.id } })).status, 404, "direct chats must not expose a member-add endpoint");

  const originalTransaction = db.transaction.bind(db);
  let membershipAttempted = false;
  const transactionMock = mock.method(db, "transaction", (callback) => originalTransaction(async (transaction) => {
    const originalInsert = transaction.insert.bind(transaction);
    transaction.insert = (table) => {
      if (table === conversationMember) {
        membershipAttempted = true;
        throw new Error("forced membership failure");
      }
      return originalInsert(table);
    };
    return callback(transaction);
  }));
  try {
    await assert.rejects(() => createDirectConversation(first.id, outsider.id), /forced membership failure/);
  } finally {
    transactionMock.mock.restore();
  }
  assert.equal(membershipAttempted, true);
  const rolledBack = await pool.query('SELECT id FROM conversation WHERE direct_user_low_id = ANY($1::text[]) AND direct_user_high_id = ANY($1::text[])', [[first.id, outsider.id]]);
  assert.equal(rolledBack.rowCount, 0, "failed membership creation must roll back the conversation");
  assert.deepEqual((await readList(outsider)).conversations, []);
  assert.equal((await request(`/api/conversations?userId=${first.id}`, { actor: outsider })).status, 400, "the caller cannot select another user's list");

  const directIds = [directId];
  for (const target of [third, fourth]) {
    const response = await request("/api/conversations", { actor: first, body: { otherUserId: target.id } });
    assert.equal(response.status, 201);
    directIds.push((await readConversation(response)).id);
  }
  await pool.query("UPDATE conversation SET created_at = $1 WHERE id = ANY($2::uuid[])", ["2026-01-01T00:00:00.123Z", directIds]);
  await db.transaction(async (transaction) => {
    await transaction.insert(conversation).values({ id: groupId, type: "group" });
    await transaction.insert(conversationMember).values([second, third, fourth].map((actor) => ({ conversationId: groupId, userId: actor.id })));
  });
  const secondList = await readList(second, "", servers[1]);
  assert.deepEqual(secondList.conversations.map((item) => item.id), [directId], "the direct-chat API must exclude groups even for their members");
  assert.equal(secondList.conversations.find((item) => item.id === directId).peer.id, first.id);

  const firstPage = await readList(first, "?limit=1");
  assert.equal(firstPage.conversations.length, 1);
  assert.ok(firstPage.nextCursor);
  const later = await request("/api/conversations", { actor: first, body: { otherUserId: outsider.id } });
  assert.equal(later.status, 201, "the failed transaction must not leave an existing conversation");
  const laterId = (await readConversation(later)).id;
  const paginatedIds = firstPage.conversations.map((item) => item.id);
  let cursor = firstPage.nextCursor;
  while (cursor) {
    const page = await readList(first, `?limit=1&cursor=${encodeURIComponent(cursor)}`, servers[paginatedIds.length % servers.length]);
    paginatedIds.push(...page.conversations.map((item) => item.id));
    cursor = page.nextCursor;
    assert.ok(paginatedIds.length <= directIds.length, "pagination must terminate without duplicates");
  }
  assert.deepEqual(paginatedIds, [...directIds].sort().reverse(), "tied timestamps must paginate by ID without gaps; newer inserts stay before the cursor");
  const firstList = await readList(first, "", "http://nginx");
  assert.equal(firstList.conversations.length, 4);
  assert.equal(firstList.conversations[0].id, laterId);
  assert.equal(firstList.conversations.some((item) => item.id === groupId), false, "non-members cannot see the group");
  assert.equal(firstList.conversations.find((item) => item.id === directId).peer.username, second.username);
  const foreignCursor = { createdAt: new Date().toISOString(), id: groupId };
  const filtered = await readList(first, `?cursor=${encodeURIComponent(`${foreignCursor.createdAt}_${foreignCursor.id}`)}`);
  assert.ok(filtered.conversations.every((item) => [...directIds, laterId].includes(item.id)), "a cursor is not an authorization grant");
  for (const query of ["?limit=0", "?limit=101", "?limit=1.5", "?cursor=invalid", "?limit=1&limit=2", "?cursor=2026-99-99T00:00:00.000Z_invalid"]) {
    assert.equal((await request(`/api/conversations${query}`, { actor: first })).status, 400);
  }

  for (let attempt = 0; attempt < 61; attempt += 1) {
    const server = servers[attempt % servers.length];
    assert.equal((await request("/api/conversations", { actor: first, body: { otherUserId: second.id }, server })).status, 200, "opening a conversation must not apply a custom rate limit");
    await readList(second, "", server);
  }

  const logout = await request("/api/auth/sign-out", { actor: outsider, body: {} });
  assert.equal(logout.status, 200);
  assert.equal((await request("/api/conversations", { actor: outsider, server: servers[2] })).status, 401);
  assert.equal((await request("/api/conversations", { actor: outsider, body: { otherUserId: first.id } })).status, 401);
  await pool.query('UPDATE "session" SET expires_at = NOW() - INTERVAL \'1 minute\' WHERE user_id = $1', [fourth.id]);
  assert.equal((await request("/api/conversations", { actor: fourth })).status, 401);
  console.log("Conversation integration passed: auth/origins, atomic create/open, cross-instance duplicate prevention, rollback, group-capable memberships, private cursor pagination, and unrestricted authenticated requests.");
} finally {
  mock.restoreAll();
  const fixtureIds = actors.map((actor) => actor.id);
  await pool.query("DELETE FROM conversation WHERE id = $1 OR direct_user_low_id = ANY($2::text[]) OR direct_user_high_id = ANY($2::text[])", [groupId, fixtureIds]);
  await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [emails]);
  await pool.end();
}
