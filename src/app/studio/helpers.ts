import type { ScheduledThread } from '@/db/schema';
import type { PublicAccount } from '@/lib/accounts';

/** Visual + label metadata per thread status, keyed off the DB `status` column. */
export const STATUS_META: Record<
  string,
  { label: string; color: string; bg: string; ring: string }
> = {
  draft: {
    label: 'Draft',
    color: '#8b5cf6',
    bg: 'color-mix(in srgb, #8b5cf6 14%, transparent)',
    ring: 'color-mix(in srgb, #8b5cf6 45%, transparent)',
  },
  pending: {
    label: 'Scheduled',
    color: 'var(--accent)',
    bg: 'color-mix(in srgb, var(--accent) 14%, transparent)',
    ring: 'color-mix(in srgb, var(--accent) 45%, transparent)',
  },
  publishing: {
    label: 'Publishing…',
    color: '#d98a00',
    bg: 'color-mix(in srgb, #d98a00 16%, transparent)',
    ring: 'color-mix(in srgb, #d98a00 45%, transparent)',
  },
  posted: {
    label: 'Posted',
    color: 'var(--good)',
    bg: 'color-mix(in srgb, var(--good) 14%, transparent)',
    ring: 'color-mix(in srgb, var(--good) 45%, transparent)',
  },
  failed: {
    label: 'Failed',
    color: '#e5484d',
    bg: 'color-mix(in srgb, #e5484d 14%, transparent)',
    ring: 'color-mix(in srgb, #e5484d 45%, transparent)',
  },
  canceled: {
    label: 'Canceled',
    color: 'var(--text-muted)',
    bg: 'color-mix(in srgb, var(--text-muted) 12%, transparent)',
    ring: 'color-mix(in srgb, var(--text-muted) 35%, transparent)',
  },
};

export function statusMeta(status: string) {
  return STATUS_META[status] ?? STATUS_META.pending;
}

/** Drafts live in their own section — they're never placed on the timeline/calendar. */
export function isDraft(t: { status: string }): boolean {
  return t.status === 'draft';
}

/**
 * The date a thread occupies on the timeline (calendar buckets, list sort).
 *
 * A posted thread lands on when it *actually* went out (`postedAt`), not when it
 * was queued — so a draft published later doesn't stay pinned to its creation
 * time. Everything still in flight (pending, publishing, failed) uses its
 * scheduled time.
 */
export function displayDate(t: {
  status: string;
  scheduledAt: string | Date;
  postedAt?: string | Date | null;
}): Date {
  if (t.status === 'posted' && t.postedAt) return new Date(t.postedAt);
  return new Date(t.scheduledAt);
}

/** True when a thread carries at least one per-segment image. */
export function hasMedia(thread: { mediaUrls?: (string | null)[] | null }): boolean {
  return Boolean(thread.mediaUrls?.some(Boolean));
}

/** base64url-encode a string in the browser (ASCII URLs only — blob URLs are). */
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Route a post image through our same-origin proxy. Blob images won't render
 * cross-origin in some setups (referrer rules, and content blockers that match
 * the blob hostname anywhere in a request URL). The proxy loads them as
 * first-party requests, and the target is base64url-encoded (`?u=`) so the blob
 * hostname never appears literally in the request URL for a blocker to match.
 * Non-blob/relative URLs are returned untouched.
 */
export function imageSrc(url: string): string {
  return /^https:\/\/[^/]*\.public\.blob\.vercel-storage\.com\//i.test(url)
    ? `/api/img?u=${b64url(url)}`
    : url;
}

/** Deterministic pastel-on-dark colour for an account monogram avatar. */
const AVATAR_HUES = [210, 160, 280, 20, 330, 130, 45, 250];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${AVATAR_HUES[h % AVATAR_HUES.length]} 55% 45%)`;
}

export function usernameFor(
  threadsUserId: string,
  accounts: PublicAccount[],
): string {
  return accounts.find((a) => a.threadsUserId === threadsUserId)?.username ?? '?';
}

// ---- date helpers (all local-time; the calendar is a local-time grid) -------

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Local YYYY-MM-DD key for bucketing threads into day cells. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/**
 * Build the Monday-start grid of days covering `month` (padded with the
 * trailing/leading days of adjacent months so every row has 7 cells).
 */
export function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  // JS getDay(): 0=Sun..6=Sat. Convert to Monday-start offset.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - lead);

  const days: Date[] = [];
  const cursor = new Date(start);
  // 6 weeks always renders a stable, non-jumping grid height.
  for (let i = 0; i < 42; i++) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/** Format a Date into the value a <input type="datetime-local"> expects (local). */
export function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export type Thread = ScheduledThread;
