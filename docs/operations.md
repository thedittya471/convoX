# History restoration

Message history, counters, identities, sessions, retry identities and the outbox must come from one consistent database backup. The singleton `history.generation` identifies that canonical history; it is not a timestamp or message cursor. Migration `0006_history_generation.sql` initializes it for existing installations. Apply migrations before starting the updated replicas.

Before resuming traffic after **every** restore:

1. Stop public traffic and all application replicas, publishers and jobs. Fence old database connections; do not allow old and restored writers to overlap. Preserve the original database/backup for investigation.
2. Restore into an isolated target and apply compatible migrations. Check constraints, identities, counters and outbox consistency. Record the backup cutoff and any acknowledged data lost after it. Redis is not a history backup; stop/restart the routing processes so queued events from the old database cannot be relabeled as restored history.
3. On the restored database, as an authorized operator, run this once and record the returned UUID:

   ```sql
   UPDATE history SET generation = gen_random_uuid() WHERE singleton = true
   RETURNING generation;
   ```

   Exactly one row must change. A missing generation fails history reads and realtime startup closed. Never reuse a pre-restore generation, including when the restored numeric head is unchanged. Rotate on the target after the restore, not before taking the backup. No public generation-change endpoint exists.
4. Start replicas against the restored target. With authorized fixture accounts, verify that a request carrying an old generation receives 409 `HISTORY_RESET`, even when its numeric cursor remains below head. Verify a fresh `recent=true` bootstrap returns the new generation, then catch-up with that generation succeeds. Outsiders must still receive 404. Only then resume traffic.

Clients carry the generation alongside every nonzero checkpoint and older-page boundary. Missing or mismatched generations return 409 `HISTORY_RESET`; missing required ranges return 410 `HISTORY_UNAVAILABLE`; an ahead cursor returns 409 `CURSOR_AHEAD`. Clients stop live synchronization and clear displayed history on explicit recovery errors. The user can reload an authorized recent window to establish a fresh checkpoint. Realtime readiness and message delivery also carry the generation so open clients stop on mismatch; periodic history checks detect quiet resets. A disconnected client cannot prove the server's current history until it reconnects.

Each new pending entry stores its original generation; unknown/old-generation entries are retained and blocked from automatic resending. The composer resumes a queue only when every saved entry matches the loaded history generation. Older/unknown-generation queues remain visible, with sending blocked for explicit review. Restoring accepted messages lost after the backup cutoff cannot be promised. Reconcile pending IDs/content explicitly against canonical history before enabling sending; never regenerate IDs or silently recreate previously accepted data. Storage failures show loaded history without claiming live synchronization. A failed reload leaves the client unsynchronized with its queue intact.

Rollback: revert the application changes as a unit. Leave the additive `history` table in place; older code ignores it. If permanently removing the migration, first stop all updated replicas, then `DROP TABLE history` and coordinate the migration journal with the deployment tooling. Dropping the table while updated replicas run makes history unavailable. Do not roll back the recovery protocol during a restore.

Backup automation, measured RPO/RTO, full backup restoration and production rehearsal remain Task 26; focused generation rotation tests do not establish those targets.

### Shared chat HTTP quotas

The owner approved these initial fixed-window limits per minute: `CHAT_IP_PER_MINUTE=300` before authentication for all `/api/users` and `/api/conversations` traffic; per verified account, `CHAT_SENDS_PER_MINUTE=120`, `CHAT_LOOKUPS_PER_MINUTE=60`, `CHAT_OPENS_PER_MINUTE=30`, and `CHAT_READS_PER_MINUTE=120` shared between conversation and history reads. Configuration accepts positive integers up to 1,000,000. Account limits are applied after session verification in the controllers; IP enforcement runs before JSON parsing and authentication. These are initial abuse controls, not measured capacity limits; qualify/tune them for the agreed load and shared-IP deployment.

PostgreSQL's existing `rate_limit` table provides atomic counters and server-clock windows across replicas. Keys use a `chat:` namespace, operation and SHA-256 identity hash. They contain no raw IP, cookie or payload. Buckets reset on their first request after 60 seconds; counts saturate at limit + 1. Every minute of traffic each replica attempts a bounded cleanup of up to 1,000 chat-owned buckets idle for over one hour; Better Auth buckets are untouched. Monitor table size/cleanup cost during load qualification.

NGINX overwrites `X-Forwarded-For` with its direct client address. Express trusts private/loopback proxies; **backends must stay firewalled and reachable only from the private gateway/network**, as in Compose (no host server ports). A deployment that exposes backend ports or trusts untrusted private peers must narrow proxy trust before release. Auth routes keep Better Auth's separate limits.

Exhausted quotas return 429, `Cache-Control: no-store`, `Retry-After` seconds and JSON guidance. A failed quota query returns 503 with a five-second retry hint, without invoking the action or acknowledging a new message. Redis outages do not disable HTTP acceptance because quotas use PostgreSQL. The durable client honors numeric Retry-After guidance for 429/503 before automatic or manual synchronization retries. Retries still retain the same client message ID; every attempt consumes quota, and a rejected request promises no acceptance. Rolling back this feature removes the middleware/controller checks; stored quota rows contain no message data.

### Socket resource limits

Owner-approved defaults: `SOCKET_USER_LIMIT=10`, `SOCKET_IP_LIMIT=100`, `SOCKET_OUTBOUND_BYTES=262144` (256 KiB). Redis atomically reserves account and source-IP leases in one hash slot, refreshes every two seconds and expires abandoned ownership after 20 seconds. Disconnect removes only its own token. Redis loss refuses new handshakes; existing clients report activity unavailable and reclaim leases on recovery, disconnecting if capacity is no longer available. Private proxy trust follows the HTTP boundary; backend ports must remain private. Handshakes also consume the shared pre-auth IP request budget.

Each connection accepts at most 20 application events per second, including unknown/invalid events; excess traffic disconnects it. The tighter watch/typing limits still apply. Engine.IO queued packet bytes plus WebSocket buffered bytes are checked per packet and every 100ms; excess closes/terminates the transport. A packet already being encoded can add one bounded packet over the threshold. Clients reconnect and reconcile durable history from their existing generation/cursor; an emit is never a receipt acknowledgement. This guard uses the installed Engine.IO WebSocket upgrade request and must be rechecked on transport upgrades.

Use `pnpm test:sockets` for shared connection bursts, release, event flooding and a deterministic stalled Engine.IO writer with bounded heap growth. Run existing realtime/client/presence regressions sequentially. Default IP limits deliberately allow multi-tab use but cannot accommodate 1,000 connections behind one IP: configure the approved load/staging profile explicitly and report it. These checks do not qualify sustained release capacity or OS/kernel network buffers.

### Per-instance metrics

Set a separate random `METRICS_TOKEN` (at least 32 characters) and scrape each backend's private `/internal/metrics` with `Authorization: Bearer <token>` every 10–15 seconds. Missing/wrong credentials return 404; the gateway blocks `/internal/` even with the token. Keep collection on the private network and rotate the token through the deployment secret mechanism. The endpoint is disabled without a token. Never reuse the auth signing secret.

Prometheus text exports fixed names with only the configured instance label: active sockets; new committed durable accepts (retries excluded); publish attempts/errors and retry-loop counters; routing-time histogram; HTTP request/5xx counters; Redis/database failures; and shared outbox pending count/oldest age. The outbox gauges describe the same database on every replica: do not sum them. Failed collection exports NaN and availability=0, not an empty backlog. Counters reset on process restart. Routing time includes dispatch acknowledgements and local routing, not recipient receipt; retries count publisher loops following a failure, not distinct message IDs. No message/user/conversation/session labels or bodies are exported.

Scrapes query the indexed pending outbox and can add database work; observe scrape cost under load. Alert on sustained backlog/age, unavailable collection, repeated dependency errors and publish failures alongside active socket and durable-accept rates. `pnpm test:metrics` checks auth/format; `pnpm test:realtime` with a metrics token checks known accept/retry/socket/routing deltas on all three replicas.
