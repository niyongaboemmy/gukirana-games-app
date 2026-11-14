CREATE TABLE "arena_bars" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"until" timestamp with time zone,
	"barred_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"game" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"doors_open_at" timestamp with time zone NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"rules" jsonb NOT NULL,
	"capacity" integer NOT NULL,
	"vip_capacity" integer DEFAULT 0 NOT NULL,
	"seats_issued" integer DEFAULT 0 NOT NULL,
	"vip_issued" integer DEFAULT 0 NOT NULL,
	"floor_issued" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_invites" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"zone" text DEFAULT 'seats' NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arena_invites_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "arena_participants" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arena_participants_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "arena_passes" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"zone" text NOT NULL,
	"seat" text,
	"via" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arena_passes_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "arena_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"open" boolean DEFAULT false NOT NULL,
	"default_capacity" integer DEFAULT 200 NOT NULL,
	"max_concourse" integer DEFAULT 50 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text DEFAULT 'seed' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arena_bars" ADD CONSTRAINT "arena_bars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_invites" ADD CONSTRAINT "arena_invites_event_id_arena_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."arena_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_invites" ADD CONSTRAINT "arena_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_participants" ADD CONSTRAINT "arena_participants_event_id_arena_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."arena_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_participants" ADD CONSTRAINT "arena_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_passes" ADD CONSTRAINT "arena_passes_event_id_arena_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."arena_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_passes" ADD CONSTRAINT "arena_passes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arena_events_status_idx" ON "arena_events" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "arena_invites_user_idx" ON "arena_invites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "arena_participants_user_idx" ON "arena_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "arena_passes_user_idx" ON "arena_passes" USING btree ("user_id");