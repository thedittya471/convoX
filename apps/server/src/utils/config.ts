import { z } from "zod";

const configSchema = z.object({
  CHAT_IP_PER_MINUTE: z.coerce.number().int().min(1).max(1000000).default(300),
  CHAT_SENDS_PER_MINUTE: z.coerce.number().int().min(1).max(1000000).default(120),
  CHAT_LOOKUPS_PER_MINUTE: z.coerce.number().int().min(1).max(1000000).default(60),
  CHAT_OPENS_PER_MINUTE: z.coerce.number().int().min(1).max(1000000).default(30),
  CHAT_READS_PER_MINUTE: z.coerce.number().int().min(1).max(1000000).default(120),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.email().optional(),
  SMTP_TLS: z.enum(["starttls", "implicit", "local"]).default("starttls"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  INSTANCE_ID: z.string().min(1).default("local"),
  DATABASE_URL: z.url().refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol)),
  REDIS_URL: z.url().refine((value) => ["redis:", "rediss:"].includes(new URL(value).protocol)).default("redis://localhost:56379"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
}).superRefine((value, context) => {
  if (value.SMTP_HOST && !value.SMTP_FROM) context.addIssue({ code: "custom", path: ["SMTP_FROM"], message: "A sender is required." });
  if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) context.addIssue({ code: "custom", path: ["SMTP_USER"], message: "Both SMTP credentials are required." });
  if (value.SMTP_TLS === "local" && (!['localhost', '127.0.0.1', 'mailpit'].includes(value.SMTP_HOST ?? '') || new URL(value.BETTER_AUTH_URL).protocol !== "http:")) {
    context.addIssue({ code: "custom", path: ["SMTP_TLS"], message: "Unencrypted SMTP is restricted to local development." });
  }
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(JSON.stringify({
    event: "invalid_configuration",
    fields: parsed.error.issues.map((issue) => issue.path.join("."))
  }));

  process.exit(1);
}

export const config = parsed.data;
