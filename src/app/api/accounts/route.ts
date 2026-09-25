import { NextResponse } from 'next/server';
import { listAccounts } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

/** GET /api/accounts — the connected accounts for the switcher (no tokens). */
export async function GET() {
  try {
    const accounts = await listAccounts();
    return NextResponse.json({ accounts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list accounts' },
      { status: 500 },
    );
  }
}
