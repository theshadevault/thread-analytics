import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { getDb } from '@/db';
import { oauthClients, oauthCodes, type OAuthClient } from '@/db/schema';

/**
 * A minimal OAuth 2.1 authorization server for the MCP connector.
 *
 * Design notes:
 * - Single owner. There's no user directory — the authorize screen is gated by
 *   one shared password (OAUTH_PASSWORD). Every issued token has sub "owner".
 * - Access/refresh tokens are stateless HMAC-signed blobs (no token table);
 *   validation is a signature + expiry check. The signing key is derived from
 *   TOKEN_ENCRYPTION_KEY so there's no extra secret to provision.
 * - Authorization codes ARE stored (single-use, short TTL) to prevent replay.
 * - Clients self-register via RFC 7591 Dynamic Client Registration.
 */

const ACCESS_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const CODE_TTL_SECONDS = 60 * 5; // 5 minutes
export const OAUTH_SCOPE = 'threads';

// ---------------------------------------------------------------------------
// Token signing (stateless)
// ---------------------------------------------------------------------------

function signingKey(): Buffer {
  const base = process.env.TOKEN_ENCRYPTION_KEY;
  if (!base) throw new Error('TOKEN_ENCRYPTION_KEY is not set.');
  // Derive a purpose-specific subkey so token signing is isolated from the
  // token-encryption use of the same secret.
  return createHmac('sha256', base).update('mcp-oauth-token-signing').digest();
}

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf).toString('base64url');

interface TokenPayload {
  sub: string;
  client_id: string;
  scope: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

function sign(payload: TokenPayload): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyBearerToken(token: string): TokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', signingKey()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload.type !== 'access') return null;
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function issueTokens(clientId: string, scope: string) {
  const now = Math.floor(Date.now() / 1000);
  const access = sign({
    sub: 'owner',
    client_id: clientId,
    scope,
    type: 'access',
    iat: now,
    exp: now + ACCESS_TTL_SECONDS,
  });
  const refresh = sign({
    sub: 'owner',
    client_id: clientId,
    scope,
    type: 'refresh',
    iat: now,
    exp: now + REFRESH_TTL_SECONDS,
  });
  return { access, refresh, expiresIn: ACCESS_TTL_SECONDS };
}

function verifyRefreshToken(token: string): TokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', signingKey()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload: TokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.type !== 'refresh') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Password gate
// ---------------------------------------------------------------------------

export function checkOwnerPassword(input: string): boolean {
  const expected = process.env.OAUTH_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

/** Verify an RFC 7636 S256 (or plain) PKCE challenge. */
export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  if (method === 'plain') return verifier === challenge;
  const hash = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(hash);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Dynamic Client Registration (RFC 7591)
// ---------------------------------------------------------------------------

export async function registerClient(params: {
  redirectUris: string[];
  clientName?: string;
}): Promise<OAuthClient> {
  const clientId = `mcp_${randomBytes(16).toString('hex')}`;
  const [row] = await getDb()
    .insert(oauthClients)
    .values({
      clientId,
      clientSecret: null, // public client — PKCE only
      redirectUris: params.redirectUris,
      clientName: params.clientName ?? null,
    })
    .returning();
  return row;
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const [row] = await getDb()
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Authorization codes (single-use, stored)
// ---------------------------------------------------------------------------

export async function createAuthCode(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
}): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  await getDb().insert(oauthCodes).values({
    code,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    scope: params.scope,
    expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
  });
  return code;
}

/** Atomically consume a code: returns its row and deletes it. Null if missing/expired. */
export async function consumeAuthCode(code: string, clientId: string) {
  const deleted = await getDb()
    .delete(oauthCodes)
    .where(and(eq(oauthCodes.code, code), eq(oauthCodes.clientId, clientId)))
    .returning();
  const row = deleted[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

/** Best-effort cleanup of expired codes (called opportunistically). */
export async function purgeExpiredCodes(): Promise<void> {
  await getDb().delete(oauthCodes).where(lt(oauthCodes.expiresAt, new Date()));
}

// ---------------------------------------------------------------------------
// Token endpoint grant handlers
// ---------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function exchangeAuthorizationCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse | { error: string; error_description: string }> {
  const row = await consumeAuthCode(params.code, params.clientId);
  if (!row) return { error: 'invalid_grant', error_description: 'Code invalid or expired.' };
  if (row.redirectUri !== params.redirectUri) {
    return { error: 'invalid_grant', error_description: 'redirect_uri mismatch.' };
  }
  if (!verifyPkce(params.codeVerifier, row.codeChallenge, row.codeChallengeMethod)) {
    return { error: 'invalid_grant', error_description: 'PKCE verification failed.' };
  }
  const scope = row.scope ?? OAUTH_SCOPE;
  const { access, refresh, expiresIn } = issueTokens(params.clientId, scope);
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: expiresIn,
    refresh_token: refresh,
    scope,
  };
}

export function exchangeRefreshToken(params: {
  refreshToken: string;
  clientId: string;
}): TokenResponse | { error: string; error_description: string } {
  const payload = verifyRefreshToken(params.refreshToken);
  if (!payload || payload.client_id !== params.clientId) {
    return { error: 'invalid_grant', error_description: 'Refresh token invalid.' };
  }
  const { access, refresh, expiresIn } = issueTokens(params.clientId, payload.scope);
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: expiresIn,
    refresh_token: refresh,
    scope: payload.scope,
  };
}

// ---------------------------------------------------------------------------
// Metadata documents
// ---------------------------------------------------------------------------

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [OAUTH_SCOPE],
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ['header'],
  };
}

// ---------------------------------------------------------------------------
// Origin + CORS helpers (metadata/register/token are fetched cross-origin)
// ---------------------------------------------------------------------------

/** Public origin of the incoming request, honoring Vercel's proxy headers. */
export function originFromRequest(req: Request): string {
  const h = req.headers;
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
};

export function corsJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
