CREATE TABLE "buildings" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
