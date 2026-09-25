/** Centralized access to environment configuration. */

export function getThreadsOAuthConfig() {
  const clientId = process.env.THREADS_APP_ID;
  const clientSecret = process.env.THREADS_APP_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('THREADS_APP_ID / THREADS_APP_SECRET are not set.');
  }
  return { clientId, clientSecret };
}

/**
 * The public base URL of this deployment. On Vercel, VERCEL_PROJECT_PRODUCTION_URL
 * is injected automatically; APP_BASE_URL lets you override (e.g. a custom domain
 * or localhost during dev). The OAuth redirect_uri is derived from this and must
 * exactly match the URI registered on the Meta app.
 */
export function getBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return 'http://localhost:3000';
}

export function getRedirectUri(): string {
  return `${getBaseUrl()}/api/auth/threads/callback`;
}
