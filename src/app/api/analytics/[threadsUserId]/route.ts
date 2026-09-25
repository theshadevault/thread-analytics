import { NextRequest, NextResponse } from 'next/server';
import { getAnalytics } from '@/lib/analytics';

export const dynamic = 'force-dynamic';

/**
 * GET /api/analytics/[threadsUserId]?days=30&force=1
 * Pulls the stored token, calls Threads insights, returns a normalized payload.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadsUserId: string }> },
) {
  const { threadsUserId } = await params;
  const daysParam = req.nextUrl.searchParams.get('days');
  const days = daysParam ? Math.max(1, Math.min(90, Number(daysParam))) : 30;
  const force = req.nextUrl.searchParams.get('force') === '1';

  try {
    const payload = await getAnalytics({ threadsUserId, days, force });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load analytics' },
      { status: 502 },
    );
  }
}
