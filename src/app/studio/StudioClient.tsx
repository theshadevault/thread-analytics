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
  avatarColor,
  displayDate,
  fmtMonthYear,
  hasMedia,
  isDraft,
  startOfMonth,
  statusMeta,
  usernameFor,
  type Thread,
} from './helpers';

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

  if (accounts === null) {
    return (
      <Shell>
        <div className="py-24 text-center text-sm text-[var(--text-muted)]">Loading…</div>
      </Shell>
    );
  }

  if (accounts.length === 0) {
    return (
      <Shell>
        <div className="rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)] p-10 text-center">
          <h2 className="text-lg font-medium">No accounts connected</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">
            Connect a Threads account before scheduling posts.
          </p>
          <a
            href="/api/auth/threads"
            className="mt-5 inline-block rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Connect an account
          </a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setMonth(startOfMonth(new Date()))}
            className="rounded-lg bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-1)] hover:text-[var(--text-primary)]"
          >
            Today
          </button>
          <button
            onClick={() => setMonth((m) => addMonths(m, -1))}
            className="rounded-lg bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-secondary)] ring-1 ring-[var(--border-1)] hover:text-[var(--text-primary)]"
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="rounded-lg bg-[var(--surface-1)] px-2.5 py-1.5 text-sm text-[var(--text-secondary)] ring-1 ring-[var(--border-1)] hover:text-[var(--text-primary)]"
            aria-label="Next month"
          >
            ›
          </button>
          <h2 className="ml-1.5 text-base font-semibold text-[var(--text-primary)]">
            {fmtMonthYear(month)}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Account filter */}
          {accounts.length > 1 && (
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="rounded-lg bg-[var(--surface-1)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] ring-1 ring-[var(--border-1)] outline-none"
            >
              <option value={ALL}>All accounts</option>
              {accounts.map((a) => (
                <option key={a.threadsUserId} value={a.threadsUserId}>
                  @{a.username}
                </option>
              ))}
            </select>
          )}

          {/* Month / List / Drafts toggle */}
          <div className="flex overflow-hidden rounded-lg ring-1 ring-[var(--border-1)]">
            {(['month', 'list', 'drafts'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  view === v
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--surface-1)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {v === 'month'
                  ? '▦ Month'
                  : v === 'list'
                    ? '☰ List'
                    : `✎ Drafts${drafts.length ? ` (${drafts.length})` : ''}`}
              </button>
            ))}
          </div>

          <span className="text-xs text-[var(--text-muted)] tabular-nums">
            {scheduledCount} scheduled
          </span>
          <button
            onClick={refresh}
            disabled={loading}
            className="rounded-lg bg-[var(--surface-1)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] ring-1 ring-[var(--border-1)] hover:text-[var(--text-primary)] disabled:opacity-50"
            title="Refresh"
          >
            {loading ? '…' : '↻'}
          </button>
          <button
            onClick={() => openNew()}
            className="rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            + New post
          </button>
        </div>
      </div>

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
      <div className="rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)] p-10 text-center text-sm text-[var(--text-muted)]">
        Nothing here yet. Hit “+ New post” to schedule your first thread.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)]">
      {sorted.map((t, i) => {
        const meta = statusMeta(t.status);
        const username = usernameFor(t.threadsUserId, accounts);
        const when = displayDate(t);
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)] ${
              i > 0 ? 'border-t border-[var(--border-1)]' : ''
            }`}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: avatarColor(username) }}
            >
              {username.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                {hasMedia(t) && <span title="Has images">🖼 </span>}
                {t.segments[0] || '(empty)'}
                {t.segments.length > 1 && (
                  <span className="text-[var(--text-muted)]"> · {t.segments.length} parts</span>
                )}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                @{username} · {t.status === 'posted' ? 'Posted ' : ''}
                {when.toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <span
              className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ color: meta.color, background: meta.bg }}
            >
              {meta.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Page chrome: nav between Analytics and Studio + the connect button. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="viz min-h-screen bg-[var(--surface-2)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold tracking-tight">Studio</h1>
            <nav className="flex gap-1 text-sm">
              <a
                href="/dashboard"
                className="rounded-lg px-3 py-1.5 font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)]"
              >
                Analytics
              </a>
              <span className="rounded-lg bg-[var(--surface-1)] px-3 py-1.5 font-medium text-[var(--text-primary)] ring-1 ring-[var(--border-1)]">
                Studio
              </span>
            </nav>
          </div>
          <a
            href="/api/auth/threads"
            className="rounded-lg bg-[var(--surface-1)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-1)] transition-colors hover:text-[var(--text-primary)]"
          >
            + Connect account
          </a>
        </header>
        {children}
      </div>
    </div>
  );
}
