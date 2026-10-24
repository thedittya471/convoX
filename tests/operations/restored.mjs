import assert from "node:assert/strict";
import { pool } from "../../apps/server/dist/db/client.js";
import { createMessage } from "../../apps/server/dist/services/messages.service.js";
import { publishNextMessage } from "../../apps/server/dist/services/outbox.service.js";

try {
  const { auth } = await import("../../apps/server/dist/utils/auth.js");
  const response = await auth.api.signInEmail({ body: { email: "backup-a@example.com", password: "backup-fixture-password-123" }, asResponse: true });
  assert.equal(response.status, 200, "restored credential must authenticate");
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(session.user.id, "backup-a");
  const result = await createMessage("backup-a", "00000000-0000-4000-8000-000000000001", {
    clientMessageId: "00000000-0000-4000-8000-000000000003", encryptedPayload: "retained fixture",
  });
  assert.equal(result.created, false, "retry must resolve to the restored message");
  assert.equal(result.message.sequence, "1");
  assert.equal(await createMessage("outsider", result.message.conversationId, { clientMessageId: crypto.randomUUID(), encryptedPayload: "denied" }), null);
  let delivered = 0;
  await publishNextMessage(async (message, participants) => {
    assert.equal(message.id, result.message.id);
    assert.deepEqual(participants, ["backup-a", "backup-b"]);
    delivered++;
  });
  assert.equal(delivered, 1, "pending restored outbox must recover");
  assert.equal((await pool.query("SELECT count(*) FROM message_outbox WHERE published_at IS NULL")).rows[0].count, "0");
  console.log("Restored application retry, participant authorization and pending publication passed");
} finally { await pool.end(); }
