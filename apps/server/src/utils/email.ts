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

export async function sendVerificationEmail(email: string, url: string) {
  if (!transport || !config.SMTP_FROM) throw new Error("Email delivery is not configured.");
  const result = await transport.sendMail({
    from: config.SMTP_FROM,
    to: email,
    subject: "Verify your convoX email",
    text: `Verify your email before starting a conversation:\n\n${url}\n\nThis link expires in one hour and can be used once. If you did not request this, ignore this email.`,
  });
  if (result.accepted.length !== 1) throw new Error("Email was not accepted.");
}
