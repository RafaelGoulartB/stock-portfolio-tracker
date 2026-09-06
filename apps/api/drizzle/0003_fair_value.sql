ALTER TABLE "allocation_assets" ADD COLUMN "fair_value" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "allocation_assets" DROP COLUMN "discount";
