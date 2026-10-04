CREATE TABLE "financial_goals" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"currency" "currency" NOT NULL,
	"monthly_contribution" numeric(22, 8) NOT NULL,
	"target_kind" text NOT NULL,
	"target_amount" numeric(22, 8) NOT NULL,
	"withdrawal_rate" numeric(22, 8) NOT NULL,
	"conservative_return" numeric(22, 8) NOT NULL,
	"base_return" numeric(22, 8) NOT NULL,
	"optimistic_return" numeric(22, 8) NOT NULL,
	"target_month" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_goals" ADD CONSTRAINT "financial_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;