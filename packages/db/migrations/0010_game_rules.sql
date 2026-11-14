CREATE TABLE "friendly_plays" (
	"user_id" uuid NOT NULL,
	"game" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "friendly_plays_user_id_game_day_pk" PRIMARY KEY("user_id","game","day")
);
--> statement-breakpoint
CREATE TABLE "game_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"game" text NOT NULL,
	"version" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_settings_game_version" UNIQUE("game","version")
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "rules" jsonb;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "void_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "void_cause" text;--> statement-breakpoint
ALTER TABLE "friendly_plays" ADD CONSTRAINT "friendly_plays_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_players_user_idx" ON "match_players" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "matches_status_idx" ON "matches" USING btree ("status");