/**
 * One-shot handoff of an analytics post into the Studio composer.
 *
 * The dashboard (`/dashboard`) and studio (`/studio`) are separate routes with
 * no shared client state, so "repurpose this post" stashes a draft in
 * sessionStorage, navigates to Studio, and Studio pops it on mount to prefill
 * the composer. sessionStorage (not query params) keeps post text out of the URL.
 */

export const REPURPOSE_KEY = 'ta:repurpose';

export interface RepurposeDraft {
  /** Account to preselect; null lets Studio fall back to its default. */
  threadsUserId?: string | null;
  /** Composer parts — every segment of the thread, in order. */
  segments: string[];
  /** Per-segment image URL (index-aligned with `segments`); null entry = text-only. */
  mediaUrls?: (string | null)[] | null;
  /** Original post link, kept for reference (not sent to Threads). */
  sourcePermalink?: string | null;
}

/** Stash a draft, then it's the caller's job to navigate to /studio. */
export function stashRepurpose(draft: RepurposeDraft): void {
  try {
    sessionStorage.setItem(REPURPOSE_KEY, JSON.stringify(draft));
  } catch {
    /* sessionStorage unavailable (private mode / quota) — silently skip */
  }
}

/** Pop the stashed draft (single-use — cleared on read). */
export function takeRepurpose(): RepurposeDraft | null {
  try {
    const raw = sessionStorage.getItem(REPURPOSE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(REPURPOSE_KEY);
    const draft = JSON.parse(raw) as RepurposeDraft;
    if (!Array.isArray(draft.segments) || draft.segments.length === 0) return null;
    return draft;
  } catch {
    return null;
  }
}
