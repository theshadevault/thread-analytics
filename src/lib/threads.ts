/**
 * Thin client for Meta's Threads Graph API.
 *
 * Docs: https://developers.facebook.com/docs/threads
 * Base URL for data endpoints: https://graph.threads.net/v1.0/
 * OAuth endpoints live at the root: https://graph.threads.net/ and https://threads.net/
 */

const GRAPH_BASE = 'https://graph.threads.net';
const API_VERSION = 'v1.0';

/**
 * OAuth scopes requested at connect time.
 * - `threads_content_publish` lets us create + publish root posts.
 * - `threads_manage_replies` is ALSO required to create reply containers
 *   (`reply_to_id`), i.e. every segment after the first in a thread chain.
 *   Without it Meta returns an opaque empty 500 on the reply container, so the
 *   root publishes but the rest of the thread silently fails.
 * Adding a scope requires each account to re-authorize via the connect flow.
 */
export const SCOPES = [
  'threads_basic',
  'threads_manage_insights',
  'threads_content_publish',
  'threads_manage_replies',
] as const;

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL('https://threads.net/oauth/authorize');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', params.state);
  return url.toString();
}

interface ShortLivedToken {
  access_token: string;
  user_id: string;
}

/** Exchange an OAuth `code` for a short-lived token + the threads user id. */
export async function exchangeCodeForToken(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<ShortLivedToken> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
    code: params.code,
  });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new ThreadsApiError('exchangeCodeForToken', res.status, data);
  return { access_token: data.access_token, user_id: String(data.user_id) };
}

interface LongLivedToken {
  access_token: string;
  /** Seconds until expiry (~60 days). */
  expires_in: number;
}

/** Upgrade a short-lived token to a long-lived (~60 day) token. */
export async function exchangeForLongLivedToken(params: {
  clientSecret: string;
  shortLivedToken: string;
}): Promise<LongLivedToken> {
  const url = new URL(`${GRAPH_BASE}/access_token`);
  url.searchParams.set('grant_type', 'th_exchange_token');
  url.searchParams.set('client_secret', params.clientSecret);
  url.searchParams.set('access_token', params.shortLivedToken);
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json();
  if (!res.ok) throw new ThreadsApiError('exchangeForLongLivedToken', res.status, data);
  return { access_token: data.access_token, expires_in: data.expires_in };
}

/**
 * Refresh a long-lived token before it expires. Tokens must be at least 24h old
 * and unexpired to be refreshable. Returns a fresh ~60 day token.
 */
export async function refreshLongLivedToken(longLivedToken: string): Promise<LongLivedToken> {
  const url = new URL(`${GRAPH_BASE}/refresh_access_token`);
  url.searchParams.set('grant_type', 'th_refresh_token');
  url.searchParams.set('access_token', longLivedToken);
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json();
  if (!res.ok) throw new ThreadsApiError('refreshLongLivedToken', res.status, data);
  return { access_token: data.access_token, expires_in: data.expires_in };
}

// ---------------------------------------------------------------------------
// Profile / posts / insights
// ---------------------------------------------------------------------------

export interface ThreadsProfile {
  id: string;
  username: string;
  name?: string;
}

export async function getProfile(accessToken: string): Promise<ThreadsProfile> {
  const url = new URL(`${GRAPH_BASE}/${API_VERSION}/me`);
  url.searchParams.set('fields', 'id,username,name');
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json();
  if (!res.ok) throw new ThreadsApiError('getProfile', res.status, data);
  return data;
}

export interface ThreadsPost {
  id: string;
  text?: string;
  timestamp: string;
  permalink?: string;
  /** TEXT_POST | IMAGE | VIDEO | CAROUSEL_ALBUM | REPOST_FACADE | AUDIO. */
  media_type?: string;
  is_quote_post?: boolean;
}

/**
 * List a user's own posts within a time window, following pagination cursors.
 *
 * The API returns posts newest-first, one page at a time. Fetching only the
 * first page (the old behavior) meant a viral-but-older post was never loaded,
 * so it could never appear in the table no matter how it was sorted. We now page
 * through until we either cross the window's start, hit `maxPosts`, or run out.
 *
 * `since`/`until` are also sent to the API; the early-stop + client-side filter
 * below make correctness independent of whether the edge honors them.
 */
export async function listPosts(params: {
  threadsUserId: string;
  accessToken: string;
  since?: number;
  until?: number;
  pageSize?: number;
  maxPosts?: number;
}): Promise<ThreadsPost[]> {
  const pageSize = params.pageSize ?? 100;
  const maxPosts = params.maxPosts ?? 200;
  const collected: ThreadsPost[] = [];

  const first = new URL(`${GRAPH_BASE}/${API_VERSION}/${params.threadsUserId}/threads`);
  first.searchParams.set('fields', 'id,text,timestamp,permalink,media_type,is_quote_post');
  first.searchParams.set('limit', String(pageSize));
  if (params.since) first.searchParams.set('since', String(params.since));
  if (params.until) first.searchParams.set('until', String(params.until));
  first.searchParams.set('access_token', params.accessToken);

  // `paging.next` is a full URL with cursor + token embedded, so we follow it directly.
  let next: string | null = first.toString();
  while (next && collected.length < maxPosts) {
    const res: Response = await fetch(next, { method: 'GET' });
    const data = await res.json();
    if (!res.ok) throw new ThreadsApiError('listPosts', res.status, data);
    const page: ThreadsPost[] = data.data ?? [];
    collected.push(...page);

    // Posts come newest-first — once the oldest on a page predates the window, stop.
    const oldest = page[page.length - 1];
    if (params.since && oldest && Date.parse(oldest.timestamp) / 1000 < params.since) break;
    next = data.paging?.next ?? null;
  }

  const inWindow = collected.filter((p) => {
    const t = Date.parse(p.timestamp) / 1000;
    if (params.since && t < params.since) return false;
    if (params.until && t > params.until) return false;
    return true;
  });
  return inWindow.slice(0, maxPosts);
}

export type MetricName =
  | 'views'
  | 'likes'
  | 'replies'
  | 'reposts'
  | 'quotes'
  | 'followers_count';

const POST_METRICS: MetricName[] = ['views', 'likes', 'replies', 'reposts', 'quotes'];
const ACCOUNT_METRICS: MetricName[] = [
  'views',
  'likes',
  'replies',
  'reposts',
  'quotes',
  'followers_count',
];

/**
 * Insight responses come back either as a lifetime `total_value` or as a
 * time-series `values[]` array (e.g. `views`). Collapse both into one number.
 */
interface InsightDatum {
  name: string;
  total_value?: { value: number };
  values?: { value: number; end_time?: string }[];
}

function collapseInsights(data: InsightDatum[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of data) {
    if (d.total_value && typeof d.total_value.value === 'number') {
      out[d.name] = d.total_value.value;
    } else if (Array.isArray(d.values)) {
      out[d.name] = d.values.reduce((sum, v) => sum + (v.value ?? 0), 0);
    } else {
      out[d.name] = 0;
    }
  }
  return out;
}

export async function getPostInsights(params: {
  mediaId: string;
  accessToken: string;
}): Promise<Record<string, number>> {
  const url = new URL(`${GRAPH_BASE}/${API_VERSION}/${params.mediaId}/insights`);
  url.searchParams.set('metric', POST_METRICS.join(','));
  url.searchParams.set('access_token', params.accessToken);
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json();
  if (!res.ok) throw new ThreadsApiError('getPostInsights', res.status, data);
  return collapseInsights(data.data ?? []);
}

export async function getAccountInsights(params: {
  threadsUserId: string;
  accessToken: string;
  since?: number;
  until?: number;
}): Promise<Record<string, number>> {
  const url = new URL(`${GRAPH_BASE}/${API_VERSION}/${params.threadsUserId}/threads_insights`);
  url.searchParams.set('metric', ACCOUNT_METRICS.join(','));
  if (params.since) url.searchParams.set('since', String(params.since));
  if (params.until) url.searchParams.set('until', String(params.until));
  url.searchParams.set('access_token', params.accessToken);
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json();
  if (!res.ok) throw new ThreadsApiError('getAccountInsights', res.status, data);
  return collapseInsights(data.data ?? []);
}

/**
 * Follower demographics only populate once an account has ~100 followers, and
 * error below that threshold — callers should treat a null return as "not yet
 * available" rather than a hard failure.
 */
export async function getFollowerDemographics(params: {
  threadsUserId: string;
  accessToken: string;
  breakdown: 'country' | 'city' | 'age' | 'gender';
}): Promise<{ label: string; value: number }[] | null> {
  const url = new URL(`${GRAPH_BASE}/${API_VERSION}/${params.threadsUserId}/threads_insights`);
  url.searchParams.set('metric', 'follower_demographics');
  url.searchParams.set('breakdown', params.breakdown);
  url.searchParams.set('access_token', params.accessToken);
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json();
  if (!res.ok) return null;
  // Shape: data[0].total_value.breakdowns[0].results[] = { dimension_values:[label], value }
  const results = data?.data?.[0]?.total_value?.breakdowns?.[0]?.results;
  if (!Array.isArray(results)) return null;
  return results
    .map((r: { dimension_values?: string[]; value: number }) => ({
      label: r.dimension_values?.[0] ?? 'unknown',
      value: r.value,
    }))
    .sort((a: { value: number }, b: { value: number }) => b.value - a.value);
}

// ---------------------------------------------------------------------------
// Publishing (create → publish, chained for multi-part threads)
// ---------------------------------------------------------------------------

/** Who can reply to a post. Maps to the Threads API `reply_control` values. */
export type ReplyControl = 'everyone' | 'accounts_you_follow' | 'mentioned_only';

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST to a publishing endpoint with resilience to transient Meta failures.
 * The Threads API intermittently returns a 5xx (`code:1 "An unknown error
 * occurred"`) or an empty body for a few seconds at a time; those are safe to
 * retry with backoff. Genuine 4xx errors (bad params, permissions) are thrown
 * immediately since retrying won't help.
 */
async function publishPost(url: URL, operation: string, retries = 4): Promise<Record<string, unknown>> {
  let lastError: ThreadsApiError | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, { method: 'POST' });
    const raw = await res.text();
    const empty = raw.trim() === '';
    let data: Record<string, unknown>;
    try {
      data = empty ? { error: { message: `Empty ${res.status} response from Threads (transient).` } } : JSON.parse(raw);
    } catch {
      data = { error: { message: `Non-JSON ${res.status} response from Threads.` } };
    }
    if (res.ok) return data;

    lastError = new ThreadsApiError(operation, res.status, data);
    // Meta's create/publish endpoints intermittently return empty 5xx bodies for
    // minutes at a time; those are safe to retry. 4xx (bad params/permissions) are not.
    const errObj = (data.error ?? {}) as { code?: number };
    // Code 24 ("Media Not Found") right after a container reports FINISHED is an
    // eventual-consistency lag between Meta's status and publish endpoints — the
    // container exists, publish just can't see it yet. Nothing was published, so
    // retrying the same creation_id is safe (won't duplicate).
    const mediaNotReady = errObj.code === 24;
    const transient = res.status >= 500 || empty || mediaNotReady;
    if (!transient || attempt === retries - 1) throw lastError;
    await sleepMs(2000 * Math.pow(2, attempt)); // 2s, 4s, 8s
  }
  throw lastError ?? new ThreadsApiError(operation, 0, 'unknown');
}

/**
 * Step 1 of publishing: create a media container (an unpublished draft).
 *
 * Pass `imageUrl` to make it an IMAGE post (a publicly-fetchable URL Meta will
 * download; `text` becomes the caption) — otherwise it's a TEXT post. Pass
 * `replyToId` to make this post a reply to another media id — that's how a
 * connected multi-part thread is built. Returns the container's creation id.
 */
export async function createTextContainer(params: {
  threadsUserId: string;
  accessToken: string;
  text: string;
  imageUrl?: string | null;
  replyToId?: string;
  replyControl?: ReplyControl;
}): Promise<string> {
  const url = new URL(`${GRAPH_BASE}/${API_VERSION}/${params.threadsUserId}/threads`);
  if (params.imageUrl) {
    url.searchParams.set('media_type', 'IMAGE');
    url.searchParams.set('image_url', params.imageUrl);
    // Threads treats `text` as the caption on an image post.
    if (params.text) url.searchParams.set('text', params.text);
  } else {
    url.searchParams.set('media_type', 'TEXT');
    url.searchParams.set('text', params.text);
  }
  if (params.replyToId) url.searchParams.set('reply_to_id', params.replyToId);
  if (params.replyControl) url.searchParams.set('reply_control', params.replyControl);
  url.searchParams.set('access_token', params.accessToken);
  const data = await publishPost(url, 'createTextContainer');
  return String(data.id);
}

/**
 * Poll a container's processing status until it's ready to publish.
 *
 * Text containers are ready almost immediately, but an IMAGE container isn't
 * publishable until Meta has finished downloading the `image_url` — publishing
 * too early fails. We poll `status` (IN_PROGRESS → FINISHED) up to ~30s and
 * throw on ERROR/EXPIRED so the caller can record the failure.
 */
export async function waitForContainerReady(params: {
  creationId: string;
  accessToken: string;
  attempts?: number;
  intervalMs?: number;
}): Promise<void> {
  const attempts = params.attempts ?? 15;
  const intervalMs = params.intervalMs ?? 2000;
  for (let i = 0; i < attempts; i++) {
    const url = new URL(`${GRAPH_BASE}/${API_VERSION}/${params.creationId}`);
    url.searchParams.set('fields', 'status,error_message');
    url.searchParams.set('access_token', params.accessToken);
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json().catch(() => ({}));
    const status = data?.status as string | undefined;
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new ThreadsApiError('waitForContainerReady', res.status, data);
    }
    // IN_PROGRESS (or a transient read error) — wait and re-poll.
    await sleepMs(intervalMs);
  }
  // Fell through without FINISHED — let the publish attempt surface the error.
}

/**
 * Step 2 of publishing: publish a previously-created container. Returns the
 * published media id (used as the `replyToId` for the next chain segment).
 */
export async function publishContainer(params: {
  threadsUserId: string;
  accessToken: string;
  creationId: string;
}): Promise<string> {
  const url = new URL(`${GRAPH_BASE}/${API_VERSION}/${params.threadsUserId}/threads_publish`);
  url.searchParams.set('creation_id', params.creationId);
  url.searchParams.set('access_token', params.accessToken);
  const data = await publishPost(url, 'publishContainer');
  return String(data.id);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Publish a multi-part thread as a connected reply chain. Segment 0 is the root
 * post; each subsequent segment is published as a reply to the previous one, so
 * the result reads as "1/n, 2/n, …" threaded together.
 *
 * Meta needs a brief moment between creating a container and publishing it, so
 * we pause ~2s per segment. `replyControl` applies to the root post only.
 * Returns the published media ids in order. Throws on the first failure — the
 * caller records how many segments made it out via the returned/thrown state.
 */
export async function publishThreadChain(params: {
  threadsUserId: string;
  accessToken: string;
  segments: string[];
  /** Optional image URL per segment (index-aligned). A null/absent entry = text-only. */
  mediaUrls?: (string | null)[] | null;
  replyControl?: ReplyControl;
  onProgress?: (publishedIds: string[]) => void;
}): Promise<string[]> {
  const publishedIds: string[] = [];
  let replyToId: string | undefined;

  for (let i = 0; i < params.segments.length; i++) {
    const text = params.segments[i];
    const imageUrl = params.mediaUrls?.[i] ?? null;
    const creationId = await createTextContainer({
      threadsUserId: params.threadsUserId,
      accessToken: params.accessToken,
      text,
      imageUrl,
      replyToId,
      // reply_control only meaningfully applies to the root of the thread.
      replyControl: i === 0 ? params.replyControl : undefined,
    });
    if (imageUrl) {
      // Image containers must finish downloading before they can be published.
      await waitForContainerReady({ creationId, accessToken: params.accessToken });
      // Even after status=FINISHED, Meta's publish endpoint can briefly 404 the
      // container ("Media Not Found"); a short settle reduces that race (and the
      // publish call itself retries code 24 as a backstop).
      await sleep(3000);
    } else {
      // Text containers just need a brief moment before publishing.
      await sleep(2000);
    }
    const mediaId = await publishContainer({
      threadsUserId: params.threadsUserId,
      accessToken: params.accessToken,
      creationId,
    });
    publishedIds.push(mediaId);
    params.onProgress?.(publishedIds);
    replyToId = mediaId;
  }

  return publishedIds;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ThreadsApiError extends Error {
  constructor(
    public operation: string,
    public status: number,
    public body: unknown,
  ) {
    const detail =
      typeof body === 'object' && body && 'error' in body
        ? JSON.stringify((body as { error: unknown }).error)
        : String(body);
    super(`Threads API ${operation} failed (${status}): ${detail}`);
    this.name = 'ThreadsApiError';
  }
}
