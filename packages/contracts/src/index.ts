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
  type: z.literal("direct"),
  createdAt: z.iso.datetime({ precision: 3 }),
  peer: publicUserSchema.extend({ username: usernameSchema.nullable() }),
});

export const conversationResponseSchema = z.object({ conversation: conversationSchema });
export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
});
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export const createMessageSchema = z.object({
  clientMessageId: z.uuid(),
  encryptedPayload: z.string().min(1).max(8192),
}).strict();

export const messageSequenceSchema = z.string().max(19).regex(/^(0|[1-9]\d{0,18})$/)
  .refine((value) => value.length < 19 || value <= "9223372036854775807");

export const messageListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  after: messageSequenceSchema.optional(),
  before: messageSequenceSchema.refine((value) => value !== "0").optional(),
  recent: z.literal("true").optional(),
}).strict().refine((value) => [value.after, value.before, value.recent].filter((item) => item !== undefined).length <= 1,
  "Choose only one pagination mode").transform((value) =>
  value.before === undefined && value.recent === undefined ? { ...value, after: value.after ?? "0" } : value);

export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  senderId: z.string().min(1),
  clientMessageId: z.uuid(),
  sequence: messageSequenceSchema.refine((value) => value !== "0"),
  encryptedPayload: z.string().min(1).max(8192),
  createdAt: z.iso.datetime({ precision: 3 }),
});

export const messageResponseSchema = z.object({ message: messageSchema });
export const messageListResponseSchema = z.object({
  messages: z.array(messageSchema),
  nextAfter: messageSequenceSchema.nullable(),
});

export const messageHistoryPageSchema = messageListResponseSchema.extend({
  headSequence: messageSequenceSchema,
  nextBefore: messageSequenceSchema.nullable(),
});
export const messageHistoryErrorSchema = z.object({
  code: z.enum(["CURSOR_AHEAD", "HISTORY_UNAVAILABLE"]),
  error: z.string().min(1),
});

export type CreateMessage = z.infer<typeof createMessageSchema>;
export type Message = z.infer<typeof messageSchema>;
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;

export type RealtimeEvents = {
  "message:created": (message: Message) => void;
  "realtime:ready": (value: { instanceId: string; userId: string }) => void;
  "auth:required": () => void;
  "sync:required": () => void;
};
