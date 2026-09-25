import { NextResponse } from 'next/server';
import {
  cancelScheduledThread,
  getScheduledThread,
  updateScheduledThread,
  runScheduledThread,
  SchedulerError,
} from '@/lib/scheduler';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** GET /api/schedule/[id] — fetch one scheduled thread. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await getScheduledThread(id);
  if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ thread: row });
}

/**
 * PATCH /api/schedule/[id] — edit a pending thread, or publish it now.
 * Body: { segments?, scheduledAt?, replyControl?, publishNow? }.
 * When `publishNow` is true the queued thread is published immediately and its
 * final status is returned (the row's own status carries success/requeue/fail).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: {
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

  try {
    if (body.publishNow) {
      // Apply any edits and promote a draft to pending, then publish immediately.
      const promoted = await updateScheduledThread(id, {
        segments: body.segments,
        mediaUrls: body.mediaUrls,
        scheduledAt: body.scheduledAt,
        replyControl: body.replyControl,
        status: 'pending',
      });
      if (!promoted) {
        return NextResponse.json(
          { error: 'Thread not found or no longer editable.' },
          { status: 409 },
        );
      }
      const result = await runScheduledThread(id);
      return NextResponse.json({ thread: result });
    }

    const hasEdits =
      body.segments !== undefined ||
      body.mediaUrls !== undefined ||
      body.scheduledAt !== undefined ||
      body.replyControl !== undefined;
    if (hasEdits) {
      const updated = await updateScheduledThread(id, {
        segments: body.segments,
        mediaUrls: body.mediaUrls,
        scheduledAt: body.scheduledAt,
        replyControl: body.replyControl,
        // Setting a schedule moves a draft into the publish queue.
        status: body.scheduledAt !== undefined ? 'pending' : undefined,
      });
      if (!updated) {
        return NextResponse.json(
          { error: 'Thread not found or no longer editable.' },
          { status: 409 },
        );
      }
      return NextResponse.json({ thread: updated });
    }

    const row = await getScheduledThread(id);
    if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ thread: row });
  } catch (err) {
    if (err instanceof SchedulerError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update thread' },
      { status: 500 },
    );
  }
}

/** DELETE /api/schedule/[id] — cancel a still-pending thread. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const canceled = await cancelScheduledThread(id);
  if (!canceled) {
    return NextResponse.json(
      { error: 'Thread not found or no longer pending.' },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
