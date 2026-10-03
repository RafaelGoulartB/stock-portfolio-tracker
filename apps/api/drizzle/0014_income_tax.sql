CREATE TABLE "income_tax_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"start_year" integer NOT NULL,
	"ordinary_loss" numeric(22, 8) DEFAULT '0' NOT NULL,
	"day_trade_loss" numeric(22, 8) DEFAULT '0' NOT NULL,
	"fii_loss" numeric(22, 8) DEFAULT '0' NOT NULL,
	"foreign_loss" numeric(22, 8) DEFAULT '0' NOT NULL,
	"pending_darf" numeric(22, 8) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broker_notes" ADD COLUMN "day_trade_withheld_tax" numeric(22, 8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "income_tax_settings" ADD CONSTRAINT "income_tax_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;