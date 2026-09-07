CREATE TYPE "public"."asset_class" AS ENUM('stock_br', 'stock_us', 'reit', 'etf', 'bdr', 'crypto', 'fixed_income', 'other');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('BRL', 'USD');--> statement-breakpoint
CREATE TYPE "public"."transaction_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "allocation_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"asset_class" "asset_class" DEFAULT 'stock_br' NOT NULL,
	"currency" "currency" DEFAULT 'BRL' NOT NULL,
	"target_weight" numeric(22, 8),
	"valuation_ref" text,
	"manual_price" numeric(22, 8),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"period" text NOT NULL,
	"grade" numeric(22, 8),
	"notes" text,
	"fair_value" numeric(22, 8),
	"fair_value_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'chart-1' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"asset_class" "asset_class" DEFAULT 'stock_br' NOT NULL,
	"currency" "currency" DEFAULT 'BRL' NOT NULL,
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
ALTER TABLE "allocation_assets" ADD CONSTRAINT "allocation_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reviews" ADD CONSTRAINT "asset_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_assets_user_ticker_key" ON "allocation_assets" USING btree ("user_id","ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_categories_user_ticker_key" ON "asset_categories" USING btree ("user_id","ticker");--> statement-breakpoint
CREATE INDEX "asset_categories_user_category_idx" ON "asset_categories" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_reviews_user_ticker_period_key" ON "asset_reviews" USING btree ("user_id","ticker","period");--> statement-breakpoint
CREATE INDEX "asset_reviews_user_id_idx" ON "asset_reviews" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_key" ON "categories" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "categories_user_id_idx" ON "categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_user_ticker_idx" ON "transactions" USING btree ("user_id","ticker");--> statement-breakpoint
CREATE INDEX "transactions_user_traded_at_idx" ON "transactions" USING btree ("user_id","traded_at");