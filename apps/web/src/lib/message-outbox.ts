import { createMessageSchema, messageHistoryPageSchema, type CreateMessage } from "@convox/contracts";

export type PendingMessage = CreateMessage & {
  queueId: number;
  userId: string;
  conversationId: string;
  error: string | null;
  generation?: string;
};

async function transaction<Result>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<Result>): Promise<Result> {

  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("convox-message-outbox", 1);
    let blocked = false;

    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("pending", { keyPath: "queueId", autoIncrement: true });
      store.createIndex("owner", ["userId", "conversationId"]);
    };
    request.onblocked = () => { blocked = true; reject(new Error("Close other chat tabs to update local storage.")); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });

  return new Promise((resolve, reject) => {
    try {
      const current = database.transaction("pending", mode, { durability: "strict" });
      const request = operation(current.objectStore("pending"));
      current.oncomplete = () => { database.close(); resolve(request.result); };
      current.onabort = () => { database.close(); reject(current.error ?? new Error("Could not update the local outbox.")); };
    } catch (error) {
      database.close();
      reject(error);
    }
  });
}

export async function loadPendingMessages(userId: string, conversationId: string): Promise<PendingMessage[]> {

  const rows = await transaction<PendingMessage[]>("readonly", (store) => store.index("owner").getAll([userId, conversationId]));

  return rows.map((row) => {
    const envelope = createMessageSchema.parse({ clientMessageId: row.clientMessageId, encryptedPayload: row.encryptedPayload });

    if (!Number.isSafeInteger(row.queueId) || row.queueId < 1 || row.userId !== userId || row.conversationId !== conversationId || (row.error !== null && typeof row.error !== "string")) {
      throw new Error("The local message outbox is invalid. Its contents have not been deleted.");
    }

    return { ...envelope, queueId: row.queueId, userId, conversationId, error: row.error,
      ...(row.generation === undefined ? {} : { generation: messageHistoryPageSchema.shape.generation.parse(row.generation) }) };
  });
}

export async function savePendingMessage(message: Omit<PendingMessage, "queueId"> | PendingMessage) {

  const queueId = await transaction<IDBValidKey>("readwrite", (store) => store.put(message));
  return { ...message, queueId: Number(queueId) };
}

export async function removePendingMessage(queueId: number) {

  await transaction("readwrite", (store) => store.delete(queueId));
}
