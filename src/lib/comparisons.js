// Comparison engine. Operates on an array of reports sorted by period_start ASC.
// getValue(report, metricKey, platform?) -> number | null
import { parseLocalDate } from './format';

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

// Returns the index of the prior-year report for the period at `idx`, or null
// when there is none. Matching is on the calendar month, not elapsed days:
// "340 days back" lands between two month-starts and selected the *following*
// month, so a YoY card compared March against April under a "last year" label.
function nearestPeriod(series, idx, monthsBack) {
  // parseLocalDate, not `new Date(x)`: period_start is a Postgres date returned
  // as "2025-03-01", which ES parses as UTC midnight. West of UTC that is
  // 28 February locally, so getDate() === 1 was false for every month-aligned
  // report and the exact-match branch below never ran.
  const cur = parseLocalDate(series[idx].period_start);
  if (isNaN(cur)) return null;
  const targetYear = cur.getFullYear() - monthsBack;
  const targetMonth = cur.getMonth();

  if (cur.getDate() === 1) {
    // Month-aligned period: require the same calendar month, exactly one year
    // back. No fuzzy fallback — a neighbouring month is not "last year", and
    // accepting one is what made a short history silently report MoM figures.
    for (let i = idx - 1; i >= 0; i--) {
      const d = parseLocalDate(series[i].period_start);
      if (isNaN(d)) continue;
      if (d.getFullYear() === targetYear && d.getMonth() === targetMonth && d.getDate() === 1) return i;
    }
    return null;
  }

  // Cycle period ("last 30 days"): the start drifts, so allow a narrow window
  // around the one-year anniversary.
  const anniversary = new Date(cur);
  anniversary.setFullYear(anniversary.getFullYear() - monthsBack);
  const tolMs = 15 * 86400000;
  let best = null, bestDiff = Infinity;
  for (let i = idx - 1; i >= 0; i--) {
    // parseLocalDate here too: the cycle branch was left on `new Date()`, so
    // each candidate was shifted a day west of UTC and the ±15-day window could
    // settle on the wrong month for cycle periods whose anniversary sat near a
    // report boundary.
    const d = parseLocalDate(series[i].period_start);
    if (isNaN(d)) continue;
    const diff = Math.abs(d - anniversary);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return best !== null && bestDiff <= tolMs ? best : null;
}

export function yoyDelta(series, idx, key, platform, lowerBetter) {
  const cur = getValue(series[idx], key, platform);
  const best = nearestPeriod(series, idx, 1);
  // With no prior-year report, return the current value with no baseline so the
  // card can say so — previously it fell back to the previous month and showed
  // MoM numbers under a "last year" label.
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

