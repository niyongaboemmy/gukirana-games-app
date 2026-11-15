CREATE TABLE "rules_acceptances" (
	"user_id" uuid NOT NULL,
	"game" text NOT NULL,
	"version" integer NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_acceptances_user_id_game_version_pk" PRIMARY KEY("user_id","game","version")
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "room_id" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "ring" text;--> statement-breakpoint
ALTER TABLE "rules_acceptances" ADD CONSTRAINT "rules_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;