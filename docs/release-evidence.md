# Release evidence and remaining gates

Status: local preparation; not approval to publish. The owner explicitly deferred
staging details and browser execution. Every row distinguishes implemented/local
script evidence from an unexecuted release gate. Generated concepts are not
attributed to the owner. Final candidate images/digests and staging do not exist.

## Run the current deterministic checks

Use Node 24 and pinned pnpm 11.28.6 with Docker Compose v2 supporting `!reset`
and `!override`. Install the committed lockfile, then run:

```sh
pnpm install --frozen-lockfile
pnpm test:ci
```

This runs build/types/lint/unit/accounting, the current parser regression,
synthetic production-template checks and the CI runner self-check. The isolated
stack runner audits production dependencies, builds fresh server/web images,
starts private PostgreSQL/Redis/mail capture, migrates once before replicas,
starts the gateway on an ephemeral loopback port, and runs smoke/auth/reset,
conversation/message/realtime/client-sync, presence/typing, HTTP/socket limits,
metrics, gateway, dependency outage and API-reference scripts sequentially.
It then tests SMTP failure and an encrypted restore with publishers fenced and
an idle helper, before restoring service and tearing down only its own project.

Each Docker/integration step has a timeout; build allows ten minutes, individual
suites three minutes, and GitHub Actions bounds the job to 30 minutes. The runner
owns a random `convox-test-ci-*` project and temporary secret directory. Its
`finally` block removes that project's containers, orphan helper, volume and
image tags and deletes generated secrets. Host termination/daemon failure can
interrupt cleanup: inspect the recorded project, never run global Docker prune.

Artifacts under gitignored `test-results/ci/` include per-step sanitized logs and
`summary.json` with HEAD, uncommitted path list, runtime, outcomes and cleanup.
Set `CI_RESULTS` for another location. GitHub Actions uploads only that directory
for seven days; generated secret/config files are outside it. The production
audit fails the job for high/critical findings while retaining the full moderate
advisory report. The known moderate tooling finding is not suppressed or fixed
by this threshold; see security-review.md. Registry/network failure fails closed.

Load/recovery qualification remains an explicit separate run using the commands,
configurations and raw artifact format in load-recovery-report.md. CI does not
launch browsers or run five-minute capacity/crash-under-load measurements on
every push. The real-browser automation gate remains open: browser-verification.md
is a scenario checklist, not a runnable browser runner or passing report.

## PRD and task coverage

| Gate / tasks | Current evidence | Remaining release requirement |
| --- | --- | --- |
| Scope, privacy, lifecycle (1–3) | Owner decisions; architecture/database/operations records. TLS/server-readable text; no E2EE or purge. | Production data/backup ownership and operation. |
| Account policies (4–6) | SMTP verification/resend/reset, username and session integration; reset revokes all sessions. | Actual provider inbox delivery and staging cookie/origin checks. |
| Conversation/UI/client behavior (7–13) | Contracts/unit and isolated lookup/conversation/message/client-sync scripts. | Task 14 real-browser storage, navigation, keyboard, mobile and multi-tab qualification. |
| Presence/typing (15–19) | Shared ownership/expiry, authorization and activity fault scripts; scripted UI state tests. | Real-browser interaction evidence and staging load boundaries. |
| Abuse/socket bounds (20–21) | Shared quotas, failure policy, flood and slow-writer scripts. | Actual deployment proxy trust/shared-IP budget. |
| Telemetry (22–23) | Private service metrics, bounded labels, request correlation and client telemetry scripts. | Operational owner, real scrapes, dashboards, alerts and contact route. |
| Routing/deployment (24–25) | Readiness, DNS/failure/shutdown scripts; synthetic Docker-host TLS/secret validation. | Real hostname, access, image digests, certificate trust/renewal, firewall and secret ownership. |
| Backup/dependencies/correctness (26–28) | Isolated credential/retry/outbox restore, outage and assertion-map scripts. | Production scheduled encrypted off-host copies, stale-backup alerts, full-size RPO/RTO and browser evidence. |
| Harness/capacity/recovery (29–32) | Historical raw baseline, upper and real-client failure profiles with per-view accounting and identified topology/versions. | Requalify final images/topology; historical runs used the pre-Task-33 parser lockfile and are not proof of the patched release image. |
| Security (33) | Targeted parser fix/regression, current audit and scoped advisory dispositions. | Staging/browser trust boundaries; rebuilt image identification; final audit/disposition review. |
| Architecture/references (34–35) | Four ADRs/diagrams, official-schema-validated OpenAPI, core example integration and actual migrated schema snapshot. | Exercise deployment-bound examples against real staging. |
| Concepts/errors (36) | Assistant technical draft and observed-error ledger checked against source/raw records. | Owner review and author's own explanation; explicitly deferred. |
| CI/evidence (37) | `test:ci`, isolated runner, workflow and per-step local evidence. | Remote Actions execution after authorized push, actual browser automation and candidate-matched final qualifications. |
| Rehearsal (38) | Local deployment/rollback runbook preparation only. | Execute on approved staging with operational ownership. |
| Release (39) | Concrete release checklist/blocked promotion state. | All gates, owner approval of identified candidate, approved deployment and observation. |
| Conditional E1–E5 | Explicitly excluded by owner; not implemented. | No encryption promise may be inferred from legacy payload names. |

## Candidate identity and evidence freshness

Never promote `main` or a floating image name by implication. Record the exact
commit plus immutable server/web/runtime/dependency image digests. A local run
with uncommitted CI changes records parent HEAD and changed paths; it is not
reported as a remotely passing commit. CI infrastructure/docs changes do not
alter the message protocol, but changes to runtime dependencies or application
behavior require appropriate fresh evidence on the final image.

The committed capacity/recovery numbers remain historical facts for their
recorded code and dependencies. Task 33 subsequently updated body-parser 2.3.0
to 2.4.0; current CI validates that lockfile/functionality but does not silently
extend historical load qualification to the patched candidate. Repeat the
required load/failure profiles with the release topology before promotion.
An open evidence row is a blocker, not an inferred pass or waived requirement.

## Task 37 local CI-equivalent result — 2026-10-24

`pnpm test:ci` passed using Node 24.22.1: 54 unit/accounting tests plus current
security/configuration checks and all 29 stack-runner steps. Fresh images were
built from the patched lockfile; migration preceded application startup. All
integration, activity/abuse, fault, example, SMTP-failure and fenced restore checks
passed. The audit reported zero high/critical and one documented moderate finding.
The runner removed its own containers/volume/image tags and generated secret
directory; an independent Docker listing confirmed its containers were gone and
the existing projects remained running. Common token patterns in log artifacts
were checked for missed redaction.

The committed [local summary](ci-local-summary.json) records parent HEAD
`f64fe4ec` and the uncommitted CI paths that were tested, then committed with this
report. Later changes in this task were documentation/evidence only. Full local
logs are under gitignored `test-results/ci/`; remote Actions has not been run or
claimed passed, since no push was authorized. This result does not close browser,
production staging, final-image load/recovery or owner-authorship gates.
