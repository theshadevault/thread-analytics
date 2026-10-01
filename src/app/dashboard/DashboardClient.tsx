'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicAccount } from '@/lib/accounts';
import type { AnalyticsPayload, CombinedPayload } from '@/lib/analytics';
import { CountryBars } from './components/CountryBars';
import { PostsTable, type PostRow } from './components/PostsTable';
import { PostsChart } from './components/PostsChart';
import { HookAnalysis } from './components/HookAnalysis';
import { EngagementTiles, FollowersCard, ViewsCard, useSnapshots } from './components/Hero';
import { AccountChip, AppShell, Seg, ghostBtn } from '@/app/components/AppShell';
import { extractHook } from '@/lib/hooks';
import { stashRepurpose } from '@/lib/repurpose';
import { NEUTRAL_ACCENT, accountAccent } from '@/lib/theme';

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
  const [repurposingId, setRepurposingId] = useState<string | null>(null);
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
  async function handleRepurpose(post: PostRow) {
    const owner =
      selected && selected !== COMBINED
        ? selected
        : accounts?.find((a) => a.username === post.username)?.threadsUserId ?? null;

    // Rebuild the whole thread (all parts + images) from our published record.
    // Falls back to just this post's text for posts we didn't publish from here.
    let segments = [post.text ?? ''];
    let mediaUrls: (string | null)[] | null = null;
    setRepurposingId(post.id);
    try {
      const res = await fetch('/api/repurpose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: post.id, threadsUserId: owner }),
      });
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d.segments) && d.segments.length) {
          segments = d.segments;
          mediaUrls = d.mediaUrls ?? null;
        }
      }
    } catch {
      /* keep the single-post fallback */
    }

    stashRepurpose({ threadsUserId: owner, segments, mediaUrls, sourcePermalink: post.permalink });
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

  const accountIds = useMemo(() => (accounts ?? []).map((a) => a.threadsUserId), [accounts]);
  const snaps = useSnapshots(selected, accountIds, days, selected === COMBINED);
  const accent = activeAccount ? accountAccent(activeAccount.username) : NEUTRAL_ACCENT;
  const title = selected === COMBINED ? 'all accounts' : activeAccount ? `@${activeAccount.username}` : '';

  return (
    <AppShell page="analytics" accent={accent} accounts={accounts}>
      {notice && (
        <div
          role="status"
          className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm ${
            notice.kind === 'ok'
              ? 'border-[var(--good)]/40 text-[var(--good)]'
              : 'border-[var(--bad-border)] bg-[var(--bad-bg)] text-[var(--bad)]'
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* Empty state */}
      {accounts !== null && accounts.length === 0 && (
        <div className="rounded-[22px] border border-[var(--border-1)] bg-[var(--surface-1)] p-10 text-center">
          <h2 className="text-2xl font-bold tracking-[-0.03em]">No accounts connected yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">
            Connect each of your Threads accounts once. They must be added as Testers on your
            Meta app while it&apos;s in Development Mode.
          </p>
          <a
            href="/api/auth/threads"
            className="mt-5 inline-block rounded-[10px] bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-[var(--on-accent)] hover:opacity-90"
          >
            Connect your first account
          </a>
        </div>
      )}

      {accounts && accounts.length > 0 && (
        <>
          {/* Title, account switcher, range + actions */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-3">
              <h1 className="m-0 text-[clamp(34px,4.4vw,56px)] font-extrabold leading-[0.95] tracking-[-0.04em] [text-wrap:balance]">
                Last {days} days, <span className="break-all text-[var(--accent)] transition-colors">{title}</span>
              </h1>
              <div className="flex flex-wrap gap-1.5">
                {accounts.length > 1 && (
                  <AccountChip username={null} label="All accounts" active={selected === COMBINED} onClick={() => setSelected(COMBINED)} />
                )}
                {accounts.map((a) => (
                  <AccountChip
                    key={a.threadsUserId}
                    username={a.username}
                    label={`@${a.username}`}
                    active={a.threadsUserId === selected}
                    onClick={() => setSelected(a.threadsUserId)}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Seg
                label="Date range"
                mono
                options={RANGES.map((r) => ({ value: r as number, label: `${r}d` }))}
                value={days}
                onChange={setDays}
              />
              <button
                onClick={() => selected && load(selected, days, true)}
                disabled={loading}
                className={ghostBtn}
                title="Bypass the 5-minute cache and re-pull from Meta"
              >
                {loading ? 'Loading…' : '↻ Refresh'}
              </button>
              <button
                onClick={handleExport}
                disabled={loading || !data?.posts?.length}
                className={ghostBtn}
                title={`Export all posts in the last ${days} days to CSV`}
              >
                ↓ CSV
              </button>
              <a href="/studio" className={ghostBtn} title="Compose, schedule, and manage posts in the Studio">
                ✍ Studio
              </a>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-[var(--bad-border)] bg-[var(--bad-bg)] px-4 py-3 text-sm text-[var(--bad)]">
              {error}
            </div>
          )}

          {/* Hero: followers (accent) + views */}
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))]">
            <FollowersCard followers={data?.account.followersCount} snaps={snaps} loading={loading} />
            <ViewsCard views={data?.account.views} snaps={snaps} loading={loading} />
          </div>

          <EngagementTiles account={data?.account} totals={data?.totals} loading={loading} />

          {/* Per-account comparison (combined view only) */}
          {combined && (
            <section className="overflow-x-auto rounded-[22px] border border-[var(--border-1)] bg-[var(--surface-1)]">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--text-muted)]">
                    <th className="px-5 py-3 font-medium">Account</th>
                    <th className="px-3 py-3 text-right font-medium">Followers</th>
                    <th className="px-3 py-3 text-right font-medium">Post views</th>
                    <th className="px-3 py-3 text-right font-medium">Posts</th>
                    <th className="px-5 py-3 text-right font-medium">Engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {combined.accounts.map((a) => (
                    <tr key={a.threadsUserId} className="border-t border-[var(--divider)]">
                      <td className="px-5 py-3 font-medium">
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: accountAccent(a.username) }} />
                          @{a.username}
                          {a.error && <span className="text-xs text-[var(--bad)]">({a.error})</span>}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{a.followersCount.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{a.views.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{a.postCount}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{a.totalEngagement.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Top posts + countries */}
          <div className="grid items-start gap-3.5 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="relative min-w-[180px] flex-1">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search posts by keyword…"
                    aria-label="Search posts"
                    className="w-full rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-1)] px-3 py-[7px] text-[13px] text-[var(--text-primary)] outline-none focus:border-[color-mix(in_srgb,var(--accent)_60%,transparent)]"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      title="Clear search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <Seg
                  label="Posts view"
                  options={[
                    { value: 'table' as const, label: '☰ Table' },
                    { value: 'chart' as const, label: '▊ Chart' },
                  ]}
                  value={postsView}
                  onChange={setPostsView}
                />
              </div>
              {postsView === 'table' ? (
                <PostsTable
                  posts={filteredPosts}
                  loading={loading}
                  onRepurpose={handleRepurpose}
                  repurposingId={repurposingId}
                />
              ) : (
                <PostsChart posts={filteredPosts} loading={loading} />
              )}
            </div>
            <CountryBars data={data?.demographics.country ?? null} loading={loading} />
          </div>

          {data && data.posts.length > 0 && (
            <HookAnalysis
              posts={data.posts}
              label={combined ? 'All accounts' : activeAccount ? `@${activeAccount.username}` : ''}
              days={days}
            />
          )}

          {activeAccount && (
            <p className="font-mono text-[11px] text-[var(--text-muted)]">
              Token for @{activeAccount.username} expires {new Date(activeAccount.tokenExpiresAt).toLocaleDateString()}.
              Auto-refreshed weekly by the cron job.
              {data && ` · Data fetched ${new Date(data.fetchedAt).toLocaleTimeString()}.`}
            </p>
          )}
        </>
      )}

      {accounts === null && <div className="py-20 text-center text-sm text-[var(--text-muted)]">Loading…</div>}
    </AppShell>
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
