'use client';

import { useEffect, useState } from 'react';
import { TrendChart, type TrendPoint } from './TrendChart';

interface Snapshot {
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

export function Trends({
  selected,
  accountIds,
  days,
  combined,
}: {
  selected: string;
  accountIds: string[];
  days: number;
  combined: boolean;
}) {
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSnaps(null);
    const load = combined
      ? Promise.all(accountIds.map((id) => fetchSnapshots(id, days))).then(mergeByDate)
      : fetchSnapshots(selected, days);
    load.then((s) => {
      if (!cancelled) setSnaps(s);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, days, combined, accountIds.join(',')]);

  const followers: TrendPoint[] = (snaps ?? []).map((s) => ({
    date: s.date,
    value: s.followersCount,
  }));
  const views: TrendPoint[] = (snaps ?? []).map((s) => ({ date: s.date, value: s.views }));

  return (
    <section className="mb-5 grid grid-cols-1 gap-5 md:grid-cols-2">
      <TrendChart title="Followers over time" points={followers} />
      <TrendChart title="Daily views" points={views} />
    </section>
  );
}
