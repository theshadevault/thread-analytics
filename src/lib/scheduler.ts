import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { scheduledThreads, type ScheduledThread } from '@/db/schema';
import { getAccessToken } from '@/lib/accounts';
import { publishThreadChain, ThreadsApiError, type ReplyControl } from '@/lib/threads';
import { deleteStoredImages } from '@/lib/storage';

// Threads caps a single post at 500 characters. We cap segment count defensively
// so a runaway payload can't fire hundreds of API-published posts in one thread.
export const MAX_SEGMENT_LENGTH = 500;
export const MAX_SEGMENTS = 25;
// A transiently-failing thread (Meta 5xx) is requeued this many times before we
// give up and mark it failed, so a persistent problem can't retry forever.
export const MAX_ATTEMPTS = 6;

const REPLY_CONTROLS: ReplyControl[] = ['everyone', 'accounts_you_follow', 'mentioned_only'];

export class SchedulerError extends Error {}

/**
 * Trim/normalize the segments of a thread and reject anything unpublishable.
 * Returns the cleaned segments. Throws SchedulerError with a human message so
 * both the REST API and the MCP server can surface it directly.
 */
export function validateSegments(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new SchedulerError('A thread needs at least one text segment.');
  }
  if (input.length > MAX_SEGMENTS) {
    throw new SchedulerError(`A thread can have at most ${MAX_SEGMENTS} segments.`);
  }
  const segments = input.map((s, i) => {
    if (typeof s !== 'string') throw new SchedulerError(`Segment ${i + 1} is not text.`);
    const trimmed = s.trim();
    if (!trimmed) throw new SchedulerError(`Segment ${i + 1} is empty.`);
    if (trimmed.length > MAX_SEGMENT_LENGTH) {
      throw new SchedulerError(
        `Segment ${i + 1} is ${trimmed.length} chars — the limit is ${MAX_SEGMENT_LENGTH}.`,
      );
    }
    return trimmed;
  });
  return segments;
}

/**
 * Validate an optional per-segment image URL array. Returns null when there's no
 * media (a plain text thread), or a cleaned array of the same length as
 * `segmentCount` where each entry is either a public http(s) URL or null.
 */
export function validateMediaUrls(
  input: unknown,
  segmentCount: number,
): (string | null)[] | null {
  if (input == null) return null;
  if (!Array.isArray(input)) {
    throw new SchedulerError('mediaUrls must be an array aligned with segments.');
  }
  if (input.length !== segmentCount) {
    throw new SchedulerError(
      `mediaUrls has ${input.length} entries but there are ${segmentCount} segments.`,
    );
  }
  const cleaned = input.map((u, i) => {
    if (u == null || u === '') return null;
    if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) {
      throw new SchedulerError(`mediaUrls[${i}] must be a public http(s) URL.`);
    }
    return u;
  });
  // All-null is equivalent to no media — normalize so text threads stay clean.
  return cleaned.some(Boolean) ? cleaned : null;
}

/** Realign a media array to a new segment length (preserve by index, pad/trim). */
function realignMediaUrls(
  media: (string | null)[] | null | undefined,
  newLength: number,
): (string | null)[] | null {
  if (!media || !media.some(Boolean)) return null;
  const out: (string | null)[] = [];
  for (let i = 0; i < newLength; i++) out.push(media[i] ?? null);
  return out.some(Boolean) ? out : null;
}

function normalizeReplyControl(value: unknown): ReplyControl | null {
  if (value == null) return null;
  if (typeof value === 'string' && (REPLY_CONTROLS as string[]).includes(value)) {
    return value as ReplyControl;
  }
  throw new SchedulerError(`Invalid reply control: ${String(value)}.`);
}

export interface CreateThreadInput {
  threadsUserId: string;
  segments: unknown;
  /** Optional per-segment image URLs (index-aligned with segments). */
  mediaUrls?: unknown;
  /** ISO 8601 string or Date. Omit / past value = publish as soon as the cron runs. */
  scheduledAt?: string | Date | null;
  replyControl?: unknown;
  source?: 'web' | 'mcp' | 'autopost';
  /** 'draft' parks it in the Studio without ever auto-publishing; default 'pending'. */
  status?: 'pending' | 'draft';
}

/** Queue a thread for publishing. Validates before touching the DB. */
export async function createScheduledThread(input: CreateThreadInput): Promise<ScheduledThread> {
  const segments = validateSegments(input.segments);
  const mediaUrls = validateMediaUrls(input.mediaUrls, segments.length);
  const replyControl = normalizeReplyControl(input.replyControl);
  const status = input.status === 'draft' ? 'draft' : 'pending';

  let scheduledAt: Date;
  if (input.scheduledAt == null) {
    scheduledAt = new Date();
  } else {
    scheduledAt = input.scheduledAt instanceof Date ? input.scheduledAt : new Date(input.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new SchedulerError('scheduledAt is not a valid date/time.');
    }
  }

  const [row] = await getDb()
    .insert(scheduledThreads)
    .values({
      id: randomUUID(),
      threadsUserId: input.threadsUserId,
      segments,
      mediaUrls: mediaUrls ?? undefined,
      replyControl: replyControl ?? undefined,
      scheduledAt,
      status,
      source: input.source ?? 'web',
    })
    .returning();
  return row;
}

export interface ListFilter {
  threadsUserId?: string;
  status?: ScheduledThread['status'];
  limit?: number;
}

export async function listScheduledThreads(filter: ListFilter = {}): Promise<ScheduledThread[]> {
  const conds = [];
  if (filter.threadsUserId) conds.push(eq(scheduledThreads.threadsUserId, filter.threadsUserId));
  if (filter.status) conds.push(eq(scheduledThreads.status, filter.status));
  return getDb()
    .select()
    .from(scheduledThreads)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(scheduledThreads.scheduledAt))
    .limit(filter.limit ?? 100);
}

export async function getScheduledThread(id: string): Promise<ScheduledThread | null> {
  const [row] = await getDb()
    .select()
    .from(scheduledThreads)
    .where(eq(scheduledThreads.id, id))
    .limit(1);
  return row ?? null;
}

export interface UpdateThreadInput {
  segments?: unknown;
  mediaUrls?: unknown;
  scheduledAt?: string | Date | null;
  replyControl?: unknown;
  /** Promote a draft to 'pending' (i.e. actually queue it for publishing). */
  status?: 'pending';
}

/**
 * Edit a still-editable thread (content, media, time, reply control) and/or
 * promote a draft to pending. Only rows still in `pending` or `draft` are
 * editable — once publishing/posted/failed, edits are rejected (returns null) so
 * we never mutate something already in flight. Used by the studio calendar to
 * reschedule and revise queued posts, and by draft → schedule promotion.
 */
export async function updateScheduledThread(
  id: string,
  input: UpdateThreadInput,
): Promise<ScheduledThread | null> {
  const set: Partial<typeof scheduledThreads.$inferInsert> = { updatedAt: new Date() };

  if (input.segments !== undefined) {
    const segments = validateSegments(input.segments);
    set.segments = segments;
    if (input.mediaUrls !== undefined) {
      // New media supplied alongside new segments — validate against the new count.
      set.mediaUrls = validateMediaUrls(input.mediaUrls, segments.length);
    } else {
      // Segments changed but media wasn't — realign existing media to the new length
      // so the index-aligned arrays never drift apart.
      const existing = await getScheduledThread(id);
      set.mediaUrls = realignMediaUrls(existing?.mediaUrls, segments.length);
    }
  } else if (input.mediaUrls !== undefined) {
    // Media changed alone — validate against the existing segment count.
    const existing = await getScheduledThread(id);
    set.mediaUrls = validateMediaUrls(input.mediaUrls, existing?.segments.length ?? 0);
  }

  if (input.replyControl !== undefined) {
    set.replyControl = normalizeReplyControl(input.replyControl) ?? null;
  }
  if (input.scheduledAt !== undefined) {
    if (input.scheduledAt == null) {
      throw new SchedulerError('scheduledAt cannot be cleared.');
    }
    const when =
      input.scheduledAt instanceof Date ? input.scheduledAt : new Date(input.scheduledAt);
    if (Number.isNaN(when.getTime())) {
      throw new SchedulerError('scheduledAt is not a valid date/time.');
    }
    set.scheduledAt = when;
  }
  if (input.status === 'pending') set.status = 'pending';

  const rows = await getDb()
    .update(scheduledThreads)
    .set(set)
    .where(
      and(
        eq(scheduledThreads.id, id),
        inArray(scheduledThreads.status, ['pending', 'draft']),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Cancel a still-pending or draft thread. No-op-safe: in-flight rows can't be canceled. */
export async function cancelScheduledThread(id: string): Promise<boolean> {
  // Read the media before the write, since the update nulls the column.
  const existing = await getScheduledThread(id);
  const rows = await getDb()
    .update(scheduledThreads)
    .set({ status: 'canceled', mediaUrls: null, updatedAt: new Date() })
    .where(
      and(eq(scheduledThreads.id, id), inArray(scheduledThreads.status, ['pending', 'draft'])),
    )
    .returning({ id: scheduledThreads.id });
  // A canceled draft will never publish — free its durable image copies.
  if (rows.length) await deleteStoredImages(existing?.mediaUrls ?? null);
  return rows.length > 0;
}

/**
 * Publish a single queued thread. Atomically claims the row (pending →
 * publishing) so overlapping cron runs can't double-post, then publishes the
 * chain and records the outcome. Returns the final row state.
 */
export async function runScheduledThread(id: string): Promise<ScheduledThread> {
  // Claim: flip pending → publishing only if still pending.
  const claimed = await getDb()
    .update(scheduledThreads)
    .set({
      status: 'publishing',
      attempts: sql`${scheduledThreads.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(scheduledThreads.id, id), eq(scheduledThreads.status, 'pending')))
    .returning();
  if (!claimed.length) {
    const existing = await getScheduledThread(id);
    if (!existing) throw new SchedulerError('Scheduled thread not found.');
    throw new SchedulerError(`Thread is not pending (status: ${existing.status}).`);
  }
  const row = claimed[0]; // row.attempts is already incremented by the claim.

  // Track chain progress so a mid-thread failure doesn't get republished from
  // the top (which would duplicate the already-posted segments).
  const publishedSoFar: string[] = [];
  try {
    const token = await getAccessToken(row.threadsUserId);
    if (!token) throw new Error('No stored access token for this account.');

    const publishedIds = await publishThreadChain({
      threadsUserId: row.threadsUserId,
      accessToken: token,
      segments: row.segments,
      mediaUrls: row.mediaUrls ?? undefined,
      replyControl: (row.replyControl as ReplyControl | null) ?? undefined,
      onProgress: (ids) => {
        publishedSoFar.length = 0;
        publishedSoFar.push(...ids);
      },
    });

    // Meta has fetched the images by now, so drop our durable copies and the
    // media references — the post lives on Threads (linked via permalink).
    await deleteStoredImages(row.mediaUrls);

    const [done] = await getDb()
      .update(scheduledThreads)
      .set({
        status: 'posted',
        publishedIds,
        mediaUrls: null,
        error: null,
        postedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scheduledThreads.id, id))
      .returning();
    return done;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Publish failed.';
    // Meta's publish endpoints flap (empty 5xx) for minutes at a time. If nothing
    // was published yet and we haven't exhausted attempts, put the row back to
    // 'pending' so the publish cron retries it — rather than losing the post.
    const transient = err instanceof ThreadsApiError && err.status >= 500;
    const requeue =
      transient && publishedSoFar.length === 0 && row.attempts < MAX_ATTEMPTS;

    const [updated] = await getDb()
      .update(scheduledThreads)
      .set({
        status: requeue ? 'pending' : 'failed',
        error: message,
        publishedIds: publishedSoFar.length ? publishedSoFar : null,
        updatedAt: new Date(),
      })
      .where(eq(scheduledThreads.id, id))
      .returning();
    return updated;
  }
}

/**
 * Drain all due threads (pending and scheduled at/before `now`). Runs them
 * sequentially — each thread already sleeps between its own segments, and
 * serial publishing keeps us well under Threads' burst limits.
 */
export async function publishDueThreads(now: Date = new Date()): Promise<{
  processed: number;
  results: { id: string; status: string; error?: string | null }[];
}> {
  const due = await getDb()
    .select({ id: scheduledThreads.id })
    .from(scheduledThreads)
    .where(and(eq(scheduledThreads.status, 'pending'), lte(scheduledThreads.scheduledAt, now)))
    .orderBy(asc(scheduledThreads.scheduledAt))
    .limit(25);

  const results: { id: string; status: string; error?: string | null }[] = [];
  for (const { id } of due) {
    try {
      const row = await runScheduledThread(id);
      results.push({ id, status: row.status, error: row.error });
    } catch (err) {
      results.push({
        id,
        status: 'error',
        error: err instanceof Error ? err.message : 'run failed',
      });
    }
  }
  return { processed: due.length, results };
}
