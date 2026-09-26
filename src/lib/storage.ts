import { randomUUID } from 'node:crypto';

/**
 * Durable image storage on Supabase Storage.
 *
 * AutoPost uploads slide images to a Vercel Blob store that its own cron prunes
 * after ~1 hour, so any draft/scheduled post that isn't published immediately
 * loses its pictures (and would fail to publish, since Meta fetches the image
 * URL at publish time). To decouple from that, we copy each image into our own
 * public Supabase Storage bucket at ingest time and keep the durable URL until
 * the post is published or canceled — then we delete it again. Vercel Blob stays
 * pure short-lived transport.
 *
 * Uses Supabase's Storage REST API directly (no SDK dependency). Requires
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; when unset, every function degrades
 * gracefully (media is left as-is) so the app keeps working without storage.
 */

const BUCKET = 'thread-media';

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

export function isStorageConfigured(): boolean {
  return config() !== null;
}

function publicPrefix(cfg: { url: string }): string {
  return `${cfg.url}/storage/v1/object/public/${BUCKET}/`;
}

/** True for URLs we host in our own bucket (safe to serve/delete). */
export function isStoredUrl(url: string): boolean {
  const cfg = config();
  return cfg ? url.startsWith(publicPrefix(cfg)) : false;
}

/** True for AutoPost's ephemeral Vercel Blob URLs (the ones worth re-hosting). */
function isEphemeral(url: string): boolean {
  return /\.public\.blob\.vercel-storage\.com\//i.test(url);
}

function extFor(contentType: string | null): string {
  if (!contentType) return 'bin';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'bin';
}

// The public bucket is created lazily on first upload; cache success per instance.
let bucketReady = false;
async function ensureBucket(cfg: { url: string; key: string }): Promise<void> {
  if (bucketReady) return;
  const res = await fetch(`${cfg.url}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  // 200 = created; 400/409 = already exists — both mean the bucket is usable.
  if (res.ok || res.status === 400 || res.status === 409) {
    bucketReady = true;
  }
}

/**
 * Download one image and store a durable copy. Returns the public URL, or null
 * on any failure so the caller can fall back to the original URL.
 */
async function rehostImage(sourceUrl: string, batch: string, index: number): Promise<string | null> {
  const cfg = config();
  if (!cfg) return null;
  try {
    await ensureBucket(cfg);
    const src = await fetch(sourceUrl, { cache: 'no-store' });
    if (!src.ok) return null;
    const contentType = src.headers.get('content-type');
    if (contentType && !contentType.startsWith('image/')) return null;
    const bytes = new Uint8Array(await src.arrayBuffer());
    const path = `${batch}/${index}.${extFor(contentType)}`;

    const up = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        apikey: cfg.key,
        'Content-Type': contentType ?? 'application/octet-stream',
        'x-upsert': 'true',
        'cache-control': 'max-age=31536000',
      },
      body: bytes,
    });
    if (!up.ok) return null;
    return publicPrefix(cfg) + path;
  } catch {
    return null;
  }
}

/**
 * Re-host every ephemeral image in a per-segment media array, preserving index
 * alignment. Non-ephemeral entries (already durable, or null) pass through. If
 * storage isn't configured, the array is returned unchanged.
 */
export async function rehostMediaUrls(
  media: (string | null)[] | null | undefined,
): Promise<(string | null)[] | null | undefined> {
  if (!media || !isStorageConfigured() || !media.some(Boolean)) return media;
  const batch = randomUUID();
  return Promise.all(
    media.map(async (u, i) => {
      if (!u || !isEphemeral(u)) return u;
      return (await rehostImage(u, batch, i)) ?? u; // keep original if copy fails
    }),
  );
}

/**
 * Re-host arbitrary external image URLs (e.g. Meta CDN `media_url`s recovered
 * for a repurpose) into our durable bucket, preserving index alignment. Unlike
 * `rehostMediaUrls` this doesn't gate on the ephemeral-blob host — any URL that
 * isn't already ours is copied. Entries that are already stored, or null, pass
 * through. Falls back to the original URL if a copy fails or storage is unset.
 */
export async function rehostExternalUrls(
  media: (string | null)[] | null | undefined,
): Promise<(string | null)[] | null | undefined> {
  if (!media || !isStorageConfigured() || !media.some(Boolean)) return media;
  const batch = randomUUID();
  return Promise.all(
    media.map(async (u, i) => {
      if (!u || isStoredUrl(u)) return u ?? null;
      return (await rehostImage(u, batch, i)) ?? u;
    }),
  );
}

/**
 * Best-effort delete of any images we host in our bucket. Called after a post
 * publishes (Meta already fetched them) or when a draft is canceled. Never
 * throws — orphaned objects are harmless and swept by any later cleanup.
 */
export async function deleteStoredImages(
  media: (string | null)[] | null | undefined,
): Promise<void> {
  const cfg = config();
  if (!cfg || !media) return;
  const prefix = publicPrefix(cfg);
  const paths = media
    .filter((u): u is string => !!u && u.startsWith(prefix))
    .map((u) => u.slice(prefix.length));
  await Promise.all(
    paths.map((p) =>
      fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${p}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cfg.key}`, apikey: cfg.key },
      }).catch(() => {}),
    ),
  );
}
