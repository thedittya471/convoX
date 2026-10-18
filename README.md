# convoX

Real-time chat built around conversation continuity: three identical application instances behind a load balancer, behaving as one service.

convoX focuses on reliable delivery across instances, shared presence and typing, and recovering missed messages after a disconnect or server restart.

## Project status

The repository currently contains the product requirements and documentation files. Application code, infrastructure configuration, and test tooling are not implemented yet. The capabilities and performance figures below describe the release requirements, not verified results.

## Release scope

- Authenticated, one-to-one text conversations in the browser.
- Message delivery regardless of which instance serves each participant.
- Durable message history and offline delivery on reconnect.
- Duplicate-safe sends when clients retry, including across instance restarts.
- Shared presence that handles multiple tabs and expires after an instance crashes.
- Cross-instance typing indicators that clear after activity stops.
- Automatic reconnection to a healthy instance and recovery of missed messages.
- Per-instance connection counts, message throughput, and delivery latency.

Group chat, attachments, message editing/deletion, search, read receipts, push notifications, native mobile apps, end-to-end encryption, and multi-region deployment are outside this release.

## Reliability contract

A message is accepted only after durable storage. Retrying the same logical send must resolve to the original message, producing one stored message and one visible conversation entry.

A returning client must recover missed history and transition to live delivery without gaps or duplicates. Presence and typing are temporary activity signals; neither determines whether a message is stored.

The instance-recovery guarantee covers one application instance failing while the load balancer and shared dependencies remain available. Automatic failover of shared dependencies is outside this release.

## Performance targets

| Measure | Release target |
| --- | --- |
| Application instances | 3 behind one load-balanced endpoint |
| Baseline load | 500 concurrent connections, 50 new messages/second for 5 minutes |
| Upper load | 1,000 concurrent connections, 100 new messages/second for 5 minutes |
| Cross-instance delivery | p95 below 500 ms under both load profiles |
| Instance-failure recovery | Reconnect, catch up, and resume messaging in under 10 seconds |
| Stale presence after a crash | Offline within 30 seconds for users without a surviving or re-established connection |

Delivery latency is measured from the sender initiating a send to the connected recipient receiving it. Recovery time starts when the instance failure is injected. Load and recovery reports must include failed or missing deliveries alongside latency results.

## Running and deployment

There is no runnable application or deployment configuration in this repository yet. Installation, environment variables, local execution, three-instance deployment, and test commands will be documented alongside their implementation.

## Documentation

| File | Contents |
| --- | --- |
| [PRD.md](PRD.md) | Product scope, user journeys, requirements, acceptance targets, and release criteria. |

The release also requires architecture diagrams, four ADRs covering routing, presence, load balancing, and reconnect synchronization, API and database documentation, and reproducible test, load, and recovery reports. The full deliverable requirements are defined in the [PRD](PRD.md#13-required-release-artifacts).
