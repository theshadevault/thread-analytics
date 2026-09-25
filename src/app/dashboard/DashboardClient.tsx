'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicAccount } from '@/lib/accounts';
import type { AnalyticsPayload, CombinedPayload } from '@/lib/analytics';
import { StatTile } from './components/StatTile';
import { CountryBars } from './components/CountryBars';
import { PostsTable } from './components/PostsTable';
import { PostsChart } from './components/PostsChart';
import { HookAnalysis } from './components/HookAnalysis';
import { Trends } from './components/Trends';
import { extractHook } from '@/lib/hooks';
import { stashRepurpose } from '@/lib/repurpose';
import type { PostRow } from './components/PostsTable';

const RANGES = [7, 14, 30, 60, 90] as const;
const COMBINED = 'combined';

type ViewData = AnalyticsPayload | CombinedPayload;

function useConnectNotice() {
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const connected = p.get('connected');
    const err = p.get('connect_error');
    if (connected) setNotice({ kind: 'ok', text: `Connected @${connected}.` });
    else if (err) setNotice({ kind: 'err', text: `Connection failed: ${err}` });
    if (connected || err) window.history.replaceState({}, '', '/dashboard');
  }, []);
  return [notice, setNotice] as const;
}

export default function DashboardClient() {
  const [accounts, setAccounts] = useState<PublicAccount[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<ViewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postsView, setPostsView] = useState<'table' | 'chart'>('table');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useConnectNotice();

  // Per-visit cache: keeps already-loaded account/range data so revisiting an
  // account (or switching back) renders instantly instead of re-pulling from Meta.
  const cacheRef = useRef<Map<string, ViewData>>(new Map());

  // Load the connected accounts once.
  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((d) => {
        const list: PublicAccount[] = d.accounts ?? [];
        setAccounts(list);
        if (list.length) setSelected(list[0].threadsUserId);
      })
      .catch(() => setAccounts([]));
  }, []);

  const load = useCallback(
    async (target: string, windowDays: number, force = false) => {
      const key = `${target}:${windowDays}`;
      // Serve from the per-visit cache unless a manual refresh forces a re-pull.
      if (!force) {
        const cached = cacheRef.current.get(key);
        if (cached) {
          setData(cached);
          setError(null);
          setLoading(false);
          return;
        }
      }
      setLoading(true);
      setError(null);
      try {
        const base =
          target === COMBINED ? '/api/analytics/combined' : `/api/analytics/${target}`;
        const url = `${base}?days=${windowDays}${force ? '&force=1' : ''}`;
        const res = await fetch(url);
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? 'Failed to load');
        cacheRef.current.set(key, payload);
        setData(payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (selected) load(selected, days);
  }, [selected, days, load]);

  const activeAccount = accounts?.find((a) => a.threadsUserId === selected) ?? null;
  const combined = selected === COMBINED && data && 'accounts' in data ? data : null;

  const filteredPosts = useMemo(() => {
    const all = data?.posts ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((p) => (p.text ?? '').toLowerCase().includes(q));
  }, [data, search]);

  // Send a high-performing post into the Studio composer to schedule it again.
  // Resolve the owning account: in single-account view it's the selected id;
  // in combined view, map the post's @username back to its account id.
  function handleRepurpose(post: PostRow) {
    const owner =
      selected && selected !== COMBINED
        ? selected
        : accounts?.find((a) => a.username === post.username)?.threadsUserId ?? null;
    stashRepurpose({
      threadsUserId: owner,
      segments: [post.text ?? ''],
      sourcePermalink: post.permalink,
    });
    window.location.assign('/studio');
  }

  function handleExport() {
    const posts = (data?.posts ?? []) as PostRow[];
    if (!posts.length) return;
    const includeAccount = selected === COMBINED;
    const who = selected === COMBINED ? 'all-accounts' : activeAccount?.username ?? 'account';
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`threads-${who}-${days}d-${stamp}.csv`, buildPostsCsv(posts, includeAccount));
  }

  return (
    <div className="viz min-h-screen bg-[var(--surface-2)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-6xl px-5 py-8">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold tracking-tight">Threads Analytics</h1>
            <nav className="flex gap-1 text-sm">
              <span className="rounded-lg bg-[var(--surface-1)] px-3 py-1.5 font-medium text-[var(--text-primary)] ring-1 ring-[var(--border-1)]">
                Analytics
              </span>
              <a
                href="/studio"
                className="rounded-lg px-3 py-1.5 font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)]"
              >
                Studio
              </a>
            </nav>
          </div>
          <a
            href="/api/auth/threads"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            + Connect account
          </a>
        </header>

        {notice && (
          <div
            className={`mb-4 flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm ${
              notice.kind === 'ok'
                ? 'border-[var(--good)]/40 text-[var(--good)]'
                : 'border-red-500/40 text-red-500'
            }`}
          >
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100">
              ✕
            </button>
          </div>
        )}

        {/* Empty state */}
        {accounts !== null && accounts.length === 0 && (
          <div className="rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)] p-10 text-center">
            <h2 className="text-lg font-medium">No accounts connected yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">
              Connect each of your Threads accounts once. They must be added as Testers on your
              Meta app while it&apos;s in Development Mode.
            </p>
            <a
              href="/api/auth/threads"
              className="mt-5 inline-block rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              Connect your first account
            </a>
          </div>
        )}

        {/* Account switcher + range */}
        {accounts && accounts.length > 0 && (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {accounts.length > 1 && (
                  <button
                    onClick={() => setSelected(COMBINED)}
                    className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                      selected === COMBINED
                        ? 'bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--accent)]/40'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--surface-1)]/60'
                    }`}
                  >
                    All accounts
                  </button>
                )}
                {accounts.map((a) => {
                  const active = a.threadsUserId === selected;
                  return (
                    <button
                      key={a.threadsUserId}
                      onClick={() => setSelected(a.threadsUserId)}
                      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--border-1)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-1)]/60'
                      }`}
                    >
                      @{a.username}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded-lg ring-1 ring-[var(--border-1)]">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setDays(r)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        days === r
                          ? 'bg-[var(--accent)] text-white'
                          : 'bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {r}d
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => selected && load(selected, days, true)}
                  disabled={loading}
                  className="rounded-lg bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-1)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
                  title="Bypass the 5-minute cache and re-pull from Meta"
                >
                  {loading ? 'Loading…' : '↻ Refresh'}
                </button>
                <button
                  onClick={handleExport}
                  disabled={loading || !(data?.posts?.length)}
                  className="rounded-lg bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-1)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
                  title={`Export all posts in the last ${days} days to CSV`}
                >
                  ⬇ Export CSV
                </button>
                <a
                  href="/studio"
                  className="rounded-lg bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-1)] transition-colors hover:text-[var(--text-primary)]"
                  title="Compose, schedule, and manage posts in the Studio"
                >
                  ✍ Studio
                </a>
              </div>
            </div>

            {error && (
              <div className="mb-5 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-500">
                {error}
              </div>
            )}

            {/* KPI tiles */}
            <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatTile
                label="Followers"
                value={data?.account.followersCount}
                loading={loading}
                emphasis
              />
              <StatTile label="Views" value={data?.account.views} loading={loading} />
              <StatTile label="Likes" value={data?.account.likes} loading={loading} />
              <StatTile label="Replies" value={data?.account.replies} loading={loading} />
              <StatTile label="Reposts" value={data?.account.reposts} loading={loading} />
              <StatTile label="Quotes" value={data?.account.quotes} loading={loading} />
            </section>

            {/* Per-account comparison (combined view only) */}
            {combined && (
              <section className="mb-5 overflow-x-auto rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)]">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--text-muted)]">
                      <th className="px-4 py-2.5 font-medium">Account</th>
                      <th className="px-3 py-2.5 text-right font-medium">Followers</th>
                      <th className="px-3 py-2.5 text-right font-medium">Post views</th>
                      <th className="px-3 py-2.5 text-right font-medium">Posts</th>
                      <th className="px-3 py-2.5 text-right font-medium">Engagement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {combined.accounts.map((a) => (
                      <tr key={a.threadsUserId} className="border-t border-[var(--border-1)]">
                        <td className="px-4 py-2.5 font-medium">
                          @{a.username}
                          {a.error && (
                            <span className="ml-2 text-xs text-red-500">({a.error})</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {a.followersCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {a.views.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{a.postCount}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {a.totalEngagement.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {selected && (
              <Trends
                selected={selected}
                accountIds={accounts.map((a) => a.threadsUserId)}
                days={days}
                combined={selected === COMBINED}
              />
            )}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {/* Posts: table / chart toggle */}
              <div className="lg:col-span-2">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="relative min-w-[180px] flex-1">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search posts by keyword…"
                      className="w-full rounded-lg bg-[var(--surface-1)] px-3 py-1.5 text-xs text-[var(--text-primary)] ring-1 ring-[var(--border-1)] outline-none placeholder:text-[var(--text-muted)] focus:ring-[var(--accent)]/50"
                    />
                    {search && (
                      <button
                        onClick={() => setSearch('')}
                        title="Clear search"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="flex overflow-hidden rounded-lg ring-1 ring-[var(--border-1)]">
                    {(['table', 'chart'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setPostsView(v)}
                        className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                          postsView === v
                            ? 'bg-[var(--accent)] text-white'
                            : 'bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {v === 'table' ? '☰ Table' : '▊ Chart'}
                      </button>
                    ))}
                  </div>
                </div>
                {postsView === 'table' ? (
                  <PostsTable
                    posts={filteredPosts}
                    loading={loading}
                    onRepurpose={handleRepurpose}
                  />
                ) : (
                  <PostsChart posts={filteredPosts} loading={loading} />
                )}
              </div>

              {/* Side column: demographics */}
              <div className="flex flex-col gap-5">
                <CountryBars data={data?.demographics.country ?? null} loading={loading} />
              </div>
            </div>

            {data && data.posts.length > 0 && (
              <HookAnalysis
                posts={data.posts}
                label={combined ? 'All accounts' : activeAccount ? `@${activeAccount.username}` : ''}
                days={days}
              />
            )}

            {activeAccount && (
              <p className="mt-6 text-xs text-[var(--text-muted)]">
                Token for @{activeAccount.username} expires{' '}
                {new Date(activeAccount.tokenExpiresAt).toLocaleDateString()}. Auto-refreshed weekly
                by the cron job.
                {data && ` · Data fetched ${new Date(data.fetchedAt).toLocaleTimeString()}.`}
              </p>
            )}
          </>
        )}

        {accounts === null && (
          <div className="py-20 text-center text-sm text-[var(--text-muted)]">Loading…</div>
        )}
      </div>
    </div>
  );
}

/** Quote a CSV cell only when it contains a comma, quote, or newline. */
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildPostsCsv(posts: PostRow[], includeAccount: boolean): string {
  const headers = [
    'Date',
    ...(includeAccount ? ['Account'] : []),
    'Hook',
    'Text',
    'Views',
    'Likes',
    'Replies',
    'Reposts',
    'Quotes',
    'Engagement rate %',
    'Permalink',
  ];
  const rows = posts.map((p) => [
    new Date(p.timestamp).toISOString().slice(0, 10),
    ...(includeAccount ? [`@${p.username ?? ''}`] : []),
    extractHook(p.text),
    (p.text ?? '').replace(/\r?\n/g, ' '),
    p.views,
    p.likes,
    p.replies,
    p.reposts,
    p.quotes,
    (p.engagementRate * 100).toFixed(2),
    p.permalink ?? '',
  ]);
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Trigger a client-side download of `csv` (BOM prefixed so Excel reads UTF-8). */
function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
