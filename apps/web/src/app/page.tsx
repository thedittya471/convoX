"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { StartConversation } from "@/components/start-conversation";
import { UsernameForm } from "@/components/username-form";
import { authClient } from "@/lib/auth-client";

function Account() {
  const verification = useSearchParams().get("verification");
  const router = useRouter();
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const [sendingVerification, setSendingVerification] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    if (!isPending && !error && !session) router.replace(window.location.search.includes("verification=") ? "/login?verification=check" : "/login");
  }, [isPending, error, session, router]);

  async function resendVerification() {
    if (!session || sendingVerification) return;
    setSendingVerification(true);
    setVerificationMessage("");
    setVerificationError("");
    try {
      const result = await authClient.sendVerificationEmail({ email: session.user.email, callbackURL: "/" });
      if (result.error) {
        setVerificationError(result.error.status === 429 ? "Too many requests. Wait a minute before trying again." : "Could not send the email. Please try again.");
      } else {
        setVerificationMessage("Verification email sent. Check your inbox and spam folder. The link expires in one hour.");
      }
    } catch {
      setVerificationError("Could not reach the server. Please try again.");
    } finally {
      setSendingVerification(false);
    }
  }

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

  let content;
  if (isPending) {
    content = <p role="status">Checking your session…</p>;
  } else if (error) {
    content = (
      <>
        <h1 id="home-heading">Connection interrupted</h1>
        <p role="alert">We couldn’t check your session. Please try again.</p>
        <button className="primary-button" onClick={() => void refetch()}>Try again</button>
      </>
    );
  } else if (session) {
    content = (
      <>
        <p className="eyebrow">Your account</p>
        <h1 id="home-heading">Welcome, {session.user.name}</h1>
        <p className="muted wrap-break-word">Signed in as {session.user.email}</p>
        <div className="account-notice">
          {session.user.emailVerified ? (
            <><h2>Email verified.</h2><p>Your account is ready. Find someone below to open a conversation.</p></>
          ) : (
            <>
              <h2>Verify your email</h2>
              <p>Check your inbox for a verification link. You can sign in, but you must verify your email before finding people or using chat.</p>
              <button className="primary-button" onClick={resendVerification} disabled={sendingVerification}>
                {sendingVerification ? "Sending…" : "Resend verification email"}
              </button>
              <button className="primary-button" onClick={() => void refetch()}>I’ve verified — check again</button>
            </>
          )}
        </div>
        {session.user.emailVerified && <StartConversation key={session.user.id} userId={session.user.id} />}
        <UsernameForm key={session.user.id} username={session.user.username} />
        {verification === "invalid" && <p role="alert">This verification link expired or was already used. If your email is still unverified, request a new link.</p>}
        {verificationMessage && <p role="status">{verificationMessage}</p>}
        {verificationError && <p role="alert" className="form-error">{verificationError}</p>}
        {signOutError && <p role="alert" className="form-error">{signOutError}</p>}
        <button className="primary-button" onClick={signOut} disabled={signingOut}>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </>
    );
  } else {
    content = <p role="status">Taking you to sign in…</p>;
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-label="Your account">
        <p className="brand">convo<span>X</span></p>
        {content}
      </section>
    </main>
  );
}

export default function Home() {
  return <Suspense fallback={<p role="status">Checking your account…</p>}><Account /></Suspense>;
}
