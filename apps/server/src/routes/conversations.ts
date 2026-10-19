import { Router } from "express";
import { createConversation, getConversations } from "../controllers/conversations.controller.js";

export const conversationsRouter = Router();

conversationsRouter.post("/", createConversation);
conversationsRouter.get("/", getConversations);
