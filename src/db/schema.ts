import { pgSchema, text, timestamp, integer, date, jsonb, primaryKey } from 'drizzle-orm/pg-core';

/**
 * All ThreadAnalytics tables live in a dedicated `threadanalytics` Postgres
 * schema. The database is shared with another app (LexTrack) in its `public`
 * schema, so namespacing here guarantees the two can never collide.
 */
export const taSchema = pgSchema('threadanalytics');

/**
 * The entire schema for this dashboard.
 *
 * We only persist OAuth tokens (encrypted at rest) — analytics are pulled live
 * from Meta on every request, so there are no analytics tables. If historical
 * trend charts are wanted later, add a `daily_snapshots` table + a cron writer.
 */
export const accounts = taSchema.table('accounts', {
  // Meta's Threads user id is our primary key (BlackTwist provider ids are irrelevant here).
  threadsUserId: text('threads_user_id').primaryKey(),
  username: text('username').notNull(),
  displayName: text('display_name'),
  // AES-256-GCM ciphertext of the long-lived token (see src/lib/crypto.ts).
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

/**
 * One row per account per day, written by the snapshot cron. Meta doesn't
 * backfill daily history, so this table starts filling from first deploy.
 *
 * `followersCount` and the engagement totals are cumulative (lifetime) — diff
 * consecutive days for daily deltas. `views` is the trailing-24h value (the one
 * account metric Meta breaks down daily).
 */
export const dailySnapshots = taSchema.table(
  'daily_snapshots',
  {
    threadsUserId: text('threads_user_id').notNull(),
    date: date('date').notNull(),
    followersCount: integer('followers_count').notNull().default(0),
    views: integer('views').notNull().default(0),
    likes: integer('likes').notNull().default(0),
    replies: integer('replies').notNull().default(0),
    reposts: integer('reposts').notNull().default(0),
    quotes: integer('quotes').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.threadsUserId, t.date] })],
);

export type DailySnapshot = typeof dailySnapshots.$inferSelect;

/**
 * Queue of threads to publish, written by the compose UI and the MCP server,
 * drained by the publish cron. A "thread" is one or more ordered text segments
 * published as a connected reply chain.
 *
 * Lifecycle: (draft →) pending → publishing → posted | failed (| canceled while
 * pending). A `draft` is queued but never auto-published — it waits in the Studio
 * until scheduled or published; only `pending` rows are drained by the cron.
 * `publishedIds` records the media ids already published so a partial failure
 * can be diagnosed (and, later, resumed) rather than silently double-posting.
 */
export const scheduledThreads = taSchema.table('scheduled_threads', {
  id: text('id').primaryKey(),
  threadsUserId: text('threads_user_id').notNull(),
  // Ordered array of post bodies; segments.length === 1 is a single post.
  segments: jsonb('segments').notNull().$type<string[]>(),
  // Optional image URL per segment (index-aligned with `segments`); a null entry
  // means that segment is text-only. Null/absent for a fully text thread. The URL
  // must be publicly fetchable — Meta downloads it when building the IMAGE post.
  mediaUrls: jsonb('media_urls').$type<(string | null)[]>(),
  // 'everyone' | 'accounts_you_follow' | 'mentioned_only' — applies to the root.
  replyControl: text('reply_control'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('pending'),
  publishedIds: jsonb('published_ids').$type<string[]>(),
  // Deep link to the published root post, once known.
  permalink: text('permalink'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  // Who queued it: 'web' (dashboard) or 'mcp' (Claude connector).
  source: text('source').notNull().default('web'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  postedAt: timestamp('posted_at', { withTimezone: true }),
});

export type ScheduledThread = typeof scheduledThreads.$inferSelect;
export type NewScheduledThread = typeof scheduledThreads.$inferInsert;

/**
 * OAuth 2.1 clients registered via Dynamic Client Registration (RFC 7591).
 * claude.ai self-registers here when you add the MCP connector. Public PKCE
 * clients have a null secret.
 */
export const oauthClients = taSchema.table('oauth_clients', {
  clientId: text('client_id').primaryKey(),
  clientSecret: text('client_secret'),
  redirectUris: jsonb('redirect_uris').notNull().$type<string[]>(),
  clientName: text('client_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OAuthClient = typeof oauthClients.$inferSelect;

/**
 * Short-lived, single-use authorization codes (RFC 6749 + PKCE). A row is
 * created when the owner approves the authorize screen and deleted the moment
 * it's exchanged at the token endpoint.
 */
export const oauthCodes = taSchema.table('oauth_codes', {
  code: text('code').primaryKey(),
  clientId: text('client_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
  scope: text('scope'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OAuthCode = typeof oauthCodes.$inferSelect;
