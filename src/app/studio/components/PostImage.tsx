'use client';

import Image from 'next/image';

/**
 * Post media rendered through next/image. It fills a `position: relative`
 * parent, so the caller controls the frame size (fixed-height thumbnail in a
 * card, taller box in the detail modal) and we letterbox with object-contain.
 *
 * We hand next/image the raw storage URL (Supabase / Vercel Blob, both allowed
 * in next.config `images.remotePatterns`) rather than the old same-origin
 * proxy: the optimizer resizes to the requested `sizes`, serves WebP/AVIF, and
 * edge-caches it — which is what actually fixes the slow full-res loads. The
 * optimized endpoint is same-origin too, so the cross-origin quirks the proxy
 * worked around don't apply here either.
 */
export function PostImage({
  url,
  alt,
  sizes,
  className,
}: {
  url: string;
  alt: string;
  sizes: string;
  className?: string;
}) {
  return (
    <Image
      src={url}
      alt={alt}
      fill
      sizes={sizes}
      className={className ?? 'object-contain'}
    />
  );
}
