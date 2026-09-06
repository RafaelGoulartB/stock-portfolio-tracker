ALTER TABLE "asset_reviews" ADD COLUMN "fair_value" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "allocation_assets" DROP COLUMN "fair_value";
