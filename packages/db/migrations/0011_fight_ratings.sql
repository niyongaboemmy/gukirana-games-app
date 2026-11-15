CREATE TABLE "fight_rating_events" (
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"game" text NOT NULL,
	"opponent_id" uuid NOT NULL,
	"score" double precision NOT NULL,
	"rating_before" double precision NOT NULL,
	"rating_after" double precision NOT NULL,
	"rd_before" double precision NOT NULL,
	"rd_after" double precision NOT NULL,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fight_rating_events_match_id_user_id_pk" PRIMARY KEY("match_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "fight_ratings" (
	"user_id" uuid NOT NULL,
	"game" text NOT NULL,
	"rating" double precision DEFAULT 1500 NOT NULL,
	"rd" double precision DEFAULT 350 NOT NULL,
	"vol" double precision DEFAULT 0.06 NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"peak" double precision DEFAULT 1500 NOT NULL,
	"last_at" timestamp with time zone,
	CONSTRAINT "fight_ratings_user_id_game_pk" PRIMARY KEY("user_id","game")
);
--> statement-breakpoint
ALTER TABLE "fight_rating_events" ADD CONSTRAINT "fight_rating_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fight_rating_events" ADD CONSTRAINT "fight_rating_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fight_ratings" ADD CONSTRAINT "fight_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fight_rating_events_user_idx" ON "fight_rating_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "fight_ratings_game_idx" ON "fight_ratings" USING btree ("game","rating");