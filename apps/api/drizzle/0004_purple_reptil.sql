CREATE TABLE "user_contribution_plan_configs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"min_weight_impact" numeric(22, 8) NOT NULL,
	"max_share" numeric(22, 8) NOT NULL,
	"max_assets" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_contribution_plan_configs" ADD CONSTRAINT "user_contribution_plan_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;