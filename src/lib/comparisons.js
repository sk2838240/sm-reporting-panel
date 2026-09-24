// Comparison engine. Operates on an array of reports sorted by period_start ASC.
// getValue(report, metricKey, platform?) -> number | null
export function getValue(report, key, platform) {
  if (!report) return null;
  let v;
  if (platform) v = report.metrics?.[platform]?.[key];
  else v = report.metrics?.[key];
  return num(v);
}

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

export function compare(cur, prev, lowerBetter) {
  if (cur === null || prev === null) return { cur, prev, abs: null, pct: null, good: null };
  const abs = cur - prev;
  const pct = prev !== 0 ? (abs / Math.abs(prev)) * 100 : null;
  let good = null;
  if (abs !== 0) good = lowerBetter ? abs < 0 : abs > 0;
  return { cur, prev, abs, pct, good };
}

export function momDelta(series, idx, key, platform, lowerBetter) {
  const cur = getValue(series[idx], key, platform);
  const prev = idx > 0 ? getValue(series[idx - 1], key, platform) : null;
  return compare(cur, prev, lowerBetter);
}

export function yoyDelta(series, idx, key, platform, lowerBetter) {
  const cur = getValue(series[idx], key, platform);
  const target = new Date(new Date(series[idx].period_start).getTime() - 340 * 86400000);
  let best = null, bestDiff = Infinity;
  for (let i = idx - 1; i >= 0; i--) {
    const d = new Date(series[i].period_start).getTime();
    const diff = Math.abs(d - target.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = i; }
    if (d < target.getTime()) break;
  }
  const prev = best !== null ? getValue(series[best], key, platform) : null;
  return compare(cur, prev, lowerBetter);
}

export function trailingAvg(series, idx, key, platform, windowSize) {
  const vals = [];
  for (let i = Math.max(0, idx - windowSize + 1); i <= idx; i++) {
    const v = getValue(series[i], key, platform);
    if (v !== null) vals.push(v);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function vsTarget(cur, targetValue, lowerBetter = false) {
  if (cur === null || targetValue === null || targetValue === undefined || isNaN(Number(targetValue))) return null;
  const t = Number(targetValue);
  // "Progress toward goal": 100% means the target is met, in either direction.
  // For lower-is-better metrics (e.g. average ranking) being below the target
  // is success, so the ratio is inverted.
  let pct = null;
  if (lowerBetter) pct = cur !== 0 ? (t / cur) * 100 : null;
  else pct = t !== 0 ? (cur / t) * 100 : null;
  const remaining = lowerBetter ? cur - t : t - cur;
  const met = lowerBetter ? cur <= t : cur >= t;
  return { cur, target: t, pct, remaining, met, lowerBetter };
}

export function rangeAggregate(reports, key, platform, mode = 'avg') {
  const vals = reports.map(r => getValue(r, key, platform)).filter(v => v !== null);
  if (!vals.length) return null;
  if (mode === 'sum') return vals.reduce((a, b) => a + b, 0);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Given the full series and a list of period_start dates defining a set, return reports in that set.
export function selectByPeriods(series, periodStarts) {
  const set = new Set(periodStarts);
  return series.filter(r => set.has(r.period_start));
}
