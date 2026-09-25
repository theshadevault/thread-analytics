import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { buildAuthorizeUrl } from '@/lib/threads';
import { getThreadsOAuthConfig, getRedirectUri } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/threads — start the OAuth flow.
 * Redirects to Meta's authorize dialog. Run this once per account (each of your
 * 3 accounts must be a Tester on the Meta app while it's in Development Mode).
 */
export async function GET() {
  try {
    const { clientId } = getThreadsOAuthConfig();
    const state = randomBytes(16).toString('hex');
    const url = buildAuthorizeUrl({ clientId, redirectUri: getRedirectUri(), state });

    const res = NextResponse.redirect(url);
    // CSRF guard — verified in the callback.
    res.cookies.set('threads_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start OAuth' },
      { status: 500 },
    );
  }
}
