# Shared connection presence

Decision: use the existing Redis connection and Socket.IO boundary. Presence is transient evidence of an authenticated live connection, never proof of message receipt or reading. No PostgreSQL presence rows or additional services.

Each authenticated socket owns one unpredictable connection token in a per-user Redis sorted set. Redis server time supplies expiry scores. An atomic Lua command prunes expired members, refreshes only that token and sets a key expiry. Refresh every five seconds with a 20-second lease. Disconnect atomically removes only its own token; it never deletes the user key or another token. A delayed old disconnect therefore cannot remove a reconnected socket. Online means at least one unexpired member; otherwise offline.

Each socket may watch exactly one conversation. Validate its UUID and membership server-side; derive the peer from the database, never a client-supplied user ID. Replacing a watch discards the old one. Bound watch requests to one per second and one in-flight operation per socket. Revalidate session, verification and membership before snapshots. Unauthorized or revoked sessions receive no activity data. No user enumeration or arbitrary rooms.

Observer snapshots poll every five seconds, pruning the peer's expired members atomically. A crashed final connection becomes offline within 25 seconds under healthy dependencies, without Redis keyspace notifications or a global scan. Bound each read to the peer's active connection members; Task 21 will enforce socket counts. Timers stop at disconnect and overlapping ticks are skipped. Emit changed snapshots only. An initial unavailable snapshot is valid while a request is being authorized.

Redis routing/read failures or database authorization failures produce unavailable, not offline. Clients also invalidate activity when their socket disconnects. Redis recovery refreshes surviving sockets and observers rebuild snapshots on the next poll. Presence does not gate durable message acceptance. Polling and database revalidation cost scale with active sockets; qualify the release workload in the later load tasks.

Timelines:
- Two tabs A/B: remove A's token; B's unexpired token keeps the user online.
- Crash A without B: A cannot refresh; observer pruning after expiry yields offline by 25 seconds.
- Reconnect B before delayed A cleanup: B has a different token; A removes only A.
- Redis restart: observers report unavailable during loss; live sockets refresh their own tokens after recovery. Missing keys after a successful Redis read mean no current evidence, hence offline until refreshed.

Typing will use separate, conversation-scoped connection leases with six-second TTL and throttled activity. Stops remove only the sender connection. This state is excluded from messages, history and the outbox. Task 18 supplies its bounded contract and implementation.

Rollback: remove activity handlers/UI together; Redis lease keys expire automatically. No database migration or durable-data rollback.
