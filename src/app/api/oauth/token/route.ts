import {
  corsJson,
  corsPreflight,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
} from '@/lib/oauth';

export const dynamic = 'force-dynamic';

/**
 * OAuth 2.1 token endpoint. Handles the authorization_code (with PKCE) and
 * refresh_token grants. Public clients only — no client authentication.
 */
export async function POST(req: Request) {
  let form: URLSearchParams;
  try {
    const raw = await req.text();
    form = new URLSearchParams(raw);
  } catch {
    return corsJson({ error: 'invalid_request', error_description: 'Unreadable body.' }, 400);
  }

  const grantType = form.get('grant_type');
  const clientId = form.get('client_id') ?? '';

  if (grantType === 'authorization_code') {
    const code = form.get('code') ?? '';
    const redirectUri = form.get('redirect_uri') ?? '';
    const codeVerifier = form.get('code_verifier') ?? '';
    if (!code || !redirectUri || !codeVerifier || !clientId) {
      return corsJson(
        { error: 'invalid_request', error_description: 'Missing required parameters.' },
        400,
      );
    }
    const result = await exchangeAuthorizationCode({ code, clientId, redirectUri, codeVerifier });
    if ('error' in result) return corsJson(result, 400);
    return corsJson(result);
  }

  if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token') ?? '';
    if (!refreshToken || !clientId) {
      return corsJson(
        { error: 'invalid_request', error_description: 'Missing refresh_token or client_id.' },
        400,
      );
    }
    const result = exchangeRefreshToken({ refreshToken, clientId });
    if ('error' in result) return corsJson(result, 400);
    return corsJson(result);
  }

  return corsJson(
    { error: 'unsupported_grant_type', error_description: `Unsupported grant_type: ${grantType}.` },
    400,
  );
}

export function OPTIONS() {
  return corsPreflight();
}
