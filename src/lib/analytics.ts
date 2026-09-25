import { getAccessToken, listAccounts } from '@/lib/accounts';
import {
  listPosts,
  getPostInsights,
  getAccountInsights,
  getFollowerDemographics,
  type ThreadsPost,
} from '@/lib/threads';

export interface PostAnalytics {
  id: string;
  text: string;
  permalink: string | null;
  timestamp: string;
  mediaType: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  /** likes + replies + reposts + quotes, as a share of views. */
  engagementRate: number;
}

export interface AnalyticsPayload {
  threadsUserId: string;
  window: { since: number; until: number; days: number };
  account: {
    views: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    followersCount: number;
  };
  demographics: {
    country: { label: string; value: number }[] | null;
  };
  posts: PostAnalytics[];
  totals: {
    postCount: number;
    totalViews: number;
    totalEngagement: number;
    avgEngagementRate: number;
  };
  fetchedAt: string;
}

// --- Simple in-process TTL cache so we don't hammer Meta on every render. ---
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; payload: AnalyticsPayload }>();

function engagement(p: {
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}): number {
  return p.likes + p.replies + p.reposts + p.quotes;
}

/** Run `fn` over `items` in sequential batches of `size` (concurrency limit). */
async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

export async function getAnalytics(params: {
  threadsUserId: string;
  days?: number;
  force?: boolean;
}): Promise<AnalyticsPayload> {
  const days = params.days ?? 30;
  const cacheKey = `${params.threadsUserId}:${days}`;
  const hit = cache.get(cacheKey);
  if (!params.force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.payload;
  }

  const accessToken = await getAccessToken(params.threadsUserId);
  if (!accessToken) {
    throw new Error(`No stored account for threads_user_id ${params.threadsUserId}`);
  }

  const until = Math.floor(Date.now() / 1000);
  const since = until - days * 24 * 60 * 60;

  // Kick off account-level calls in parallel with the post list.
  const [accountInsights, demographics, rawPosts] = await Promise.all([
    getAccountInsights({ threadsUserId: params.threadsUserId, accessToken, since, until }),
    getFollowerDemographics({
      threadsUserId: params.threadsUserId,
      accessToken,
      breakdown: 'country',
    }),
    listPosts({ threadsUserId: params.threadsUserId, accessToken, since, until, maxPosts: 200 }),
  ]);

  // Reposts (you re-sharing someone else's content) carry no text and no
  // insights of their own — they'd show up as all-zero junk rows. Drop them
  // before fetching insights, which also cuts the number of API calls.
  const ownPosts = rawPosts.filter((p: ThreadsPost) => p.media_type !== 'REPOST_FACADE');

  // Per-post insights, batched to cap concurrency (24 at a time is fast but
  // stays well under burst limits). A single post failing shouldn't nuke the page.
  const posts: PostAnalytics[] = await inBatches(ownPosts, 24, async (post: ThreadsPost) => {
      let metrics: Record<string, number> = {
        views: 0,
        likes: 0,
        replies: 0,
        reposts: 0,
        quotes: 0,
      };
      try {
        metrics = { ...metrics, ...(await getPostInsights({ mediaId: post.id, accessToken })) };
      } catch {
        // Leave zeros; some post types (or very new posts) return no insights.
      }
      const eng = engagement({
        likes: metrics.likes,
        replies: metrics.replies,
        reposts: metrics.reposts,
        quotes: metrics.quotes,
      });
      return {
        id: post.id,
        text: post.text ?? '',
        permalink: post.permalink ?? null,
        timestamp: post.timestamp,
        mediaType: post.media_type ?? 'TEXT_POST',
        views: metrics.views,
        likes: metrics.likes,
        replies: metrics.replies,
        reposts: metrics.reposts,
        quotes: metrics.quotes,
        engagementRate: metrics.views > 0 ? eng / metrics.views : 0,
      };
    });

  const totalViews = posts.reduce((s, p) => s + p.views, 0);
  const totalEngagement = posts.reduce((s, p) => s + engagement(p), 0);

  const payload: AnalyticsPayload = {
    threadsUserId: params.threadsUserId,
    window: { since, until, days },
    account: {
      views: accountInsights.views ?? 0,
      likes: accountInsights.likes ?? 0,
      replies: accountInsights.replies ?? 0,
      reposts: accountInsights.reposts ?? 0,
      quotes: accountInsights.quotes ?? 0,
      followersCount: accountInsights.followers_count ?? 0,
    },
    demographics: { country: demographics },
    posts,
    totals: {
      postCount: posts.length,
      totalViews,
      totalEngagement,
      avgEngagementRate: totalViews > 0 ? totalEngagement / totalViews : 0,
    },
    fetchedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}

// ---------------------------------------------------------------------------
// Combined view — all accounts merged.
// ---------------------------------------------------------------------------

export interface CombinedPayload {
  window: { days: number };
  /** Per-account summary, for a side-by-side comparison. */
  accounts: {
    threadsUserId: string;
    username: string;
    followersCount: number;
    views: number;
    postCount: number;
    totalEngagement: number;
    error?: string;
  }[];
  /** Summed account-level metrics across every account. */
  account: {
    views: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    followersCount: number;
  };
  demographics: { country: { label: string; value: number }[] | null };
  /** Every post across all accounts, each tagged with its @username. */
  posts: (PostAnalytics & { username: string })[];
  totals: {
    postCount: number;
    totalViews: number;
    totalEngagement: number;
    avgEngagementRate: number;
  };
  fetchedAt: string;
}

/** Merge follower-by-country arrays, summing counts per country. */
function mergeCountries(
  parts: ({ label: string; value: number }[] | null)[],
): { label: string; value: number }[] | null {
  const present = parts.filter((p): p is { label: string; value: number }[] => p !== null);
  if (present.length === 0) return null;
  const byLabel = new Map<string, number>();
  for (const arr of present) {
    for (const { label, value } of arr) {
      byLabel.set(label, (byLabel.get(label) ?? 0) + value);
    }
  }
  return [...byLabel.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

export async function getCombinedAnalytics(params?: {
  days?: number;
  force?: boolean;
}): Promise<CombinedPayload> {
  const days = params?.days ?? 30;
  const accounts = await listAccounts();

  // Pull each account's analytics in parallel; one failing shouldn't sink the rest.
  const results = await Promise.all(
    accounts.map(async (a) => {
      try {
        const payload = await getAnalytics({
          threadsUserId: a.threadsUserId,
          days,
          force: params?.force,
        });
        return { account: a, payload, error: undefined as string | undefined };
      } catch (err) {
        return {
          account: a,
          payload: null,
          error: err instanceof Error ? err.message : 'failed',
        };
      }
    }),
  );

  const account = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, followersCount: 0 };
  const posts: (PostAnalytics & { username: string })[] = [];
  const summaries: CombinedPayload['accounts'] = [];
  const countryParts: ({ label: string; value: number }[] | null)[] = [];

  for (const { account: a, payload, error } of results) {
    if (!payload) {
      summaries.push({
        threadsUserId: a.threadsUserId,
        username: a.username,
        followersCount: 0,
        views: 0,
        postCount: 0,
        totalEngagement: 0,
        error,
      });
      continue;
    }
    account.views += payload.account.views;
    account.likes += payload.account.likes;
    account.replies += payload.account.replies;
    account.reposts += payload.account.reposts;
    account.quotes += payload.account.quotes;
    account.followersCount += payload.account.followersCount;
    countryParts.push(payload.demographics.country);
    for (const p of payload.posts) posts.push({ ...p, username: a.username });
    summaries.push({
      threadsUserId: a.threadsUserId,
      username: a.username,
      followersCount: payload.account.followersCount,
      views: payload.totals.totalViews,
      postCount: payload.totals.postCount,
      totalEngagement: payload.totals.totalEngagement,
    });
  }

  posts.sort((a, b) => b.views - a.views);
  const totalViews = posts.reduce((s, p) => s + p.views, 0);
  const totalEngagement = posts.reduce(
    (s, p) => s + p.likes + p.replies + p.reposts + p.quotes,
    0,
  );

  return {
    window: { days },
    accounts: summaries,
    account,
    demographics: { country: mergeCountries(countryParts) },
    posts,
    totals: {
      postCount: posts.length,
      totalViews,
      totalEngagement,
      avgEngagementRate: totalViews > 0 ? totalEngagement / totalViews : 0,
    },
    fetchedAt: new Date().toISOString(),
  };
}
