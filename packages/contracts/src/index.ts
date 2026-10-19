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

export const createConversationSchema = z.object({
  otherUserId: z.string().min(1).max(128),
}).strict();

export const conversationCursorSchema = z.string().max(80)
  .transform((value) => value.split("_"))
  .pipe(z.tuple([z.iso.datetime({ precision: 3 }), z.uuid()]));

export const conversationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: conversationCursorSchema.optional(),
}).strict();

export const conversationSchema = z.object({
  id: z.uuid(),
  type: z.enum(["direct", "group"]),
  createdAt: z.iso.datetime({ precision: 3 }),
  peer: publicUserSchema.extend({ username: usernameSchema.nullable() }).nullable(),
});

export const conversationResponseSchema = z.object({ conversation: conversationSchema });
export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
});
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;
