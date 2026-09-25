import { and, eq, gte, asc } from 'drizzle-orm';
import { getDb } from '@/db';
import { dailySnapshots, type DailySnapshot } from '@/db/schema';
import { listAccounts, getAccessToken } from '@/lib/accounts';
import { getAccountInsights } from '@/lib/threads';

/** ISO date (YYYY-MM-DD) in UTC for today. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Capture one snapshot row per account for today. Idempotent — re-running the
 * same day upserts. `views` uses a trailing-24h window (Meta's only daily
 * account metric); everything else is the cumulative lifetime value.
 */
export async function captureSnapshots(): Promise<
  { username: string; ok: boolean; error?: string }[]
> {
  const accounts = await listAccounts();
  const date = todayUtc();
  const until = Math.floor(Date.now() / 1000);
  const since = until - 24 * 60 * 60;
  const results: { username: string; ok: boolean; error?: string }[] = [];

  for (const account of accounts) {
    try {
      const token = await getAccessToken(account.threadsUserId);
      if (!token) throw new Error('no stored token');
      const insights = await getAccountInsights({
        threadsUserId: account.threadsUserId,
        accessToken: token,
        since,
        until,
      });
      await getDb()
        .insert(dailySnapshots)
        .values({
          threadsUserId: account.threadsUserId,
          date,
          followersCount: Math.round(insights.followers_count ?? 0),
          views: Math.round(insights.views ?? 0),
          likes: Math.round(insights.likes ?? 0),
          replies: Math.round(insights.replies ?? 0),
          reposts: Math.round(insights.reposts ?? 0),
          quotes: Math.round(insights.quotes ?? 0),
        })
        .onConflictDoUpdate({
          target: [dailySnapshots.threadsUserId, dailySnapshots.date],
          set: {
            followersCount: Math.round(insights.followers_count ?? 0),
            views: Math.round(insights.views ?? 0),
            likes: Math.round(insights.likes ?? 0),
            replies: Math.round(insights.replies ?? 0),
            reposts: Math.round(insights.reposts ?? 0),
            quotes: Math.round(insights.quotes ?? 0),
          },
        });
      results.push({ username: account.username, ok: true });
    } catch (err) {
      results.push({
        username: account.username,
        ok: false,
        error: err instanceof Error ? err.message : 'snapshot failed',
      });
    }
  }
  return results;
}

export async function getSnapshots(
  threadsUserId: string,
  days = 90,
): Promise<DailySnapshot[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return getDb()
    .select()
    .from(dailySnapshots)
    .where(
      and(eq(dailySnapshots.threadsUserId, threadsUserId), gte(dailySnapshots.date, since)),
    )
    .orderBy(asc(dailySnapshots.date));
}
