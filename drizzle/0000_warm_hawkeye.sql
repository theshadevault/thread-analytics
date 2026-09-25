CREATE TABLE "accounts" (
	"threads_user_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"access_token_encrypted" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
