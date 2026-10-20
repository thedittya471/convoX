LOCK TABLE "conversation", "conversation_member" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "conversation" WHERE "type" = 'group') THEN
    RAISE EXCEPTION 'Group conversations exist; migrate them separately before removing group storage';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "conversation_member";--> statement-breakpoint
ALTER TABLE "conversation" DROP CONSTRAINT "conversation_direct_pair_check";--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "direct_user_low_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "direct_user_high_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_direct_pair_check" CHECK ("conversation"."direct_user_low_id" COLLATE "C" < "conversation"."direct_user_high_id" COLLATE "C");--> statement-breakpoint
DROP TYPE "public"."conversation_type";
