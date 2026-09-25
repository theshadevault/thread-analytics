import { NextRequest, NextResponse } from 'next/server';
import {
  createScheduledThread,
  listScheduledThreads,
  runScheduledThread,
  SchedulerError,
} from '@/lib/scheduler';
import type { ScheduledThread } from '@/db/schema';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** GET /api/schedule?account=<id>&status=<status> — list queued/past threads. */
export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get('account') ?? undefined;
  const status = (req.nextUrl.searchParams.get('status') as ScheduledThread['status']) ?? undefined;
  try {
    const rows = await listScheduledThreads({ threadsUserId: account, status });
    return NextResponse.json({ threads: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list scheduled threads' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/schedule — queue a thread.
 * Body: { threadsUserId, segments: string[], scheduledAt?, replyControl?, publishNow? }
 * When `publishNow` is true the thread is published immediately (and its final
 * status returned) instead of waiting for the cron.
 */
export async function POST(req: NextRequest) {
  let body: {
    threadsUserId?: string;
    segments?: unknown;
    mediaUrls?: unknown;
    scheduledAt?: string | null;
    replyControl?: unknown;
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
    const created = await createScheduledThread({
      threadsUserId: body.threadsUserId,
      segments: body.segments,
      mediaUrls: body.mediaUrls,
      scheduledAt: body.publishNow ? new Date() : body.scheduledAt ?? null,
      replyControl: body.replyControl,
      source: 'web',
    });

    if (body.publishNow) {
      // The attempt ran; the thread's own `status` (posted / pending / failed)
      // carries the outcome, so a transient requeue isn't reported as an HTTP error.
      const result = await runScheduledThread(created.id);
      return NextResponse.json({ thread: result });
    }

    return NextResponse.json({ thread: created }, { status: 201 });
  } catch (err) {
    if (err instanceof SchedulerError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to schedule thread' },
      { status: 500 },
    );
  }
}
