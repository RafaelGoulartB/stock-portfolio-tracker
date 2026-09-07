CREATE TABLE "user_score_configs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"absolute_weight_cap" numeric(22, 8) NOT NULL,
	"overweight_block_factor" numeric(22, 8) NOT NULL,
	"trim_factor" numeric(22, 8) NOT NULL,
	"cooldown_days" integer NOT NULL,
	"grade_window_quarters" integer NOT NULL,
	"grade_bands" jsonb NOT NULL,
	"ungraded_multiplier" numeric(22, 8) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_score_configs" ADD CONSTRAINT "user_score_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;