# Load and recovery qualification

Status: local harness preparation and dry-run evidence. Production staging is
unavailable (Task 25); browser qualification (Task 14) is intentionally open.
Local results do not qualify a public release topology.

## Reproduce safely

Use a separate Compose project named `convox-test-*` (or `convox-release`), with
its own PostgreSQL/Redis volumes, gateway port and test SMTP mailbox. Mount current
server/contracts build output, web source, tests and migrations when using a
cached development image. Run migrations once and wait for all three replicas.
Never use production credentials or attach this project to retained databases.
The driver refuses production mode and uses private Compose service names.

Run `pnpm test:load` for accounting self-tests. Then run:

```sh
COMPOSE_PROJECT_NAME=convox-test-load \
COMPOSE_FILE=compose.yaml:/absolute/path/to/isolated-override.yaml \
LOAD_CONNECTIONS=30 LOAD_RATE=3 LOAD_SECONDS=5 LOAD_WARMUP=3 \
LOAD_RESULTS=/absolute/path/to/results pnpm load
```

For a local baseline, use 500 connections, rate 50, duration 300 and warmup 10.
The upper profile is a separate Task 31 (1,000/100); do not infer its result from
the baseline. The driver creates five views per account, two accounts per
conversation, with synthetic source IPs forwarded only on the trusted private
network. At baseline there are 100 accounts and 50 conversations. Default
per-account send/socket quotas apply; this is not a shared-NAT/IP-limit test.
Direct private connections distribute round-robin across all replicas; private
HTTP sends also rotate, ensuring cross-instance receipts. Gateway routing/fault
correctness is covered separately. This load profile does not measure gateway/TLS
capacity or real browser render cost. Report that scope with every result.

The driver uses Node's single-process monotonic clock from send initiation to
each recipient socket callback. It records cross-instance samples separately.
Each logical ID deterministically derives from `LOAD_SEED` and an increasing
index; fixture account IDs are unique per run. One bounded retry retains the ID
and exact body. HTTP 429/503 respect retry guidance (capped at five seconds for
this synthetic driver); at most 200 HTTP sends are in flight. Driver overload,
errors and rejected/uncertain outcomes remain in offered accounting.

Every recipient view is expected. Raw transport duplicates are counted; first
receipt per ID/view gives latency. Stored IDs are independently reconciled by
SQL and duplicates/missing storage remain failures. This measures transport
receipt; scripted client-sync tests establish applied-view deduplication. Missing
receipts are counted after a 15-second drain and cannot be masked by latency
percentiles. Timeout counters distinguish deadline/abort errors from other
request errors. Accepted includes ambiguous HTTP outcomes later found in storage.

Artifacts: `raw.json.gz` contains every measured logical ID, attempts, HTTP status,
canonical response ID, expected view IDs, receipt timings and per-instance metrics
snapshots. `environment.json` records commit, Node, host/VM resources, topology and
10-second Docker resource samples. It contains no cookies, credentials or message
bodies. Keep both files and the command/log; use `gzip -dc raw.json.gz` to inspect.
Credentials stay in the worker's memory. Fixtures are deleted in `finally`; after
an interrupted driver inspect/remove only its `load-*` users and conversations in
the disposable project before removing that project's volume. Never clean a
shared database by blanket truncation. The host removes only its named driver
container and preserves artifacts even when accounting fails.

## Local dry run (2026-10-24)

30 sockets distributed 10/10/10; 3 new messages/second for five seconds after
three seconds of warmup. Offered/accepted 15/15; 45 cross-instance recipient
samples, p95 124.22 ms, max 127.65 ms. No rejected/uncertain sends, retries,
timeouts, missing recipients, stored duplicates or raw transport duplicates.
All 30 sockets stayed connected. Raw evidence: `/tmp/convox-release/load-dry-final/`.
This small run verifies accounting/integration, not baseline capacity.

## Local baseline (2026-10-24): passed within the measured scope

Tested commit: `2d0d10268362b5f8becd38e25c560624a18d256a`.
Node 24.22.1 on Apple M4 (10 CPUs, 16 GiB host memory); Docker 29.4.3
Linux VM (10 CPUs, approximately 7.75 GiB memory). All dependencies, replicas
and driver shared this host. No throughput optimization was needed for this run.

| Measurement | Result |
| --- | --- |
| Connected views, start/end | 500 / 500 |
| Replica distribution | 167 / 167 / 166 |
| Warmup | 10 seconds at 50 new logical messages/second |
| Measured profile | 50 new logical messages/second for 300 seconds |
| Offering duration | 300,001.37 ms |
| Offered / accepted | 15,000 / 15,000 |
| Rejected / uncertain / retried | 0 / 0 / 0 |
| Timeouts / request errors / driver overload | 0 / 0 / 0 |
| Recipient receipts | 75,000 of 75,000 expected |
| Missing storage/receipts | 0 |
| Stored / raw transport duplicates | 0 / 0 |
| Cross-instance receipt samples | 50,000 |
| Latency min / p50 | 3.23 / 53.22 ms |
| Latency p95 / p99 | 100.97 / 107.46 ms |
| Latency maximum | 508.71 ms |

The p95 target (<500 ms) passed; the maximum is retained rather than filtered.
Independent artifact inspection reproduced the p95, verified 15,000 unique
logical/canonical IDs and all five recipient receipts per accepted message.
The driver reconciled all measured IDs against PostgreSQL before fixture cleanup.
Per-instance sampled CPU peaks were 22.63%, 21.97%, 22.43% (Docker CPU units),
and sampled memory peaks were 295.2, 265.6, 290.2 MiB. Five-minute memory samples
do not establish long-duration memory bounds. Metrics and resource samples are
preserved, including outbox and connection gauges.

Committed evidence is under
[`tests/load/results/2026-10-24-baseline`](../tests/load/results/2026-10-24-baseline/):
`summary.json`, `raw.json.gz` and `environment.json`. The raw file contains only
synthetic IDs/timings/statuses/metrics; no credentials or message bodies.

Task 30's **local baseline passed**. Qualification of the identified production
release topology remains open until Task 25 supplies staging, trusted HTTPS and
actual deployment artifacts. This run uses direct private service traffic and
synthetic source IPs; it does not establish gateway/TLS capacity, NAT limits,
real browser behavior, upper-profile performance or failure-under-load recovery.
Tasks 31/32 are separate and were not executed.

## Task 31 local upper profile (2026-10-24): passed

Commit `7bb17c4f9f5ad802d0a43bff40dbd4ca7bd5348d`, same local Docker topology
and unchanged default per-account policies as the baseline. After ten seconds
of warmup, 1,000 sockets (334/333/333) sustained 100 new logical messages/second
for 300,000.54 ms. All 30,000 offered messages were accepted and reconciled with
storage; all 150,000 expected recipient receipts arrived. There were zero
rejections, uncertain outcomes, retries, timeouts, request errors, missing
storage/receipts, stored duplicates, transport duplicates or driver overloads.
All 1,000 sockets remained connected.

100,000 cross-instance samples: min 3.20 ms, p50 53.02 ms, p95 100.23 ms,
p99 123.00 ms, maximum 445.71 ms. Independent artifact inspection verified
unique canonical IDs, every recipient receipt and reproduced p95. Sampled CPU
peaks per replica were 77.60%, 63.76%, 70.34%; sampled memory peaks were
365.0, 382.7, 364.0 MiB. No capacity bottleneck was demonstrated within this
five-minute envelope; these measurements do not establish unlimited capacity or
long-duration memory behavior. See committed `2026-10-24-upper` raw, environment
and summary artifacts beside the baseline. Public staging/TLS/gateway capacity
and real-browser rendering remain unqualified.

## Task 32 recovery harness

Set `LOAD_RECOVERY=1` with the existing load command. Run the baseline and upper
envelopes sequentially with `LOAD_SECONDS=60 LOAD_WARMUP=10` and their respective
500/50 and 1,000/100 settings. This is a 60-second failure exercise at each
qualified workload rate; the separate capacity runs above last five minutes.
The worker loads the actual `createChatClient` through the installed TS loader
and uses fake IndexedDB, not a browser or a simulated synchronization algorithm.
HTTP and reconnecting sockets use NGINX. Test-only `SOCKET_IP_LIMIT=2000` and
`CHAT_IP_PER_MINUTE=1000000` accommodate the shared driver IP; account limits and
production defaults are unchanged. This is not a default shared-NAT quota test.

After ten seconds of active measured traffic, a client commits a send, discards
the acknowledgement and asks the host to SIGKILL server-3. Timing starts before
that host command. Every reconnecting view initially on server-3 must reach a
healthy different replica, apply contiguous catch-up, reconcile its initial
pending state and complete a new send/peer reply within ten seconds. One
catch-up response is deliberately held for 250 ms while traffic continues.
Each view's raw timing, new instance, sent/reply IDs and applied cursor is retained.
Probe and uncertain-send IDs are reconciled independently against SQL.

Five views of one synthetic user are deliberately pinned to server-3 and kept
disconnected to measure typing and final-connection presence expiry. Their peer
stays on server-1. Those five deliberately offline views are excluded from the
reconnecting-client deadline, explicitly return after offline is observed, and
catch up before final all-recipient accounting. Only then does server-3 restart;
realtime readiness, an authenticated handshake and continued send/receive are
checked. The remaining replicas carry active traffic throughout the outage.
All applied messages are checked for duplicates, including sender views.

Two initial baseline trials failed an overbroad harness predicate: a view had
already caught up and observed both its send and peer reply, but the probe also
required its entire local queue to be empty while concurrent views of the same
account kept sending. The final predicate measures the required connected,
contiguous send/reply outcome. Initial pre-probe pending reconciliation, the
ten-second threshold, original uncertain-send identity and SQL uniqueness checks
remain enforced. Failed artifacts are preserved under
`/tmp/convox-release/recovery-baseline/` and `recovery-baseline-diagnostic/`.
Recovery artifacts contain no cross-instance routing-latency claim because
reconnections can change the receiving instance; recovery timing is a separate
single-clock measurement. Missing/timeout/duplicate outcomes remain failures.

Final local recovery results (2026-10-24):

| Measurement | Baseline envelope | Upper envelope |
| --- | --- | --- |
| Connections / message rate | 500 / 50 per second | 1,000 / 100 per second |
| Active duration after warmup | 60 seconds | 60 seconds |
| Reconnecting affected views | 164 / 164 recovered | 321 / 321 recovered |
| Recovery p95 / worst | 1,107.35 / 1,115.72 ms | 7,887.19 / 8,449.57 ms |
| Offered / accepted | 3,000 / 3,000 | 6,000 / 6,000 |
| Recipient receipts | 15,000 / 15,000 | 30,000 / 30,000 |
| Load retries | 0 | 1 |
| Missing / stored duplicates / applied duplicates | 0 / 0 / 0 | 0 / 0 / 0 |
| Offline observed | 20,005.09 ms | 22,003.27 ms |
| Typing cleared | 4,495.77 ms | 5,423.85 ms |
| Replica rejoin / all final sockets connected | Passed / 500 | Passed / 1,000 |

Raw per-view timing/probe records, SQL reconciliation outcomes, metrics and host
resource samples are committed in `2026-10-24-recovery-baseline` and
`2026-10-24-recovery-upper`. The two predicate-failure artifacts are committed in
`2026-10-24-recovery-harness-failures`. The upper worst case has about 1.55 seconds
of margin against the ten-second limit; one local run does not establish a
production recovery SLA. No browser/staging qualification is claimed.

The recovery artifacts record parent HEAD `db7e837` plus the recovery-driver
changes committed with this report (`tests/load/run.mjs` and `recovery.mjs`).
Check out the commit containing this report to reproduce those scripts. The
application code itself is unchanged by the recovery harness. `pnpm check`
passed with all 54 unit/accounting tests after the final harness changes.
