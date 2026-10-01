import type { PublicAccount } from '@/lib/accounts';
import { accentVars, accountAccent } from '@/lib/theme';

/**
 * Page chrome shared by Analytics and Studio: logo, page tabs, connected
 * account avatars and the connect button. `accent` re-tints the whole page.
 */
export function AppShell({
  page,
  accent,
  accounts,
  children,
}: {
  page: 'analytics' | 'studio';
  accent: string;
  accounts: PublicAccount[] | null;
  children: React.ReactNode;
}) {
  const tab = (on: boolean) =>
    `rounded-full px-4 py-[7px] text-sm font-semibold transition-colors ${
      on ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
    }`;
  return (
    <div className="viz min-h-screen bg-[var(--page)] text-[var(--text-primary)]" style={accentVars(accent)}>
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 pb-16 pt-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--divider)] pb-4">
          <div className="flex flex-wrap items-center gap-7">
            <a href="/dashboard" className="flex items-center gap-2.5 text-[var(--text-primary)]">
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-[var(--accent)] text-lg font-extrabold text-[var(--on-accent)] transition-colors">
                @
              </span>
              <span className="text-[19px] font-bold tracking-[-0.02em]">Threads Analytics</span>
            </a>
            <nav className="flex gap-1 rounded-full border border-[var(--border-1)] bg-[var(--surface-1)] p-1">
              {page === 'analytics' ? (
                <span className={tab(true)}>Analytics</span>
              ) : (
                <a href="/dashboard" className={tab(false)}>
                  Analytics
                </a>
              )}
              {page === 'studio' ? (
                <span className={tab(true)}>Studio</span>
              ) : (
                <a href="/studio" className={tab(false)}>
                  Studio
                </a>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-2.5">
            {accounts && accounts.length > 0 && (
              <div className="flex pl-1.5">
                {accounts.map((a) => (
                  <Avatar key={a.threadsUserId} username={a.username} size={30} ring className="-ml-1.5" />
                ))}
              </div>
            )}
            <a
              href="/api/auth/threads"
              className="rounded-full border border-[var(--border-2)] px-3.5 py-2 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-2)]"
            >
              + Connect account
            </a>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Account monogram in the account's colour. */
export function Avatar({
  username,
  size = 22,
  ring,
  className = '',
}: {
  username: string;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  return (
    <span
      title={`@${username}`}
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-[var(--on-accent)] ${
        ring ? 'border-2 border-[var(--page)]' : ''
      } ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45), background: accountAccent(username) }}
    >
      {(username || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Rounded account filter chip; `all` renders the "All accounts" variant. */
export function AccountChip({
  username,
  label,
  active,
  onClick,
  small,
}: {
  username: string | null;
  label: string;
  active: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-[7px] rounded-full border font-medium transition-colors ${
        small ? 'py-[5px] pl-[5px] pr-2.5 text-xs' : 'py-1.5 pl-1.5 pr-3 text-[13px]'
      } ${
        active
          ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--on-accent)]'
          : 'border-[var(--border-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {username ? (
        <Avatar username={username} size={small ? 18 : 20} />
      ) : (
        <span
          className="flex items-center justify-center rounded-full bg-[var(--text-primary)] font-bold text-[var(--on-accent)]"
          style={{ width: small ? 18 : 20, height: small ? 18 : 20, fontSize: small ? 10 : 11, boxShadow: active ? 'inset 0 0 0 1.5px var(--page)' : undefined }}
        >
          ∗
        </span>
      )}
      {label}
    </button>
  );
}

/** Segmented control; the active option takes the accent. */
export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  mono,
  label,
  surface = 'card',
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  mono?: boolean;
  label: string;
  surface?: 'card' | 'page';
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex rounded-[10px] border border-[var(--border-1)] p-[3px] ${surface === 'page' ? 'bg-[var(--page)]' : 'bg-[var(--surface-1)]'}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className={`rounded-[7px] px-2.5 py-1.5 text-xs transition-colors ${mono ? 'font-mono font-medium' : 'font-semibold'} ${
              on ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Quiet bordered button used for Refresh / CSV / Today etc. */
export const ghostBtn =
  'rounded-[10px] border border-[var(--border-1)] bg-[var(--surface-1)] px-3 py-[7px] text-[13px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50';
