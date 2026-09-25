import { NextRequest, NextResponse } from 'next/server';
import { publishDueThreads } from '@/lib/scheduler';

export const dynamic = 'force-dynamic';
// A multi-part thread sleeps ~2s between segments, so give the drain room.
export const maxDuration = 300;

/**
 * GET /api/cron/publish — publishes every queued thread whose scheduled time
 * has arrived (drains up to 25 due threads per call).
 *
 * On the Vercel Hobby plan cron jobs run at most once/day, which is too coarse
 * for time-accurate posting, so this is NOT in vercel.json's `crons`. Instead an
 * external scheduler (e.g. cron-job.org) hits this endpoint every ~5 minutes.
 *
 * Protected by CRON_SECRET: the external caller must send
 * `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const outcome = await publishDueThreads();
    return NextResponse.json({ ranAt: new Date().toISOString(), ...outcome });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Publish run failed' },
      { status: 500 },
    );
  }
}
