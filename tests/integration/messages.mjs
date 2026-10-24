import { verifyFixture } from "./verify-email.mjs";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execute = promisify(execFile);

if (!process.argv.includes("--run")) {
  const child = spawn("docker", ["compose", "exec", "-T", "server-2", "node", "tests/integration/messages.mjs", "--run"], { stdio: ["pipe", "pipe", "inherit"] });
  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Message integration exited with ${code}`)));
  });
  try {
    const output = (async () => {
      for await (const line of createInterface({ input: child.stdout })) {
        if (line === "MESSAGE_RESTART_READY") {
          await execute("docker", ["compose", "kill", "-s", "SIGKILL", "server-1"], { timeout: 20000 });
          await execute("docker", ["compose", "--profile", "stack", "up", "-d", "--wait", "--wait-timeout", "30", "server-1"], { timeout: 40000 });
          child.stdin.end("restarted\n");
        } else {
          console.log(line);
        }
      }
    })();
    await Promise.all([completion, output]);
  } finally {
    child.stdin.end();
    await execute("docker", ["compose", "--profile", "stack", "up", "-d", "--wait", "--wait-timeout", "30", "server-1"], { timeout: 40000 });
  }
} else {
  await run();
}

async function run() {
  const { messageResponseSchema, messageHistoryPageSchema, messageHistoryErrorSchema } = await import("../../packages/contracts/dist/index.js");
  const { pool } = await import("../../apps/server/dist/db/client.js");
  const servers = ["http://server-1:4000", "http://server-2:4000", "http://server-3:4000"];
  const origin = new URL(process.env.BETTER_AUTH_URL).origin;
  const suffix = randomUUID();
  const fixtureIp = `198.29.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const actors = [];
  const originalGeneration = (await pool.query("SELECT generation FROM history")).rows[0].generation;
  let generation = originalGeneration;
  const emails = Array.from({ length: 3 }, (_value, index) => `message-test-${suffix}-${index}@example.com`);
  const triggerName = `message_test_${suffix.replaceAll("-", "")}`;

  async function request(path, { actor, body, server = servers[0], requestOrigin = origin, expectedUserId } = {}) {
    const url = new URL(`${server}${path}`);
    if (path.includes("/messages") && body === undefined) url.searchParams.set("generation", generation);
    return fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-real-ip": fixtureIp, ...(actor ? { cookie: actor.cookie } : {}), ...(requestOrigin ? { origin: requestOrigin } : {}), ...(expectedUserId ? { "X-Expected-User-Id": expectedUserId } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
  }

  async function readMessage(response) {
    assert.ok([200, 201].includes(response.status), `send status: ${response.status}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return messageResponseSchema.parse(await response.json()).message;
  }

  async function readHistory(actor, id, query = "", server = servers[0]) {
    const response = await request(`/api/conversations/${id}/messages${query}`, { actor, server });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return messageHistoryPageSchema.parse(await response.json());
  }

  try {
    for (const [index, email] of emails.entries()) {
      const response = await request("/api/auth/sign-up/email", { body: { name: `Message fixture ${index}`, email, password: randomBytes(24).toString("base64url") }, server: servers[index] });
      assert.equal(response.status, 200);
      actors.push({ ...(await response.json()).user, cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") });
      await verifyFixture(email);
    }
    const [alice, bob, outsider] = actors;
    const opened = await request("/api/conversations", { actor: alice, body: { otherUserId: bob.id } });
    assert.equal(opened.status, 201);
    const id = (await opened.json()).conversation.id;
    const path = `/api/conversations/${id}/messages`;
    const body = { clientMessageId: randomUUID(), encryptedPayload: randomBytes(48).toString("base64") };

    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { body })).status, 401);
    assert.equal((await request(path, { actor: outsider })).status, 404);
    assert.equal((await request(path, { actor: outsider, body })).status, 404);
    assert.equal((await request(path, { actor: alice, expectedUserId: bob.id })).status, 403);
    assert.equal((await request(path, { actor: alice, body, expectedUserId: bob.id })).status, 403);
    assert.equal((await request(path, { actor: alice, expectedUserId: alice.id })).status, 200);
    assert.equal((await request(`/api/conversations/${randomUUID()}/messages`, { actor: alice, body })).status, 404);
    for (const requestOrigin of [null, "https://untrusted.example"]) {
      assert.equal((await request(path, { actor: alice, body, requestOrigin })).status, 403);
    }
    for (const invalid of [{}, { ...body, encryptedPayload: "" }, { ...body, encryptedPayload: "a".repeat(8193) }, { ...body, senderId: bob.id }, { ...body, clientMessageId: "invalid" }]) {
      assert.equal((await request(path, { actor: alice, body: invalid })).status, 400);
    }
    assert.equal((await request("/api/conversations/invalid/messages", { actor: alice, body })).status, 400);
    for (const query of ["?after=-1", "?after=01", "?after=9223372036854775808", "?after=1&after=2", "?limit=0", "?limit=101", "?limit=1&limit=2", "?userId=other", "?after=0&recent=true", "?before=0", "?before=2&after=0"]) {
      assert.equal((await request(`${path}${query}`, { actor: alice })).status, 400);
    }
    assert.deepEqual(await readHistory(bob, id), { messages: [], nextAfter: null, nextBefore: null, headSequence: "0", generation });

    assert.deepEqual(await readHistory(bob, id, "?recent=true"), { messages: [], nextAfter: null, nextBefore: null, headSequence: "0", generation });
    assert.equal((await request(`${path}?after=1`, { actor: alice })).status, 409);
    assert.equal((await request(`${path}?recent=true`, { actor: outsider })).status, 404);

    const retries = await Promise.all(Array.from({ length: 4 }, (_value, index) => request(path, { actor: alice, body, server: servers[index % 3] })));
    assert.equal(retries.filter((response) => response.status === 201).length, 1);
    assert.equal(retries.filter((response) => response.status === 200).length, 3);
    const messages = await Promise.all(retries.map(readMessage));
    const first = messages[0];
    assert.ok(messages.every((item) => JSON.stringify(item) === JSON.stringify(first)));
    assert.equal(first.sequence, "1");
    assert.equal(first.senderId, alice.id);
    for (const server of [...servers].reverse()) {
      const reversed = await request(path, { actor: alice, body, server });
      assert.equal(reversed.status, 200);
      assert.deepEqual(await readMessage(reversed), first, "reversed replica retries preserve the canonical response");
    }
    assert.equal((await request(path, { actor: alice, body: { ...body, encryptedPayload: "different" } })).status, 409);

    const otherChat = await request("/api/conversations", { actor: alice, body: { otherUserId: outsider.id } });
    assert.equal(otherChat.status, 201);
    const otherId = (await otherChat.json()).conversation.id;
    const crossChat = await Promise.all([id, otherId].map((chatId, index) => request(`/api/conversations/${chatId}/messages`, { actor: alice, body: { ...body, clientMessageId: "00000000-0000-4000-8000-000000000001" }, server: servers[index] })));
    assert.deepEqual(crossChat.map((response) => response.status).sort(), [201, 409], "a client ID cannot race into two conversations");

    const second = await readMessage(await request(path, { actor: bob, body, server: servers[2] }));
    assert.notEqual(first.id, second.id, "different senders may use the same client ID");
    const simultaneous = await Promise.all(Array.from({ length: 12 }, (_value, index) => request(path, { actor: index % 2 ? alice : bob, body: { clientMessageId: randomUUID(), encryptedPayload: `opaque-envelope-${index}` }, server: servers[index % 3] })));
    assert.ok(simultaneous.every((response) => response.status === 201));
    await Promise.all(simultaneous.map(readMessage));

    const beforeFailure = await pool.query("SELECT last_message_sequence FROM conversation WHERE id = $1", [id]);
    const rollbackId = randomUUID();
    await pool.query(`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM message WHERE id = NEW.message_id AND client_message_id = '${rollbackId}') THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON message_outbox FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`);
    const rollbackBody = { clientMessageId: rollbackId, encryptedPayload: "opaque-rollback-fixture" };
    assert.equal((await request(path, { actor: alice, body: rollbackBody })).status, 503);
    assert.equal((await pool.query("SELECT id FROM message WHERE client_message_id = $1", [rollbackId])).rowCount, 0);
    assert.deepEqual((await pool.query("SELECT last_message_sequence FROM conversation WHERE id = $1", [id])).rows, beforeFailure.rows);
    await pool.query(`DROP TRIGGER ${triggerName} ON message_outbox`);
    await pool.query(`DROP FUNCTION ${triggerName}()`);
    await readMessage(await request(path, { actor: alice, body: rollbackBody }));

    const page = await readHistory(bob, id, "?limit=2", servers[2]);
    assert.ok(page.nextAfter);
    const duringPagination = await readMessage(await request(path, { actor: alice, body: { clientMessageId: randomUUID(), encryptedPayload: "opaque-later-message" } }));
    const collected = [...page.messages];
    let after = page.nextAfter;
    while (after) {
      const next = await readHistory(bob, id, `?limit=2&after=${after}`, servers[collected.length % 3]);
      collected.push(...next.messages);
      after = next.nextAfter;
      assert.ok(collected.length < 30, "pagination must terminate");
    }
    assert.equal(collected.at(-1).id, duringPagination.id);
    assert.equal(new Set(collected.map((item) => item.id)).size, collected.length);
    assert.deepEqual(collected.map((item) => item.sequence), collected.map((_item, index) => String(index + 1)));
    assert.deepEqual((await readHistory(bob, id, `?after=${duringPagination.sequence}`)).messages, []);
    const recent = await readHistory(bob, id, "?recent=true&limit=3");
    assert.deepEqual(recent.messages, collected.slice(-3));
    assert.equal(recent.headSequence, duringPagination.sequence);
    const live = await readMessage(await request(path, { actor: alice, body: { clientMessageId: randomUUID(), encryptedPayload: "after-bootstrap" } }));
    const older = [...recent.messages];
    let before = recent.nextBefore;
    while (before) {
      const next = await readHistory(bob, id, `?before=${before}&limit=3`);
      older.unshift(...next.messages);
      before = next.nextBefore;
    }
    assert.deepEqual(older, collected, "older pages meet the initial window without gaps or duplicates");
    assert.deepEqual((await readHistory(bob, id, `?after=${recent.headSequence}`)).messages, [live]);
    collected.push(live);
    for (const mode of ["after", "before"]) {
      const response = await request(`${path}?${mode}=${BigInt(live.sequence) + 1n}`, { actor: alice });
      assert.equal(response.status, 409);
      assert.equal(messageHistoryErrorSchema.parse(await response.json()).code, "CURSOR_AHEAD");
    }
    // Restore synthetic history loss after checking recovery errors.
    try {
      await pool.query("DELETE FROM message WHERE id = $1", [second.id]);
      for (const query of ["?after=0&limit=100", `?after=${second.sequence}`, `?before=${BigInt(second.sequence) + 1n}&limit=100`, "?recent=true&limit=100"]) {
        const response = await request(`${path}${query}`, { actor: bob });
        assert.equal(response.status, 410);
        assert.equal(messageHistoryErrorSchema.parse(await response.json()).code, "HISTORY_UNAVAILABLE");
      }
    } finally {
      await pool.query("INSERT INTO message (id, conversation_id, sender_id, client_message_id, sequence, encrypted_payload, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [second.id, second.conversationId, second.senderId, second.clientMessageId, second.sequence, second.encryptedPayload, second.createdAt]);
      await pool.query("INSERT INTO message_outbox (message_id, published_at) VALUES ($1, now())", [second.id]);
    }

    const stored = await pool.query("SELECT m.id, m.encrypted_payload, o.published_at FROM message m JOIN message_outbox o ON o.message_id = m.id WHERE m.conversation_id = $1", [id]);
    assert.equal(stored.rowCount, collected.length);
    assert.ok(stored.rows.every((item) => item.published_at === null || item.published_at instanceof Date));
    assert.equal(stored.rows.find((item) => item.id === first.id).encrypted_payload, body.encryptedPayload);
    assert.equal((await pool.query("SELECT id FROM message WHERE sender_id = $1 AND client_message_id = $2", [alice.id, body.clientMessageId])).rowCount, 1);

    const planner = await pool.connect();
    try {
      await planner.query("BEGIN");
      await planner.query("INSERT INTO message (id, conversation_id, sender_id, client_message_id, sequence, encrypted_payload) SELECT gen_random_uuid(), $1, $2, gen_random_uuid(), n, 'plan-fixture' FROM generate_series(1000, 10999) n", [id, alice.id]);
      await planner.query("ANALYZE message");
      for (const [condition, order] of [["sequence > 5000 AND sequence <= 10999", "ASC"], ["sequence < 5000", "DESC"]]) {
        const plan = await planner.query(`EXPLAIN (FORMAT JSON) SELECT * FROM message WHERE conversation_id = $1 AND ${condition} ORDER BY sequence ${order} LIMIT 21`, [id]);
        assert.match(JSON.stringify(plan.rows), /message_conversation_sequence_idx/, "bounded history should use the conversation/sequence index");
      }
    } finally {
      await planner.query("ROLLBACK");
      planner.release();
    }

    const resumed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Restart controller did not respond")), 60000);
      process.stdin.once("data", () => { clearTimeout(timeout); resolve(); });
    });
    console.log("MESSAGE_RESTART_READY");
    await resumed;
    assert.deepEqual((await readHistory(bob, id, "?limit=100", servers[1])).messages, collected, "an offline recipient retrieves all history on another instance after a crash");
    const retry = await request(path, { actor: alice, body, server: servers[0] });
    assert.equal(retry.status, 200);
    assert.deepEqual(await readMessage(retry), first, "restarted instance must return the original send");
    const checkpoint = await readHistory(bob, id, "?recent=true");
    generation = randomUUID();
    await pool.query("UPDATE history SET generation = $1", [generation]);
    const stale = await fetch(`${servers[0]}${path}?after=${checkpoint.headSequence}&generation=${checkpoint.generation}`, { headers: { cookie: bob.cookie } });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "HISTORY_RESET", "a numerically valid pre-restore checkpoint must be rejected");
    const missingGeneration = await fetch(`${servers[0]}${path}?after=${checkpoint.headSequence}`, { headers: { cookie: bob.cookie } });
    assert.equal(missingGeneration.status, 409);
    const unauthorizedReset = await fetch(`${servers[0]}${path}?after=0&generation=${checkpoint.generation}`, { headers: { cookie: outsider.cookie } });
    assert.equal(unauthorizedReset.status, 404);
    assert.equal((await readHistory(bob, id, "?recent=true")).generation, generation);
    const rejectedSend = await fetch(`${servers[0]}${path}`, { method: "POST", headers: { cookie: alice.cookie, origin, "content-type": "application/json", "X-History-Generation": checkpoint.generation }, body: JSON.stringify({ clientMessageId: randomUUID(), encryptedPayload: "stale-generation-send" }) });
    assert.equal(rejectedSend.status, 409);
    assert.equal((await rejectedSend.json()).code, "HISTORY_RESET");
    console.log("Message integration passed: authorization, atomic rollback/outbox, cross-instance retries/conflicts, recent/older bootstrap, recovery boundaries, indexed pagination, ordered catch-up, and persistence after an abrupt instance restart.");
  } finally {
    await pool.query("UPDATE history SET generation = $1", [originalGeneration]);
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON message_outbox`);
    await pool.query(`DROP FUNCTION IF EXISTS ${triggerName}()`);
    const ids = actors.map((actor) => actor.id);
    await pool.query("DELETE FROM message WHERE sender_id = ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM conversation WHERE direct_user_low_id = ANY($1::text[]) OR direct_user_high_id = ANY($1::text[])", [ids]);
    await pool.query('DELETE FROM "user" WHERE email = ANY($1::text[])', [emails]);
    await pool.end();
  }
}
