import { NextRequest, NextResponse } from 'next/server';
import { getCombinedAnalytics } from '@/lib/analytics';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/analytics/combined?days=30&force=1
 * Pulls every stored account in parallel and returns a merged payload.
 */
export async function GET(req: NextRequest) {
  const daysParam = req.nextUrl.searchParams.get('days');
  const days = daysParam ? Math.max(1, Math.min(90, Number(daysParam))) : 30;
  const force = req.nextUrl.searchParams.get('force') === '1';

  try {
    const payload = await getCombinedAnalytics({ days, force });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load combined analytics' },
      { status: 502 },
    );
  }
}
