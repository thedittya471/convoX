import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  instanceId: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const usernameSchema = z.string().toLowerCase().min(3).max(30).regex(/^[a-z0-9_.]+$/);

export const publicUserSchema = z.object({
  id: z.string().min(1),
  username: usernameSchema,
  name: z.string(),
});

export const userLookupResponseSchema = z.object({ user: publicUserSchema });
export type PublicUser = z.infer<typeof publicUserSchema>;
