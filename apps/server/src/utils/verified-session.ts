import type { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";

export async function getVerifiedSession(request: Request, response: Response, signInMessage: string) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

  if (!session) {
    response.status(401).json({ error: signInMessage });
    return null;
  }

  if (!session.user.emailVerified) {
    response.status(403).json({
      code: "EMAIL_NOT_VERIFIED",
      error: "Verify your email before using chat.",
    });
    return null;
  }

  return session;
}
