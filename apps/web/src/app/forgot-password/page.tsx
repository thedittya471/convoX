import type { Metadata } from "next";
import { Suspense } from "react";
import { PasswordRecoveryForm } from "@/components/password-recovery-form";

export const metadata: Metadata = { title: "Forgot password | convoX" };

export default function ForgotPasswordPage() {
  return <Suspense fallback={<p role="status">Loading password recovery…</p>}><PasswordRecoveryForm mode="request" /></Suspense>;
}
