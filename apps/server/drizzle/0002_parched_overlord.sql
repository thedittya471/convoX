CREATE TYPE "public"."conversation_type" AS ENUM('direct', 'group');--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "conversation_type" NOT NULL,
	"direct_user_low_id" text,
	"direct_user_high_id" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_direct_pair_check" CHECK (
    ("conversation"."type" = 'direct' AND "conversation"."direct_user_low_id" IS NOT NULL AND "conversation"."direct_user_high_id" IS NOT NULL
      AND "conversation"."direct_user_low_id" COLLATE "C" < "conversation"."direct_user_high_id" COLLATE "C")
    OR ("conversation"."type" = 'group' AND "conversation"."direct_user_low_id" IS NULL AND "conversation"."direct_user_high_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "conversation_member" (
	"conversation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_member_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_direct_user_low_id_user_id_fk" FOREIGN KEY ("direct_user_low_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_direct_user_high_id_user_id_fk" FOREIGN KEY ("direct_user_high_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_member" ADD CONSTRAINT "conversation_member_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_member" ADD CONSTRAINT "conversation_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_direct_pair_idx" ON "conversation" USING btree ("direct_user_low_id","direct_user_high_id");--> statement-breakpoint
CREATE INDEX "conversation_direct_high_user_idx" ON "conversation" USING btree ("direct_user_high_id");--> statement-breakpoint
CREATE INDEX "conversation_created_idx" ON "conversation" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversation_member_user_idx" ON "conversation_member" USING btree ("user_id","conversation_id");