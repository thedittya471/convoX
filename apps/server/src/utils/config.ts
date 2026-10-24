import { isIP } from "node:net";
import { z } from "zod";

const defaultProxies = "127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,::1/128,fc00::/7,fe80::/10";
const configSchema = z.object({
  DEPLOYMENT_MODE: z.enum(["development", "production"]).default("development"),
  TRUSTED_PROXY_CIDRS: z.string().max(2048).default(defaultProxies).refine((value) => {
    const entries = value.split(",");
    return entries.length <= 32 && entries.every((entry) => {
      const parts = entry.trim().split("/");
      const version = isIP(parts[0]);
      if (version === 0 || parts.length > 2) {
        return false;
      }
      if (parts.length === 1) {
        return true;
      }

      const prefix = parts[1];
      const maxPrefix = version === 4 ? 32 : 128;
      return /^\d+$/.test(prefix) && Number(prefix) <= maxPrefix;
    });
  }),
  METRICS_TOKEN: z.string().min(32).optional(),
  SOCKET_USER_LIMIT: z.coerce.number().int().min(1).max(10000).default(10),
  SOCKET_IP_LIMIT: z.coerce.number().int().min(1).max(100000).default(100),
  SOCKET_OUTBOUND_BYTES: z.coerce.number().int().min(16384).max(16777216).default(262144),
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
  if (value.DEPLOYMENT_MODE === "production") {
    const invalid = (field: string) => context.addIssue({ code: "custom", path: [field], message: "Invalid production configuration." });
    const origin = new URL(value.BETTER_AUTH_URL);

    if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) {
      invalid("BETTER_AUTH_URL");
    }

    if (value.BETTER_AUTH_SECRET.length < 48) {
      invalid("BETTER_AUTH_SECRET");
    }

    if (!value.METRICS_TOKEN || value.METRICS_TOKEN === value.BETTER_AUTH_SECRET) {
      invalid("METRICS_TOKEN");
    }

    if (!value.SMTP_HOST || value.SMTP_TLS === "local") {
      invalid("SMTP_HOST");
    }

    for (const field of ["DATABASE_URL", "REDIS_URL"] as const) {
      try {
        const password = decodeURIComponent(new URL(value[field]).password);

        if (!password || ["convox_dev", "password", "change-me"].includes(password)) {
          invalid(field);
        }
      } catch {
        invalid(field);
      }
    }

    if (value.TRUSTED_PROXY_CIDRS === defaultProxies || value.TRUSTED_PROXY_CIDRS.split(",").some((entry) => entry.trim().endsWith("/0"))) {
      invalid("TRUSTED_PROXY_CIDRS");
    }
  }

  if (value.SMTP_HOST && !value.SMTP_FROM) {
    context.addIssue({ code: "custom", path: ["SMTP_FROM"], message: "A sender is required." });
  }

  if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) {
    context.addIssue({ code: "custom", path: ["SMTP_USER"], message: "Both SMTP credentials are required." });
  }

  if (value.SMTP_TLS === "local" && (!['localhost', '127.0.0.1', 'mailpit'].includes(value.SMTP_HOST ?? '') || new URL(value.BETTER_AUTH_URL).protocol !== "http:")) {
    context.addIssue({
      code: "custom",
      path: ["SMTP_TLS"],
      message: "Unencrypted SMTP is restricted to local development."
    });
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
