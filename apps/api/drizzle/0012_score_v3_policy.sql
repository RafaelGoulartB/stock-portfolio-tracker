ALTER TABLE "user_score_configs" ADD COLUMN "ic_reference" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "ic_prior" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "ic_prior_pairs" integer;--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "momentum_weight" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "momentum_z_cap" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "review_drift" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "sell_band" numeric(22, 8);--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD COLUMN "sell_confidence" numeric(22, 8);--> statement-breakpoint
-- A custom v2 policy keeps every knob the user chose; only the v3 knobs
-- start at their defaults.
UPDATE "user_score_configs" SET
  "ic_reference" = '0.10',
  "ic_prior" = '0.05',
  "ic_prior_pairs" = 240,
  "momentum_weight" = '0.10',
  "momentum_z_cap" = '2',
  "review_drift" = '0.25',
  "sell_band" = '0.25',
  "sell_confidence" = '0.8';--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "ic_reference" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "ic_prior" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "ic_prior_pairs" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "momentum_weight" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "momentum_z_cap" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "review_drift" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "sell_band" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_score_configs" ALTER COLUMN "sell_confidence" SET NOT NULL;
