CREATE TYPE "public"."asset_class" AS ENUM('stock', 'reit', 'etf', 'bdr', 'crypto', 'fixed_income', 'other');--> statement-breakpoint
CREATE TYPE "public"."transaction_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"asset_class" "asset_class" DEFAULT 'stock' NOT NULL,
	"side" "transaction_side" NOT NULL,
	"quantity" numeric(22, 8) NOT NULL,
	"price" numeric(22, 8) NOT NULL,
	"fees" numeric(22, 8) DEFAULT '0' NOT NULL,
	"traded_at" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_user_ticker_idx" ON "transactions" USING btree ("user_id","ticker");--> statement-breakpoint
CREATE INDEX "transactions_user_traded_at_idx" ON "transactions" USING btree ("user_id","traded_at");