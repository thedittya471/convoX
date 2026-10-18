"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function Home() {
  const router = useRouter();
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    if (!isPending && !error && !session) router.replace("/login");
  }, [isPending, error, session, router]);

  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setSignOutError("Could not sign out. Please try again.");
        return;
      }
      router.replace("/login");
    } catch {
      setSignOutError("Could not reach the server. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-label="Your account">
        <p className="brand">convo<span>X</span></p>
        {isPending ? <p role="status">Checking your session…</p> : error ? (
          <>
            <h1 id="home-heading">Connection interrupted</h1>
            <p role="alert">We couldn’t check your session. Please try again.</p>
            <button className="primary-button" onClick={() => void refetch()}>Try again</button>
          </>
        ) : session ? (
          <>
            <p className="eyebrow">Your account</p>
            <h1 id="home-heading">Welcome, {session.user.name}</h1>
            <p className="muted break-words">Signed in as {session.user.email}</p>
            <div className="account-notice">
              <h2>You’re all set.</h2>
              <p>Your account is ready. Conversations are coming next.</p>
            </div>
            {signOutError && <p role="alert" className="form-error">{signOutError}</p>}
            <button className="primary-button" onClick={signOut} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </>
        ) : <p role="status">Taking you to sign in…</p>}
      </section>
    </main>
  );
}
