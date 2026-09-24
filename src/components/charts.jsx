import { useState, useRef } from 'react';
import { fmtRaw } from '../lib/format';

/* TrendChart: responsive SVG line chart with optional trailing-average, target
   overlays, and annotation markers pinned to specific periods.
   data: [{ label, value }] (value may be null for gaps)
   trailing: number[] aligned with data (rolling avg), optional
   target: number, optional (horizontal dashed line)
   annotations: [{ label, note }] aligned with data indices, optional */
export function TrendChart({ data, color = '#6366f1', target = null, trailing = null, annotations = null, height = 240, valueFmt = fmtRaw }) {
  const [hover, setHover] = useState(null);
  const [hoverAnn, setHoverAnn] = useState(null);
  const wrapRef = useRef(null);

  if (!data || data.length === 0) {
    return <div className='flex items-center justify-center text-sm text-slate-400 dark:text-slate-500' style={{ height }}>No trend data yet.</div>;
  }

  const W = 640, H = height;
  const pad = { l: 46, r: 16, t: 18, b: 30 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const vals = data.map(d => d.value).filter(v => v !== null && v !== undefined);
  if (trailing) trailing.forEach(v => { if (v !== null && v !== undefined) vals.push(v); });
  if (target !== null && target !== undefined) vals.push(target);
  if (!vals.length) return <div className='flex items-center justify-center text-sm text-slate-400 dark:text-slate-500' style={{ height }}>No numeric data yet.</div>;

  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) { min = min - 1; max = max + 1; }
  const range = max - min;
  min -= range * 0.08;
  max += range * 0.08;

  const xFor = (i) => data.length === 1 ? pad.l + innerW / 2 : pad.l + (i / (data.length - 1)) * innerW;
  const yFor = (v) => pad.t + innerH - ((v - min) / (max - min)) * innerH;

  const segments = [];
  let cur = [];
  data.forEach((d, i) => {
    if (d.value === null || d.value === undefined) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else {
      cur.push({ x: xFor(i), y: yFor(d.value), i, v: d.value });
    }
  });
  if (cur.length) segments.push(cur);
  const linePath = segments.map(seg => 'M ' + seg.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')).join(' ');
  const areaPath = segments.map(seg => {
    const top = seg.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
    return `M ${seg[0].x.toFixed(1)} ${(pad.t + innerH).toFixed(1)} L ${top} L ${seg[seg.length - 1].x.toFixed(1)} ${(pad.t + innerH).toFixed(1)} Z`;
  }).join(' ');

  const gridLines = 4;
  const yTicks = Array.from({ length: gridLines + 1 }, (_, i) => min + (i / gridLines) * (max - min));
  const labelStep = data.length > 8 ? Math.ceil(data.length / 7) : 1;

  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const xRel = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bestDiff = Infinity;
    data.forEach((_, i) => { const d = Math.abs(xFor(i) - xRel); if (d < bestDiff) { bestDiff = d; best = i; } });
    setHover(best);
  };

  const gid = 'grad-' + color.replace('#', '');
  // Annotation markers: map period_start -> note
  const annMap = {};
  if (annotations) annotations.forEach(a => { annMap[a.period_start] = a.note; });

  return (
    <div className='relative w-full' ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => { setHover(null); setHoverAnn(null); }}>
      <svg viewBox={`0 0 ${W} ${H}`} className='w-full' style={{ height }} preserveAspectRatio='none' role='img'>
        <defs>
          <linearGradient id={gid} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={color} stopOpacity='0.22' />
            <stop offset='100%' stopColor={color} stopOpacity='0' />
          </linearGradient>
        </defs>

        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} y1={yFor(t)} x2={W - pad.r} y2={yFor(t)} stroke='#f1f5f9' strokeWidth='1' className='dark:stroke-slate-700' />
            <text x={pad.l - 8} y={yFor(t) + 3} textAnchor='end' fontSize='10' fill='#94a3b8' className='dark:fill-slate-500'>{fmtRaw(t)}</text>
          </g>
        ))}

        {target !== null && target !== undefined && (
          <g>
            <line x1={pad.l} y1={yFor(target)} x2={W - pad.r} y2={yFor(target)} stroke='#f43f5e' strokeWidth='1.5' strokeDasharray='5 4' opacity='0.8' />
            <text x={W - pad.r - 4} y={yFor(target) - 5} textAnchor='end' fontSize='9' fill='#f43f5e' fontWeight='700'>TARGET {valueFmt(target)}</text>
          </g>
        )}

        {areaPath && <path d={areaPath} fill={`url(#${gid})`} />}
        {trailing && segments.length > 0 && (
          <polyline fill='none' stroke={color} strokeOpacity='0.5' strokeWidth='1.5' strokeDasharray='4 3'
            points={data.map((d, i) => { const tv = trailing[i]; if (tv === null || tv === undefined) return null; return `${xFor(i).toFixed(1)},${yFor(tv).toFixed(1)}`; }).filter(Boolean).join(' ')} />
        )}
        {linePath && <path d={linePath} fill='none' stroke={color} strokeWidth='2.5' strokeLinejoin='round' strokeLinecap='round' />}

        {/* Annotation markers: small flag icons at the top of the chart */}
        {data.map((d, i) => {
          if (!annMap[d.periodStart]) return null;
          const x = xFor(i);
          return (
            <g key={'ann' + i} onMouseEnter={() => setHoverAnn(i)} onMouseLeave={() => setHoverAnn(null)} style={{ cursor: 'pointer' }}>
              <line x1={x} y1={pad.t} x2={x} y2={pad.t + innerH} stroke='#f59e0b' strokeWidth='1' strokeDasharray='2 3' opacity='0.4' />
              <circle cx={x} cy={pad.t + 2} r='5' fill='#f59e0b' stroke='#fff' strokeWidth='1.5' />
              <text x={x} y={pad.t + 5} textAnchor='middle' fontSize='7' fill='#fff' fontWeight='700'>!</text>
            </g>
          );
        })}

        {data.map((d, i) => d.value === null || d.value === undefined ? null : (
          <circle key={i} cx={xFor(i)} cy={yFor(d.value)} r={hover === i ? 4.5 : 3} fill='#fff' stroke={color} strokeWidth='2' className='dark:fill-slate-800' />
        ))}

        {data.map((d, i) => i % labelStep === 0 ? (
          <text key={'l' + i} x={xFor(i)} y={H - 8} textAnchor='middle' fontSize='10' fill='#94a3b8' className='dark:fill-slate-500'>{d.shortLabel || d.label}</text>
        ) : null)}

        {hover !== null && data[hover] && data[hover].value !== null && data[hover].value !== undefined && (
          <line x1={xFor(hover)} y1={pad.t} x2={xFor(hover)} y2={pad.t + innerH} stroke={color} strokeWidth='1' strokeDasharray='3 3' opacity='0.4' />
        )}
      </svg>

      {/* Hover tooltip for data point */}
      {hover !== null && data[hover] && (
        <div className='pointer-events-none absolute -translate-x-1/2 rounded-lg bg-slate-900 text-white text-xs px-2.5 py-1.5 shadow-lg whitespace-nowrap z-10'
          style={{ left: `${(xFor(hover) / W) * 100}%`, top: 6 }}>
          <div className='font-semibold'>{data[hover].label}</div>
          <div>{valueFmt(data[hover].value)}{trailing && trailing[hover] !== null && trailing[hover] !== undefined ? `  ·  avg ${valueFmt(trailing[hover])}` : ''}</div>
        </div>
      )}

      {/* Annotation tooltip */}
      {hoverAnn !== null && data[hoverAnn] && annMap[data[hoverAnn].periodStart] && (
        <div className='pointer-events-none absolute -translate-x-1/2 rounded-lg bg-amber-500 text-white text-xs px-2.5 py-1.5 shadow-lg z-10 max-w-[200px]'
          style={{ left: `${(xFor(hoverAnn) / W) * 100}%`, top: 16 }}>
          <div className='font-semibold flex items-center gap-1'>📝 {data[hoverAnn].label}</div>
          <div className='mt-0.5'>{annMap[data[hoverAnn].periodStart]}</div>
        </div>
      )}
    </div>
  );
}

/* ComparisonBars: this-period vs last-period bars for a metric card. */
export function ComparisonBars({ current, previous, color = '#6366f1', height = 56 }) {
  const cur = current === null || current === undefined ? null : Number(current);
  const prev = previous === null || previous === undefined ? null : Number(previous);
  const max = Math.max(Math.abs(cur ?? 0), Math.abs(prev ?? 0), 1);
  const bars = [
    { label: 'Last', v: prev, dim: true },
    { label: 'This', v: cur, dim: false },
  ];
  return (
    <div className='flex items-end gap-3' style={{ height }}>
      {bars.map((b) => (
        <div key={b.label} className='flex-1 flex flex-col items-center gap-1'>
          <div className='w-full flex items-end justify-center' style={{ height: height - 18 }}>
            <div className='rounded-t-md w-7 transition-all' style={{ height: `${b.v === null ? 0 : (Math.abs(b.v) / max) * 100}%`, minHeight: b.v === null ? 0 : 4, backgroundColor: b.dim ? color + '55' : color }} />
          </div>
          <span className='text-[10px] font-semibold text-slate-400 dark:text-slate-500'>{b.label}</span>
        </div>
      ))}
    </div>
  );
}

/* MiniBars for breakdown category comparison (optional). */
export function MiniBar({ value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return <div className='h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden'><div className='h-full rounded-full' style={{ width: `${pct}%`, backgroundColor: color }} /></div>;
}
