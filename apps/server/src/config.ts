import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  INSTANCE_ID: z.string().min(1).default("local"),
  DATABASE_URL: z.url().refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol)),
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(JSON.stringify({ event: "invalid_configuration", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }));
  process.exit(1);
}

export const config = parsed.data;
