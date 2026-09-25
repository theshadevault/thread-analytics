'use client';

import { useState } from 'react';
import type { PostRow } from './PostsTable';

const METRICS = [
  { key: 'views', label: 'Views' },
  { key: 'likes', label: 'Likes' },
  { key: 'engagement', label: 'Engagement' },
] as const;

type MetricKey = (typeof METRICS)[number]['key'];

function valueOf(p: PostRow, metric: MetricKey): number {
  if (metric === 'engagement') return p.likes + p.replies + p.reposts + p.quotes;
  return p[metric];
}

function label(p: PostRow): string {
  const text = p.text?.trim();
  if (text) return text;
  const t = p.mediaType?.toLowerCase().replace('_', ' ') ?? 'post';
  return `[${t}]`;
}

/**
 * Top posts by a chosen metric as a horizontal bar chart.
 * Magnitude → bar length, single hue (accent), values direct-labeled, full
 * breakdown on hover. One series, so no legend needed.
 */
export function PostsChart({ posts, loading }: { posts: PostRow[]; loading: boolean }) {
  const [metric, setMetric] = useState<MetricKey>('views');
  const top = [...posts].sort((a, b) => valueOf(b, metric) - valueOf(a, metric)).slice(0, 12);
  const max = Math.max(1, ...top.map((p) => valueOf(p, metric)));

  return (
    <div className="rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)]">
      <div className="flex items-center justify-between border-b border-[var(--border-1)] px-4 py-3">
        <h3 className="text-sm font-semibold">Top posts</h3>
        <div className="flex overflow-hidden rounded-lg ring-1 ring-[var(--border-1)]">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                metric === m.key
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {loading && posts.length === 0 ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-[var(--surface-2)]" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--text-muted)]">No posts in this window.</p>
      ) : (
        <div className="space-y-2.5 p-4">
          {top.map((p) => {
            const v = valueOf(p, metric);
            const pct = Math.max(2, (v / max) * 100);
            const tip = `${label(p).slice(0, 80)}\n${new Date(
              p.timestamp,
            ).toLocaleDateString()} · ${p.views.toLocaleString()} views · ${p.likes.toLocaleString()} likes · ${p.replies.toLocaleString()} replies · ${(
              p.engagementRate * 100
            ).toFixed(1)}% eng`;
            return (
              <div key={p.id} className="group flex items-center gap-3" title={tip}>
                <div className="w-36 shrink-0 truncate text-xs text-[var(--text-secondary)] sm:w-48">
                  {p.username && (
                    <span className="text-[var(--text-muted)]">@{p.username} · </span>
                  )}
                  {label(p)}
                </div>
                <div className="relative h-5 flex-1">
                  <div
                    className="absolute inset-y-0 left-0 rounded-r bg-[var(--accent)] transition-[width] group-hover:opacity-90"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-16 shrink-0 text-right text-xs font-medium tabular-nums">
                  {v.toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
