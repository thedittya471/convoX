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
