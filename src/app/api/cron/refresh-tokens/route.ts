import { NextRequest, NextResponse } from 'next/server';
import { listAccounts, getAccessToken, updateToken } from '@/lib/accounts';
import { refreshLongLivedToken } from '@/lib/threads';

export const dynamic = 'force-dynamic';
// Give the loop room if a refresh is slow.
export const maxDuration = 60;

/**
 * GET /api/cron/refresh-tokens — hit by Vercel Cron (~every 45 days).
 * Refreshes every stored long-lived token so none silently expire.
 *
 * Protected by CRON_SECRET: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  let accounts;
  try {
    accounts = await listAccounts();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list accounts' },
      { status: 500 },
    );
  }
  const results: { username: string; ok: boolean; error?: string }[] = [];

  for (const account of accounts) {
    try {
      const token = await getAccessToken(account.threadsUserId);
      if (!token) throw new Error('no stored token');
      const refreshed = await refreshLongLivedToken(token);
      await updateToken({
        threadsUserId: account.threadsUserId,
        accessToken: refreshed.access_token,
        expiresInSeconds: refreshed.expires_in,
      });
      results.push({ username: account.username, ok: true });
    } catch (err) {
      results.push({
        username: account.username,
        ok: false,
        error: err instanceof Error ? err.message : 'refresh failed',
      });
    }
  }

  return NextResponse.json({ refreshedAt: new Date().toISOString(), results });
}
