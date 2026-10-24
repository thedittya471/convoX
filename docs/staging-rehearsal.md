# Staging deployment, restoration and rollback rehearsal

Status: **prepared locally; not executed in staging**. The owner deferred staging
hostname/access/secrets and requested no browser execution. Local CI proves the
component checks in release-evidence.md; it is not this rehearsal. No public
service, real provider account, registry or deployment was modified.

## Inputs and accountable owner — all required before execution

Record these in the private deployment record, not committed secret files:

| Input | Current state |
| --- | --- |
| Staging HTTPS hostname and isolated host/access | Not supplied |
| Exact reviewed source commit and immutable server/web/runtime/dependency image digests | Not selected/built/published for staging |
| Approved previous compatible server/web digests for rollback | Not supplied |
| Private secret mechanism/file ownership and TLS certificate renewal | Template only; actual mechanism/owner pending |
| Staging-only database/Redis, fixture accounts and SMTP sender/inbox | Not supplied; production data is prohibited |
| Operational owner and incident/escalation contact | Unassigned; owner must supply |
| Metrics collection/dashboard location and alert delivery owner | Unconfigured; source metrics exist |
| Encrypted off-host backup location, key custodian, daily schedule/stale-backup alert | Not configured in staging |
| Observation duration and rollout/rollback decision authority | Not agreed; do not substitute an arbitrary window |

Check the full release-evidence.md matrix first. The moderate tooling advisory
needs final-image disposition review; historical capacity/recovery runs predate
the parser dependency patch and must not be reused as final-image qualification.
Do not expose administration, PostgreSQL, Redis, backends or metrics publicly.

## 1. Validate the concrete deployment and freeze the evidence

Use compose.production.yaml by itself and complete the reviewed production
examples as described in deployment.md. Supply digests, HTTPS origin, explicit
private proxy subnet, authenticated dependencies, private secrets and matching
certificate/key. Run `pnpm validate:production /absolute/path/to/staging.env`
without printing configuration/secrets. This validates inputs, not DNS, public
certificate trust, host permissions or image contents. Inspect runtime identities
inside the selected images and record the actual Node/PostgreSQL/Redis/NGINX
versions and host resources. Set the incident owner before enabling traffic.

Store the reviewed configuration and prior compatible image references privately.
Record migration journal/head and backup cutoff. Verify an encrypted backup is
recoverable on a separate target before migration/promotion; the backup's key must
be recoverable independently of the database host. Do not use production records.

## 2. Deploy a clean isolated staging environment

These are operator commands for the future approved staging host, not commands
executed by this task. `STAGING_ENV` names the completed private deployment input
file. Environment files are data; do not source/execute them in the shell.

```sh
docker compose --env-file "$STAGING_ENV" -f compose.production.yaml up -d postgres redis
docker compose --env-file "$STAGING_ENV" -f compose.production.yaml run --rm --no-deps --workdir /app/apps/server server-1 node --env-file=/run/secrets/server_env node_modules/drizzle-kit/bin.cjs migrate
docker compose --env-file "$STAGING_ENV" -f compose.production.yaml up -d --wait
```

Run migrations once, before replicas; archive the journal result. Verify live,
HTTP and realtime readiness plus all three authenticated instance identities.
Check actual trusted HTTPS, fixed-origin redirects, Secure/HttpOnly/SameSite
cookies, Origin/callback rejection, private ports, external metrics denial and
proxy spoofing rejection. Synthetic template checks cannot establish these.
Verify actual SMTP verification/reset links and same-account session revocation
with staging-only accounts. Browser flows remain pending until explicitly enabled.

## 3. Exercise service continuity on staging-only fixtures

Record fixture logical IDs and compare canonical responses/history before and
after each step. Send in both directions, reload/replay and verify bounded recent
and older history, presence and typing. Record peer receipt rather than outbox
publication as client delivery evidence.

- Planned restart: restart one replica; verify draining/refusal, healthy routing,
  same-ID uncertain-send reconciliation and clean rejoin.
- Abrupt loss: kill one replica only on isolated staging while traffic continues;
  retain the failure timestamp, every affected client's catch-up plus send/receive
  time and missing/duplicate accounting. Keep the replica down through recovery,
  then verify rejoin. Presence and typing expiry need a user with no surviving or
  re-established connection, separate from users recovering automatically.
- Dependency recovery: qualify database/Redis failures, bounded work and pending
  outbox catch-up on isolated fixtures. Do not run destructive fault injection on
  production. Existing local fault scripts deliberately reject production mode;
  do not bypass guards to point them at a public deployment. The actual staging
  harness/endpoints must be qualified before executing this phase.

Use the PRD limits: p95 receipt <500 ms at both five-minute load profiles;
every recovering client <10 seconds; final crashed presence <30 seconds. The
full environment, configured abuse limits, raw outcomes and failures must be
recorded. Do not filter failed clients or equate connection with recovery.

## 4. Rehearse compatible binary rollback

Gate new traffic, retain the current database/backup and change only to previously
reviewed compatible server/web image digests/configuration. Recreate the affected
services, verify readiness and original canonical message/retry identities, then
restore controlled fixture traffic. Record elapsed rollback time and observed
results; no duration has been measured for a real staging host yet.

No schema is reversed as incidental application rollback. Current CI/documentation
changes add no migrations. Historical migration 0003 removes group storage and is
not a generic reversible downgrade; 0005 adds message/outbox ownership and 0006
adds generation fencing. A rollback candidate must preserve the deployed message,
session and generation protocol. Never drop history/deduplication rows or reset
its migration journal to make an older binary start. If no compatible prior image
exists for a first release, record that explicitly and use a reviewed fix-forward
or traffic hold rather than inventing a rollback target.

## 5. Rehearse disaster restoration separately

Follow the fenced procedure in operations.md: stop traffic, replicas, publishers
and jobs; preserve the original database; authenticate/restore the consistent
archive into an empty separate target; apply compatible migrations once; rotate
generation; discard old routing connections; start only restored writers.
Validate credentials/authorization, sequence/counter order, retry uniqueness,
pending outbox recovery and stale-generation rejection before traffic resumes.
Record data cutoff and any newer accepted data lost. Restore is not a zero-loss
binary rollback. Keep pending queues for explicit reconciliation; do not silently
recreate lost canonical history. Measure full-size RPO/RTO through verification,
not merely pg_restore duration. Daily backups target RPO <=24h and RTO <=4h.

## 6. Observe, decide and record

Scrape every replica's private authenticated metrics, correlate request failures,
watch readiness, HTTP errors, durable accepts, routing failures/retries, pending
outbox/age, connections, CPU/memory and backup freshness. Do not sum shared outbox
gauges or label them by message/user. Configure alert recipients and test delivery.
Client receipt/recovery needs separate client measurements; server dispatch is
not receipt. Record dashboards, baseline values, observation window and decision
owner before approving promotion.

Any authorization leak, false durable acceptance, missing accepted canonical
message or unexplained duplicate effect requires an immediate traffic hold and
investigation. Failing agreed latency/recovery limits prevents promotion. The
owner must approve deployment-specific operational thresholds/window; no new SLO
or automatic rollback policy is silently adopted here. Binary rollback must not
erase data or conceal an integrity incident.

Rehearsal record: commit/digests, host/topology, configuration references, migration
head, backup cutoff/key custody, checks and raw outcomes, restart/crash/rollback/
restore times, alerts, deviations, unresolved findings, operator and reviewer.
Until that record exists and passes, Task 38 and public promotion remain open.
