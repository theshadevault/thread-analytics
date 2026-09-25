import { NextRequest, NextResponse } from 'next/server';
import { createScheduledThread, runScheduledThread, SchedulerError } from '@/lib/scheduler';
import { rehostMediaUrls } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/ingest — authenticated intake for external tools (e.g. the AutoPost
 * app) to push a thread into the scheduler. Unlike the browser-facing
 * /api/schedule, this door requires a shared secret because it publishes to real
 * accounts from a machine caller.
 *
 * Auth: `Authorization: Bearer <INGEST_SECRET>`. Fails closed if the secret env
 * isn't configured, so the endpoint is never accidentally left open.
 *
 * Body: {
 *   threadsUserId: string,
 *   segments: string[],
 *   mediaUrls?: (string | null)[],   // public image URL per segment, index-aligned
 *   replyControl?: 'everyone' | 'accounts_you_follow' | 'mentioned_only',
 *   scheduledAt?: string,            // ISO 8601; when to auto-publish
 *   draft?: boolean,                 // park in Studio without auto-publishing
 *   publishNow?: boolean,            // publish immediately, return final status
 * }
 */
export async function POST(req: NextRequest) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Ingest is not configured.' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    threadsUserId?: string;
    segments?: unknown;
    mediaUrls?: unknown;
    replyControl?: unknown;
    scheduledAt?: string | null;
    draft?: boolean;
    publishNow?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.threadsUserId) {
    return NextResponse.json({ error: 'threadsUserId is required.' }, { status: 400 });
  }

  try {
    // Copy AutoPost's ephemeral blob images into our durable Supabase bucket
    // before storing, so the pictures survive its 1-hour blob cleanup. Falls
    // back to the original URLs if storage is unconfigured or a copy fails.
    const mediaUrls = Array.isArray(body.mediaUrls)
      ? await rehostMediaUrls(body.mediaUrls as (string | null)[])
      : body.mediaUrls;

    const created = await createScheduledThread({
      threadsUserId: body.threadsUserId,
      segments: body.segments,
      mediaUrls,
      replyControl: body.replyControl,
      scheduledAt: body.publishNow ? new Date() : body.scheduledAt ?? null,
      // publishNow forces pending (a draft can't be run); otherwise honor draft.
      status: !body.publishNow && body.draft ? 'draft' : 'pending',
      source: 'autopost',
    });

    if (body.publishNow) {
      const result = await runScheduledThread(created.id);
      return NextResponse.json({ thread: result });
    }

    return NextResponse.json({ thread: created }, { status: 201 });
  } catch (err) {
    if (err instanceof SchedulerError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to ingest thread' },
      { status: 500 },
    );
  }
}
