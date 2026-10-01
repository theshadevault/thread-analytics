import type { CSSProperties } from 'react';

/**
 * Per-account accent colours. The whole UI's `--accent` follows the account in
 * view, so each account reads as its own colour everywhere (header logo, hero
 * card, charts, buttons). Keyed by Threads username.
 */
const ACCOUNT_ACCENTS: Record<string, string> = {
  alexmax00001: '#D4FF3A', // lime
  shade_nvr: '#7DB9FF', // blue
  myrasharma808: '#FF8FC4', // pink
};

/** Fallbacks for accounts connected later, in connection order. */
const SPARE = ['#FFC53D', '#B79CFF', '#5EEAD4', '#FF9E5E'];

/** Accent used when no single account is in view ("All accounts"). */
export const NEUTRAL_ACCENT = '#F2F0E8';
/** Text colour that sits on any accent (they're all light). */
export const INK = '#0E0E0C';

/** Accent for an account; unknown usernames get a stable spare colour. */
export function accountAccent(username: string | null | undefined): string {
  if (!username) return NEUTRAL_ACCENT;
  const known = ACCOUNT_ACCENTS[username.toLowerCase()];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0;
  return SPARE[h % SPARE.length];
}

/** CSS variables that re-tint everything below an element to `color`. */
export function accentVars(color: string): CSSProperties {
  return {
    '--accent': color,
    '--accent-soft': `color-mix(in srgb, ${color} 22%, transparent)`,
  } as CSSProperties;
}
