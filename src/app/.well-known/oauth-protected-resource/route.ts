import { protectedResourceMetadata, corsJson, corsPreflight, originFromRequest } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

/** RFC 9728 Protected Resource Metadata — points clients at our auth server. */
export function GET(req: Request) {
  return corsJson(protectedResourceMetadata(originFromRequest(req)));
}

export function OPTIONS() {
  return corsPreflight();
}
