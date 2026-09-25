import { authorizationServerMetadata, corsJson, corsPreflight, originFromRequest } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

/** RFC 8414 Authorization Server Metadata. Fetched by claude.ai during connect. */
export function GET(req: Request) {
  return corsJson(authorizationServerMetadata(originFromRequest(req)));
}

export function OPTIONS() {
  return corsPreflight();
}
