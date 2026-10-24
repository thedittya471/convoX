"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { usernameSchema } from "@convox/contracts";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const router = useRouter();
  const { data: session, isPending, error: sessionError, refetch } = authClient.useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (session && !sessionError) router.replace("/");
  }, [session, sessionError, router]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const name = String(fields.get("name") ?? "").trim();
    const email = String(fields.get("email") ?? "").trim();
    const password = String(fields.get("password") ?? "");
    setError("");
    if (signup && !name) {
      setError("Please enter your name.");
      return;
    }
    const requestedUsername = String(fields.get("username") ?? "");
    const parsedUsername = requestedUsername ? usernameSchema.safeParse(requestedUsername) : null;
    if (signup && parsedUsername && !parsedUsername.success) {
      setError("Use 3–30 letters, numbers, underscores or dots for your username.");
      return;
    }
    const username = parsedUsername?.success ? parsedUsername.data : undefined;
    setSubmitting(true);
    try {
      const result = signup
        ? await authClient.signUp.email({ name, email, password, username })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        if (result.error.code === "USERNAME_IS_ALREADY_TAKEN") {
          setError("That username is already taken. Choose another, or leave it blank to set one later.");
        } else if (result.error.status === 429) {
          setError("Too many attempts. Please wait a minute and try again.");
        } else if (result.error.status >= 500) {
          setError("The server is temporarily unavailable. Please try again.");
        } else if (signup) {
          setError("Could not create your account. If you already have an account, sign in instead.");
        } else {
          setError("Could not sign in. Check your email and password and try again.");
        }
        return;
      }
      form.reset();
      router.replace("/");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = signup ? "Create account" : "Sign in";
  const submittingLabel = signup ? "Creating account…" : "Signing in…";

  return (
    <main className="auth-screen">
      <div className="auth-frame">
        <aside className="auth-artwork" aria-label="A little inspiration">
          <p className="artwork-eyebrow">A place to connect <span /></p>
          <div className="artwork-copy">
            <h2>Every great<br />conversation<br />starts here.</h2>
            <p>A familiar face. A new perspective.<br />Make room for meaningful connections.</p>
          </div>
        </aside>
        <section className="auth-panel" aria-labelledby="auth-heading">
          <Link className="auth-wordmark" href="/" aria-label="convoX home">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path d="M7 8h11a7 7 0 0 1 7 7v1a7 7 0 0 1-7 7h-6l-6 4V9a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" />
              <path d="M11 13h9M11 18h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            convoX
          </Link>
          <div className="auth-content">
            <header className="auth-heading">
              <h1 id="auth-heading">{signup ? "Create your account" : "Welcome back"}</h1>
              <p>{signup ? "A few details, and you’re ready to connect." : "Enter your email and password to access your account"}</p>
            </header>
            <Suspense><VerificationNotice /></Suspense>
            {!signup && <p><Link href="/forgot-password">Forgot password?</Link></p>}
            {isPending || (session && !sessionError) ? <p role="status">{session ? "Taking you to your account…" : "Checking your session…"}</p> : sessionError ? (
              <>
                <p role="alert" className="form-error">We couldn’t check your session. Please try again.</p>
                <button className="primary-button" onClick={() => void refetch()}>Try again</button>
              </>
            ) : (
              <form onSubmit={submit} aria-busy={submitting}>
                <fieldset disabled={submitting}>
                  {signup && (
                    <div className="form-field">
                      <label htmlFor="name">Name</label>
                      <input id="name" name="name" autoComplete="name" placeholder="Enter your name" required />
                    </div>
                  )}
                  {signup && (
                    <div className="form-field">
                      <label htmlFor="username">Username (optional)</label>
                      <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" aria-describedby="username-hint" />
                      <p id="username-hint" className="field-hint">Use 3–30 letters, numbers, underscores or dots. Saved in lowercase. People with verified accounts can find your display name by this exact username. You can set or change it later; sign-in still uses your email.</p>
                    </div>
                  )}
                  <div className="form-field">
                    <label htmlFor="email">Email</label>
                    <input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="Enter your email" required />
                  </div>
                  <div className="form-field">
                    <label htmlFor="password">Password</label>
                    <div className="password-field">
                      <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 12 : undefined} maxLength={128} aria-describedby={signup ? "password-hint" : undefined} placeholder={signup ? "Create a password" : "Enter your password"} required />
                      <button className="password-toggle" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="1.5" />
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
                          {showPassword && <path d="m3 3 18 18" stroke="currentColor" strokeWidth="1.5" />}
                        </svg>
                      </button>
                    </div>
                    {signup && <p id="password-hint" className="field-hint">Use 12–128 characters. A passphrase works well.</p>}
                  </div>
                  {error && <p ref={errorRef} tabIndex={-1} role="alert" className="form-error">{error}</p>}
                  <button className="primary-button" type="submit" disabled={submitting}>
                    {submitting ? submittingLabel : submitLabel}
                  </button>
                </fieldset>
              </form>
            )}
          </div>
          <p className="auth-footer">
            {signup ? "Already have an account? " : "Don’t have an account? "}
            <Link href={signup ? "/login" : "/signup"}>{signup ? "Sign in" : "Create an account"}</Link>
          </p>
        </section>
      </div>
    </main>
  );
}

function VerificationNotice() {
  const verification = useSearchParams().has("verification");
  return verification ? <p role="status">Sign in to check your email verification. If the link expired or was already used, request a new one from your account.</p> : null;
}
