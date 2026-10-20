CREATE TABLE "message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"client_message_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"encrypted_payload" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_sequence_positive" CHECK ("message"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "message_outbox" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp (3) with time zone
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "last_message_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_sender_client_idx" ON "message" USING btree ("sender_id","client_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_conversation_sequence_idx" ON "message" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "message_outbox_pending_idx" ON "message_outbox" USING btree ("created_at","message_id") WHERE "message_outbox"."published_at" IS NULL;
