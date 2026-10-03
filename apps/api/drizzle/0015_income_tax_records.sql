ALTER TYPE "public"."corporate_action_kind" ADD VALUE 'bonus';--> statement-breakpoint
CREATE TABLE "asset_tax_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"legal_name" text,
	"cnpj" text,
	"broker" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "darf_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"month" text NOT NULL,
	"paid_on" date NOT NULL,
	"amount" numeric(22, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "foreign_cash_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"amount_usd" numeric(22, 8) NOT NULL,
	"value_brl" numeric(22, 8) NOT NULL,
	"institution" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD COLUMN "unit_cost" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "asset_tax_profiles" ADD CONSTRAINT "asset_tax_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "darf_payments" ADD CONSTRAINT "darf_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foreign_cash_balances" ADD CONSTRAINT "foreign_cash_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_tax_profiles_user_ticker_key" ON "asset_tax_profiles" USING btree ("user_id","ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "darf_payments_user_month_key" ON "darf_payments" USING btree ("user_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "foreign_cash_balances_user_year_key" ON "foreign_cash_balances" USING btree ("user_id","year");