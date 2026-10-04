CREATE TABLE "broker_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"format" text NOT NULL,
	"fingerprint" text NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"note_number" text,
	"account" text,
	"trade_date" date NOT NULL,
	"settlement_date" date,
	"currency" "currency" NOT NULL,
	"purchases_total" numeric(22, 8) NOT NULL,
	"sales_total" numeric(22, 8) NOT NULL,
	"fees_total" numeric(22, 8) NOT NULL,
	"withheld_tax" numeric(22, 8) DEFAULT '0' NOT NULL,
	"net_amount" numeric(22, 8) NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_security_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"ticker" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "broker_note_id" uuid;--> statement-breakpoint
ALTER TABLE "broker_notes" ADD CONSTRAINT "broker_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_security_aliases" ADD CONSTRAINT "broker_security_aliases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broker_notes_user_fingerprint_key" ON "broker_notes" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "broker_notes_user_trade_date_idx" ON "broker_notes" USING btree ("user_id","trade_date");--> statement-breakpoint
CREATE UNIQUE INDEX "broker_security_aliases_user_key" ON "broker_security_aliases" USING btree ("user_id","source_key");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_broker_note_id_broker_notes_id_fk" FOREIGN KEY ("broker_note_id") REFERENCES "public"."broker_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_broker_note_idx" ON "transactions" USING btree ("broker_note_id");