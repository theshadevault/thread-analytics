import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Same-origin image proxy for post media.
 *
 * The Studio stores post images as public Vercel Blob URLs (from AutoPost). A
 * few browser environments refuse to render those cross-origin images directly
 * (ad/privacy blockers keyed on the blob host, strict referrer/cross-site
 * rules), so thumbnails come out broken even though the blob serves fine. Piping
 * them through our own origin sidesteps all of that — the browser only ever
 * loads `…/api/img?url=…` from the same host as the app.
 *
 * SSRF guard: only https URLs on Vercel's public blob host are allowed, so this
 * can't be turned into an open relay for arbitrary internal/external requests.
 *
 * The target URL is passed base64url-encoded (`?u=`) rather than as a plain
 * query param, so content/ad blockers that pattern-match the blob hostname in a
 * request URL can't recognize (and block) the proxied request.
 */
const ALLOWED_HOST = /(^|\.)public\.blob\.vercel-storage\.com$/i;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const encoded = params.get('u');
  // `url` kept as a fallback for any old cached client bundle still using it.
  let raw = params.get('url');
  if (encoded) {
    try {
      raw = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      return NextResponse.json({ error: 'Invalid url.' }, { status: 400 });
    }
  }
  if (!raw) return NextResponse.json({ error: 'Missing url.' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid url.' }, { status: 400 });
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOST.test(target.hostname)) {
    return NextResponse.json({ error: 'Host not allowed.' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), { cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: 'Upstream fetch failed.' }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Image unavailable.' }, { status: upstream.status || 502 });
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  if (!contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'Not an image.' }, { status: 415 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // Cache in the browser + CDN; blob URLs are content-addressed (immutable).
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}
