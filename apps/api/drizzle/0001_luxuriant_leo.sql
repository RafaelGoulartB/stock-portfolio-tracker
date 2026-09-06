CREATE TYPE "public"."currency" AS ENUM('BRL', 'USD');--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "asset_class" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "asset_class" SET DEFAULT 'stock_br'::text;--> statement-breakpoint
UPDATE "transactions" SET "asset_class" = 'stock_br' WHERE "asset_class" = 'stock';--> statement-breakpoint
DROP TYPE "public"."asset_class";--> statement-breakpoint
CREATE TYPE "public"."asset_class" AS ENUM('stock_br', 'stock_us', 'reit', 'etf', 'bdr', 'crypto', 'fixed_income', 'other');--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "asset_class" SET DEFAULT 'stock_br'::"public"."asset_class";--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "asset_class" SET DATA TYPE "public"."asset_class" USING "asset_class"::"public"."asset_class";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "currency" "currency" DEFAULT 'BRL' NOT NULL;