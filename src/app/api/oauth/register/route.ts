import { corsJson, corsPreflight, registerClient } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

/**
 * RFC 7591 Dynamic Client Registration. claude.ai POSTs its redirect_uris here
 * and gets back a client_id. We only issue public (PKCE) clients — no secret.
 */
export async function POST(req: Request) {
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return corsJson({ error: 'invalid_client_metadata', error_description: 'Body must be JSON.' }, 400);
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
    : [];
  if (!redirectUris.length) {
    return corsJson(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris is required.' },
      400,
    );
  }

  const client = await registerClient({
    redirectUris,
    clientName: typeof body.client_name === 'string' ? body.client_name : undefined,
  });

  return corsJson(
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: client.clientName ?? undefined,
    },
    201,
  );
}

export function OPTIONS() {
  return corsPreflight();
}
