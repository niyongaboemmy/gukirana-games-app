CREATE TABLE "economy_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economy_settings_version_unique" UNIQUE("version")
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "economy_version" integer;