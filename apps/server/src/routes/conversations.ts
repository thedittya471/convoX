import { Router } from "express";
import { createConversation, getConversations } from "../controllers/conversations.controller.js";
import { sendMessage, getMessages } from "../controllers/messages.controller.js";

export const conversationsRouter = Router();

conversationsRouter.post("/", createConversation);
conversationsRouter.get("/", getConversations);
conversationsRouter.post("/:id/messages", sendMessage);
conversationsRouter.get("/:id/messages", getMessages);
