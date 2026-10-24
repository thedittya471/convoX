import nodemailer from "nodemailer";
import { config } from "./config.js";

const transport = config.SMTP_HOST ? nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_TLS === "implicit",
  requireTLS: config.SMTP_TLS === "starttls",
  ignoreTLS: config.SMTP_TLS === "local",
  ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {}),
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 10000,
  disableFileAccess: true,
  disableUrlAccess: true,
}) : null;

export function sendVerificationEmail(email: string, url: string) {
  return sendEmail(email, "Verify your convoX email", `Verify your email before starting a conversation:\n\n${url}\n\nThis link expires in one hour and can be used once. If you did not request this, ignore this email.`);
}

export function sendPasswordResetEmail(email: string, url: string) {
  return sendEmail(email, "Reset your convoX password", `Reset your password:\n\n${url}\n\nThis link expires in one hour and can be used once. Resetting your password signs out all sessions. If you did not request this, ignore this email; your password has not changed.`);
}

async function sendEmail(email: string, subject: string, text: string) {
  if (!transport || !config.SMTP_FROM) throw new Error("Email delivery is not configured.");
  const result = await transport.sendMail({ from: config.SMTP_FROM, to: email, subject, text });
  if (result.accepted.length !== 1) throw new Error("Email was not accepted.");
}
