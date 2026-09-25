'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PublicAccount } from '@/lib/accounts';
import { avatarColor, imageSrc, toDatetimeLocal } from '../helpers';

const MAX_LEN = 500;
const REPLY_CONTROLS = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'accounts_you_follow', label: 'Accounts you follow' },
  { value: 'mentioned_only', label: 'Mentioned only' },
] as const;

export interface ComposerInitial {
  editingId?: string;
  threadsUserId?: string | null;
  segments?: string[];
  /** Per-segment image URLs (index-aligned with segments). */
  mediaUrls?: (string | null)[] | null;
  replyControl?: string;
  /** Prefill the schedule field (Date) — e.g. the day cell that was clicked. */
  when?: Date | null;
}

/** A part = one post in the thread: its text plus an optional image URL. */
interface Part {
  text: string;
  img: string | null;
}

/** Zip segments + mediaUrls into aligned parts, padding media to segment length. */
function toParts(segments: string[] | undefined, media: (string | null)[] | null | undefined): Part[] {
  const segs = segments?.length ? segments : [''];
  return segs.map((text, i) => ({ text, img: media?.[i] ?? null }));
}

/**
 * Modal editor for composing, scheduling, editing, and immediately posting a
 * multi-part thread. Each part carries its own optional image (loaded from the
 * saved draft and preserved on save). In edit mode (`initial.editingId`) it
 * PATCHes the existing queued row; otherwise it POSTs a new one.
 */
export function Composer({
  accounts,
  open,
  initial,
  onClose,
  onSaved,
}: {
  accounts: PublicAccount[];
  open: boolean;
  initial: ComposerInitial;
  onClose: () => void;
  onSaved: () => void;
}) {
  const firstAccount = accounts[0]?.threadsUserId ?? '';
  const [accountId, setAccountId] = useState(initial.threadsUserId || firstAccount);
  const [parts, setParts] = useState<Part[]>(toParts(initial.segments, initial.mediaUrls));
  const [replyControl, setReplyControl] = useState(initial.replyControl ?? 'everyone');
  const [when, setWhen] = useState(initial.when ? toDatetimeLocal(initial.when) : '');
  const [busy, setBusy] = useState<'schedule' | 'now' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isEdit = Boolean(initial.editingId);

  // Re-seed the form each time the modal is (re)opened with fresh initial data.
  useEffect(() => {
    if (!open) return;
    setAccountId(initial.threadsUserId || firstAccount);
    setParts(toParts(initial.segments, initial.mediaUrls));
    setReplyControl(initial.replyControl ?? 'everyone');
    setWhen(initial.when ? toDatetimeLocal(initial.when) : '');
    setErr(null);
    setBusy(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const filled = useMemo(() => parts.filter((p) => p.text.trim()), [parts]);
  const totalChars = useMemo(() => filled.reduce((n, p) => n + p.text.trim().length, 0), [filled]);
  const imageCount = useMemo(() => parts.filter((p) => p.img).length, [parts]);

  if (!open) return null;

  function setText(i: number, v: string) {
    setParts((cur) => cur.map((p, idx) => (idx === i ? { ...p, text: v } : p)));
  }
  function setImg(i: number, url: string | null) {
    setParts((cur) => cur.map((p, idx) => (idx === i ? { ...p, img: url } : p)));
  }
  function addPart() {
    setParts((cur) => [...cur, { text: '', img: null }]);
  }
  function removePart(i: number) {
    setParts((cur) => (cur.length === 1 ? cur : cur.filter((_, idx) => idx !== i)));
  }

  async function save(publishNow: boolean) {
    setErr(null);
    // Drop empty parts, but keep each surviving part's image aligned to its text.
    const kept = parts.map((p) => ({ text: p.text.trim(), img: p.img })).filter((p) => p.text);
    if (!accountId) return setErr('Pick an account.');
    if (!kept.length) return setErr('Write at least one part.');
    if (!publishNow && !when) return setErr('Pick a date & time, or use “Post now”.');
    const over = kept.findIndex((p) => p.text.length > MAX_LEN);
    if (over >= 0) return setErr(`Part ${over + 1} is over ${MAX_LEN} characters.`);

    const segments = kept.map((p) => p.text);
    const media = kept.map((p) => p.img);
    // Send the array only when at least one part carries an image (keeps plain
    // text threads clean); the backend treats all-null as no media anyway.
    const mediaUrls = media.some(Boolean) ? media : null;

    setBusy(publishNow ? 'now' : 'schedule');
    try {
      const scheduledAt = publishNow ? undefined : new Date(when).toISOString();
      let res: Response;
      if (isEdit) {
        res = await fetch(`/api/schedule/${initial.editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segments, mediaUrls, replyControl, scheduledAt, publishNow }),
        });
      } else {
        res = await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadsUserId: accountId,
            segments,
            mediaUrls,
            replyControl,
            scheduledAt,
            publishNow,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Request failed');

      if (publishNow) {
        const st = data.thread?.status;
        if (st === 'failed') throw new Error(data.thread?.error ?? 'Publish failed');
        // posted or pending(requeued) both count as accepted — close and refresh.
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  const acct = accounts.find((a) => a.threadsUserId === accountId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="viz mt-[6vh] w-full max-w-xl rounded-2xl border border-[var(--border-1)] bg-[var(--surface-1)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-1)] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {isEdit ? 'Edit thread' : 'New thread'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {/* Account */}
          <div className="mb-4 flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: avatarColor(acct?.username ?? accountId) }}
            >
              {(acct?.username ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={isEdit}
              className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] ring-1 ring-[var(--border-1)] outline-none disabled:opacity-60"
            >
              {accounts.map((a) => (
                <option key={a.threadsUserId} value={a.threadsUserId}>
                  @{a.username}
                </option>
              ))}
            </select>
          </div>

          {/* Parts — connected by a vertical rail so the thread reads as a chain. */}
          <div className="space-y-3">
            {parts.map((part, i) => (
              <PartCard
                key={i}
                index={i}
                total={parts.length}
                part={part}
                onText={(v) => setText(i, v)}
                onSetImg={(url) => setImg(i, url)}
                onRemove={() => removePart(i)}
              />
            ))}
          </div>

          <button
            onClick={addPart}
            className="mt-3 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--surface-2)]"
          >
            + Add part
          </button>

          {/* Options */}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
              Who can reply
              <select
                value={replyControl}
                onChange={(e) => setReplyControl(e.target.value)}
                className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] ring-1 ring-[var(--border-1)] outline-none"
              >
                {REPLY_CONTROLS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
              Schedule for
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] ring-1 ring-[var(--border-1)] outline-none"
              />
            </label>
          </div>

          {err && <p className="mt-3 text-xs text-[#e5484d]">{err}</p>}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-1)] px-5 py-3.5">
          <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
            {filled.length} part{filled.length === 1 ? '' : 's'}
            {imageCount > 0 && ` · ${imageCount} 🖼`} · {totalChars} chars
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => save(false)}
              disabled={busy !== null}
              className="rounded-lg bg-[var(--surface-2)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] ring-1 ring-[var(--border-1)] transition-colors hover:ring-[var(--accent)]/50 disabled:opacity-50"
            >
              {busy === 'schedule' ? 'Saving…' : isEdit ? 'Save changes' : 'Schedule'}
            </button>
            <button
              onClick={() => save(true)}
              disabled={busy !== null}
              className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'now' ? 'Posting…' : 'Post now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One part of the thread: multiline text + an optional image. Shows a live
 * thumbnail for the saved image with a remove control, or an "Add image"
 * affordance that reveals a URL field (images are hosted URLs — e.g. from
 * AutoPost's blob store — so there's no upload step).
 */
function PartCard({
  index,
  total,
  part,
  onText,
  onSetImg,
  onRemove,
}: {
  index: number;
  total: number;
  part: Part;
  onText: (v: string) => void;
  onSetImg: (url: string | null) => void;
  onRemove: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [broken, setBroken] = useState(false);
  const len = part.text.trim().length;
  const over = len > MAX_LEN;

  function commitUrl() {
    const u = urlDraft.trim();
    if (!/^https?:\/\//i.test(u)) return;
    setBroken(false);
    onSetImg(u);
    setUrlDraft('');
    setAdding(false);
  }

  return (
    <div className="rounded-xl bg-[var(--surface-2)] p-2.5 ring-1 ring-[var(--border-1)]">
      {total > 1 && (
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span className="font-medium">
            Part {index + 1} / {total}
          </span>
          <button onClick={onRemove} className="hover:text-[#e5484d]">
            Remove part
          </button>
        </div>
      )}

      {/* Hook text on top… */}
      <textarea
        value={part.text}
        onChange={(e) => onText(e.target.value)}
        rows={index === 0 ? 4 : 3}
        autoFocus={index === 0}
        placeholder={index === 0 ? 'Write your hook…' : 'Continue the thread…'}
        className="w-full resize-y bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
      />

      {/* …image below it (thumbnail + remove), or the add-image URL field. */}
      {part.img ? (
        <div className="relative mt-2 overflow-hidden rounded-lg ring-1 ring-[var(--border-1)]">
          {broken ? (
            <div className="flex h-24 items-center justify-center bg-[var(--surface-1)] px-3 text-center text-[11px] text-[var(--text-muted)]">
              Image can’t be previewed — the link may have expired.
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc(part.img)}
              alt={`Part ${index + 1} image`}
              referrerPolicy="no-referrer"
              onError={() => setBroken(true)}
              className="max-h-80 w-full bg-[var(--surface-1)] object-contain"
            />
          )}
          <button
            onClick={() => {
              onSetImg(null);
              setBroken(false);
            }}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/80"
            title="Remove image"
          >
            ✕
          </button>
        </div>
      ) : adding ? (
        <div className="mt-2 flex gap-1.5">
          <input
            autoFocus
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitUrl();
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="Paste an image URL (https://…)"
            className="min-w-0 flex-1 rounded-lg bg-[var(--surface-1)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] ring-1 ring-[var(--border-1)] outline-none placeholder:text-[var(--text-muted)]"
          />
          <button
            onClick={commitUrl}
            className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Add
          </button>
          <button
            onClick={() => setAdding(false)}
            className="rounded-lg px-2 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* Action row: add-image affordance + character count. */}
      <div className="mt-2 flex items-center justify-between">
        {!part.img && !adding ? (
          <button
            onClick={() => setAdding(true)}
            className="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--accent)]"
          >
            🖼 Add image
          </button>
        ) : (
          <span />
        )}
        <span className={`text-[11px] tabular-nums ${over ? 'text-[#e5484d]' : 'text-[var(--text-muted)]'}`}>
          {len}/{MAX_LEN}
        </span>
      </div>
    </div>
  );
}
