# Conversation browser qualification (Task 14)

Status: pending. The owner requested script-only checks and no browser execution for Tasks 14–20. Existing Node integration tests do not establish real-cookie, IndexedDB, layout or accessibility behavior. Do not treat this document as a passing test report or release approval.

Use two isolated browser profiles against a disposable, migrated three-replica gateway with a controlled mail sink. Never use production accounts. Record commit, browser/version, viewport, observed results and screenshots on failures. Add a browser runner/CI job only after these cases run deterministically; no runner dependency is added before it can be exercised.

1. Create and verify Alice and Bob, choose usernames, sign in independently, discover the exact peer username and open the same conversation.
2. Send in both directions. Confirm one canonical row per client message ID and accurate pending/server-accepted wording. Reload both profiles and verify recent history and older-page reachability.
3. At a narrow viewport, use keyboard navigation through discovery, chat, older-history loading and the composer. Check visible focus, retained scroll position and readable status feedback. Enter sends, Shift+Enter inserts a newline, and IME composition does not submit.
4. Disconnect Alice from the network, save a draft to the pending queue, reload, reconnect and confirm the original ID is accepted once and the queue clears. Block IndexedDB separately and verify the draft is retained with an actionable error.
5. Open another Alice tab. Sign out or switch accounts in one tab; verify the other clears protected content, stops its old client and never sends Alice’s queued messages as Bob. Test with storage notifications disabled to exercise fallback refresh.
6. Expire/revoke a session on the server and verify protected views clear and pending entries remain owned by their original identity. Test focus return and back/forward navigation.
7. With shared activity implemented, keep two Bob tabs on different replicas: closing one keeps Bob online; closing/crashing the final one clears presence within 30 seconds. Typing stops on send, blur, inactivity, disconnect and view switch; loss of routing reports unavailable.

Release evidence remains incomplete until these scenarios run in actual browsers. Script suites remain the primary automated regression checks while this gate is pending.
