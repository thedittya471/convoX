import { Router } from "express";
import { lookupUser } from "../controllers/users.controller.js";

export const usersRouter = Router();

usersRouter.get("/lookup", lookupUser);
