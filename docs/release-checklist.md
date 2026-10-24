# Release candidate and promotion checklist

Status: **BLOCKED — LOCAL PREPARATION ONLY** (2026-10-24).
The owner explicitly deferred staging details and retained the no-browser-testing
constraint. No public release, registry publication, tag or deployment has been
performed or approved. Task 39 is not complete merely because this checklist exists.

## Prepared source baseline

| Field | Recorded value |
| --- | --- |
| Source/CI baseline | `699bab94175260a490201f36ccc451d47da0e175` |
| Existing root package version | `1.0.0`; final release version/tag not approved or issued |
| Node / pnpm | Node 24; local CI used 24.22.1; pnpm pinned 11.28.6 |
| Lockfile SHA-256 | `db10e0e110282426319aade667323d1e1ac2971a725210fb31a20be4559bdbbd` |
| Dependency fix | body-parser 2.4.0; one moderate esbuild tooling advisory remains documented |
| Last local deterministic command | `pnpm test:ci`: passed, including 54 unit/accounting tests and all 29 isolated stack steps |
| Exact local-run provenance | Parent HEAD `f64fe4ec` plus the CI changes committed in the source baseline; see ci-local-summary.json |
| Deployment images/digests, hostname and secrets | Not supplied; no promotable artifact set exists yet |
| Migration head | Committed sequence 0000–0006; actual staging/production journal not inspected |
| Approved previous compatible images | Not supplied; do not assume a first release has a rollback target |
| Production backup/cutoff and restored verification | Not configured/measured |
| Release operator, incident contact and observation window | Not assigned/agreed |

Documentation prepared after this baseline does not modify the application's
behavior. The final release record must still identify its exact commit and
immutable artifacts; do not substitute a floating `main` or local Docker tag.
Local container builds are not published/pinned production image identities.

## Mandatory open gates

- [ ] **Owner explanation (36):** CONCEPTS.md is an assistant technical draft.
  Owner review/authorship was explicitly left pending; do not attribute it to them.
- [ ] **Real browser (14/28/33/37):** qualify auth cookies, IndexedDB/account/tab
  lifecycle, history/composer/activity, keyboard/mobile/IME and recovery behavior;
  establish the runnable browser automation path. Script checks are not this gate.
- [ ] **Actual deployment boundary (25/33/35):** hostname/host access, trusted
  HTTPS/certificates, secret ownership/rotation, Origin/proxy rejection, private
  ports and deployment-bound API examples verified on staging.
- [ ] **Production backup policy (26):** encrypted off-host daily copies, seven-day
  retention, key custodian, stale/failure alerts and production-size recoverable
  RPO <=24h / full verified RTO <=4h measured. Fixture restore is insufficient.
- [ ] **Final-image evidence (30–32/37):** repeat both five-minute capacity profiles
  and both failure envelopes on the actual patched candidate/topology. The
  committed historical runs precede the parser patch; they are not final-image
  qualifications. No accepted loss/duplicate effects may be hidden by percentiles.
- [ ] **Security disposition (33):** audit the final lockfile/images, review the
  moderate tooling exposure and all deployment/browser findings. No blocking
  finding may be accepted by implication or hidden by an audit severity filter.
- [ ] **CI provenance (37):** record remote Actions results after an authorized
  push and exact candidate test evidence. A passing local command is recorded as
  local, not as a remotely executed workflow.
- [ ] **Staging rehearsal (38):** execute staging-rehearsal.md with once-only
  migrations, real flows, planned restart, abrupt loss, compatible binary rollback
  and fenced restoration; record actual results and non-reversible schema steps.
- [ ] **Operations (38/39):** operator, escalation contact, metrics/alerts and
  tested notification delivery; agree observation window and decision authority.
- [ ] **Approval (39):** review the filled candidate/backup/compatibility/evidence
  record and obtain explicit owner authorization for that public deployment.

E1–E5 are explicitly excluded by the owner's TLS/server-readable first-release
scope, not falsely marked implemented. Messages/identities are retained until
approved deletion; no purge, E2EE or read-receipt promise is added for release.

## Promotion sequence after gates are closed

1. Freeze the exact reviewed source/image/configuration set; record verification
   results, current backup cutoff and prior compatible images. Review all task
   and PRD gates against release-evidence.md. Any unresolved mandatory gate holds
   promotion; neither a green unit suite nor an old load report overrides it.
2. Obtain explicit owner deployment authorization for the identified environment,
   version/artifacts, limitations, observation window and rollback authority.
   Generic task-planning approval and this preparation are not that authorization.
3. Execute the reviewed deployment runbook with protected input files, database
   preservation and migrations once. Never automatically roll back migrations,
   erase retained volumes or force-push source history as application rollback.
4. Verify trusted HTTPS, readiness, actual instance identities, staging-approved
   auth/chat/history/presence/typing flows, private metrics collection, real SMTP
   and backup freshness without destructive production fault injection.
5. Observe the agreed window using server and client measurements. Investigate
   authorization leaks, false acceptance, missing canonical data or duplicate
   applied effects immediately; fence traffic if integrity/privacy is in doubt.
   Hold promotion when PRD latency/recovery or agreed operational limits fail.
   Use only the approved compatible rollback/fix-forward process and preserve data.
6. Record successful release or rollback with timestamp, operator, authorization,
   source/artifact identity, migration/backup state, observed results, incidents,
   known limitations and follow-up owner. Tag/publish only the reviewed identity
   when separately authorized; do not mark a release successful without observation.

## Evidence links

[Release gate matrix](release-evidence.md), [local CI summary](ci-local-summary.json),
[test report](test-report.md), [historical load/recovery](load-recovery-report.md),
[security review](security-review.md), [staging rehearsal](staging-rehearsal.md),
[deployment inputs](deployment.md), [operations/restore](operations.md),
[architecture/ADRs](architecture.md), [OpenAPI](openapi.json),
[realtime](realtime.md), [database](database.md), [concepts draft](../CONCEPTS.md)
and [observed errors](../ERRORS.md).

Actual release record: **none**. Explicit public-deployment authorization: **none**.
The next external prerequisite is the staging information the owner deferred;
no approval is requested for this incomplete artifact set.
