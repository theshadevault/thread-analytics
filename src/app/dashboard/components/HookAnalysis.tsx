'use client';

import { useMemo, useState } from 'react';
import { analyzeHooks, buildReport, type HookPost } from '@/lib/hooks';

export function HookAnalysis({
  posts,
  label,
  days,
}: {
  posts: HookPost[];
  label: string;
  days: number;
}) {
  const analysis = useMemo(() => analyzeHooks(posts), [posts]);
  const [copied, setCopied] = useState(false);

  async function copyReport() {
    const report = buildReport(analysis, { label, days, count: posts.length });
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — fall back to a prompt the user can copy from.
      window.prompt('Copy this analysis:', report);
    }
  }

  if (posts.length === 0) return null;

  const maxOutlier = Math.max(1, ...analysis.patterns.map((p) => p.medianOutlier));

  return (
    <section className="mt-5 rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-1)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Hook analysis</h3>
          <p className="text-xs text-[var(--text-muted)]">
            First lines grouped by pattern · scored vs your median of{' '}
            {Math.round(analysis.medianViews).toLocaleString()} views
          </p>
        </div>
        <button
          onClick={copyReport}
          className="rounded-lg bg-[var(--accent)] px-3.5 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          {copied ? '✓ Copied for Claude' : '⧉ Copy analysis for Claude'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 p-4 lg:grid-cols-2">
        {/* Winning templates */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Winning templates (median × baseline)
          </h4>
          {analysis.patterns.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              Not enough posts per pattern yet — widen the date range.
            </p>
          ) : (
            <ul className="space-y-3">
              {analysis.patterns.map((p) => (
                <li key={p.template}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--text-primary)]">
                      {p.template}{' '}
                      <span className="font-normal text-[var(--text-muted)]">
                        ({p.count} posts)
                      </span>
                    </span>
                    <span className="tabular-nums text-[var(--text-secondary)]">
                      {p.medianOutlier.toFixed(1)}×
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-[var(--surface-2)]">
                    <div
                      className="h-full rounded bg-[var(--accent)]"
                      style={{ width: `${Math.max(4, (p.medianOutlier / maxOutlier) * 100)}%` }}
                    />
                  </div>
                  <p
                    className="mt-1 truncate text-xs text-[var(--text-muted)]"
                    title={p.bestExample.hook}
                  >
                    best: “{p.bestExample.hook}” ({p.bestExample.outlier.toFixed(1)}×)
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Feature lift */}
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            What correlates with more views
          </h4>
          {analysis.features.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              Not enough data to correlate features yet.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {analysis.features.map((f) => {
                const positive = f.lift >= 0;
                const pct = Math.min(100, Math.abs(f.lift) * 100);
                return (
                  <li key={f.feature} className="flex items-center gap-3 text-xs">
                    <span className="w-40 shrink-0 text-[var(--text-secondary)]">{f.feature}</span>
                    <div className="relative flex h-2 flex-1 items-center">
                      <div className="absolute left-1/2 h-full w-px bg-[var(--border-1)]" />
                      <div
                        className="absolute h-full rounded"
                        style={{
                          width: `${pct / 2}%`,
                          left: positive ? '50%' : undefined,
                          right: positive ? undefined : '50%',
                          background: positive ? 'var(--good)' : '#e34948',
                        }}
                      />
                    </div>
                    <span
                      className="w-12 shrink-0 text-right font-medium tabular-nums"
                      style={{ color: positive ? 'var(--good)' : '#e34948' }}
                    >
                      {positive ? '+' : ''}
                      {Math.round(f.lift * 100)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Top hooks */}
      <div className="border-t border-[var(--border-1)] p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          Top hooks
        </h4>
        <ul className="space-y-1.5">
          {analysis.hooks.slice(0, 10).map((h, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-[var(--accent)]">
                {h.outlier.toFixed(1)}×
              </span>
              <a
                href={h.permalink ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-[var(--text-primary)] hover:text-[var(--accent)]"
                title={h.hook}
              >
                {h.username && <span className="text-[var(--text-muted)]">@{h.username} · </span>}
                {h.hook}
              </a>
              <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                {h.views.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
