/** A single KPI tile — a headline number is a data-viz "form", not a chart. */
export function StatTile({
  label,
  value,
  loading,
  emphasis,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)] p-4 ${
        emphasis ? 'ring-1 ring-[var(--accent)]/30' : ''
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div
        className={`mt-1.5 tabular-nums ${emphasis ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'} text-2xl font-semibold`}
      >
        {loading && value === undefined ? (
          <span className="inline-block h-7 w-16 animate-pulse rounded bg-[var(--surface-2)]" />
        ) : value === undefined ? (
          '—'
        ) : (
          value.toLocaleString()
        )}
      </div>
    </div>
  );
}
