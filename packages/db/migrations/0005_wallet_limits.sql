CREATE TABLE "wallet_limits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"daily_stake_limit" integer,
	"pending_stake_limit" integer,
	"pending_from" timestamp with time zone,
	"reminder_minutes" integer DEFAULT 60 NOT NULL,
	"self_excluded_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
