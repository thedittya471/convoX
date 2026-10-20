import { setTimeout as sleep } from "node:timers/promises";
import { asc, eq, isNull } from "drizzle-orm";
import type { Message } from "@convox/contracts";
import { db } from "../db/client.js";
import { conversation } from "../db/schema/conversation.schema.js";
import { message, messageOutbox } from "../db/schema/message.schema.js";
import { serializeMessage } from "./messages.service.js";
import { config } from "../utils/config.js";

type PublishMessage = (message: Message, participants: string[]) => Promise<void>;

export async function publishNextMessage(publish: PublishMessage) {

  return db.transaction(async (transaction) => {

    const [pending] = await transaction.select({ message, conversation })
      .from(messageOutbox)
      .innerJoin(message, eq(message.id, messageOutbox.messageId))
      .innerJoin(conversation, eq(conversation.id, message.conversationId))
      .where(isNull(messageOutbox.publishedAt))
      .orderBy(asc(messageOutbox.createdAt), asc(messageOutbox.messageId))
      .limit(1)
      .for("update", { of: messageOutbox, skipLocked: true });

    if (!pending) {
      return false;
    }

    await publish(serializeMessage(pending.message), [pending.conversation.directUserLowId, pending.conversation.directUserHighId]);
    await transaction.update(messageOutbox).set({ publishedAt: new Date() }).where(eq(messageOutbox.messageId, pending.message.id));

    return true;
  });
}

export function startOutboxPublisher(publish: PublishMessage) {

  let stopped = false;
  const running = (async () => {

    while (!stopped) {
      try {
        if (!await publishNextMessage(publish)) {
          await sleep(100);
        }

      } catch {
        console.error(JSON.stringify({ event: "outbox_publish_failed", instanceId: config.INSTANCE_ID }));
        await sleep(1000);
      }
    }
  })();

  return async () => {
    stopped = true;
    await running;
  };
}
