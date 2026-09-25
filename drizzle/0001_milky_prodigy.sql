CREATE TABLE "daily_snapshots" (
	"threads_user_id" text NOT NULL,
	"date" date NOT NULL,
	"followers_count" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	"reposts" integer DEFAULT 0 NOT NULL,
	"quotes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_snapshots_threads_user_id_date_pk" PRIMARY KEY("threads_user_id","date")
);
--> statement-breakpoint
CREATE TABLE "scheduled_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"threads_user_id" text NOT NULL,
	"segments" jsonb NOT NULL,
	"reply_control" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"published_ids" jsonb,
	"permalink" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone
);
