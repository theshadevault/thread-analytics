'use client';

import { useState } from 'react';
import type { PublicAccount } from '@/lib/accounts';
import { avatarColor, displayDate, statusMeta, usernameFor, type Thread } from '../helpers';
import { PostImage } from './PostImage';

/**
 * Read-only detail view for a single thread with lifecycle actions. Pending
 * threads can be edited, published now, or canceled; posted threads link out to
 * Threads; failed threads can be retried (publish now).
 */
export function ThreadDetailModal({
  thread,
  accounts,
  onClose,
  onEdit,
  onChanged,
}: {
  thread: Thread;
  accounts: PublicAccount[];
  onClose: () => void;
  onEdit: (t: Thread) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'cancel' | 'now' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const meta = statusMeta(thread.status);
  const username = usernameFor(thread.threadsUserId, accounts);
  const isFailed = thread.status === 'failed';
  // Pending and draft rows are both still editable / cancelable / publishable.
  const isEditable = thread.status === 'pending' || thread.status === 'draft';
  const isDraft = thread.status === 'draft';
  // Drafts show when they were saved; posted rows show when they went out
  // (displayDate); everything else shows its scheduled time.
  const when = isDraft ? new Date(thread.createdAt) : displayDate(thread);
  const whenLabel = isDraft ? 'Saved ' : thread.status === 'posted' ? 'Posted ' : '';

  async function cancel() {
    setBusy('cancel');
    setErr(null);
    try {
      const res = await fetch(`/api/schedule/${thread.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Cancel failed');
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
      setBusy(null);
    }
  }

  async function publishNow() {
    setBusy('now');
    setErr(null);
    try {
      // Failed rows aren't pending, so re-create+publish; pending rows publish in place.
      let res: Response;
      if (isFailed) {
        res = await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadsUserId: thread.threadsUserId,
            segments: thread.segments,
            mediaUrls: thread.mediaUrls ?? undefined,
            replyControl: thread.replyControl ?? undefined,
            publishNow: true,
          }),
        });
      } else {
        res = await fetch(`/api/schedule/${thread.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publishNow: true }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Publish failed');
      if (data.thread?.status === 'failed') throw new Error(data.thread?.error ?? 'Publish failed');
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="viz mt-[8vh] w-full max-w-lg rounded-2xl border border-[var(--border-1)] bg-[var(--surface-1)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-1)] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: avatarColor(username) }}
            >
              {username.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">@{username}</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                {whenLabel}
                {when.toLocaleString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ color: meta.color, background: meta.bg }}
          >
            {meta.label}
          </span>
        </div>

        <div className="max-h-[55vh] space-y-2.5 overflow-y-auto px-5 py-4">
          {thread.segments.map((seg, i) => {
            const img = thread.mediaUrls?.[i] ?? null;
            return (
              <div
                key={i}
                className="rounded-xl bg-[var(--surface-2)] p-3 text-sm text-[var(--text-primary)] ring-1 ring-[var(--border-1)]"
              >
                {thread.segments.length > 1 && (
                  <div className="mb-1.5 text-[11px] font-medium text-[var(--text-muted)]">
                    Part {i + 1} / {thread.segments.length}
                  </div>
                )}
                {/* Hook text on top, image below — mirrors how it reads on Threads. */}
                {seg && <p className="whitespace-pre-wrap">{seg}</p>}
                {img && (
                  <div
                    className={`relative h-80 w-full overflow-hidden rounded-lg bg-[var(--surface-1)] ring-1 ring-[var(--border-1)] ${
                      seg ? 'mt-2.5' : ''
                    }`}
                  >
                    <PostImage url={img} alt={`Part ${i + 1} image`} sizes="(max-width: 640px) 90vw, 480px" />
                  </div>
                )}
              </div>
            );
          })}

          {thread.error && (
            <div className="rounded-lg bg-[color-mix(in_srgb,#e5484d_10%,transparent)] px-3 py-2 text-xs text-[#e5484d]">
              {thread.error}
            </div>
          )}
          {err && <p className="text-xs text-[#e5484d]">{err}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-1)] px-5 py-3.5">
          {thread.permalink && (
            <a
              href={thread.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="mr-auto text-xs font-medium text-[var(--accent)] hover:opacity-80"
            >
              ↗ View on Threads
            </a>
          )}
          {isEditable && (
            <>
              <button
                onClick={cancel}
                disabled={busy !== null}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#e5484d] ring-1 ring-[color-mix(in_srgb,#e5484d_40%,transparent)] hover:bg-[color-mix(in_srgb,#e5484d_10%,transparent)] disabled:opacity-50"
              >
                {busy === 'cancel' ? 'Canceling…' : isDraft ? 'Delete draft' : 'Cancel'}
              </button>
              <button
                onClick={() => onEdit(thread)}
                disabled={busy !== null}
                className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] ring-1 ring-[var(--border-1)] hover:ring-[var(--accent)]/50 disabled:opacity-50"
              >
                {isDraft ? 'Edit / schedule' : 'Edit'}
              </button>
            </>
          )}
          {(isEditable || isFailed) && (
            <button
              onClick={publishNow}
              disabled={busy !== null}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'now' ? 'Posting…' : isFailed ? 'Retry now' : 'Post now'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
