const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function fmtNum(v, format) {
  if (v === '' || v === null || v === undefined || isNaN(Number(v))) return '—';
  const n = Number(v);
  if (format === 'num1') return n.toFixed(1);
  if (format === 'int') return Math.round(n).toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function fmtRaw(v) {
  if (v === '' || v === null || v === undefined || isNaN(Number(v))) return '—';
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function fmtPct(v, withSign = true) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const sign = withSign && v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}


export function monthLabel(year, month) {
  return `${MONTHS[month - 1]} ${year}`;
}

export function monthBounds(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function shortPeriod(label) {
  if (!label) return '';
  const m = String(label).match(/^(\w+) (\d{4})$/);
  if (m) return `${m[1].slice(0, 3)} '${m[2].slice(2)}`;
  return String(label).length > 12 ? String(label).slice(0, 12) + '…' : label;
}

// A date-only string is parsed as UTC per the ES spec, so in any timezone at
// UTC-1 or west "2025-03-05" renders as Mar 4. Every date the agency enters
// comes back from a <input type="date"> in exactly that form, so anchor it to
// local midnight instead. Full ISO timestamps (with a time part) are left alone.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parseLocalDate(value) {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return new Date(NaN);
  return new Date(DATE_ONLY.test(value) ? `${value}T00:00:00` : value);
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = parseLocalDate(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}
