'use client';

import { useEffect, useRef, useState } from 'react';

export interface TrendPoint {
  date: string;
  value: number;
}

const H = 160;
const PAD = { top: 12, right: 12, bottom: 22, left: 40 };

export function TrendChart({
  title,
  points,
  format = (n: number) => n.toLocaleString(),
}: {
  title: string;
  points: TrendPoint[];
  format?: (n: number) => string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = Math.max(1, w - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const x = (i: number) =>
    PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - min) / span) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const areaPath =
    points.length > 1
      ? `${linePath} L ${x(points.length - 1)} ${PAD.top + innerH} L ${x(0)} ${PAD.top + innerH} Z`
      : '';

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    const rel = (px - PAD.left) / innerW;
    const i = Math.round(rel * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  if (points.length < 2) {
    return (
      <div className="rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)] p-4">
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="mt-6 mb-6 text-center text-sm text-[var(--text-muted)]">
          Collecting daily data — this chart fills in as the snapshot cron runs. Check back in a
          couple of days.
        </p>
      </div>
    );
  }

  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="rounded-xl border border-[var(--border-1)] bg-[var(--surface-1)] p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-xs tabular-nums text-[var(--text-secondary)]">
          {format(points[points.length - 1].value)}
        </span>
      </div>
      <div ref={wrapRef} className="relative">
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${w} ${H}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* y gridlines (min / max) */}
          {[min, max].map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={w - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--border-1)"
                strokeWidth={1}
              />
              <text x={4} y={y(v) + 3} fontSize={10} fill="var(--text-muted)">
                {format(v)}
              </text>
            </g>
          ))}
          <path d={areaPath} fill="var(--accent-soft)" opacity={0.5} />
          <path
            d={linePath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {/* endpoint labels */}
          <text x={PAD.left} y={H - 6} fontSize={10} fill="var(--text-muted)">
            {new Date(points[0].date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </text>
          <text x={w - PAD.right} y={H - 6} fontSize={10} fill="var(--text-muted)" textAnchor="end">
            {new Date(points[points.length - 1].date).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </text>
          {/* hover crosshair + dot */}
          {hp && (
            <g>
              <line
                x1={x(hover!)}
                x2={x(hover!)}
                y1={PAD.top}
                y2={PAD.top + innerH}
                stroke="var(--text-muted)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle cx={x(hover!)} cy={y(hp.value)} r={4} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hp && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-[var(--text-primary)] px-2 py-1 text-xs text-[var(--surface-1)] shadow"
            style={{ left: `${(x(hover!) / w) * 100}%`, top: 0 }}
          >
            <span className="font-medium tabular-nums">{format(hp.value)}</span>
            <span className="ml-1 opacity-70">
              {new Date(hp.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
