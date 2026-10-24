"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export function PasswordRecoveryForm({ mode }: { mode: "request" | "reset" }) {
  const reset = mode === "reset";
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const invalidLink = reset && (!token || searchParams.has("error"));
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting || invalidLink) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setError("");

    if (reset && fields.get("password") !== fields.get("confirmation")) {
      setError("The passwords do not match. Please enter them again.");
      return;
    }
    setSubmitting(true);

    try {
      const result = reset
        ? await authClient.resetPassword({ token: token!, newPassword: String(fields.get("password") ?? "") })
        : await authClient.requestPasswordReset({
          email: String(fields.get("email") ?? "").trim(),
          redirectTo: `${window.location.origin}/reset-password`
        });

      if (result.error) {
        if (result.error.status === 429) setError("Too many attempts. Wait a minute before trying again.");
        else if (result.error.status >= 500) setError("The server is temporarily unavailable. Please try again.");
        else if (reset) setError("This link is invalid, expired or already used. Request a new link, and use a password with 12–128 characters.");
        else setError("Check your email address and try again.");
        return;
      }
      form.reset();
      setComplete(true);

      if (reset) window.history.replaceState(null, "", "/reset-password");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="recovery-heading">
        <Link className="brand" href="/login">convo<span>X</span></Link>
        <h1 id="recovery-heading">{reset ? "Reset your password" : "Forgot your password?"}</h1>
        {complete ? (
          <p className="muted" role="status">{reset
            ? "Your password has been reset and all sessions have been signed out. Sign in with your new password."
            : "If an account exists for this email, we’ll send a reset link. Check your inbox and spam folder. The link expires in one hour. If no email arrives, try again later."}</p>
        ) : invalidLink ? (
          <p className="muted" role="alert">This reset link is missing or invalid. Request a new link to continue.</p>
        ) : (
          <>
            <p className="muted">{reset ? "Choose a new password with 12–128 characters. Resetting signs out all existing sessions." : "Enter your account email to request a password reset link."}</p>
            <form onSubmit={submit} aria-busy={submitting}>
              <fieldset disabled={submitting}>
                {reset ? (
                  <>
                    <div className="form-field">
                      <label htmlFor="password">New password</label>
                      <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
                    </div>
                    <div className="form-field">
                      <label htmlFor="confirmation">Confirm new password</label>
                      <input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
                    </div>
                  </>
                ) : (
                  <div className="form-field">
                    <label htmlFor="email">Email</label>
                    <input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required />
                  </div>
                )}
                {error && <p ref={errorRef} tabIndex={-1} role="alert" className="form-error">{error}</p>}
                <button className="primary-button" type="submit">{submitting ? "Please wait…" : reset ? "Reset password" : "Send reset link"}</button>
              </fieldset>
            </form>
          </>
        )}
        {reset && !complete && <p className="muted"><Link href="/forgot-password">Request a new reset link</Link></p>}
        {/* A fresh page load discards cached session state after revocation. */}
        <p className="muted"><a href="/login">Back to sign in</a></p>
      </section>
    </main>
  );
}
