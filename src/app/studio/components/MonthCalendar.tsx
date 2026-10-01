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
  pillLook,
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

  const todayCol = (today.getDay() + 6) % 7;
  const showsToday = days.some((d) => isSameDay(d, today));

  return (
    <div className="overflow-x-auto rounded-[22px] border border-[var(--border-1)] bg-[var(--surface-3)]">
      <div className="min-w-[700px]">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-[var(--border-1)]">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className="px-3 py-3 font-mono text-[11px] tracking-[0.08em]"
              style={{ color: showsToday && i === todayCol ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              {w.slice(0, 3).toUpperCase()}
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
                className={`group relative flex min-h-[104px] flex-col gap-1 border-b border-r border-[#1f1f1c] p-2 transition-colors hover:bg-[#191916] ${
                  i % 7 === 6 ? 'border-r-0' : ''
                } ${inMonth ? '' : 'bg-[#0f0f0d]'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <button
                      onClick={() => onAddOnDay(atNineAm(day))}
                      title="Add a post on this day"
                      aria-label={`Add a post on ${day.toDateString()}`}
                      className="text-sm leading-none text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--accent)] focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      +
                    </button>
                    {items.length > 0 && (
                      <span className="font-mono text-[10px] text-[var(--text-faint)]">
                        {items.length} post{items.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </span>
                  <span
                    className="flex h-[26px] min-w-[26px] items-center justify-center rounded-full px-1 text-[15px] font-bold tabular-nums"
                    style={
                      isToday
                        ? { background: 'var(--accent)', color: 'var(--on-accent)' }
                        : { color: inMonth ? 'var(--text-primary)' : '#4a4a43' }
                    }
                  >
                    {day.getDate()}
                  </span>
                </div>

                {items.map((t) => (
                  <ThreadPill
                    key={t.id}
                    thread={t}
                    username={usernameFor(t.threadsUserId, accounts)}
                    onClick={() => onSelectThread(t)}
                  />
                ))}
              </div>
            );
          })}
        </div>
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
  const look = pillLook(thread.status);
  const title = thread.segments[0] ?? '';
  const time = fmtTime(displayDate(thread));
  return (
    <button
      onClick={onClick}
      title={`@${username} · ${meta.label}\n${title}`}
      className="flex w-full items-center gap-1.5 rounded-[7px] border px-1.5 py-1 text-left text-[11.5px] leading-tight transition-[filter] hover:brightness-125"
      style={{ background: look.bg, borderColor: look.border, borderStyle: look.borderStyle }}
    >
      <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: avatarColor(username) }} />
      <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-primary)]">
        {hasMedia(thread) && <span title="Has images">🖼 </span>}
        {title || '(empty)'}
        {thread.segments.length > 1 && (
          <span className="text-[var(--text-muted)]"> +{thread.segments.length - 1}</span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums" style={{ color: look.time }}>
        {time}
      </span>
    </button>
  );
}

/** Default new-post time when a day is clicked: 9:00 AM local. */
function atNineAm(day: Date): Date {
  const d = new Date(day);
  d.setHours(9, 0, 0, 0);
  return d;
}
