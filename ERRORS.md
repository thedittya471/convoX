# Observed errors and recovery

Recorded during Tasks 1–3 on 2026-10-24. This is an initial observed-error ledger; Task 36 completes the release artifact. Anticipated failure modes are not represented as observed incidents.

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

## Source-inspection gaps requiring later implementation

A valid numeric history cursor beyond the conversation head currently returns empty success. Restoration also lacks a checkpoint-invalidation protocol. These are source-inspection findings, not reproduced baseline test failures. [Recovery boundaries](docs/architecture.md) specifies expected behavior and Tasks 3A–3C/9 track implementation. No runtime fix is claimed here.
