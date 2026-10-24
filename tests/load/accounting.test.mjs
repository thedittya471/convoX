import assert from "node:assert/strict";
import { test } from "node:test";
import { summarize } from "./accounting.mjs";
const row = (id, extra = {}) => ({ id, attempts: 1, duplicates: 0, timeouts: 0, accepted: true, expected: [1, 2], cross: [2], receipts: new Map([[1, 3], [2, 8]]), ...extra });
test("missing storage/recipients and raw duplicates cannot disappear behind latency percentiles", () => {
  const result = summarize([row("a"), row("b", { receipts: new Map([[1, 2]]), duplicates: 2 }), row("c", { accepted: false, timeouts: 1, attempts: 2 })], new Map([["a", 2], ["b", 1]]));
  assert.equal(result.offered, 3);
  assert.equal(result.accepted, 2);
  assert.equal(result.uncertain, 1);
  assert.equal(result.missing, 1);
  assert.equal(result.storedDuplicates, 1);
  assert.equal(result.transportDuplicates, 2);
  assert.equal(result.timeouts, 1);
  assert.equal(result.retries, 1);
  assert.equal(result.latencyMs.p95, 8);
});
test("ambiguous commits reconcile from storage; acknowledged missing rows fail accounting", () => {
  const result = summarize([row("a", { accepted: false }), row("b"), row("c", { accepted: false, rejected: true })], new Map([["a", 1]]));
  assert.equal(result.accepted, 2);
  assert.equal(result.rejected, 1);
  assert.equal(result.missing, 1);
});
