import { NextRequest, NextResponse } from 'next/server';
import { runAutoReplies } from '@/lib/autoreply';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/autoreply — answer new product-keyword comments with the link
 * (see src/lib/autoreply.ts). It already runs after every /api/cron/publish
 * drain; this route is for manual runs. `?dry=1` lists what would be answered
 * without posting anything.
 *
 * Protected by CRON_SECRET (`Authorization: Bearer <CRON_SECRET>`).
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
    const dryRun = req.nextUrl.searchParams.get('dry') === '1';
    const outcome = await runAutoReplies({ dryRun });
    return NextResponse.json({ ranAt: new Date().toISOString(), dryRun, ...outcome });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Auto-reply run failed' },
      { status: 500 },
    );
  }
}
