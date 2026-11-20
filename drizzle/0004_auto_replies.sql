CREATE TABLE IF NOT EXISTS "threadanalytics"."auto_replies" (
	"comment_id" text PRIMARY KEY NOT NULL,
	"threads_user_id" text NOT NULL,
	"post_id" text NOT NULL,
	"commenter" text NOT NULL,
	"comment_text" text,
	"product" text NOT NULL,
	"reply_text" text NOT NULL,
	"reply_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"commented_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_replies_account_created_idx" ON "threadanalytics"."auto_replies" USING btree ("threads_user_id","created_at");
