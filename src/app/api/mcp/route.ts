import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import sharp from 'sharp';
import { listAccounts } from '@/lib/accounts';
import {
  createScheduledThread,
  listScheduledThreads,
  getScheduledThread,
  updateScheduledThread,
  cancelScheduledThread,
  runScheduledThread,
  SchedulerError,
} from '@/lib/scheduler';
import type { ScheduledThread } from '@/db/schema';
import { getAnalytics } from '@/lib/analytics';
import { extractHook } from '@/lib/hooks';
import { verifyBearerToken } from '@/lib/oauth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Resolve a user-supplied account reference (either a Threads user id or an
 * @username, with or without the @) to a stored account. Returns null if none
 * of the connected accounts match.
 */
async function resolveAccount(ref: string) {
  const accounts = await listAccounts();
  const needle = ref.trim().replace(/^@/, '').toLowerCase();
  return (
    accounts.find((a) => a.threadsUserId === ref) ??
    accounts.find((a) => a.username.toLowerCase() === needle) ??
    null
  );
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

const REPLY_CONTROL = z.enum(['everyone', 'accounts_you_follow', 'mentioned_only']);

/**
 * Render a thread's full content as text: every segment (not just the first),
 * numbered, with each part's image URL, plus status/timing/permalink. This is
 * what lets Claude read all 8 parts of an AutoPost draft instead of a preview.
 */
function formatThreadFull(r: ScheduledThread, username: string): string {
  const lines: string[] = [
    `[${r.status}] id: ${r.id}`,
    `@${username} · ${r.segments.length} part${r.segments.length === 1 ? '' : 's'} · scheduled ${new Date(
      r.scheduledAt,
    ).toISOString()}${r.postedAt ? ` · posted ${new Date(r.postedAt).toISOString()}` : ''}`,
  ];
  if (r.permalink) lines.push(`permalink: ${r.permalink}`);
  r.segments.forEach((s, i) => {
    lines.push(`  ${i + 1}. ${s}`);
    const img = r.mediaUrls?.[i];
    if (img) lines.push(`     [image ${i + 1}] ${img}`);
  });
  if (r.error) lines.push(`  error: ${r.error}`);
  return lines.join('\n');
}

/** An MCP image content block the client can render inline. */
type ImageBlock = { type: 'image'; data: string; mimeType: string };

/**
 * Fetch a thread's per-segment images and return them as inline image blocks so
 * Claude can actually view them (the client can't fetch the storage URLs
 * itself). Each image is downscaled + recompressed to WebP first — the source
 * slides are ~1.3 MB each, so at full size only ~3 fit before any sane payload
 * budget is exhausted; at ≤1568px/WebP a full 8-part thread comfortably fits in
 * one result while staying legible for reading text off a slide. `only` limits
 * to specific 1-based part numbers so a caller can page through explicitly.
 *
 * Media is cleared once a thread posts, so this only yields images for drafts /
 * pending / failed threads.
 */
async function fetchImageBlocks(
  mediaUrls: (string | null)[] | null | undefined,
  only?: number[],
): Promise<{ index: number; block: ImageBlock }[]> {
  if (!mediaUrls) return [];
  const out: { index: number; block: ImageBlock }[] = [];
  let budget = 18_000_000; // ~18 MB of downscaled output — ample for a full thread
  for (let i = 0; i < mediaUrls.length; i++) {
    const url = mediaUrls[i];
    if (!url) continue;
    if (only && !only.includes(i + 1)) continue;
    if (budget <= 0) break;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.startsWith('image/')) continue;
      const original = Buffer.from(await res.arrayBuffer());

      let data: Buffer;
      let mimeType: string;
      try {
        data = await sharp(original)
          .rotate() // honor EXIF orientation before resizing
          .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        mimeType = 'image/webp';
      } catch {
        // sharp failed — fall back to the original, size-guarded so it can't blow up.
        if (original.byteLength > 3_000_000) continue;
        data = original;
        mimeType = ct;
      }

      if (data.byteLength > budget) continue;
      budget -= data.byteLength;
      out.push({ index: i + 1, block: { type: 'image', data: data.toString('base64'), mimeType } });
    } catch {
      /* skip unreachable image */
    }
  }
  return out;
}

const baseHandler = createMcpHandler(
  (server) => {
    // -- Discovery -------------------------------------------------------
    server.registerTool(
      'list_accounts',
      {
        title: 'List connected Threads accounts',
        description:
          'List the Threads accounts you can post as. Use the returned username or id as the "account" argument for other tools.',
        inputSchema: z.object({}),
      },
      async () => {
        const accounts = await listAccounts();
        if (!accounts.length) return text('No accounts are connected.');
        return text(
          accounts
            .map((a) => `@${a.username} (id: ${a.threadsUserId})`)
            .join('\n'),
        );
      },
    );

    // -- Read hooks to inform writing -----------------------------------
    server.registerTool(
      'get_top_hooks',
      {
        title: 'Get top-performing hooks',
        description:
          "Return an account's best-performing recent posts (by likes) with their hook line, likes, views, and engagement rate. Use this to study what hooks work before writing new ones.",
        inputSchema: z.object({
          account: z.string().describe('Account username or id'),
          days: z.number().int().min(1).max(90).default(30).describe('Look-back window in days'),
          limit: z.number().int().min(1).max(50).default(15),
        }),
      },
      async ({ account, days, limit }) => {
        const acct = await resolveAccount(account);
        if (!acct) return text(`No connected account matches "${account}".`);
        const data = await getAnalytics({ threadsUserId: acct.threadsUserId, days });
        const top = [...data.posts]
          .sort((a, b) => b.likes - a.likes)
          .slice(0, limit)
          .map((p, i) => {
            const hook = extractHook(p.text) || '(no text)';
            return `${i + 1}. "${hook}" — ${p.likes.toLocaleString()} likes, ${p.views.toLocaleString()} views, ${(p.engagementRate * 100).toFixed(1)}% eng.`;
          });
        return text(
          top.length
            ? `Top hooks for @${acct.username} (last ${days}d):\n${top.join('\n')}`
            : `No posts found for @${acct.username} in the last ${days} days.`,
        );
      },
    );

    // -- Schedule --------------------------------------------------------
    server.registerTool(
      'schedule_thread',
      {
        title: 'Schedule a thread',
        description:
          'Queue a single post or a multi-part thread to publish at a future time. Segments are published as a connected reply chain (part 1, 2, 3…). Each segment is max 500 characters.',
        inputSchema: z.object({
          account: z.string().describe('Account username or id'),
          segments: z
            .array(z.string())
            .min(1)
            .describe('Ordered post bodies. One item = a single post; multiple = a thread.'),
          scheduled_at: z
            .string()
            .describe('ISO 8601 date-time for when to publish (e.g. 2026-08-24T15:30:00Z).'),
          reply_control: REPLY_CONTROL.optional().describe('Who can reply (applies to the root post).'),
        }),
      },
      async ({ account, segments, scheduled_at, reply_control }) => {
        const acct = await resolveAccount(account);
        if (!acct) return text(`No connected account matches "${account}".`);
        try {
          const row = await createScheduledThread({
            threadsUserId: acct.threadsUserId,
            segments,
            scheduledAt: scheduled_at,
            replyControl: reply_control,
            source: 'mcp',
          });
          return text(
            `Scheduled a ${row.segments.length}-part thread for @${acct.username} at ${new Date(
              row.scheduledAt,
            ).toISOString()}.\nid: ${row.id}`,
          );
        } catch (err) {
          if (err instanceof SchedulerError) return text(`Could not schedule: ${err.message}`);
          throw err;
        }
      },
    );

    // -- Publish immediately --------------------------------------------
    server.registerTool(
      'publish_thread_now',
      {
        title: 'Publish a thread now',
        description:
          'Immediately publish a single post or multi-part thread (connected reply chain). Each segment is max 500 characters. Returns the published post link on success.',
        inputSchema: z.object({
          account: z.string().describe('Account username or id'),
          segments: z.array(z.string()).min(1),
          reply_control: REPLY_CONTROL.optional(),
        }),
      },
      async ({ account, segments, reply_control }) => {
        const acct = await resolveAccount(account);
        if (!acct) return text(`No connected account matches "${account}".`);
        try {
          const created = await createScheduledThread({
            threadsUserId: acct.threadsUserId,
            segments,
            scheduledAt: new Date(),
            replyControl: reply_control,
            source: 'mcp',
          });
          const result = await runScheduledThread(created.id);
          if (result.status === 'posted') {
            return text(
              `Published a ${result.segments.length}-part thread to @${acct.username}. ✓\nMedia ids: ${(result.publishedIds ?? []).join(', ')}`,
            );
          }
          if (result.status === 'pending') {
            return text(
              `Threads' API had a transient error, so this thread was requeued (id: ${result.id}) and will auto-publish within ~a minute — no action needed. Last error: ${result.error}`,
            );
          }
          return text(`Publish failed: ${result.error ?? 'unknown error'}`);
        } catch (err) {
          if (err instanceof SchedulerError) return text(`Could not publish: ${err.message}`);
          throw err;
        }
      },
    );

    // -- Manage queue ----------------------------------------------------
    server.registerTool(
      'list_scheduled',
      {
        title: 'List scheduled/recent threads',
        description:
          'List queued, draft, posted, and failed threads (optionally filtered by account or status). Returns every thread in full — all segments and image URLs, not just a preview. To also view the images inline, pass a thread id to get_thread.',
        inputSchema: z.object({
          account: z.string().optional().describe('Account username or id (omit for all).'),
          status: z
            .enum(['draft', 'pending', 'publishing', 'posted', 'failed', 'canceled'])
            .optional()
            .describe('Filter to one status. Omit for all. Use "draft" for AutoPost drafts.'),
        }),
      },
      async ({ account, status }) => {
        let threadsUserId: string | undefined;
        if (account) {
          const acct = await resolveAccount(account);
          if (!acct) return text(`No connected account matches "${account}".`);
          threadsUserId = acct.threadsUserId;
        }
        const rows = await listScheduledThreads({ threadsUserId, status });
        if (!rows.length) return text('No matching threads.');
        const accounts = await listAccounts();
        const nameOf = (id: string) =>
          accounts.find((a) => a.threadsUserId === id)?.username ?? id;
        return text(
          rows.map((r) => formatThreadFull(r, nameOf(r.threadsUserId))).join('\n\n───\n\n') +
            '\n\nTip: call get_thread with an id to view a thread’s images inline.',
        );
      },
    );

    server.registerTool(
      'get_thread',
      {
        title: 'Get one thread in full (with images)',
        description:
          'Fetch a single queued/draft/posted thread by its id and return its complete content — every segment in full plus its images rendered inline (downscaled) so you can view them. All parts are returned by default; pass `parts` to view only specific slides. (Images are only available while a thread is a draft/pending/failed; they’re cleared once it posts.)',
        inputSchema: z.object({
          id: z.string().describe('Thread id (from list_scheduled).'),
          parts: z
            .array(z.number().int().min(1))
            .optional()
            .describe('1-based part numbers to render images for, e.g. [4,5,6,7]. Omit for all.'),
        }),
      },
      async ({ id, parts }) => {
        const row = await getScheduledThread(id);
        if (!row) return text(`No thread with id ${id}.`);
        const accounts = await listAccounts();
        const username =
          accounts.find((a) => a.threadsUserId === row.threadsUserId)?.username ??
          row.threadsUserId;

        const totalImages = row.mediaUrls?.filter(Boolean).length ?? 0;
        const images = await fetchImageBlocks(row.mediaUrls, parts);

        const content: ({ type: 'text'; text: string } | ImageBlock)[] = [
          { type: 'text', text: formatThreadFull(row, username) },
        ];
        for (const { index, block } of images) {
          content.push({ type: 'text', text: `— image for part ${index} —` });
          content.push(block);
        }
        if (totalImages > 0 && images.length === 0) {
          content.push({
            type: 'text',
            text: '(Images are attached but couldn’t be rendered inline — see the URLs above.)',
          });
        } else if (!parts && images.length < totalImages) {
          content.push({
            type: 'text',
            text: `(${images.length}/${totalImages} images shown. Call get_thread again with parts:[…] to fetch the rest.)`,
          });
        }
        return { content };
      },
    );

    server.registerTool(
      'edit_thread',
      {
        title: 'Edit a draft or scheduled thread',
        description:
          'Edit an existing draft or still-pending thread in place — replace its text segments, its per-segment images, its scheduled time, or its reply control. Only works while the thread is a draft or pending (not once it is publishing/posted/failed/canceled). Pass `queue: true` to promote a draft into the scheduled queue so it will auto-publish at its scheduled time. Any field you omit is left unchanged; if you change `segments` without passing `media_urls`, existing images are kept by position.',
        inputSchema: z.object({
          id: z.string().describe('Thread id (from list_scheduled).'),
          segments: z
            .array(z.string())
            .min(1)
            .optional()
            .describe('New complete ordered set of post bodies (replaces ALL segments). Max 500 chars each.'),
          media_urls: z
            .array(z.string().nullable())
            .optional()
            .describe(
              'Per-segment public image URLs, index-aligned with segments (null = text-only part). Replaces existing media. Must be publicly fetchable http(s) URLs.',
            ),
          scheduled_at: z
            .string()
            .optional()
            .describe('New ISO 8601 publish time (e.g. 2026-08-24T15:30:00Z).'),
          reply_control: REPLY_CONTROL.optional().describe('Who can reply (applies to the root post).'),
          queue: z
            .boolean()
            .optional()
            .describe('Promote a draft to the scheduled queue (status → pending) so the cron will publish it.'),
        }),
      },
      async ({ id, segments, media_urls, scheduled_at, reply_control, queue }) => {
        try {
          const row = await updateScheduledThread(id, {
            segments,
            mediaUrls: media_urls,
            scheduledAt: scheduled_at,
            replyControl: reply_control,
            status: queue ? 'pending' : undefined,
          });
          if (!row) {
            return text(
              `Could not edit ${id}: it doesn't exist, or it's no longer editable (only drafts and pending threads can be edited — not ones already publishing/posted/failed/canceled).`,
            );
          }
          const accounts = await listAccounts();
          const username =
            accounts.find((a) => a.threadsUserId === row.threadsUserId)?.username ??
            row.threadsUserId;
          return text(`Updated thread ${id}.\n\n${formatThreadFull(row, username)}`);
        } catch (err) {
          if (err instanceof SchedulerError) return text(`Could not edit: ${err.message}`);
          throw err;
        }
      },
    );

    server.registerTool(
      'cancel_scheduled',
      {
        title: 'Cancel a scheduled thread',
        description: 'Cancel a still-pending scheduled thread by its id.',
        inputSchema: z.object({ id: z.string() }),
      },
      async ({ id }) => {
        const ok = await cancelScheduledThread(id);
        return text(ok ? `Canceled ${id}.` : `Could not cancel ${id} (not found or already sent).`);
      },
    );
  },
  {
    serverInfo: { name: 'thread-analytics', version: '1.0.0' },
  },
);

/**
 * Auth gate accepting two credential types:
 *  1. An OAuth 2.1 access token issued by our own auth server (claude.ai flow).
 *  2. The static MCP_SECRET bearer (Claude Desktop / Claude Code / scripts).
 *
 * On failure withMcpAuth returns 401 with a WWW-Authenticate header pointing at
 * the protected-resource metadata, which is how claude.ai discovers the OAuth
 * server and kicks off the connect flow.
 */
const handler = withMcpAuth(
  baseHandler,
  async (_req, bearer) => {
    if (!bearer) return undefined;
    const oauth = verifyBearerToken(bearer);
    if (oauth) return { token: bearer, clientId: oauth.client_id, scopes: oauth.scope.split(' ') };
    const secret = process.env.MCP_SECRET;
    if (secret && bearer === secret) {
      return { token: bearer, clientId: 'thread-analytics-mcp', scopes: [] };
    }
    return undefined;
  },
  { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource' },
);

export { handler as GET, handler as POST, handler as DELETE };
