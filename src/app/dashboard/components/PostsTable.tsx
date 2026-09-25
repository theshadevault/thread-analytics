'use client';

import { useState } from 'react';
import type { PostAnalytics } from '@/lib/analytics';
import { extractHook } from '@/lib/hooks';

export type PostRow = PostAnalytics & { username?: string };

type SortKey = 'timestamp' | 'views' | 'likes' | 'reposts' | 'engagementRate';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'views', label: 'Views', numeric: true },
  { key: 'likes', label: 'Likes', numeric: true },
  { key: 'reposts', label: 'Reposts', numeric: true },
  { key: 'engagementRate', label: 'Eng. rate', numeric: true },
];

export function PostsTable({
  posts,
  loading,
  onRepurpose,
}: {
  posts: PostRow[];
  loading: boolean;
  /** Push a post's text into the Studio composer to schedule it again. */
  onRepurpose?: (post: PostRow) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('views');
  const [asc, setAsc] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const showAccount = posts.some((p) => p.username);

  const sorted = [...posts].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return asc ? cmp : -cmp;
  });

  function toggle(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(false);
    }
  }

  async function copyHook(p: PostRow) {
    const hook = extractHook(p.text) || '(no text)';
    const text = `${hook} [${p.likes.toLocaleString()} likes]`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(p.id);
      setTimeout(() => setCopiedId((cur) => (cur === p.id ? null : cur)), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)]">
      <div className="border-b border-[var(--border-1)] px-4 py-3">
        <h3 className="text-sm font-semibold">Posts ({posts.length})</h3>
      </div>

      {loading && posts.length === 0 ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-[var(--surface-2)]" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--text-muted)]">No posts in this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">
                  <button
                    onClick={() => toggle('timestamp')}
                    className="hover:text-[var(--text-primary)]"
                    title="Sort by date"
                  >
                    Post{sortKey === 'timestamp' ? (asc ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
                {showAccount && <th className="px-3 py-2 font-medium">Account</th>}
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={`px-3 py-2 font-medium ${c.numeric ? 'text-right' : 'text-left'}`}
                  >
                    <button
                      onClick={() => toggle(c.key)}
                      className="hover:text-[var(--text-primary)]"
                    >
                      {c.label}
                      {sortKey === c.key ? (asc ? ' ↑' : ' ↓') : ''}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-[var(--border-1)] transition-colors hover:bg-[var(--surface-2)]"
                >
                  <td className="max-w-[240px] px-4 py-2.5">
                    <a
                      href={p.permalink ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-[var(--text-primary)] hover:text-[var(--accent)]"
                      title={p.text}
                    >
                      {p.text || '(no text)'}
                    </a>
                    <span className="text-xs text-[var(--text-muted)]">
                      {new Date(p.timestamp).toLocaleDateString()}
                    </span>
                  </td>
                  {showAccount && (
                    <td className="px-3 py-2.5 text-[var(--text-secondary)]">@{p.username}</td>
                  )}
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {p.views.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {p.likes.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {p.reposts.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-secondary)]">
                    {(p.engagementRate * 100).toFixed(1)}%
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {onRepurpose && (
                        <button
                          onClick={() => onRepurpose(p)}
                          title="Repurpose in Studio — reschedule this post"
                          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] ring-1 ring-[var(--border-1)] transition-colors hover:text-[var(--accent)] hover:ring-[var(--accent)]/50"
                        >
                          ✍
                        </button>
                      )}
                      <button
                        onClick={() => copyHook(p)}
                        title="Copy hook + likes"
                        className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] ring-1 ring-[var(--border-1)] transition-colors hover:text-[var(--text-primary)] hover:ring-[var(--accent)]/50"
                      >
                        {copiedId === p.id ? '✓' : '⧉'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
