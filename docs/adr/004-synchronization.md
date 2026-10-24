# ADR 004: Generation-bound contiguous history and durable client retries

Status: implemented; scripted client and isolated restore/recovery evidence
passed. Real-browser IndexedDB/visibility behavior remains Task 14.

## Decision and alternatives

Bootstrap a bounded recent window with its snapshot head and database generation,
then connect the durable client from that head. Older UI pages do not move the
live checkpoint. The client buffers live events while replaying history, applies
only contiguous conversation sequences, and deduplicates applied positions.
Recovery uses bounded pages over all retained history; there is no time expiry.
Pending sends persist in account/conversation-scoped IndexedDB before HTTP,
retain the same logical ID/body across retries, and are removed after canonical
acceptance. Sessions remain in HttpOnly cookies, not IndexedDB.

Live-only delivery loses offline events. Replaying an unbounded conversation
costs unbounded memory. Timestamps cannot provide conversation order or distinguish
a restored database with reused numeric positions. A separate client broker or
cryptographic device protocol is outside the approved first release.

## Consequences and failures

Nonzero checkpoints/older boundaries require their original generation. Restore
rotates the singleton generation with traffic fenced. `HISTORY_RESET`,
`CURSOR_AHEAD` and `HISTORY_UNAVAILABLE` stop misleading synchronization and require
explicit recent-history reload; pending queues remain preserved and old-generation
entries cannot resend automatically. Never infer synchronization from socket
connect alone. Dependency failures are retryable, not declared permanent data loss.

Reconnect uses bounded staggered backoff and healthy catch-up. A server crash
can cause raw repeats; applied messages remain unique. An acknowledgement lost
after commit reconciles to the same stored message. Stopping one view releases
only that view. Sign-out/account switches prevent another account's queued text
from transmitting, while retaining it for same-account recovery. Browser profile
access can read pending plaintext; E2EE is excluded. A database restore can lose
acknowledgements newer than its backup cutoff; client retries cannot manufacture
lost canonical history or promise zero disaster loss.

Evidence: `client-sync.mjs`, message recovery-boundary tests, backup rehearsal,
and real-client [load/recovery profiles](../load-recovery-report.md). Roll back
protocol changes as a compatible client/server unit; preserve the history table,
retained identities and generation-bound queues during application rollback.
