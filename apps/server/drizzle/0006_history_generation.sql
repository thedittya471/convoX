CREATE TABLE "history" (
  "singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
  "generation" uuid DEFAULT gen_random_uuid() NOT NULL,
  CONSTRAINT "history_singleton" CHECK ("singleton" = true)
);
--> statement-breakpoint
INSERT INTO "history" ("singleton") VALUES (true);
