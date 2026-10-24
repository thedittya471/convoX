# convoX web

Next.js frontend for login, signup, account email verification, username setup/editing and password recovery. The chat synchronization and IndexedDB outbox modules exist in `src/lib/`; a conversation UI is not implemented yet.

Run setup and checks from the repository root using pnpm. See the [root README](../../README.md) for environment setup, local development, SMTP capture and the Compose stack. See the [codebase guide](../../docs/codebase.md) for file responsibilities and the message flow.

- `src/app/`: routes, account page and shared styles/layout.
- `src/components/auth-form.tsx`: login/signup form.
- `src/components/start-conversation.tsx`: verified-user exact-name lookup and direct conversation opening.
- `src/components/username-form.tsx`: account username setup/editing; signup has an optional username field in `auth-form.tsx`.
- `src/components/password-recovery-form.tsx`: password reset request and submission forms.
- `src/lib/auth-client.ts`: Better Auth browser client.
- `src/lib/chat-client.ts`: ordered history/live synchronization and retry handling.
- `src/lib/message-outbox.ts`: persistent pending sends.
- `tests/chat-client.mjs`: synchronization regression tests with an isolated local-storage implementation.

Read the installed Next.js documentation referenced by `AGENTS.md` before changing framework APIs.
