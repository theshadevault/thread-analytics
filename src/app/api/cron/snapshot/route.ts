import { NextRequest, NextResponse } from 'next/server';
import { captureSnapshots } from '@/lib/snapshots';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/snapshot — hit daily by Vercel Cron (see vercel.json).
 * Writes one daily_snapshots row per account. CRON_SECRET-protected.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const results = await captureSnapshots();
    return NextResponse.json({ snapshotAt: new Date().toISOString(), results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'snapshot failed' },
      { status: 500 },
    );
  }
}
