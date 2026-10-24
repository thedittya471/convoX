"use client";

import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({ sessionOptions: { refetchInterval: 30 }, plugins: [usernameClient({ displayUsername: false })] });
