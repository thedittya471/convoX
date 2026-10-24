import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";

process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
process.env.BETTER_AUTH_URL = "http://localhost:8081";
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.REDIS_URL = "redis://127.0.0.1:1";
process.env.NODE_ENV = "production";
const require = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const expressRequire = createRequire(require.resolve("express"));
assert.equal(expressRequire("body-parser/package.json").version, "2.4.0", "use the reviewed patched parser");
const { default: app } = await import("../../apps/server/dist/app.js");
app.post("/security-fixture", (_request, response) => response.sendStatus(204));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
try {
  const valid = gzipSync(Buffer.from(JSON.stringify({ text: "synthetic" })));
  const send = (body) => fetch(`${url}/security-fixture`, { method: "POST", headers: { "content-type": "application/json", "content-encoding": "gzip" }, body, signal: AbortSignal.timeout(3000) });
  assert.equal((await send(valid)).status, 204);
  const malformed = await send(Buffer.concat([valid, Buffer.from("trailing bytes")]));
  assert.ok([204, 400].includes(malformed.status), "malformed compression must be handled without process failure");
  await sleep(100);
  assert.equal((await fetch(`${url}/api/health/live`)).status, 200);
  console.log("Compressed-body regression passed: current parser, valid gzip and trailing-byte request keep the process alive");
} finally { await new Promise((resolve) => server.close(resolve)); }
