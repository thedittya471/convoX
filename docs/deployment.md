# Docker-host deployment template

Status: template prepared for the owner's selected Docker-host approach. No public hostname, hosting account, release image digests or production secret files were provided. Validation uses synthetic inputs; staging, real HTTPS/cookies, provider SMTP, firewall reachability and deployment approval remain pending. Do not treat this template as a release or run fault suites against production.

## Inputs and isolation

Use `compose.production.yaml` **by itself**, not as an override of the development stack. Only NGINX publishes 80/443. PostgreSQL and authenticated Redis use an internal data network; servers also join the edge network for gateway traffic and SMTP egress. The frontend joins only edge. Keep the Docker host/firewall private except HTTPS, HTTP redirect and separately controlled administration. Docker-host compromise can read mounted secrets; Compose file secrets are not an encrypted secret manager.

Copy `.env.production.example` to the gitignored `.env.production`. Supply your public DNS hostname, an unused edge subnet and reviewed immutable image digests. Match the tested major versions: Node 24, PostgreSQL 17, Redis 8 and NGINX with dynamic upstream resolution (the local test image is 1.28). Build server/web from the reviewed commit with a digest-pinned `NODE_IMAGE` build argument, publish immutable artifacts, then record their digests. The Dockerfile's floating default is for development; production validation requires the explicit pin. Confirm artifact runtime versions in staging; a digest alone does not prove its contents.

Create the secret files outside the repository/build context, such as `/srv/convox/secrets`. All must be regular files with no group/other access (0600/0400). Match ownership to the pinned image's runtime UID: the current server image uses UID 1000; inspect the selected Redis image's UID for its ACL file. Compose file-secret UID/mode remapping must not be assumed to fix host permissions. Verify readability as the actual runtime user in staging.

- `server.env`: fill `infra/server.production.env.example` with the public HTTPS origin, independent random auth secret (at least 48 characters), metrics token (at least 32), dependency URLs and existing-provider SMTP credentials. URL-encode database/Redis passwords. `TRUSTED_PROXY_CIDRS` must equal the chosen edge subnet. Explicit production mode is set by Compose; startup rejects HTTP origins, missing authentication, development passwords, broad default proxy trust and local SMTP.
- `database_password`: the same decoded database password as `DATABASE_URL`. PostgreSQL initialization reads this file; changing it does not change an existing role password.
- `redis.acl`: `user default on #<SHA-256 of decoded Redis password> ~* &* +@all`, matching `REDIS_URL`. Anonymous/no-password Redis is not supported. This grants the application's current Redis adapter commands on the private data service; separate users/finer ACLs require qualification.
- `tls.crt` and `tls.key`: a current certificate/full chain and matching private key for `PUBLIC_HOST`. Supply/renew these through your existing certificate mechanism; no certificate-issuance service is introduced. The gateway redirects HTTP to the fixed hostname, enables TLS 1.2/1.3 and HSTS, forwards HTTPS scheme and WebSocket upgrades, and blocks private metrics.

Never put actual secrets in examples, shell arguments, logs or image layers. Environment examples contain placeholders; validation intentionally rejects them until completed. Secret/key paths are excluded from source/build contexts.

## Validation and startup

From the reviewed source with the working Node/pnpm toolchain:

```sh
pnpm build
pnpm validate:production .env.production
```

The validator prints no private values. It checks required digest references, private file modes, matching origin/proxy ranges and database/Redis secrets, TLS certificate/key pairing/hostname/expiry, production startup guards, and rendered Compose port isolation. It does **not** pull/verify images, validate the public trust chain, connect to production, or prove runtime file ownership. `pnpm test:production` uses temporary synthetic secrets/certificates, renders Compose and runs `nginx -t` in the cached local `nginx:1.28-bookworm` test image with no network or published ports; it also rejects floating images and readable credential files.

Start dependencies, apply the reviewed migrations once, then start replicas/gateway. These are deployment commands for the operator after staging approval, not commands executed by this task:

```sh
docker compose --env-file .env.production -f compose.production.yaml up -d postgres redis
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps --workdir /app/apps/server server-1 node --env-file=/run/secrets/server_env node_modules/drizzle-kit/bin.cjs migrate
docker compose --env-file .env.production -f compose.production.yaml up -d --wait
```

The migration command assumes artifacts built from this repository's server target, which retains the migration runner. Do not run migrations independently on every replica. Never use `down --volumes` on production. Backup/restore qualification is Task 26, still required before release.

## Budgets, rotation and rollback

Three server pools allow ten database connections each (30 total), plus migrations/administration/monitoring; verify the database connection budget before adding replicas. Each server has a 20-second connection lease, 10/account and 100/IP socket defaults, 256-KiB outbound bound, bounded transient events and approved shared HTTP quotas. Tune/report staging load configuration explicitly, especially shared-IP users. Redis remains transient; PostgreSQL owns durable messages. Shutdown rejects new work immediately and has an eight-second hard deadline within the ten-second container grace.

Rotate secrets through protected files and recreate the affected containers so new mounts/environment are read. Coordinate PostgreSQL role-password and server-file updates in a maintenance window; file replacement alone does not rotate the role. Coordinate Redis ACL/server credential changes and verify live realtime readiness. A zero-downtime dual-credential rotation needs a separately tested procedure. Rotate metrics tokens with collectors. Auth-signing-secret rotation invalidates existing signed cookies: announce re-login and preserve IndexedDB queues under their original account. Replace TLS files atomically and recreate the gateway to remount them; verify certificate expiry/chain and reconnection afterward. Never print secret contents to confirm rotation.

Rollback to the previous reviewed server/web digests and compatible configuration/secrets while retaining database volumes. This task adds no migration; migrations from other tasks require their own compatibility review. Gate traffic using the documented readiness/draining procedure.

## Staging gate still required

Record the actual hostname, pinned versions, host resources, network/firewall rules, certificate renewal and secret owner/mechanism. Verify public trusted HTTPS, fixed-origin redirects, Secure/HttpOnly/SameSite cookies, origin rejection, WebSocket upgrades/reconnect, private backend/database/Redis/metrics ports, real SMTP delivery, readiness and rotation. Complete backup/restore and load qualification before release. The owner must approve the concrete deployment separately.
