# Observed errors and recovery

Observed during local implementation/qualification on 2026-10-24. Test counts and versions in each historical entry describe that run, not the latest candidate. Entries distinguish reproduced runtime failures, test/setup errors and audit/source findings. Future risks are not presented as observed incidents.

## Homebrew Node 24 missing shared library

**Reproduction:** `/opt/homebrew/opt/node@24/bin/node --version`.

**Observed:** exit 134 before application startup. dyld cannot load `libsimdjson.29.dylib`; the installed simdjson directory contains ABI 33.

**Cause:** the Homebrew Node 24.13.0 binary references a missing shared-library ABI. This is a local toolchain problem, not a failing application test.

**Recovery:** use the existing bundled Node 24.22.1 for this baseline. Homebrew was not modified; no incompatible ABI symlink was created.

**Verification:** `pnpm check` passed with Node 24.22.1 and pinned pnpm 11.28.6, including builds, types, lint and 17 unit tests.

**Prevention:** verify runtime startup/version before tests; repair Homebrew separately if needed. The working bundled runtime is sufficient for this project.

## Docker daemon stopped / restricted socket access

**Reproduction:** `docker info --format '{{.ServerVersion}}'` with desktop-linux context.

**Observed:** initially the socket did not exist; after startup the restricted sandbox could not access it without escalation. `open -a Docker` could not resolve this installation.

**Cause:** stopped Docker Desktop plus sandbox restrictions on daemon access.

**Recovery:** start `/Applications/Docker.app/Contents/MacOS/Docker Desktop.app` and use approved escalation for Docker operations.

**Verification:** daemon 29.4.3 responded; the isolated stack built/started, all six integration suites passed, fixtures were removed, services recovered and only the disposable stack/volumes were torn down. The unrelated existing Compose project remained running.

**Prevention:** verify daemon/context first and use explicit project identity, alternate ports, fresh volumes and sequential fault suites.

## Initial pnpm lookup stalled

**Reproduction:** initial repository `pnpm --version` under restricted execution.

**Observed:** no output before cancellation. Homebrew launcher is 11.5.3; the repository pins 11.28.6. Exact cause of the stall was not established.

**Recovery:** working Node 24 plus approved escalation allowed pinned pnpm to report 11.28.6 and execute the baseline. No version requirement was weakened.

**Prevention:** record effective runtime/package-manager versions and distinguish bootstrap restrictions from application failures.

## Historical source findings: recovery boundaries (resolved)

Initial inspection found an ahead-of-head cursor could return empty success and
restoration lacked checkpoint invalidation. These were source findings, not
reproduced baseline failures. Tasks 3A–3C/9–10 implemented explicit 409/410 errors,
a history generation and preserved blocked pending queues. Message/client-sync
scripts verify the resulting behavior; see docs/correctness-coverage.md.

## Task 4: new verification socket error retried indefinitely

A new client regression test emitted EMAIL_NOT_VERIFIED and observed reconnecting instead of a stopped actionable state. The cause was that only UNAUTHENTICATED stopped handshake retries. The client now stops for EMAIL_NOT_VERIFIED, retains its queue and gives email-verification guidance. The added test passed after the fix; full checks and client-sync integration also passed.

During UI implementation, lint rejected synchronous state derivation from URL parameters inside effects. The UI now reads callback parameters through Next.js useSearchParams inside Suspense; no lint rule was disabled. A test initially expected an unsafe callback to be accepted; actual existing origin validation rejected it. The assertion was corrected to prove rejection without consuming the token, while valid callback requests test shared resend limits.


## Task 26: publisher consumed the backup fixture

**Observed/reproduction:** the restore test expected one pending outbox row while
source publishers were running; it found zero. The encrypted archive itself
restored successfully.

**Cause:** the source worker legitimately published the synthetic row before the
dump snapshot. This was an invalid test setup, not backup data loss.

**Fix/verification:** fence disposable publishers and run application restore
checks through an idle helper on the private network. Credential login, stable
retry, participant isolation and pending publication passed. See
`tests/operations/backup.mjs`, `restored.mjs` and docs/test-report.md.

**Prevention:** deliberately pending backup fixtures require controlled writers;
never infer a backup consistency defect from an uncontrolled outbox transition.

## Task 27: checked-out PostgreSQL client terminated a replica

**Observed/reproduction:** stopping the disposable PostgreSQL service during
concurrent requests produced an unhandled `Client` error (`ECONNRESET`) and a
replica exited; another run then found its service name unavailable.

**Cause:** the pool's idle-connection error listener did not handle errors emitted
by a checked-out client outside an active query promise.

**Fix:** attach a redacted error listener when each pool client connects. Query
and transaction failures still reject; readiness fails closed. No error is
converted into a successful durable acknowledgement.

**Verification/prevention:** the dependency-outage regression verifies bounded
503 responses, no rejected-send row, original-ID reconciliation and both remote
replicas becoming ready again without restart. `pnpm check` passed. Keep this
runtime regression when changing database drivers or pool lifecycle handling.

## Tasks 26–28: cached image did not contain the tested sources

**Observed/reproduction:** integration checks using an older cached image lacked
current migrations/frontend activity behavior. The client could report connected
without the presence fields expected by the current test.

**Cause:** local tests mounted current tests/server output but left older web
source or migrations inside the image. A passing build on the host does not
update an already-built container.

**Fix/verification:** mount every required current artifact for those development
checks, or rebuild from the reviewed lockfile/source. The final current-source
message/realtime/client-sync scripts passed; docs/test-report.md records scope.

**Prevention:** qualification must identify source, dependency image and mounted
artifacts. The release candidate must rebuild images; cached-image evidence is
not silently relabeled as proof of new dependencies.

## Task 32: recovery probe required an unrelated queue to be empty

**Observed/reproduction:** baseline recovery trials failed the probe deadline.
Diagnostic view 486 was connected, had applied its sent message and peer reply,
but still displayed a pending entry while other views shared its account queue.

**Cause:** the harness required the entire local queue to be empty after the
send/reply, a broader condition than that view's required recovery outcome.
This was a harness assertion issue; it was not evidence that the observed reply
or stored message was lost.

**Fix:** measure connected state, contiguous applied catch-up and verified
send/reply. Preserve the pre-probe pending-reconciliation gate, ten-second limit,
original uncertain-send identity and independent SQL uniqueness checks.

**Verification/prevention:** both final failure envelopes passed, including every
affected reconnecting view; raw failed trials are committed under
`tests/load/results/2026-10-24-recovery-harness-failures/`. Do not reduce the
recovery threshold or filter slow/missing views to make a run pass. The predicate
change and its justification remain in docs/load-recovery-report.md.

## Task 33: vulnerable compressed-body dependency found by audit

**Observed:** production dependency audit reported high-severity body-parser
2.3.0 and a moderate esbuild tooling advisory. This is an observed dependency
finding, not a claim that the vulnerable parser crash was reproduced here.

**Fix/verification:** targeted compatible body-parser 2.4.0 lockfile update;
current-package gzip/trailing-byte regression and `pnpm check` passed. The audit
then reported no high/critical and one documented moderate esbuild finding.
Raw before/after evidence and exposure/disposition are in docs/security-review.md.

**Prevention:** audit the candidate lockfile, rebuild its images, and keep the
compressed-body regression. Do not hide the remaining tooling advisory or infer
that an old image contains the patched parser.

## Unverified risks and remaining gates — not observed incidents

Real staging TLS/cookie/proxy boundaries, production backup freshness/full-size
recovery, browser behavior and monitoring operations remain unqualified until
executed. The local scripts are not evidence that those future deployments failed
or passed. Track their actual state in docs/release-checklist.md.
