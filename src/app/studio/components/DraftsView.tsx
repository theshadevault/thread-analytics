'use client';

import { useMemo, useState } from 'react';
import type { PublicAccount } from '@/lib/accounts';
import { avatarColor, hasMedia, statusMeta, usernameFor, type Thread } from '../helpers';
import { PostImage } from './PostImage';

type FilterKey = 'image' | 'thread' | 'single' | 'week';

const FILTERS: { key: FilterKey; label: string; test: (t: Thread) => boolean }[] = [
  { key: 'image', label: '🖼 Has image', test: (t) => hasMedia(t) },
  { key: 'thread', label: '🧵 Thread', test: (t) => t.segments.length > 1 },
  { key: 'single', label: '▤ Single', test: (t) => t.segments.length === 1 },
  {
    key: 'week',
    label: '📅 This week',
    test: (t) => +new Date(t.createdAt) >= Date.now() - 7 * 864e5,
  },
];

/**
 * Home for saved drafts (from AutoPost's ingest or a manually parked post).
 * Drafts never auto-publish and are kept off the calendar — this is their
 * inbox: searchable, filterable, with per-thread slide preview, inline
 * edit/delete, and multi-select bulk delete for clearing out AutoPost batches.
 */
export function DraftsView({
  threads,
  accounts,
  onSelect,
  onEdit,
  onNew,
  onChanged,
}: {
  threads: Thread[];
  accounts: PublicAccount[];
  onSelect: (t: Thread) => void;
  onEdit: (t: Thread) => void;
  onNew: () => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<Set<FilterKey>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Newest-saved first, then narrowed by the search box and any active chips.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...threads]
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .filter((t) => {
        if (q && !t.segments.some((s) => s.toLowerCase().includes(q))) return false;
        for (const f of FILTERS) {
          if (active.has(f.key) && !f.test(t)) return false;
        }
        return true;
      });
  }, [threads, query, active]);

  function toggleFilter(key: FilterKey) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allShownSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));
  function toggleSelectAll() {
    setSelected(allShownSelected ? new Set() : new Set(filtered.map((t) => t.id)));
  }

  async function deleteOne(id: string) {
    await fetch(`/api/schedule/${id}`, { method: 'DELETE' }).catch(() => {});
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    onChanged();
  }

  async function deleteSelected() {
    setBulkBusy(true);
    const ids = [...selected];
    await Promise.all(
      ids.map((id) => fetch(`/api/schedule/${id}`, { method: 'DELETE' }).catch(() => {})),
    );
    setSelected(new Set());
    setBulkBusy(false);
    onChanged();
  }

  if (!threads.length) {
    return (
      <div className="rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)] p-10 text-center">
        <p className="mx-auto max-w-md text-sm text-[var(--text-muted)]">
          No drafts yet. Posts saved as drafts — including everything AutoPost pushes
          in — land here until you schedule or post them.
        </p>
        <button
          onClick={onNew}
          className="mt-4 inline-block rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
        >
          + New post
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search drafts…"
        className="w-full rounded-lg bg-[var(--surface-1)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] ring-1 ring-[var(--border-1)] outline-none placeholder:text-[var(--text-muted)] focus:ring-[var(--accent)]/50"
      />

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const on = active.has(f.key);
          return (
            <button
              key={f.key}
              onClick={() => toggleFilter(f.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors ${
                on
                  ? 'bg-[var(--accent)] text-white ring-transparent'
                  : 'bg-[var(--surface-1)] text-[var(--text-secondary)] ring-[var(--border-1)] hover:text-[var(--text-primary)]'
              }`}
            >
              {f.label}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-[var(--text-muted)] tabular-nums">
          {filtered.length} draft{filtered.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={toggleSelectAll}
          className="rounded-full bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-1)] hover:text-[var(--text-primary)]"
        >
          {allShownSelected ? 'Clear selection' : `Select all${filtered.length ? ` (${filtered.length})` : ''}`}
        </button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-[var(--surface-1)] px-4 py-2.5 ring-1 ring-[var(--accent)]/40">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-1)] hover:text-[var(--text-primary)]"
            >
              Clear
            </button>
            <button
              onClick={deleteSelected}
              disabled={bulkBusy}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#e5484d] ring-1 ring-[color-mix(in_srgb,#e5484d_40%,transparent)] hover:bg-[color-mix(in_srgb,#e5484d_10%,transparent)] disabled:opacity-50"
            >
              {bulkBusy ? 'Deleting…' : `Delete ${selected.size}`}
            </button>
          </div>
        </div>
      )}

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)] p-10 text-center text-sm text-[var(--text-muted)]">
          No drafts match your search and filters.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <DraftCard
              key={t.id}
              thread={t}
              username={usernameFor(t.threadsUserId, accounts)}
              selected={selected.has(t.id)}
              onToggleSelect={() => toggleSelect(t.id)}
              onOpen={() => onSelect(t)}
              onEdit={() => onEdit(t)}
              onDelete={() => deleteOne(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One draft as a card with a slide viewer over its segments. */
function DraftCard({
  thread,
  username,
  selected,
  onToggleSelect,
  onOpen,
  onEdit,
  onDelete,
}: {
  thread: Thread;
  username: string;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [slide, setSlide] = useState(0);
  const [busy, setBusy] = useState(false);
  const total = thread.segments.length;
  const i = Math.min(slide, total - 1);
  const text = thread.segments[i] ?? '';
  const img = thread.mediaUrls?.[i] ?? null;
  const draftColor = statusMeta('draft').color;
  const saved = new Date(thread.createdAt);

  async function del() {
    setBusy(true);
    await onDelete();
    // Component may unmount on refresh; guard is cheap if it doesn't.
    setBusy(false);
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-[var(--surface-1)] transition-colors ${
        selected ? 'border-[var(--accent)]' : 'border-[var(--border-1)]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 shrink-0 accent-[var(--accent)]"
          aria-label="Select draft"
        />
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ background: avatarColor(username) }}
        >
          {username.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">@{username}</p>
          <p className="text-[11px] text-[var(--text-muted)]">
            Saved{' '}
            {saved.toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {thread.source === 'autopost' && ' · AutoPost'}
          </p>
        </div>
        <button
          onClick={onEdit}
          className="rounded-md bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-1)] hover:text-[var(--text-primary)]"
        >
          ✎ Edit
        </button>
        <button
          onClick={del}
          disabled={busy}
          title="Delete draft"
          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] ring-1 ring-[var(--border-1)] hover:text-[#e5484d] hover:ring-[color-mix(in_srgb,#e5484d_40%,transparent)] disabled:opacity-50"
        >
          🗑
        </button>
      </div>

      {/* Body: current slide's text + image, left-accented like a thread quote */}
      <button onClick={onOpen} className="block w-full px-4 py-3 text-left">
        <div className="border-l-2 pl-3" style={{ borderColor: draftColor }}>
          {text ? (
            <p className="line-clamp-4 whitespace-pre-wrap text-sm text-[var(--text-primary)]">
              {text}
            </p>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">(no text for this part)</p>
          )}
          {img ? (
            <div className="relative mt-2.5 h-44 w-full overflow-hidden rounded-lg bg-[var(--surface-2)] ring-1 ring-[var(--border-1)]">
              <PostImage url={img} alt={`Part ${i + 1}`} sizes="(max-width: 640px) 90vw, 340px" />
            </div>
          ) : (
            <div className="mt-2.5 flex h-16 w-full items-center justify-center rounded-lg bg-[var(--surface-2)] text-[11px] text-[var(--text-muted)] ring-1 ring-[var(--border-1)]">
              No image on this part
            </div>
          )}
        </div>
      </button>

      {/* Slide controls — only when the thread has more than one part */}
      {total > 1 && (
        <div className="flex items-center justify-between border-t border-[var(--border-1)] px-4 py-2">
          <button
            onClick={() => setSlide((s) => Math.max(0, s - 1))}
            disabled={i === 0}
            className="rounded-md px-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30"
            aria-label="Previous part"
          >
            ‹
          </button>
          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
            {i + 1} / {total}
          </span>
          <button
            onClick={() => setSlide((s) => Math.min(total - 1, s + 1))}
            disabled={i === total - 1}
            className="rounded-md px-2 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30"
            aria-label="Next part"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
