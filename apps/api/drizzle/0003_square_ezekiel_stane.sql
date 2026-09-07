ALTER TYPE "public"."asset_class" ADD VALUE 'cash' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "cash_balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"amount" numeric(22, 8) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_balances" ADD CONSTRAINT "cash_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;