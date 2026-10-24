# Shared connection presence

Decision: use the existing Redis connection and Socket.IO boundary. Presence is transient evidence of an authenticated live connection, never proof of message receipt or reading. No PostgreSQL presence rows or additional services.

Each authenticated socket owns one unpredictable connection token in a per-user Redis sorted set. Redis server time supplies expiry scores. An atomic Lua command prunes expired members, refreshes only that token and sets a key expiry. Refresh every two seconds with a 20-second lease. Disconnect atomically removes only its own token; it never deletes the user key or another token. A delayed old disconnect therefore cannot remove a reconnected socket. Online means at least one unexpired member; otherwise offline.

Each socket may watch exactly one conversation. Validate its UUID and membership server-side; derive the peer from the database, never a client-supplied user ID. Replacing a watch discards the old one. Bound watch requests to one per second and one in-flight operation per socket. Revalidate session, verification and membership before snapshots. Unauthorized or revoked sessions receive no activity data. No user enumeration or arbitrary rooms.

Observer snapshots poll every two seconds, pruning the peer's expired members atomically. A crashed final connection becomes offline within 22 seconds under healthy dependencies, without Redis keyspace notifications or a global scan. Bound each read to the peer's active connection members; Shared socket counts are enforced (10 per account, 100 per IP by default). Timers stop at disconnect and overlapping ticks are skipped. Emit snapshots each poll so clients can expire silent/stalled authority after two missed polls plus one second. An initial unavailable snapshot is valid while a request is being authorized.

Redis routing/read failures or database authorization failures produce unavailable, not offline. Clients also invalidate activity when their socket disconnects. Redis recovery refreshes surviving sockets and observers rebuild snapshots on the next poll. Presence does not gate durable message acceptance. Polling and database revalidation cost scale with active sockets; qualify the release workload in the later load tasks.

Timelines:
- Two tabs A/B: remove A's token; B's unexpired token keeps the user online.
- Crash A without B: A cannot refresh; observer pruning after expiry yields offline by 22 seconds.
- Reconnect B before delayed A cleanup: B has a different token; A removes only A.
- Redis restart: observers report unavailable during loss; live sockets refresh their own tokens after recovery. Missing keys after a successful Redis read mean no current evidence, hence offline until refreshed.

Typing uses separate, conversation-scoped connection leases with a six-second TTL. Activity refresh is accepted at most once every two seconds per connection; repeated stops are capped at four per second. Each command is authorized against the watched conversation and live verified session. Stops and disconnects remove only the sender token. Poll snapshots carry remaining lease time; the client must clear at that deadline even if a stop is lost. Under healthy dependencies, observers learn crash/inactivity expiry within eight seconds. Redis/database failures invalidate activity and discard pending transient commands; recovery never replays typing as history. This state is excluded from messages and the outbox.

Rollback: remove activity handlers/UI together; Redis lease keys expire automatically. No database migration or durable-data rollback.

Evidence: activity/typing fault scripts and both real-client load/recovery envelopes passed; see [load/recovery report](../load-recovery-report.md). Redis ownership is shared across replicas; the database remains the authorization authority. These are local bounds under healthy dependencies, not a production SLA.

Alternatives: a process-local online boolean cannot represent other replicas; a shared user boolean lets a delayed disconnect erase a newer connection; relying on graceful disconnect alone misses crashes. Connection-owned Redis leases with observer pruning preserve independent ownership and observable expiry without durable presence rows or another service.
