# Threads Analytics

A multi-account analytics dashboard that pulls straight from **Meta's official Threads API** — no
third-party wrapper, no paid tier. It's a Next.js app on Vercel that stores only OAuth tokens
(encrypted at rest) and pulls all analytics **live** on each request.

## What's built

| Piece | Path |
|-------|------|
| Account switcher API | `src/app/api/accounts/route.ts` |
| Live analytics (per account) | `src/app/api/analytics/[threadsUserId]/route.ts` |
| OAuth connect + callback | `src/app/api/auth/threads/…` |
| Token-refresh cron | `src/app/api/cron/refresh-tokens/route.ts` (weekly, see `vercel.json`) |
| Dashboard UI | `src/app/dashboard/…` |
| Threads API client | `src/lib/threads.ts` |
| Token encryption (AES-256-GCM) | `src/lib/crypto.ts` |
| DB schema (Drizzle) | `src/db/schema.ts` — one `accounts` table |

The whole schema is: `threads_user_id`, `username`, `display_name`, `access_token_encrypted`,
`token_expires_at`. No analytics tables — analytics are pulled live and cached in-process for 5 min.

---

## Setup (one time)

### 1. Create the Meta app (no App Review needed)

Because all 3 accounts are yours, you keep the app in **Development Mode** and add each account as a
**Tester** — that unlocks every endpoint for those accounts with **no App Review**.

1. Create an app at [developers.facebook.com](https://developers.facebook.com) → add the **Threads** use case.
2. Request scopes: `threads_basic`, `threads_manage_insights` (read-only — no publish/reply).
3. App → **Roles** → add all 3 Threads accounts as **Testers** (accept the invite from each account).
4. Under the Threads use case settings, set the **Redirect Callback URI** to exactly:
   `https://<your-domain>/api/auth/threads/callback` (and `http://localhost:3000/api/auth/threads/callback` for local dev).
5. Copy the **App ID** and **App Secret**.

### 2. Provision the database (Neon Postgres via Vercel Marketplace)

The Vercel CLI isn't installed yet:

```bash
npm i -g vercel
vercel link                    # link this folder to a Vercel project
vercel integration add neon    # provisions Neon + injects DATABASE_URL
```

### 3. Environment variables

Copy `.env.example` → `.env.local` and fill in:

```bash
DATABASE_URL=              # from `vercel env pull` after adding Neon
THREADS_APP_ID=            # Meta app ID
THREADS_APP_SECRET=        # Meta app secret
TOKEN_ENCRYPTION_KEY=      # openssl rand -base64 32
CRON_SECRET=               # openssl rand -hex 32
APP_BASE_URL=http://localhost:3000
```

Pull Vercel-managed vars locally: `vercel env pull .env.local --yes`.

### 4. Create the table

```bash
npm run db:push      # applies src/db/schema.ts to Neon (reads .env.local)
```

### 5. Run

```bash
npm run dev
```

Open <http://localhost:3000> → click **Connect account** → authorize with each Threads account
once. Each connection stores an encrypted long-lived (~60-day) token.

---

## Deploy

```bash
vercel deploy --prod
```

Set the same env vars in the Vercel project (Settings → Environment Variables), and set
`CRON_SECRET` — Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>` to the refresh route.
The cron in `vercel.json` refreshes all tokens weekly so none expire.

---

## Notes / things to confirm against live Meta docs

- **Date ranges**: `threads_insights` is called with `since`/`until` (7–90 day windows in the UI). If
  Meta rejects arbitrary ranges for some metrics, they're clamped in `src/app/api/analytics/[threadsUserId]/route.ts`.
- **`follower_demographics`** only populates above ~100 followers — the UI shows a note below that
  threshold instead of erroring (`src/lib/threads.ts` returns `null`).
- **Token refresh** requires the token be ≥24h old and unexpired; the weekly cron handles this and
  logs per-account success/failure.

## Extending to a combined multi-account view

Add `/api/analytics/combined` that calls `getAnalytics()` (in `src/lib/analytics.ts`) for all stored
accounts in parallel and merges — no change to the per-account logic.
