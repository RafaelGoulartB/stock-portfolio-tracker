ALTER TABLE "user_contribution_plan_configs" ADD COLUMN "small_book_impact" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_contribution_plan_configs" ADD COLUMN "large_book_impact" numeric(22, 8);--> statement-breakpoint
UPDATE "user_contribution_plan_configs" SET "small_book_impact" = '0.02', "large_book_impact" = '0.005';--> statement-breakpoint
ALTER TABLE "user_contribution_plan_configs" ALTER COLUMN "small_book_impact" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_contribution_plan_configs" ALTER COLUMN "large_book_impact" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_contribution_plan_configs" DROP COLUMN "min_weight_impact";
