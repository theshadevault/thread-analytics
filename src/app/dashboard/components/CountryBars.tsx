/**
 * Top follower countries as a horizontal bar list (share → length, one hue).
 * Meta returns ISO-3166 country codes ("US", "IN", …); we resolve them to full
 * country names and show each country's share of total followers as a percent.
 * Follower demographics only populate above ~100 followers, so a null result is
 * shown as an informational note, not an error.
 */

// Intl.DisplayNames resolves ISO country codes to full English names (e.g.
// "US" → "United States"). Constructed once at module load.
const REGION_NAMES =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

function countryName(code: string): string {
  const c = code?.trim();
  if (!c || c.toLowerCase() === 'unknown') return 'Unknown';
  // Only 2-letter ISO codes are resolvable; anything else is passed through.
  if (/^[A-Za-z]{2}$/.test(c) && REGION_NAMES) {
    try {
      return REGION_NAMES.of(c.toUpperCase()) ?? c.toUpperCase();
    } catch {
      return c.toUpperCase();
    }
  }
  return c;
}

export function CountryBars({
  data,
  loading,
}: {
  data: { label: string; value: number }[] | null;
  loading: boolean;
}) {
  // Percentages are computed against the FULL follower total (every country
  // Meta returned), not just the visible top rows, so the shares are accurate.
  const total = data?.reduce((s, d) => s + d.value, 0) ?? 0;
  const top = data?.slice(0, 6) ?? [];
  const max = top.reduce((m, d) => Math.max(m, d.value), 0) || 1;
  const otherPct = total > 0 ? ((total - top.reduce((n, d) => n + d.value, 0)) / total) * 100 : 0;

  return (
    <div className="flex flex-col gap-4 rounded-[22px] border border-[var(--border-1)] bg-[var(--surface-1)] p-5">
      <h2 className="m-0 text-2xl font-bold tracking-[-0.03em]">Where they&apos;re from</h2>
      {loading && !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded-lg bg-[var(--surface-2)]" />
          ))}
        </div>
      ) : !data || top.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          Not available yet — Meta only returns follower demographics once an account passes
          ~100 followers.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {top.map((d, i) => {
              const pct = total > 0 ? (d.value / total) * 100 : 0;
              return (
                <li key={d.label} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium" title={countryName(d.label)}>
                      {countryName(d.label)}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">
                        {d.value.toLocaleString()}
                      </span>
                      <span className="text-xl font-bold tracking-[-0.03em] tabular-nums">
                        {pct.toFixed(1)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[var(--divider)]">
                    <div
                      className="h-full rounded-full transition-[width,background-color]"
                      style={{
                        width: `${Math.max(4, (d.value / max) * 100)}%`,
                        background: i === 0 ? 'var(--accent)' : 'var(--text-faint)',
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {otherPct > 0.05 && (
            <div className="border-t border-[var(--divider)] pt-1 font-mono text-[11px] text-[var(--text-muted)]">
              Other countries · {otherPct.toFixed(1)}%
            </div>
          )}
        </>
      )}
    </div>
  );
}
