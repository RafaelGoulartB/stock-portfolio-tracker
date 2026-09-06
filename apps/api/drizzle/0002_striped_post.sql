CREATE TABLE "allocation_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"asset_class" "asset_class" DEFAULT 'stock_br' NOT NULL,
	"currency" "currency" DEFAULT 'BRL' NOT NULL,
	"target_weight" numeric(22, 8),
	"discount" numeric(22, 8),
	"valuation_ref" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocation_assets" ADD CONSTRAINT "allocation_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reviews" ADD CONSTRAINT "asset_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_assets_user_ticker_key" ON "allocation_assets" USING btree ("user_id","ticker");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_reviews_user_ticker_period_key" ON "asset_reviews" USING btree ("user_id","ticker","period");--> statement-breakpoint
CREATE INDEX "asset_reviews_user_id_idx" ON "asset_reviews" USING btree ("user_id");