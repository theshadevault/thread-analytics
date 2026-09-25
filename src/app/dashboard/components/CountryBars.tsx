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

  return (
    <div className="rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)] p-4">
      <h3 className="mb-3 text-sm font-semibold">Followers by country</h3>
      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-[var(--surface-2)]" />
          ))}
        </div>
      ) : !data || top.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          Not available yet — Meta only returns follower demographics once an account passes
          ~100 followers.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {top.map((d) => {
            const pct = total > 0 ? (d.value / total) * 100 : 0;
            return (
              <li key={d.label}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-[var(--text-secondary)]" title={countryName(d.label)}>
                    {countryName(d.label)}
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--text-primary)]">
                    {pct.toFixed(1)}%
                    <span className="ml-1.5 text-[var(--text-muted)]">
                      {d.value.toLocaleString()}
                    </span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded bg-[var(--surface-2)]">
                  <div
                    className="h-full rounded bg-[var(--accent)]"
                    style={{ width: `${Math.max(4, (d.value / max) * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
