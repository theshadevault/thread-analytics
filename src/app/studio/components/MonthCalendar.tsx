'use client';

import { useMemo } from 'react';
import type { PublicAccount } from '@/lib/accounts';
import {
  WEEKDAYS,
  avatarColor,
  dayKey,
  displayDate,
  fmtTime,
  hasMedia,
  isSameDay,
  monthGrid,
  statusMeta,
  usernameFor,
  type Thread,
} from '../helpers';

/**
 * BlackTwist-style month grid. Each day cell stacks its threads (time-sorted)
 * as clickable pills; hovering an empty cell reveals a quick "+ add" that opens
 * the composer prefilled to that day.
 */
export function MonthCalendar({
  month,
  threads,
  accounts,
  onSelectThread,
  onAddOnDay,
}: {
  month: Date;
  threads: Thread[];
  accounts: PublicAccount[];
  onSelectThread: (t: Thread) => void;
  onAddOnDay: (day: Date) => void;
}) {
  const days = useMemo(() => monthGrid(month), [month]);

  // Bucket threads by local day key once.
  const byDay = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of threads) {
      const k = dayKey(displayDate(t));
      const arr = map.get(k);
      if (arr) arr.push(t);
      else map.set(k, [t]);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => +displayDate(a) - +displayDate(b));
    }
    return map;
  }, [threads]);

  const today = new Date();
  const thisMonth = month.getMonth();

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)]">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-[var(--border-1)]">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]"
          >
            <span className="hidden sm:inline">{w}</span>
            <span className="sm:hidden">{w.slice(0, 3)}</span>
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const inMonth = day.getMonth() === thisMonth;
          const key = dayKey(day);
          const items = byDay.get(key) ?? [];
          const isToday = isSameDay(day, today);
          return (
            <div
              key={i}
              className={`group relative min-h-[112px] border-b border-r border-[var(--border-1)] p-1.5 ${
                i % 7 === 6 ? 'border-r-0' : ''
              } ${inMonth ? '' : 'bg-[var(--surface-2)]/40'}`}
            >
              <div className="mb-1 flex items-center justify-between px-0.5">
                <button
                  onClick={() => onAddOnDay(atNineAm(day))}
                  title="Add a post on this day"
                  className="text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--accent)] group-hover:opacity-100"
                >
                  +
                </button>
                <span
                  className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs tabular-nums ${
                    isToday
                      ? 'bg-[var(--accent)] font-semibold text-white'
                      : inMonth
                        ? 'text-[var(--text-secondary)]'
                        : 'text-[var(--text-muted)]'
                  }`}
                >
                  {day.getDate()}
                </span>
              </div>

              <div className="space-y-1">
                {items.map((t) => (
                  <ThreadPill
                    key={t.id}
                    thread={t}
                    username={usernameFor(t.threadsUserId, accounts)}
                    onClick={() => onSelectThread(t)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThreadPill({
  thread,
  username,
  onClick,
}: {
  thread: Thread;
  username: string;
  onClick: () => void;
}) {
  const meta = statusMeta(thread.status);
  const title = thread.segments[0] ?? '';
  const time = fmtTime(displayDate(thread));
  return (
    <button
      onClick={onClick}
      title={`@${username} · ${meta.label}\n${title}`}
      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-tight transition-colors hover:brightness-110"
      style={{ background: meta.bg, boxShadow: `inset 0 0 0 1px ${meta.ring}` }}
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
        style={{ background: avatarColor(username) }}
      >
        {username.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]">
        {hasMedia(thread) && <span title="Has images">🖼 </span>}
        {title || '(empty)'}
        {thread.segments.length > 1 && (
          <span className="text-[var(--text-muted)]"> +{thread.segments.length - 1}</span>
        )}
      </span>
      <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{time}</span>
    </button>
  );
}

/** Default new-post time when a day is clicked: 9:00 AM local. */
function atNineAm(day: Date): Date {
  const d = new Date(day);
  d.setHours(9, 0, 0, 0);
  return d;
}
