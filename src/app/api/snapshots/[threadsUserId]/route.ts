import { NextRequest, NextResponse } from 'next/server';
import { getSnapshots } from '@/lib/snapshots';

export const dynamic = 'force-dynamic';

/** GET /api/snapshots/[threadsUserId]?days=90 — daily history for trend charts. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadsUserId: string }> },
) {
  const { threadsUserId } = await params;
  const daysParam = req.nextUrl.searchParams.get('days');
  const days = daysParam ? Math.max(1, Math.min(365, Number(daysParam))) : 90;

  try {
    const snapshots = await getSnapshots(threadsUserId, days);
    return NextResponse.json({ snapshots });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load snapshots' },
      { status: 500 },
    );
  }
}
