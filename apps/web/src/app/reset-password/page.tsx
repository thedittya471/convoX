import type { Metadata } from "next";
import { Suspense } from "react";
import { PasswordRecoveryForm } from "@/components/password-recovery-form";

export const metadata: Metadata = {
  title: "Reset password | convoX",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return <Suspense fallback={<p role="status">Loading password reset…</p>}><PasswordRecoveryForm mode="reset" /></Suspense>;
}
