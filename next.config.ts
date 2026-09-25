import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root — this repo lives inside a larger monorepo that has
  // its own lockfiles further up the tree.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Post media is served through next/image so the optimizer resizes it, emits
  // WebP/AVIF, and edge-caches the result — full-res Supabase PNGs are why the
  // draft thumbnails used to crawl. Both hosts are our own storage:
  //   • *.supabase.co  — durable copies we rehost at ingest (see lib/storage.ts)
  //   • *.public.blob.vercel-storage.com — AutoPost's ephemeral originals
  // Content-addressed paths are immutable, so cache the optimized output for a month.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      { protocol: 'https', hostname: '**.public.blob.vercel-storage.com' },
    ],
    minimumCacheTTL: 2_678_400, // 31 days
  },
};

export default nextConfig;
