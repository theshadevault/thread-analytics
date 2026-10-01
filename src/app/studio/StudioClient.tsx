'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicAccount } from '@/lib/accounts';
import { takeRepurpose } from '@/lib/repurpose';
import { MonthCalendar } from './components/MonthCalendar';
import { Composer, type ComposerInitial } from './components/Composer';
import { ThreadDetailModal } from './components/ThreadDetailModal';
import { DraftsView } from './components/DraftsView';
import {
  addMonths,
  displayDate,
  fmtMonthYear,
  fmtTime,
  hasMedia,
  isDraft,
  pillLook,
  startOfMonth,
  statusMeta,
  usernameFor,
  type Thread,
} from './helpers';
import { AccountChip, AppShell, Avatar, Seg, ghostBtn } from '@/app/components/AppShell';
import { NEUTRAL_ACCENT, accountAccent } from '@/lib/theme';

const ALL = 'all';

export default function StudioClient() {
  const [accounts, setAccounts] = useState<PublicAccount[] | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<Date>(startOfMonth(new Date()));
  const [view, setView] = useState<'month' | 'list' | 'drafts'>('month');
  const [accountFilter, setAccountFilter] = useState<string>(ALL);

  const [composer, setComposer] = useState<{ open: boolean; initial: ComposerInitial }>({
    open: false,
    initial: {},
  });
  const [detail, setDetail] = useState<Thread | null>(null);

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts ?? []))
      .catch(() => setAccounts([]));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/schedule');
      const data = await res.json();
      setThreads(data.threads ?? []);
    } catch {
      /* keep existing */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Arriving from the Analytics "Repurpose" action: pop the stashed post and
  // open the composer prefilled with its text (as a fresh, unscheduled draft).
  useEffect(() => {
    const draft = takeRepurpose();
    if (!draft) return;
    setComposer({
      open: true,
      initial: {
        threadsUserId: draft.threadsUserId ?? null,
        segments: draft.segments,
        mediaUrls: draft.mediaUrls ?? null,
      },
    });
  }, []);

  const visible = useMemo(
    () => (accountFilter === ALL ? threads : threads.filter((t) => t.threadsUserId === accountFilter)),
    [threads, accountFilter],
  );

  // Drafts get their own section — they're never placed on the calendar/list,
  // where their creation-time `scheduledAt` would masquerade as a real slot.
  const drafts = useMemo(() => visible.filter(isDraft), [visible]);
  // Timeline = the calendar + list. Exclude drafts (own section) and canceled
  // (a canceled post is dead; keeping its pill on the grid just adds clutter).
  const timeline = useMemo(
    () => visible.filter((t) => !isDraft(t) && t.status !== 'canceled'),
    [visible],
  );

  const scheduledCount = useMemo(
    () => visible.filter((t) => t.status === 'pending').length,
    [visible],
  );

  function openNew(day?: Date) {
    setComposer({
      open: true,
      initial: {
        threadsUserId: accountFilter === ALL ? null : accountFilter,
        when: day ?? null,
      },
    });
  }

  function openEdit(t: Thread) {
    setDetail(null);
    setComposer({
      open: true,
      initial: {
        editingId: t.id,
        threadsUserId: t.threadsUserId,
        segments: t.segments,
        mediaUrls: t.mediaUrls ?? null,
        replyControl: t.replyControl ?? 'everyone',
        when: new Date(t.scheduledAt),
      },
    });
  }

  const filterAccount = accounts?.find((a) => a.threadsUserId === accountFilter) ?? null;
  const accent = filterAccount ? accountAccent(filterAccount.username) : NEUTRAL_ACCENT;

  if (accounts === null) {
    return (
      <Shell accent={accent} accounts={accounts}>
        <div className="py-24 text-center text-sm text-[var(--text-muted)]">Loading…</div>
      </Shell>
    );
  }

  if (accounts.length === 0) {
    return (
      <Shell accent={accent} accounts={accounts}>
        <div className="rounded-[22px] border border-[var(--border-1)] bg-[var(--surface-1)] p-10 text-center">
          <h2 className="text-2xl font-bold tracking-[-0.03em]">No accounts connected</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">
            Connect a Threads account before scheduling posts.
          </p>
          <a
            href="/api/auth/threads"
            className="mt-5 inline-block rounded-[10px] bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-[var(--on-accent)] hover:opacity-90"
          >
            Connect an account
          </a>
        </div>
      </Shell>
    );
  }

  const monthName = month.toLocaleDateString(undefined, { month: 'long' });

  return (
    <Shell accent={accent} accounts={accounts}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3.5">
          <h1 className="m-0 text-[clamp(34px,4.4vw,56px)] font-extrabold leading-[0.95] tracking-[-0.04em]" title={fmtMonthYear(month)}>
            {monthName} <span className="text-[var(--text-muted)]">{month.getFullYear()}</span>
          </h1>
          <div className="flex gap-1 pb-1">
            <button onClick={() => setMonth((m) => addMonths(m, -1))} className={`${ghostBtn} h-8 w-8 !p-0`} aria-label="Previous month">
              ‹
            </button>
            <button onClick={() => setMonth((m) => addMonths(m, 1))} className={`${ghostBtn} h-8 w-8 !p-0`} aria-label="Next month">
              ›
            </button>
            <button onClick={() => setMonth(startOfMonth(new Date()))} className={`${ghostBtn} h-8 !py-0`}>
              Today
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Account filter */}
          {accounts.length > 1 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Account filter">
              <AccountChip small username={null} label="All" active={accountFilter === ALL} onClick={() => setAccountFilter(ALL)} />
              {accounts.map((a) => (
                <AccountChip
                  key={a.threadsUserId}
                  small
                  username={a.username}
                  label={a.username}
                  active={accountFilter === a.threadsUserId}
                  onClick={() => setAccountFilter(a.threadsUserId)}
                />
              ))}
            </div>
          )}

          {/* Month / List / Drafts toggle */}
          <Seg
            label="View"
            options={[
              { value: 'month' as const, label: '▦ Month' },
              { value: 'list' as const, label: '☰ List' },
              { value: 'drafts' as const, label: `✎ Drafts${drafts.length ? ` (${drafts.length})` : ''}` },
            ]}
            value={view}
            onChange={setView}
          />

          <span className="font-mono text-xs tabular-nums text-[var(--text-muted)]">{scheduledCount} scheduled</span>
          <button onClick={refresh} disabled={loading} className={`${ghostBtn} h-8 w-8 !p-0`} title="Refresh">
            {loading ? '…' : '↻'}
          </button>
          <button
            onClick={() => openNew()}
            className="rounded-[10px] bg-[var(--accent)] px-4 py-[9px] text-sm font-bold text-[var(--on-accent)] transition-colors hover:brightness-110"
          >
            + New post
          </button>
        </div>
      </div>

      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {view === 'month' ? (
            <MonthCalendar
              month={month}
              threads={timeline}
              accounts={accounts}
              onSelectThread={setDetail}
              onAddOnDay={openNew}
            />
          ) : view === 'list' ? (
            <ListView threads={timeline} accounts={accounts} onSelect={setDetail} />
          ) : (
            <DraftsView
              threads={drafts}
              accounts={accounts}
              onSelect={setDetail}
              onEdit={openEdit}
              onNew={() => openNew()}
              onChanged={refresh}
            />
          )}
        </div>
        <StudioAside
          threads={visible}
          month={month}
          accounts={accounts}
          draftCount={drafts.length}
          onSelect={setDetail}
          onDrafts={() => setView('drafts')}
        />
      </div>

      <Composer
        accounts={accounts}
        open={composer.open}
        initial={composer.initial}
        onClose={() => setComposer((c) => ({ ...c, open: false }))}
        onSaved={refresh}
      />

      {detail && (
        <ThreadDetailModal
          thread={detail}
          accounts={accounts}
          onClose={() => setDetail(null)}
          onEdit={openEdit}
          onChanged={refresh}
        />
      )}
    </Shell>
  );
}

/** Chronological list of every thread with full status/time detail. */
function ListView({
  threads,
  accounts,
  onSelect,
}: {
  threads: Thread[];
  accounts: PublicAccount[];
  onSelect: (t: Thread) => void;
}) {
  const sorted = useMemo(
    () => [...threads].sort((a, b) => +displayDate(b) - +displayDate(a)),
    [threads],
  );

  if (!sorted.length) {
    return (
      <div className="rounded-[22px] border border-[var(--border-1)] bg-[var(--surface-3)] p-10 text-center text-sm text-[var(--text-muted)]">
        Nothing here yet. Hit “+ New post” to schedule your first thread.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-[22px] border border-[var(--border-1)] bg-[var(--surface-3)] p-2.5">
      {sorted.map((t) => {
        const meta = statusMeta(t.status);
        const username = usernameFor(t.threadsUserId, accounts);
        const when = displayDate(t);
        const look = pillLook(t.status);
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className="grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-[filter] hover:brightness-125 sm:grid-cols-[52px_22px_minmax(0,1fr)_auto]"
            style={{ background: look.bg, borderColor: look.border, borderStyle: look.borderStyle }}
          >
            <span className="hidden font-mono text-xs text-[var(--text-secondary)] sm:block">{fmtTime(when)}</span>
            <Avatar username={username} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                {hasMedia(t) && <span title="Has images">🖼 </span>}
                {t.segments[0] || '(empty)'}
                {t.segments.length > 1 && <span className="text-[var(--text-muted)]"> · {t.segments.length} parts</span>}
              </p>
              <p className="font-mono text-[11px] text-[var(--text-muted)]">
                @{username} · {t.status === 'posted' ? 'Posted ' : ''}
                {when.toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <span className="shrink-0 font-mono text-[11px]" style={{ color: meta.color }}>
              {meta.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Countdown, month status counts, failed posts and the upcoming queue. */
function StudioAside({
  threads,
  month,
  accounts,
  draftCount,
  onSelect,
  onDrafts,
}: {
  threads: Thread[];
  month: Date;
  accounts: PublicAccount[];
  draftCount: number;
  onSelect: (t: Thread) => void;
  onDrafts: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const upcoming = threads
    .filter((t) => t.status === 'pending' && +new Date(t.scheduledAt) > now)
    .sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
  const next = upcoming[0] ?? null;
  const inMonth = (t: Thread) => {
    const d = displayDate(t);
    return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
  };
  const monthLabel = month.toLocaleDateString(undefined, { month: 'short' });
  const failed = threads.filter((t) => t.status === 'failed').sort((a, b) => +displayDate(b) - +displayDate(a));
  const stats = [
    { n: threads.filter((t) => t.status === 'posted' && inMonth(t)).length, label: 'Posted', color: 'var(--text-primary)' },
    { n: threads.filter((t) => t.status === 'pending' && inMonth(t)).length, label: 'Scheduled', color: 'var(--accent)' },
    { n: threads.filter((t) => t.status === 'failed' && inMonth(t)).length, label: 'Failed', color: 'var(--bad-strong)' },
  ];

  return (
    <aside className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1 rounded-[22px] bg-[var(--accent)] p-5 text-[var(--on-accent)] transition-colors">
        <div className="text-sm font-semibold">{next ? 'Next post goes out in' : 'Nothing queued'}</div>
        <div className="text-[56px] font-extrabold leading-none tracking-[-0.05em] tabular-nums">
          {next ? countdown(+new Date(next.scheduledAt) - now) : '—'}
        </div>
        <div className="truncate text-[13px] font-medium opacity-75">
          {next
            ? `${new Date(next.scheduledAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} · @${usernameFor(next.threadsUserId, accounts)}`
            : 'Hit “+ New post” to schedule one.'}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1 rounded-[14px] border border-[var(--border-1)] bg-[var(--surface-1)] p-3">
            <span className="text-[28px] font-extrabold leading-none tracking-[-0.04em] tabular-nums" style={{ color: s.n || s.label !== 'Failed' ? s.color : 'var(--text-muted)' }}>
              {s.n}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">{s.label}</span>
          </div>
        ))}
        <span className="col-span-3 -mt-1 text-right font-mono text-[10px] text-[var(--text-faint)]">in {monthLabel}</span>
      </div>

      {failed.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-[18px] border border-[var(--bad-border)] bg-[var(--bad-bg)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-bold text-[var(--bad)]">Didn&apos;t post</span>
            <span className="font-mono text-[11px] text-[var(--bad)]">{failed.length}</span>
          </div>
          {failed.slice(0, 4).map((t) => (
            <div key={t.id} className="flex items-center gap-2.5">
              <span className="font-mono text-[11px] text-[#c9a69e]">{fmtTime(displayDate(t))}</span>
              <span className="min-w-0 flex-1 truncate text-[13px]" title={t.segments[0]}>
                {t.segments[0] || '(empty)'}
              </span>
              <button
                onClick={() => onSelect(t)}
                title="Open this post — retry, edit or cancel it"
                className="rounded-[7px] bg-[var(--bad-strong)] px-2.5 py-1 text-xs font-bold text-[var(--on-accent)] hover:brightness-110"
              >
                Retry
              </button>
            </div>
          ))}
          {failed.length > 4 && <span className="font-mono text-[11px] text-[#c9a69e]">+{failed.length - 4} more</span>}
        </div>
      )}

      <div className="flex flex-col gap-2.5 rounded-[18px] border border-[var(--border-1)] bg-[var(--surface-1)] p-4">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-bold">Queue</span>
          <span className="font-mono text-[11px] text-[var(--text-muted)]">{upcoming.length} upcoming</span>
        </div>
        {upcoming.length === 0 ? (
          <p className="border-t border-[var(--divider)] pt-2 text-[13px] text-[var(--text-muted)]">Nothing scheduled.</p>
        ) : (
          upcoming.slice(0, 6).map((t) => {
            const d = new Date(t.scheduledAt);
            return (
              <button
                key={t.id}
                onClick={() => onSelect(t)}
                className="flex items-center gap-2.5 border-t border-[var(--divider)] py-1.5 text-left hover:text-[var(--accent)]"
              >
                <span className="w-[74px] shrink-0 font-mono text-xs text-[var(--accent)]">
                  {d.toLocaleDateString(undefined, { weekday: 'short' })} {fmtTime(d)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{t.segments[0] || '(empty)'}</span>
              </button>
            );
          })
        )}
        <button
          onClick={onDrafts}
          className="mt-1 rounded-[10px] border border-dashed border-[var(--border-2)] p-2 text-[13px] text-[var(--text-secondary)] hover:border-[#55554d] hover:text-[var(--text-primary)]"
        >
          Drafts ({draftCount})
        </button>
      </div>
    </aside>
  );
}

/** "2h 14m", "3d 4h", "12m" until a time. */
function countdown(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Page chrome: nav between Analytics and Studio + the connect button. */
function Shell({ accent, accounts, children }: { accent: string; accounts: PublicAccount[] | null; children: React.ReactNode }) {
  return (
    <AppShell page="studio" accent={accent} accounts={accounts}>
      {children}
    </AppShell>
  );
}
