import type { PostAnalytics } from '@/lib/analytics';

/**
 * Hook analysis — pure functions, safe to run in the client bundle.
 *
 * The "hook" is the first line of a post (the scroll-stopper). We classify each
 * hook into a template, score its performance relative to the account's own
 * median (an "outlier ×"), and correlate concrete hook features with views —
 * all so you can see *which patterns work* and feed that back into writing.
 */

export type HookPost = PostAnalytics & { username?: string };

export function extractHook(text: string): string {
  const firstLine =
    (text || '')
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean) ?? '';
  return firstLine.length > 140 ? `${firstLine.slice(0, 137)}…` : firstLine;
}

// --- Template detection (first match wins; order matters) --------------------

interface TemplateDef {
  name: string;
  test: (h: string) => boolean;
}

const TEMPLATES: TemplateDef[] = [
  { name: 'How-to (without Y)', test: (h) => /how to/i.test(h) && /\(.*without.*\)/i.test(h) },
  { name: 'How-to', test: (h) => /^how (to|i)\b/i.test(h) },
  { name: 'If you…, do this', test: (h) => /^if you/i.test(h) },
  {
    name: 'Listicle (N things)',
    test: (h) =>
      /\b\d+\s+(ways|things|tips|lessons|rules|steps|habits|mistakes|reasons|signs|secrets)\b/i.test(
        h,
      ),
  },
  { name: 'Why X', test: (h) => /^why\b/i.test(h) },
  {
    name: 'Question',
    test: (h) =>
      /\?\s*$/.test(h) || /^(what|when|who|which|are|do|does|can|should|is|will)\b/i.test(h),
  },
  {
    name: 'Command (Stop/Start/Do)',
    test: (h) => /^(stop|start|do|don'?t|never|always|avoid|use|try|read|watch|quit)\b/i.test(h),
  },
  {
    name: 'Contrarian / curiosity',
    test: (h) => /\b(nobody|no one|secret|truth|unpopular|the real|hidden|what they don'?t)\b/i.test(h),
  },
  { name: 'The X that Y', test: (h) => /^the\b/i.test(h) },
];

export function detectTemplate(hook: string): string {
  for (const t of TEMPLATES) if (t.test(hook)) return t.name;
  return 'Other / statement';
}

// --- Hook features -----------------------------------------------------------

export interface HookFeatures {
  words: number;
  hasNumber: boolean;
  allCaps: boolean;
  question: boolean;
  usesYou: boolean;
  parenthetical: boolean;
  curiosity: boolean;
}

const BOOLEAN_FEATURES: { key: keyof HookFeatures; label: string }[] = [
  { key: 'hasNumber', label: 'Has a number' },
  { key: 'allCaps', label: 'ALL-CAPS opener' },
  { key: 'question', label: 'Is a question' },
  { key: 'usesYou', label: 'Uses "you"' },
  { key: 'parenthetical', label: 'Has a (parenthetical)' },
  { key: 'curiosity', label: 'Curiosity / negativity word' },
];

export function hookFeatures(h: string): HookFeatures {
  const letters = h.replace(/[^a-zA-Z]/g, '');
  const upper = h.replace(/[^A-Z]/g, '');
  return {
    words: h.split(/\s+/).filter(Boolean).length,
    hasNumber: /\d/.test(h),
    allCaps: letters.length >= 6 && upper.length / letters.length > 0.7,
    question: /\?\s*$/.test(h),
    usesYou: /\byou(r|'?re|rself)?\b/i.test(h),
    parenthetical: /\(.+\)/.test(h),
    curiosity: /\b(secret|nobody|no one|truth|mistake|stop|never|why|hidden|unpopular)\b/i.test(h),
  };
}

// --- Aggregation -------------------------------------------------------------

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface AnalyzedHook {
  hook: string;
  template: string;
  views: number;
  engagementRate: number;
  outlier: number;
  permalink: string | null;
  username?: string;
  features: HookFeatures;
}

export interface PatternStat {
  template: string;
  count: number;
  medianViews: number;
  medianOutlier: number;
  avgEngagement: number;
  bestExample: AnalyzedHook;
}

export interface FeatureStat {
  feature: string;
  withMedian: number;
  withoutMedian: number;
  lift: number;
  withCount: number;
}

export interface HookAnalysis {
  medianViews: number;
  hooks: AnalyzedHook[];
  patterns: PatternStat[];
  features: FeatureStat[];
}

export function analyzeHooks(posts: HookPost[]): HookAnalysis {
  // Baseline uses posts that have any reach, so brand-new 0-view posts don't
  // drag the median down and inflate everyone's outlier score.
  const base = median(posts.filter((p) => p.views > 0).map((p) => p.views)) || 1;

  const hooks: AnalyzedHook[] = posts
    .map((p) => {
      const hook = extractHook(p.text);
      return {
        hook,
        template: detectTemplate(hook),
        views: p.views,
        engagementRate: p.engagementRate,
        outlier: p.views / base,
        permalink: p.permalink,
        username: p.username,
        features: hookFeatures(hook),
      };
    })
    .filter((h) => h.hook.length > 0)
    .sort((a, b) => b.outlier - a.outlier);

  // Patterns (need ≥2 posts to be worth reporting).
  const byTemplate = new Map<string, AnalyzedHook[]>();
  for (const h of hooks) {
    const arr = byTemplate.get(h.template) ?? [];
    arr.push(h);
    byTemplate.set(h.template, arr);
  }
  const patterns: PatternStat[] = [...byTemplate.entries()]
    .map(([template, hs]) => ({
      template,
      count: hs.length,
      medianViews: median(hs.map((h) => h.views)),
      medianOutlier: median(hs.map((h) => h.outlier)),
      avgEngagement: hs.reduce((s, h) => s + h.engagementRate, 0) / hs.length,
      bestExample: hs.reduce((a, b) => (b.views > a.views ? b : a)),
    }))
    .filter((p) => p.count >= 2)
    .sort((a, b) => b.medianOutlier - a.medianOutlier);

  // Feature lift (need ≥3 posts with the feature for a stable read).
  const features: FeatureStat[] = BOOLEAN_FEATURES.map(({ key, label }) => {
    const withViews = hooks.filter((h) => h.features[key] === true).map((h) => h.views);
    const withoutViews = hooks.filter((h) => h.features[key] === false).map((h) => h.views);
    const withMedian = median(withViews);
    const withoutMedian = median(withoutViews);
    return {
      feature: label,
      withMedian,
      withoutMedian,
      lift: withoutMedian > 0 ? (withMedian - withoutMedian) / withoutMedian : 0,
      withCount: withViews.length,
    };
  })
    .filter((f) => f.withCount >= 3)
    .sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));

  return { medianViews: base, hooks, patterns, features };
}

// --- Claude-ready report -----------------------------------------------------

export function buildReport(
  a: HookAnalysis,
  meta: { label: string; days: number; count: number },
): string {
  const L: string[] = [];
  L.push(`# Threads Hook Analysis — ${meta.label} (last ${meta.days} days, ${meta.count} posts)`);
  L.push('');
  L.push(
    `Baseline: my median post gets ~${Math.round(a.medianViews).toLocaleString()} views. "×" below = a post's views ÷ this baseline (how much it overperformed).`,
  );
  L.push('');
  L.push('## Winning hook templates (ranked by relative performance)');
  a.patterns.slice(0, 8).forEach((p, i) => {
    L.push(
      `${i + 1}. ${p.template} — ${p.count} posts, median ${p.medianOutlier.toFixed(
        1,
      )}× baseline, ${(p.avgEngagement * 100).toFixed(1)}% avg engagement`,
    );
    L.push(
      `   Best example: "${p.bestExample.hook}" (${p.bestExample.views.toLocaleString()} views, ${p.bestExample.outlier.toFixed(1)}×)`,
    );
  });
  L.push('');
  if (a.features.length) {
    L.push('## What correlates with more views');
    a.features.forEach((f) => {
      const sign = f.lift >= 0 ? '+' : '';
      L.push(`- ${f.feature}: ${sign}${Math.round(f.lift * 100)}% median views (${f.withCount} posts)`);
    });
    L.push('');
  }
  L.push('## My top hooks (verbatim, with performance)');
  a.hooks.slice(0, 15).forEach((h) => {
    L.push(`- ${h.outlier.toFixed(1)}× | ${h.views.toLocaleString()} views | "${h.hook}"`);
  });
  L.push('');
  L.push('## Your task');
  L.push(
    'Using the winning templates and the feature patterns above, write 10 new Threads hooks about [TOPIC] that match my proven patterns and voice. For each, note which template it uses.',
  );
  return L.join('\n');
}
