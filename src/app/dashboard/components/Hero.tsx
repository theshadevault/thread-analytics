'use client';

import { useEffect, useState } from 'react';

export interface Snapshot {
  date: string;
  followersCount: number;
  views: number;
}

async function fetchSnapshots(id: string, days: number): Promise<Snapshot[]> {
  const res = await fetch(`/api/snapshots/${id}?days=${days}`);
  if (!res.ok) return [];
  const d = await res.json();
  return d.snapshots ?? [];
}

/** Merge multiple accounts' snapshots by date, summing followers + views. */
function mergeByDate(all: Snapshot[][]): Snapshot[] {
  const byDate = new Map<string, Snapshot>();
  for (const list of all) {
    for (const s of list) {
      const cur = byDate.get(s.date) ?? { date: s.date, followersCount: 0, views: 0 };
      cur.followersCount += s.followersCount;
      cur.views += s.views;
      byDate.set(s.date, cur);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Daily follower/view snapshots for one account, or summed across all. */
export function useSnapshots(selected: string | null, accountIds: string[], days: number, combined: boolean) {
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const ids = accountIds.join(',');
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setSnaps(null);
    const load = combined
      ? Promise.all(ids.split(',').filter(Boolean).map((id) => fetchSnapshots(id, days))).then(mergeByDate)
      : fetchSnapshots(selected, days);
    load.then((s) => !cancelled && setSnaps(s)).catch(() => !cancelled && setSnaps([]));
    return () => {
      cancelled = true;
    };
  }, [selected, days, combined, ids]);
  return snaps;
}

const shortDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** 45123 → ["45.1", "k"]; small numbers stay exact. */
export function compact(n: number): [string, string] {
  if (n >= 1e6) return [(n / 1e6).toFixed(n >= 1e7 ? 0 : 1), 'M'];
  if (n >= 1e4) return [(n / 1e3).toFixed(n >= 1e5 ? 0 : 1), 'k'];
  return [n.toLocaleString(), ''];
}

function BigNumber({ value, loading, muted }: { value: number | undefined; loading: boolean; muted: string }) {
  if (value === undefined) {
    return (
      <div className="text-[clamp(64px,8vw,96px)] font-extrabold leading-[0.9] tracking-[-0.05em]">
        {loading ? <span className="inline-block h-[0.8em] w-[2.4em] animate-pulse rounded-xl bg-current opacity-10" /> : '—'}
      </div>
    );
  }
  const [num, unit] = compact(value);
  return (
    <div className="text-[clamp(64px,8vw,96px)] font-extrabold leading-[0.9] tracking-[-0.05em] tabular-nums">
      {num}
      {unit && <span style={{ color: muted }}>{unit}</span>}
    </div>
  );
}

const Collecting = ({ dark }: { dark?: boolean }) => (
  <p className={`mt-auto pb-6 text-sm ${dark ? 'opacity-70' : 'text-[var(--text-muted)]'}`}>
    Collecting daily data — this fills in as the snapshot cron runs.
  </p>
);

export function FollowersCard({ followers, snaps, loading }: { followers: number | undefined; snaps: Snapshot[] | null; loading: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = snaps ?? [];
  const first = pts[0];
  const last = pts[pts.length - 1];
  const delta = first && last ? last.followersCount - first.followersCount : null;
  const pct = delta !== null && first.followersCount > 0 ? (delta / first.followersCount) * 100 : null;

  const W = 600;
  const H = 160;
  let line = '';
  let area = '';
  let xy: number[][] = [];
  if (pts.length > 1) {
    const vals = pts.map((p) => p.followersCount);
    const mn = Math.min(...vals);
    const span = Math.max(...vals) - mn || 1;
    xy = pts.map((p, i) => [(i / (pts.length - 1)) * W, H - ((p.followersCount - mn) / span) * (H - 10) - 2]);
    line = 'M' + xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
    area = `${line} L${W},${H} L0,${H} Z`;
  }

  return (
    <div className="flex min-h-[300px] flex-col gap-1.5 rounded-[22px] bg-[var(--accent)] px-[22px] pb-3.5 pt-[22px] text-[var(--on-accent)] transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold">Followers</div>
        {delta !== null && (
          <div className="rounded-full bg-[var(--on-accent)] px-[9px] py-1 font-mono text-xs font-bold text-[var(--accent)]">
            {delta >= 0 ? '+' : ''}
            {delta.toLocaleString()}
            {pct !== null && ` · ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}
          </div>
        )}
      </div>
      <BigNumber value={followers} loading={loading} muted="color-mix(in srgb, var(--on-accent) 45%, transparent)" />
      {pts.length > 1 ? (
        <>
          <div className="relative mt-auto h-[130px]">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="h-full w-full overflow-visible"
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const i = Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1));
                setHover(Math.max(0, Math.min(pts.length - 1, i)));
              }}
              onMouseLeave={() => setHover(null)}
            >
              <path d={area} fill="var(--on-accent)" fillOpacity={0.12} />
              <path d={line} fill="none" stroke="var(--on-accent)" strokeWidth={3} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {hover !== null && (
                <line x1={xy[hover][0]} x2={xy[hover][0]} y1={0} y2={H} stroke="var(--on-accent)" strokeOpacity={0.35} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            {hover !== null && (
              <span
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--accent)] bg-[var(--on-accent)]"
                style={{ left: `${(xy[hover][0] / W) * 100}%`, top: `${(xy[hover][1] / H) * 100}%` }}
              />
            )}
          </div>
          <div className="flex justify-between font-mono text-[11px] opacity-70">
            <span>
              {shortDate(first.date)} · {first.followersCount.toLocaleString()}
            </span>
            <span className={hover !== null ? 'font-bold opacity-100' : ''}>
              {shortDate(pts[hover ?? pts.length - 1].date)} · {pts[hover ?? pts.length - 1].followersCount.toLocaleString()}
            </span>
          </div>
        </>
      ) : snaps ? (
        <Collecting dark />
      ) : null}
    </div>
  );
}

export function ViewsCard({ views, snaps, loading }: { views: number | undefined; snaps: Snapshot[] | null; loading: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = snaps ?? [];
  const peak = pts.reduce<Snapshot | null>((m, p) => (!m || p.views > m.views ? p : m), null);
  const max = peak?.views || 1;
  return (
    <div className="flex min-h-[300px] flex-col gap-1.5 rounded-[22px] border border-[var(--border-1)] bg-[var(--surface-1)] px-[22px] pb-3.5 pt-[22px]">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-[var(--text-secondary)]">Views</div>
        {peak && peak.views > 0 && (
          <div className="font-mono text-xs text-[var(--text-muted)]">
            peak {peak.views.toLocaleString()} · {shortDate(peak.date)}
          </div>
        )}
      </div>
      <BigNumber value={views} loading={loading} muted="var(--text-muted)" />
      {pts.length > 1 ? (
        <>
          <div className="mt-auto flex h-[130px] items-end gap-[3px] sm:gap-1.5" onMouseLeave={() => setHover(null)}>
            {pts.map((p, i) => (
              <div
                key={p.date}
                title={`${shortDate(p.date)} · ${p.views.toLocaleString()}`}
                onMouseEnter={() => setHover(i)}
                className="min-h-1 flex-1 rounded-[6px_6px_2px_2px] transition-[background-color,opacity]"
                style={{
                  height: `${Math.max(3, (p.views / max) * 100)}%`,
                  background: p === peak ? 'var(--accent)' : hover === i ? '#55554d' : '#3a3a33',
                }}
              />
            ))}
          </div>
          <div className="flex justify-between font-mono text-[11px] text-[var(--text-muted)]">
            <span>{shortDate(pts[0].date)}</span>
            <span className={hover !== null ? 'text-[var(--text-primary)]' : ''}>
              {shortDate(pts[hover ?? pts.length - 1].date)} · {pts[hover ?? pts.length - 1].views.toLocaleString()}
            </span>
          </div>
        </>
      ) : snaps ? (
        <Collecting />
      ) : null}
    </div>
  );
}

export function EngagementTiles({
  account,
  totals,
  loading,
}: {
  account: { views: number; likes: number; replies: number; reposts: number; quotes: number } | undefined;
  totals: { totalViews: number; totalEngagement: number } | undefined;
  loading: boolean;
}) {
  const per1k = (n: number) => {
    if (!account || account.views <= 0) return '—';
    const r = (n / account.views) * 1000;
    return `${r.toFixed(r < 0.1 ? 2 : 1)} per 1k views`;
  };
  const rate = totals && totals.totalViews > 0 ? (totals.totalEngagement / totals.totalViews) * 100 : null;
  const tiles = [
    { label: 'Likes', value: account?.likes, glyph: '♥', hot: true, sub: account ? per1k(account.likes) : '' },
    { label: 'Reposts', value: account?.reposts, glyph: '⟲', hot: false, sub: account ? per1k(account.reposts) : '' },
    { label: 'Replies', value: account?.replies, glyph: '↩', hot: false, sub: account ? per1k(account.replies) : '' },
    { label: 'Quotes', value: account?.quotes, glyph: '❝', hot: false, sub: account ? per1k(account.quotes) : '' },
  ];
  return (
    <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
      {tiles.map((t) => (
        <Tile key={t.label} label={t.label} glyph={t.glyph} hot={t.hot} sub={t.sub} loading={loading}>
          {t.value === undefined ? undefined : t.value.toLocaleString()}
        </Tile>
      ))}
      <Tile label="Eng. rate" glyph="◎" hot sub="interactions / post views" loading={loading}>
        {rate === null ? undefined : `${rate.toFixed(1)}%`}
      </Tile>
    </div>
  );
}

function Tile({ label, glyph, hot, sub, loading, children }: { label: string; glyph: string; hot: boolean; sub: string; loading: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] border border-[var(--border-1)] bg-[var(--surface-1)] px-[18px] py-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-[var(--text-secondary)]">{label}</span>
        <span className="text-base" style={{ color: hot ? 'var(--accent)' : 'var(--text-muted)' }} aria-hidden>
          {glyph}
        </span>
      </div>
      <div className="text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums">
        {children ?? (loading ? <span className="inline-block h-9 w-16 animate-pulse rounded-lg bg-[var(--surface-2)]" /> : '—')}
      </div>
      <div className="font-mono text-[11px] text-[var(--text-muted)]">{sub}</div>
    </div>
  );
}
