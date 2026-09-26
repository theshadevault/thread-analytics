import { NextRequest, NextResponse } from 'next/server';
import { getThreadByPublishedId } from '@/lib/scheduler';
import { getAccessToken } from '@/lib/accounts';
import { getPostMedia } from '@/lib/threads';
import { rehostExternalUrls } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/repurpose — rebuild a whole thread for the Studio composer from one
 * of its published post ids.
 *
 * The analytics table lists individual posts, so "repurpose" only had the first
 * part's text. But threads posted through this app store their full ordered
 * `segments` plus every part's `publishedIds`. We look the thread up by the
 * clicked post id, return all segments, and recover each part's image by
 * fetching its Meta `media_url` (our own durable copies are deleted after
 * publish) — re-hosted into our bucket so a scheduled-for-later repost doesn't
 * break when Meta's temporary CDN URL expires.
 *
 * Body: { postId: string }
 * 200 → { segments: string[], mediaUrls: (string|null)[] | null }
 * 404 → post isn't one we published (caller falls back to the single post text).
 */
export async function POST(req: NextRequest) {
  let body: { postId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const postId = body.postId ? String(body.postId) : '';
  if (!postId) {
    return NextResponse.json({ error: 'postId is required.' }, { status: 400 });
  }

  const row = await getThreadByPublishedId(postId);
  if (!row) {
    return NextResponse.json({ error: 'Not a thread published from here.' }, { status: 404 });
  }

  let mediaUrls: (string | null)[] | null = null;
  const ids = row.publishedIds ?? [];
  const token = ids.length ? await getAccessToken(row.threadsUserId) : null;
  if (token && ids.length) {
    // publishedIds are index-aligned with segments (published in order). Pull
    // each part's current image URL from Meta; text-only parts return null.
    const fetched = await Promise.all(
      ids.map(async (id) => {
        try {
          const m = await getPostMedia({ mediaId: id, accessToken: token });
          return m.media_type === 'IMAGE' ? m.media_url : null;
        } catch {
          return null;
        }
      }),
    );
    const aligned = row.segments.map((_, i) => fetched[i] ?? null);
    mediaUrls = aligned.some(Boolean)
      ? ((await rehostExternalUrls(aligned)) ?? null)
      : null;
  }

  return NextResponse.json({ segments: row.segments, mediaUrls });
}
