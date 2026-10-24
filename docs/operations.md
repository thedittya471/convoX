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

### Recovery telemetry and correlation

Every HTTP request receives a server-generated `X-Request-ID`; caller-supplied IDs are not trusted. HTTP 5xx and message-operation failure logs allowlist that ID, instance, event and status. Outbox dispatch failures include only the canonical message UUID and instance; slow-socket closure includes its connection ID. Never add bodies, raw URLs/query strings, cookies, email, auth tokens or arbitrary error objects. Request IDs correlate a request; canonical message IDs correlate later publication. They are log fields, never metric labels.

`createChatClient({ onTelemetry })` optionally reports `{event: "sync" | "reconnect", outcome: "success" | "error" | "cancelled", durationMs}`. Aggregate these fixed dimensions into collector counters/histograms; do not attach account/conversation identifiers. Durations use the client monotonic clock. Sync covers one history synchronization; reconnect success requires healthy catch-up and an empty pending queue, and cancellation is separate. A throwing/rejecting collector is ignored and no network telemetry is sent by default. Instrumentation never gates IndexedDB or durable HTTP sends.

For sender-to-recipient tests, record sender initiation before HTTP in a bounded map by synthetic client ID, then measure at the recipient's onMessages callback using the same process's `performance.now()`. Remove completed entries; report missing/timeouts alongside successes. Do not compare unrelated browser clocks or label server dispatch as recipient receipt. `pnpm test:client-sync` emits one live sender-to-applied-receipt sample with its scope and missing count; this is timing-boundary evidence, not a percentile/load qualification or proof of reading.

### HTTP readiness, realtime readiness and draining

Owner-approved split: `/api/health/live` reports a reachable process; `/api/health/ready` requires PostgreSQL and a non-draining process; `/api/health/realtime` additionally requires successful pings on both Redis connections. Redis uses two-second keepalive pings and a five-second silent-socket timeout. Redis failure keeps durable HTTP acceptance available while refusing new realtime handshakes. HTTP readiness probes share one in-flight database check with a 250ms cache. Dependency failures can still occur after a successful probe: normal transaction errors remain retryable and never acknowledge an uncommitted send.

Unready replicas return 503 before auth/body/application work, with Retry-After and `X-Convox-Not-Accepted: 1`. Engine.IO handshakes use the same database/draining gate. NGINX treats 502/503/504 as passive failures, retries eligible requests across at most three peers and suppresses a failed peer for five seconds. This is request-driven passive ejection, not an active health-check scheduler; a request can reach an unready process but application work is rejected. POSTs are never retried after transmission: do not enable `non_idempotent`. Clients retain the original message UUID on uncertain responses. Resolver refresh is five seconds, without affinity.

SIGTERM/SIGINT immediately marks draining, rejects new work and disconnects local sockets so clients recover elsewhere. Existing HTTP work/outbox publication can finish before HTTP, Redis and PostgreSQL close. The hard shutdown deadline is eight seconds, below Compose's ten-second grace; exceeding it forces an unsuccessful process exit. `pnpm test:gateway` temporarily rejects only one disposable replica in PostgreSQL's access rules, proves reachable-but-unready routing, restores the rules and changes that replica's IP/DNS and restarts it as a returning replica. Moving a running container between networks without restarting its dependency connections is not a supported deployment operation. Never run fault scripts against production. `pnpm test:smoke` verifies clean planned exit/rejoin; realtime/client scripts verify gateway upgrades and abrupt failure without ambiguous POST replay.

### Production Docker host

See [deployment preparation](deployment.md) for the standalone production Compose file, TLS, private networks, file-secret ownership, pinned image/runtime inputs, connection budgets, rotations and the uncompleted staging gate. Development Compose is not a production overlay. `DEPLOYMENT_MODE=production` enforces HTTPS, independent secrets, authenticated dependencies, SMTP and explicit proxy CIDRs on startup.

### Encrypted database backups

Run `node scripts/database-backup.mjs backup CONTAINER DATABASE DIRECTORY KEY_FILE`
from a controlled Docker operator account. The container must have PostgreSQL 17
client tools and local operator authentication. Set `PGUSER` if it differs from
`convox`; no password is accepted on the command line. Create a dedicated 0700
backup directory and a separate 0600 file containing 32 cryptographically random
bytes. Protect that key independently from the backups; losing it loses recovery.
The script streams a transactionally consistent custom-format dump through
AES-256-GCM, writes privately, and publishes the file only after successful dump
and encryption. IV/tag are appended; partial files are never restoration inputs.

Schedule this command daily using the host's existing scheduler. Alert on failed
runs and when the last successful backup exceeds 24 hours. Only completed
`convox-*.dump.gcm` files older than seven days in that directory are removed,
after a successful backup. Store the encrypted archives off the database host;
replication, scheduler installation and alert routing depend on the hosting setup.
A daily schedule targets RPO <=24 hours only while successful backups continue.
The printed cutoff is a conservative timestamp before the dump snapshot, not a
promise to recover later acknowledgements. Track duration/size and rehearse at
production data volume before claiming the four-hour RTO.

Restore with `node scripts/database-backup.mjs restore CONTAINER EMPTY_DATABASE
ARCHIVE KEY_FILE`. First create a separate empty database and fence traffic as
specified above. The archive is authenticated into a private temporary directory
before any database writes. Restore runs as one transaction, preserves constraint
and migration metadata, and rotates the history generation. The temporary plain
dump is removed on ordinary exit/failure; use encrypted operator scratch storage
and clean abandoned `convox-restore-*` directories after host/process crashes.
A failed post-restore generation rotation leaves an isolated target: never route
traffic until the generation and application checks succeed.

Apply only schema-compatible reviewed migrations, then verify auth, participant
access, retry uniqueness, sequence/counter agreement and outbox replay. Keep the
original volume and compatible application images for rollback; an application
rollback does not reverse database migrations. Retired Matrix configuration is
not part of the active PostgreSQL/Redis system: archive any retained Matrix
volumes/secrets separately and do not delete them or OAuth/account tables during
cleanup. The script never removes database volumes or modifies the source.
