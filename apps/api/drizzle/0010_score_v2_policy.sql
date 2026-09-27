ALTER TABLE "user_contribution_plan_configs" ADD COLUMN "starter_fraction" numeric(22, 8);--> statement-breakpoint
UPDATE "user_contribution_plan_configs" SET "starter_fraction" = '0.5';--> statement-breakpoint
ALTER TABLE "user_contribution_plan_configs" ALTER COLUMN "starter_fraction" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "trim_absolute_band" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "trim_relative_band" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "cooldown_floor" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "grade_half_life_quarters" integer;--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "grade_prior_quarters" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "valuation_dead_zone" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "valuation_sensitivity" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "tilt_min" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "tilt_max" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "fair_value_half_life_quarters" integer;--> statement-breakpoint
-- A custom v1 trim factor (e.g. 1.2 = 20% past target) becomes the relative
-- trim band; every new v2 knob starts at its default.
UPDATE "user_score_configs" SET
  "trim_absolute_band" = '0.05',
  "trim_relative_band" = GREATEST("trim_factor" - 1, 0),
  "cooldown_floor" = '0.25',
  "grade_half_life_quarters" = 4,
  "grade_prior_quarters" = '1',
  "valuation_dead_zone" = '0.05',
  "valuation_sensitivity" = '1',
  "tilt_min" = '0.5',
  "tilt_max" = '1.5',
  "fair_value_half_life_quarters" = 2;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "trim_absolute_band" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "trim_relative_band" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "cooldown_floor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "grade_half_life_quarters" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "grade_prior_quarters" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "valuation_dead_zone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "valuation_sensitivity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "tilt_min" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "tilt_max" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "fair_value_half_life_quarters" SET NOT NULL;
