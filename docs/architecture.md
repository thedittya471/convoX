# Recovery boundaries and release decisions

Status: Task 3 policy specification, approved by the owner on 2026-10-24. This is a partial architecture document; component/deployment diagrams and four ADRs remain Task 34. Runtime gaps below are requirements, not implemented claims.

## Durable and transient ownership

PostgreSQL owns users, sessions, direct participant pairs, messages, conversation sequence counters and delivery-outbox rows. A transaction commits the message, counter and outbox before accepting a send. The `(sender_id, client_message_id)` unique key resolves retries to one canonical message; changed content/destination is a conflict. Each conversation's row lock allocates commit-ordered sequence numbers. Redis/Socket.IO carries live notifications, not durable offline storage. Clients recover from PostgreSQL and advance only through applied contiguous sequences. An instance crash can replay publication, so visible effects must deduplicate.

The first release uses TLS and server-readable text. `encryptedPayload` is the legacy property name for the exact stored string, not cryptography. No schema rewrite or new envelope is selected. Existing opaque records are retained; the future UI must not claim undecoded opaque data is readable history. Authenticated simultaneous devices remain supported without cryptographic linking.

## Approved retention and recovery window

Retain message and identity records until an explicit approved deletion process. No scheduled purge is authorized. Catch-up covers retained canonical history regardless of elapsed offline time; this is not an infinite storage/availability commitment. Backend pages remain bounded and a large history must be consumed incrementally. Presence/typing are transient and must not be replayed as messages.

Any later retention/deletion design must separately specify how sequence positions, message identity and idempotency survive. Do not hard-delete a message and leave a sequence hole that the current client will retry forever. A deletion feature is outside this work; implementation would need an explicit compatible tombstone or reset protocol before enabling deletion.

## Recovery contract: current behavior and required changes

All recovery operations require the current session and participant authorization. Missing and unauthorized conversations share 404; malformed IDs/cursors/limits return 400 without disclosing history. Sequences are decimal bigint strings, `after` is exclusive and the current server caps `limit` at 100.

| Situation | Current implementation | Required release behavior |
| --- | --- | --- |
| New browser, no checkpoint | Client defaults to `after=0`, reads oldest-first pages and reconciles live events. | API supports recent/older pages and a snapshot head; Task 10 connects a bounded UI. |
| Long-offline browser | All stored sequences after a valid cursor can be paged; no purge exists. | Recover all retained history with no time expiry, gaps or duplicate visible effects. Network/storage faults remain retryable. |
| Cursor equals head | Empty page, `nextAfter: null`. | Successful catch-up only after authoritative validation; retain the applied cursor. |
| Malformed or out-of-bigint-range cursor | Shared schema rejects it, controller returns 400. | Preserve this behavior and prove it in integration tests. |
| Valid decimal cursor ahead of head | Server returns 409 `CURSOR_AHEAD`; explicit client rebuild remains Task 3C. | Return 409 with stable code `CURSOR_AHEAD`; do not advance/reset silently or report synchronized. Offer explicit history rebuild preserving pending sends. |
| A required sequence is missing or declared unavailable | Server returns 410 `HISTORY_UNAVAILABLE` for missing boundaries or required page gaps; explicit client rebuild remains Task 3C. | Return 410 with stable code `HISTORY_UNAVAILABLE` for a known unavailable range; fail synchronization visibly and rebuild from a declared valid boundary. Do not introduce age-based expiry under this retention policy. |
| Database restored to an earlier snapshot | No restore-generation/reset protocol exists. A stale numeric cursor may still look valid, and accepted messages newer than backup can be absent. | Invalidate all pre-restore checkpoints, including numerically valid ones. Use a restoration generation/reset mechanism or equivalent proven full-client invalidation; old clients must not merge incompatible histories. Preserve pending sends for explicit reconciliation. |

The 409/410 responses are implemented; client reset and restoration invalidation remain Tasks 3B/3C. Do not classify a temporary database outage as permanent history loss. Validation of a paging boundary must use a consistent snapshot/head or equivalent atomic query so a concurrent send cannot produce a false ahead-of-head verdict. A reset must require current authorization and cannot expose a different account's history.

Recent requests use `recent=true`; older requests use an exclusive positive `before` sequence. All pages return messages in ascending sequence order and the snapshot `headSequence`. Recent/older pages expose `nextBefore`; after pages retain `nextAfter`. Apply the recent window before starting catch-up from its head; older pages do not move this checkpoint. Repeatable-read transactions bound queries to the same authorized head, and the existing `(conversation_id, sequence)` index supports both scan directions. Gap detection covers the requested page and its lookahead, not an unbounded audit of earlier history.

## Backup disaster boundary

Approved targets: daily encrypted database backups; retain backups seven days; RPO <=24 hours; RTO <=4 hours. RPO is the maximum targeted loss measured to the last recoverable backup, not a guarantee of zero loss. RTO covers restoration, readiness and required verification, not merely starting PostgreSQL. Neither target has been measured or implemented here.

The no-loss guarantee for one application instance failing assumes shared storage remains available. Database destruction/restore is a different scenario and can lose acknowledged messages after the backup cutoff. Clients must not silently re-create previously accepted history with new identities or claim the lost range was delivered. Pending unsatisfied sends retain their original client IDs and content; already-accepted local history must be reconciled against the restored service, with any loss disclosed.

## Task 3 verification walkthrough

1. **New device:** authenticate/verify, open an authorized conversation, bootstrap retained history, join live updates and render each canonical message once. Recent bootstrap/older paging is implemented in the API; browser integration remains Task 10.
2. **Long-offline device:** replay exclusive of its last applied valid sequence over retained history; do not expire merely because it is old. Detect gaps and do not report successful catch-up until reconciled.
3. **Future cursor:** syntax can be valid while exceeding the stored head. Required 409 `CURSOR_AHEAD` leads to explicit rebuild with the pending outbox preserved. Server enforcement is implemented; explicit client recovery remains Task 3C.
4. **Restored database:** use a new recovery generation or equivalent proven invalidation, reject old checkpoints, disclose the restore cutoff, rebuild from canonical history and reconcile pending sends without claiming recovery beyond the backup. Task 3B specifies the cross-client invalidation proof; Task 26 measures the restore.

These walkthroughs verify that each case has a defined expected outcome. They are not runtime test evidence. Required follow-ups are recorded as Tasks 3A–3C in the checklist; their behavior must pass before release.
