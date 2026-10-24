# ADR 001: PostgreSQL outbox and Redis sharded routing

Status: implemented; local message, realtime, outage and load/recovery scripts
passed. Public staging qualification remains open.

## Decision and alternatives

Commit each message, conversation counter and pending outbox row in one
PostgreSQL transaction. Workers claim one pending row with `FOR UPDATE SKIP
LOCKED`, retain the transaction while routing, and set `published_at` only after
remote dispatch acknowledgements and local delivery succeed. Socket.IO's sharded
Redis adapter routes `message:dispatch` to the other application replicas;
participant IDs come from the stored conversation. Each replica validates live
sessions before emitting locally. No client-supplied room grants access.

Alternatives: emitting immediately after insertion leaves a crash window with
no replayable routing intent; writing Redis before PostgreSQL can announce a
message that never commits. A separate durable broker would add another system
without removing the database transaction boundary. The existing database outbox
is the smallest reliable ownership model here.

## Consequences and failures

Acceptance follows database commit and does not wait for Redis or recipient
receipt. Dispatch acknowledgement means a replica completed its local routing
attempt, not that a recipient applied/read a message. Routing has a six-second
outer deadline. Publication can repeat after a crash between emit and outbox
commit; recipients deduplicate canonical IDs/sequences. Outbox rows remain stored
and no purge is authorized. Holding a database connection during dispatch costs
one connection per active worker; local load evidence does not remove this bound.

Redis loss preserves durable HTTP acceptance/history and leaves publication
pending. PostgreSQL loss returns retryable errors and cannot create a false
acceptance. A lost HTTP acknowledgement retries the same sender/client ID;
changed content/destination is rejected. Server crashes release uncommitted
locks, and other workers resume. Dependency outages have bounded client/pool
behavior; a checked-out client error cannot terminate the process unhandled.

Evidence: [correctness map](../correctness-coverage.md), [load/recovery report](../load-recovery-report.md),
`messages.mjs`, `realtime.mjs`, `dependency-outage.mjs`. Rollback must keep database
messages/outbox and canonical retry semantics; never replace publication with an
untracked fire-and-forget emit or delete retained rows as deployment cleanup.
