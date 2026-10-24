# Focused release security review — 2026-10-24

Scope: source and committed lockfile after Tasks 31/32, isolated auth/reset
scripts, current-package parser regression, synthetic production-template checks
and the existing authorization/fault evidence. This is not a penetration test or
approval to deploy. Real browser and staging boundaries remain release blockers.

## Trust boundaries and controls reviewed

| Boundary / asset | Implementation and evidence |
| --- | --- |
| Public requests → account/session | Better Auth email/password, database sessions, no cookie cache, trusted fixed origin; auth/reset scripts cover expired/revoked sessions, generic recovery responses, token replay and session revocation after reset. |
| Account → participant resources | Verified-email HTTP/socket gates, canonical direct pairs, session-derived sender, membership checks on history/sends/activity, expected-user guards and outsider 404; correctness map covers script assertions. |
| Browser → rendered message | Chat renders `encryptedPayload` as React text, including pending entries; no raw HTML injection. Source review only: real browser DOM/CSP/framing behavior remains unverified. |
| Browser → local outbox | IndexedDB stores message text, account/conversation ownership, retry ID and generation in plaintext; no auth cookie/token is stored there. Account-scoped reads and expected-user guards block cross-account transmission; restored generations block automatic resend. Local device/same-origin script access can read pending text. |
| App → PostgreSQL | Parameterized values, transactionally committed message/counter/outbox, restrictive message FKs, unique retry/sequence indexes, bounded pools and readiness. Source and scripted storage/fault checks; production role grants remain deployment review. |
| App → Redis / remote sockets | Authenticated private production Redis template; transient leases/routing, session revalidation, fixed event schemas, socket quotas, event/queue limits and catch-up after loss. Source IP identity depends on a private trusted gateway. |
| Secrets / logs / SMTP | Environment validation and private file-secret template, independent metrics/auth secrets, allowlisted error fields, no query/referrer in gateway access logs, token-sensitive paths suppress upstream error logs. Nodemailer requires TLS outside explicit local mode, has timeouts and disables file/URL reads. Actual provider delivery is unverified. |
| Operator → backups | Private 32-byte key and archive directory, authenticated encryption, archive verification before writes, empty restore target, generation rotation. Isolated login/retry/outbox rehearsal passed; production scheduling/key custody/off-host copies remain open. |

Limits are the approved defaults in operations.md. Production dependencies and
metrics must stay private; proxy headers are trusted only from the deployment's
explicit private gateway subnet. Synthetic load shared-IP limits are test-only.
The first release is TLS-protected, server-readable text, with E2EE excluded.
Neither the `encryptedPayload` name nor IndexedDB implies content encryption.

## Current dependency audit and dispositions

Raw `pnpm audit --prod --json` evidence is in `security/audit-before.json` and
`audit-after.json`; the audit includes optional dependencies and exits nonzero
while the moderate finding remains. Before: one high, one moderate. After the
targeted transitive update: zero high/critical and one moderate. No overrides,
new dependencies, broad upgrades or audit suppression were introduced.

- **Fixed: body-parser 2.3.0 → 2.4.0**, through Express's existing compatible
  dependency range. [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)
  affects compressed-body parsing before route handling and can exit a process.
  The current installed-package regression verifies the patched version, valid
  gzip, malformed trailing bytes and continued health. `pnpm check` passed.
  Rebuild deployment images from the new lockfile; cached test images still
  contain their previous installed dependencies.
- **Open, scoped exposure: esbuild 0.18.20** via Better Auth → drizzle-kit →
  deprecated esbuild-kit tooling. [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
  concerns the esbuild development server's permissive CORS. Application entry
  points and Compose production commands do not start `esbuild.serve`; the
  tooling is retained for reviewed, private migration commands. No exposed
  esbuild dev server was identified in this deployment path. Do not expose that
  server; upgrade the upstream tooling before enabling it. The vulnerable package
  remains installed and the advisory remains unresolved, not waived or hidden.
  A forced major/minor-zero transitive API replacement was avoided because the
  old migration loader needs compatibility testing before that change.

## Verification and remaining promotion gates

The current parser regression and `pnpm check` passed. Isolated auth/password
reset scripts verify existing account/token policies; those cached containers
exercise current application output but do not validate a rebuilt dependency
image. Production template checks validate synthetic secrets, HTTPS-only config,
proxy ranges and rendered NGINX, not an actual public certificate/network.

Before release: qualify trusted HTTPS/Secure cookies, fixed origin and proxy
spoofing rejection on the real staging host; verify private ports/metrics and
secret ownership/rotation; run the browser rendering/storage journey; rebuild
and identify images from this patched lockfile; review the remaining advisory
against the final image and rerun the audit. Tasks 14/25/26 retain their recorded
browser, staging and production backup gates. No blanket security approval is
inferred from passing local scripts.
