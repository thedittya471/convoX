import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  instanceId: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
