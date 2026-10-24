# ADR 003: WebSocket-only connections without affinity

Status: implemented in local Compose and the production Docker-host template.
Actual production TLS/network qualification remains Task 25.

## Decision and alternatives

Socket.IO uses WebSocket transport only. NGINX forwards upgrades and routes new
connections across three identical replicas without sticky sessions. Each socket
stays on its selected replica for that connection's lifetime; reconnect can land
elsewhere. Shared PostgreSQL sessions and Redis routing/presence make process
identity irrelevant to user ownership. Backends remain private and trust only
the configured gateway subnet; NGINX overwrites forwarded source addresses.

Long-polling would need affinity across its multiple HTTP requests; it is
intentionally disabled. Sticky sessions alone do not solve crash recovery and
would add routing state. A managed load balancer is a deployment alternative, not
a reason to replace the current tested private gateway without qualification.

## Consequences and failures

Clients on networks that block WebSockets have no long-polling fallback. Readiness
is split: HTTP needs PostgreSQL and a non-draining process; realtime also needs
Redis. NGINX passively ejects failed upstreams for five seconds, tries eligible
requests across at most three peers and refreshes DNS every five seconds. It
never automatically replays a transmitted POST. A client handles uncertain sends
with the original ID. Planned shutdown rejects new work, closes sockets and
finishes bounded outstanding work; hard shutdown is eight seconds.

The gateway's request-based ejection is not an active health scheduler. A fault
may occur after a readiness check. Redis outages can retain durable HTTP service
while live delivery is unavailable. Socket leases, event rates and outbound
queues bound individual connections; explicit shared-IP budgets are still needed.

Evidence: gateway/smoke/realtime scripts and [recovery profiles](../load-recovery-report.md)
verify routing, crash/rejoin and actual server identities. Direct-service capacity
runs do not measure TLS/gateway capacity; failure profiles use NGINX but local
HTTP. Rollback must preserve WebSocket upgrades, private trust boundaries and
no automatic POST replay; changes to affinity/transport need new client tests.
