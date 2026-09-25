CREATE TYPE "public"."corporate_action_kind" AS ENUM('split');--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"kind" "corporate_action_kind" DEFAULT 'split' NOT NULL,
	"effective_at" date NOT NULL,
	"from_quantity" numeric(22, 8) NOT NULL,
	"to_quantity" numeric(22, 8) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_actions_user_ticker_day_key" ON "corporate_actions" USING btree ("user_id","ticker","effective_at");