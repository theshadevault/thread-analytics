import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getProfile,
} from '@/lib/threads';
import { getThreadsOAuthConfig, getRedirectUri, getBaseUrl } from '@/lib/config';
import { upsertAccount } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/threads/callback — OAuth redirect target.
 * Exchanges the code → short-lived → long-lived token, fetches the profile,
 * stores the (encrypted) token, then bounces to the dashboard.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const dashboard = `${getBaseUrl()}/dashboard`;

  const error = params.get('error');
  if (error) {
    return NextResponse.redirect(`${dashboard}?connect_error=${encodeURIComponent(error)}`);
  }

  const code = params.get('code');
  const state = params.get('state');
  const expectedState = req.cookies.get('threads_oauth_state')?.value;

  if (!code) {
    return NextResponse.redirect(`${dashboard}?connect_error=missing_code`);
  }
  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${dashboard}?connect_error=state_mismatch`);
  }

  try {
    const { clientId, clientSecret } = getThreadsOAuthConfig();

    const short = await exchangeCodeForToken({
      clientId,
      clientSecret,
      redirectUri: getRedirectUri(),
      code,
    });

    const long = await exchangeForLongLivedToken({
      clientSecret,
      shortLivedToken: short.access_token,
    });

    const profile = await getProfile(long.access_token);

    await upsertAccount({
      threadsUserId: profile.id,
      username: profile.username,
      displayName: profile.name ?? null,
      accessToken: long.access_token,
      expiresInSeconds: long.expires_in,
    });

    const res = NextResponse.redirect(`${dashboard}?connected=${encodeURIComponent(profile.username)}`);
    res.cookies.delete('threads_oauth_state');
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'oauth_failed';
    return NextResponse.redirect(`${dashboard}?connect_error=${encodeURIComponent(msg)}`);
  }
}
