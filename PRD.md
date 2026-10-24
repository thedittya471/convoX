# convoX — Product Requirements Document

## 1. Executive summary

convoX is a real-time chat application designed to preserve conversation continuity through network interruptions, client retries, and application-instance failures. Participants use a single application endpoint while three identical server instances handle connections behind a load balancer.

The first release establishes a reliable messaging foundation: cross-instance delivery, shared presence and typing, durable offline messages, duplicate-safe retries, and automatic reconnection. Operators receive per-instance metrics and documented recovery procedures.

Release success depends on demonstrated correctness and performance under load. Visual completeness alone is insufficient for release approval.

## 2. Problem and opportunity

A chat service loses user trust when messages disappear, retries create duplicates, or online indicators remain stale after a failure. Running multiple application instances introduces additional failure modes: participants can connect to different servers, process-local state becomes incomplete, and restarting a server disconnects its users.

convoX must make these deployment boundaries invisible to participants. A message accepted by the service must remain available even when the accepting instance stops. Reconnecting participants must resume their conversations without manually refreshing, switching servers, or reconstructing missing history.

The release addresses reliability at a defined operating envelope. Multi-region operation and broader collaboration features are outside this release.

## 3. Goals and success measures

| Goal | Release measure |
| --- | --- |
| Preserve message integrity | No missing accepted messages or duplicate stored/visible messages in the correctness and failure test suite. |
| Deliver promptly across instances | Cross-instance delivery p95 below 500 ms during the specified sustained-load runs. |
| Recover from one instance failing | Affected clients reconnect elsewhere, synchronize, and resume messaging in under 10 seconds. |
| Keep presence trustworthy | Users with no surviving connection appear offline within 30 seconds of an instance crash. |
| Demonstrate usable capacity | 500–1,000 concurrent connections across three instances and 50–100 new messages/second sustained for five minutes. |
| Support operation and diagnosis | Connections, message throughput, and delivery latency are observable separately for each instance. |

These are release acceptance targets, not claims about an implemented system. A long-term availability commitment requires a defined hosting topology, dependency guarantees, and an operational observation period; it is not established by a five-minute load test.

## 4. Users and jobs to be done

| User | Job to be done | Expected outcome |
| --- | --- | --- |
| Active participant | Exchange messages and see whether the other participant is available. | Messages and activity indicators work regardless of server placement. |
| Returning participant | Resume a conversation after being offline. | Missed messages appear without gaps or duplicate entries. |
| Participant on an unstable connection | Retry a send without creating another message. | The original send resolves to one conversation entry. |
| Service operator | Identify failures and maintain the service. | Per-instance behavior is visible and a server can be restarted without losing accepted messages. |

## 5. Release scope

### 5.1 Included

- Browser-based, authenticated, one-to-one text messaging.
- Conversation access restricted to its participants.
- Persistent conversation history and offline catch-up.
- Multiple simultaneous connections per user, including multiple browser tabs.
- Shared online/offline and typing indicators.
- Connection status, send status, retry feedback, and automatic recovery in the client.
- Three identical application instances behind one load-balanced endpoint.
- Operational metrics, deployment instructions, and evidence for release targets.

Participants must authenticate, select another participant, and start or resume an authorized conversation. Authentication implementation and participant lookup are specified in the API and architecture documents.

### 5.2 Excluded

Group conversations, attachments, message editing/deletion, full-text search, read receipts, push notifications, native mobile applications, end-to-end encryption, and multi-region deployment.

Automatic failover of shared storage or routing infrastructure is not included in the single-application-instance recovery target. Safe behavior during dependency outages remains required.

### 5.3 Approved first-release decisions (2026-10-24)

The owner selected TLS-protected, server-readable text. HTTPS/WSS protects deployed traffic; the service and authorized database operators can read stored content. E2EE, cryptographic device linking/revocation and key recovery remain excluded. Simultaneous authenticated browser tabs/devices remain included under FR-12. The legacy API property `encryptedPayload` continues to carry the exact supplied text string; its name is not an encryption guarantee. Existing opaque test records are preserved without conversion, and no destructive migration is needed for this decision.

Discovery uses an exact username, not a directory listing. Usernames remain editable subject to normalization and uniqueness. Verified email is required before user discovery or chat; existing users retain login and receive a verification path. Email-verification gates, account resend and SMTP password recovery are implemented. Successful password reset revokes all sessions, retains the existing password policy and requires fresh sign-in; browser username selection/editing remains a later task. Real SMTP credentials and deployment TLS remain configuration requirements.

Messages and identities remain stored until an explicitly approved deletion process; no automatic purge is authorized. Catch-up covers all retained history. Daily encrypted database backups with seven-day retention target RPO <=24 hours and RTO <=4 hours. These objectives require measured backup/restore evidence before deployment. Database-disaster restoration may lose messages after the backup cutoff and is distinct from the no-loss guarantee for one application instance failing with shared storage available.

Malformed recovery cursors must fail explicitly; ahead-of-head or history that cannot satisfy a cursor must not appear successfully synchronized. Restoration invalidates old recovery positions, and clients must rebuild from retained canonical history. Specific error/reset contracts and the current implementation gaps are recorded in [recovery boundaries](docs/architecture.md) and [database policy](docs/database.md); their implementation is required before release. Any future deletion must preserve the ordering/retry contract or explicitly invalidate affected recovery positions.

## 6. Core user journeys

### 6.1 Live conversation

A participant opens an authorized conversation, sees available history, and sends a text message. The recipient receives it even when connected to a different server. Both participants see consistent conversation order, presence, and typing state.

**Acceptance:** A sender on instance 1 and a recipient on instance 3 exchange messages and activity updates through the same public service.

### 6.2 Offline recipient

A participant sends messages while the recipient is disconnected. The service confirms acceptance after durable storage. When the recipient returns, the client retrieves missed messages and transitions into live updates.

**Acceptance:** Messages sent before and during catch-up appear once, in conversation order, on a recipient connected to any healthy instance.

### 6.3 Uncertain send and retry

A connection drops before the sender receives confirmation. The client preserves the identity of the original send and retries it. The service resolves the retry to the original message if it was already accepted.

**Acceptance:** An original send plus three retries, including concurrent retries on different instances, produces one stored message and one visible entry.

### 6.4 Instance failure

An instance stops abruptly during an active conversation. Affected clients show a reconnecting state, connect to a healthy instance, recover missing history, and resume messaging. Other users continue using the service.

**Acceptance:** Recovery completes within the defined 10-second limit. Users who remain disconnected appear offline within 30 seconds; stale cleanup does not mark reconnected users offline.

## 7. Functional requirements

All requirements in this section are required for release.

| ID | Capability | Required behavior |
| --- | --- | --- |
| FR-01 | Identity and authorization | Authenticate connections and operations. Derive sender identity from the authenticated session. Restrict messages, history, presence, and typing subscriptions to authorized participants. |
| FR-02 | Message acceptance | Confirm acceptance only after durable storage. Assign each accepted message a stable identity. Acceptance means the service owns persistence and recovery; it does not mean the recipient has read the message. |
| FR-03 | Live delivery | Deliver to connected recipients across all three instances. An accepted message remains recoverable if live routing fails. |
| FR-04 | Retry idempotency | Preserve a logical send identifier across retries and reconnects. Sequential or concurrent retries resolve to the same stored message and canonical response, including after an instance restart. Reject reuse of that identifier with different content or destination. |
| FR-05 | Conversation order | Provide a deterministic order within each conversation, including concurrent sends and recovered history. Do not require ordering across unrelated conversations. |
| FR-06 | History and catch-up | Provide bounded, paginated history and resumable catch-up from a confirmed position. Joining replay to live delivery must not introduce gaps or duplicate visible entries. |
| FR-07 | Recovery boundaries | Handle invalid or expired recovery positions explicitly. Never report successful synchronization when retained history cannot satisfy the request. Define the supported recovery window before implementation. |
| FR-08 | Reconnection | Automatically reconnect to any healthy instance, restore authorized subscriptions, reconcile pending sends, and recover missed messages. Retries must be bounded and staggered to prevent a reconnect surge. |
| FR-09 | Presence | A user is online while at least one authenticated connection is live. State must be shared across instances, expire after lost liveness, and survive races between old-session cleanup and new connections. Presence must not gate message persistence. |
| FR-10 | Typing | Send typing updates across instances, clear them on stop or inactivity, and expire stale state after disconnect or crash. Do not persist or replay typing events as conversation history. |
| FR-11 | Client feedback | Distinguish connecting, connected, reconnecting, and unavailable states. Distinguish pending, accepted, and failed sends. Preserve uncertain sends for reconciliation rather than labeling them definitively rejected. |
| FR-12 | Multiple connections | Closing one connection must not mark a user offline while another remains live. Each authorized active view must reconcile live and replayed messages without duplicate entries. |

Duplicate-safe processing is a user-visible guarantee. The transport may deliver events more than once; the protocol must reconcile repeated events into one message effect.

## 8. User experience requirements

- Reconnection and history synchronization must happen automatically without server selection or a manual page refresh.
- A send action must provide immediate pending feedback. The interface must not show acceptance before server confirmation.
- Retry actions must reuse the original logical send rather than silently create another message.
- Connection failures and synchronization limits must have actionable, plain-language feedback.
- Presence represents connectivity, not proof that a person is reading. Typing state must not remain visible indefinitely after activity stops.
- Core conversation controls must support keyboard use, visible focus, labeled inputs, and accessible status announcements. Status must not rely on color alone.

Exact visual design and copy belong in the interface design, subject to these behaviors.

## 9. Non-functional requirements

### 9.1 Performance and capacity

| ID | Requirement | Measurement boundary |
| --- | --- | --- |
| NFR-01 | Three identical application instances behind a load balancer. | Record the deployed version and actual connection distribution. All three instances must carry connections. |
| NFR-02 | Baseline: 500 connections at 50 new messages/second for five minutes. Upper profile: 1,000 connections at 100 new messages/second for five minutes. | Run each profile after warm-up. Distinguish offered load, accepted logical messages, retries, and completed deliveries. |
| NFR-03 | Cross-instance delivery p95 below 500 ms under both profiles. | Sender test client initiates send → connected recipient test client receives message. Measure with a common monotonic clock or document clock error. |
| NFR-04 | Recovery from an application-instance failure below 10 seconds. | Failure injection → each affected client has reconnected elsewhere, completed catch-up, and demonstrated a successful send and receive. Test within the supported recovery window and load envelope. |
| NFR-05 | Crash-induced stale presence clears within 30 seconds. | Failure injection → observer receives offline state for users without a surviving or re-established connection. |

Offline waiting time is excluded from live-delivery latency and reported separately. Report missing deliveries and timeouts alongside percentiles; excluding failed samples must not conceal a failing target.

### 9.2 Reliability and data integrity

- No accepted message may be lost because one application instance stops abruptly.
- Deduplication and recovery guarantees must hold across instance boundaries and restarts, rather than depending on one process's memory.
- The load balancer must remove unhealthy instances from new traffic. Planned shutdown must stop new traffic and drain or recover existing connections within a documented deadline.
- Storage failure must not produce a false acceptance acknowledgement. Ambiguous outcomes must remain safe to retry.
- Routing failure must not destroy durable history. Presence dependency failures must expose unknown/unavailable state rather than fabricated certainty.
- Bound response sizes, connection buffers, and work per request. Slow consumers must have explicit disconnect and recovery behavior.
- Define retention, deletion, backup, and restore behavior before deployment. Recovery promises must match those policies.

### 9.3 Security and privacy

- Encrypt deployed client traffic and validate authentication, authorization, payloads, and browser origins at their trust boundaries.
- Define and enforce message-size, send-rate, and connection limits, with client-visible errors.
- Keep secrets out of version control. Exclude credentials and message bodies from operational logs by default.
- Do not expose conversations or activity indicators to unauthorized users.
- Document known security limitations. End-to-end encryption is not implied by encrypted transport.

### 9.4 Operability

Expose active connections, newly accepted messages per second, and delivery-latency distributions separately for every instance. Include error, retry, and reconnect signals sufficient to investigate failed targets.

Structured logs must identify the serving instance and support tracing an accepted message through routing and recovery without logging its body. Metric labels must avoid unbounded user, message, and conversation identifiers.

Document health/readiness checks, deployment, rollback compatibility, graceful shutdown, dependency outage handling, and backup restoration.

## 10. Validation and release gates

| Gate | Required evidence |
| --- | --- |
| Correctness | Unit and integration results covering authorization, ordering, concurrent retries, lost acknowledgements, offline delivery, and replay/live races. Verify both stored records and visible conversation entries. |
| Distributed behavior | Participants on different instances exchange messages, presence, and typing; multiple connections preserve correct presence. |
| Load | Both five-minute profiles meet throughput and cross-instance latency targets. Report latency distributions, errors, delivery accounting, and per-instance resource usage. |
| Failure recovery | Abruptly terminate an instance during traffic, an in-flight send, and replay. Verify recovery while it remains down, presence expiry for disconnected clients, and safe rejoining after restart. Report worst-case client recovery as well as percentiles. |
| Dependency safety | Storage/routing outages and slow-client tests exhibit documented behavior without false acceptance, unauthorized access, or silent loss. |
| Operational readiness | Required metrics are available for all instances; deployment, restart, rollback, and restore procedures are documented and exercised where applicable. |
| Documentation | The artifacts in Section 13 are complete and consistent with the deployed version. |

Every report must identify the tested commit, tools and versions, hardware, network setup, topology, configuration, workload, raw results, and known limitations. Record what slowed down first using observed evidence. If no bottleneck appears at the required load, state that and identify any separate capacity test clearly.

Release requires recorded passing results against every gate and documentation of known limitations. Targets must not be marked passed from implementation inspection alone.

## 11. Dependencies, risks, and decisions

| Risk | User or operational impact | Required resolution |
| --- | --- | --- |
| Routing notifications are lost | A connected participant misses a live update. | Define durable recovery and reconciliation independent of notification success. |
| Old connection cleanup races with reconnect | A live user appears offline. | Validate presence ownership and expiration under concurrent sessions. |
| Replay overlaps live traffic | Messages disappear or appear twice. | Define and test the recovery boundary and ordering contract. |
| Reconnect surge overloads healthy instances | One failure becomes a wider outage. | Verify staggered retries and remaining-instance capacity at the target load. |
| Retention is shorter than promised recovery | Returning users cannot obtain expected history. | Keep retention and recovery guarantees consistent and test expired-history behavior. |
| Shared dependency fails | Multiple application instances lose service together. | Fail safely, expose dependency health, and document recovery procedures. Shared-dependency automatic failover is outside this release. |

### Architecture decision records

The architecture documentation must explain the following choices and their effect on the requirements:

1. **Cross-instance routing:** pub/sub, a message broker, or a connection registry?
2. **Shared presence:** where does it live, and how do stale entries expire?
3. **Load balancing:** sticky sessions or no affinity, and what transport constraints apply?
4. **Reconnect synchronization:** how do client and server agree on what was missed?

Each ADR must record alternatives, the chosen approach, failure behavior, consequences, and supporting evidence. Stack selection and implementation design belong in the architecture document; this PRD does not select infrastructure by implication.

## 12. Delivery milestones

| Milestone | Exit condition |
| --- | --- |
| Product and design baseline | Four ADRs, protocol/data contracts, and deployment design document how the requirements will be met. |
| Reliable messaging | Authenticated cross-instance sends, durable history, and duplicate-safe retries pass correctness tests. |
| Continuity and activity | Offline recovery, replay/live synchronization, presence, and typing pass integration and failure tests. |
| Operational readiness | Three-instance deployment, observability, health checks, security controls, and recovery procedures are ready. |
| Release qualification | Load and restart targets pass; reports and documentation match the release candidate. |

The implementation budget is 18–22 build days. Delivery is complete when the release gates pass.

## 13. Required release artifacts

| Artifact | Required contents |
| --- | --- |
| Repository | Incremental commit history, implementation, tests, reproducible configuration, and dependency lockfiles. |
| README | Product overview, prerequisites, local execution, three-instance setup, configuration, test commands, and deployment instructions. |
| PRD | Product scope, requirements, acceptance criteria, and a concise note of any deviations from the original project brief. Git records document history. |
| Architecture document | Component, data-flow, and deployment diagrams; dependency boundaries and failure paths. |
| Four ADRs | One decision record for each architecture question in Section 11. |
| API documentation | OpenAPI/Swagger for HTTP APIs with examples; real-time event contracts, authentication, errors, acknowledgements, retries, and recovery. |
| Database documentation | Schema, relationships, constraints, indexes, and the queries those indexes serve. |
| CONCEPTS.md | The author's own explanation of the concepts on which the system depends. |
| ERRORS.md | Observed errors, causes, fixes, and prevention; clearly distinguish anticipated failure modes. |
| Test report | Unit and integration setup, commands, results, tested version, and limitations. |
| Load and recovery report | Every capacity, latency, and restart target, including tooling, setup, measured numbers, and first observed bottleneck. |

Operational procedures may live in the README or architecture document; a separate document is unnecessary if those procedures remain easy to find.

