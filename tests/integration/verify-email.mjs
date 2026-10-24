import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

// Test-only mailbox access: never expose this API on a public deployment.
export async function verificationLink(email) {
  const mailbox = process.env.MAILPIT_URL ?? "http://mailpit:8025";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${mailbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200, "test mailbox must be available");
    const { messages } = await response.json();
    if (messages?.length) {
      const message = await fetch(`${mailbox}/api/v1/message/${messages[0].ID}`).then((value) => value.json());
      const link = message.Text.match(/https?:\/\/\S+\/api\/auth\/verify-email\?\S+/)?.[0];
      assert.ok(link, "verification email must contain a link");
      return new URL(link);
    }
    await sleep(100);
  }
  assert.fail("verification email did not reach the isolated SMTP inbox");
}

export async function verifyFixture(email, server = "http://server-2:4000") {
  const link = await verificationLink(email);
  const response = await fetch(`${server}${link.pathname}${link.search}`, { redirect: "manual", headers: { "x-real-ip": `198.29.${randomBytes(1)[0]}.${randomBytes(1)[0]}` } });
  assert.equal(response.status, 302, "verification must redirect to the trusted app");
  assert.equal(new URL(response.headers.get("location")).searchParams.get("verification"), "complete", "fixture must verify successfully");
  return link;
}
