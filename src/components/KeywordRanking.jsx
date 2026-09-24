import { useState, useEffect } from 'react';
import { Plus, Trash2, Copy, ChevronDown, TrendingDown, TrendingUp, Minus, X } from 'lucide-react';
import { get } from '../lib/api';
import { useToast } from './ui';
import { shortPeriod } from '../lib/format';

/*
 * KeywordRankingEditor — used in the ReportEditor (SEO only).
 * Shows a matrix: keywords (rows) × all periods (columns).
 * The current report's period column is editable; others are read-only.
 * Supports: add/delete keywords, copy from a previous month.
 */
export function KeywordRankingEditor({ report, keywordRankings, onChange, accent, canEdit }) {
  const { push } = useToast();
  const [allReports, setAllReports] = useState([]);
  const [copySource, setCopySource] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [showAddInput, setShowAddInput] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const reports = await get(`/api/reports?clientId=${report.client_id}&service=${report.service}`);
        const sorted = [...(reports || [])].sort((a, b) => new Date(a.period_start) - new Date(b.period_start));
        setAllReports(sorted);
      } catch {}
      setLoaded(true);
    })();
  }, [report.client_id, report.service]);

  // Build the keyword universe: union of all keywords across all reports + current state
  const keywordSet = new Set();
  for (const r of allReports) {
    for (const kr of (r.lists?.keyword_rankings || [])) if (kr.keyword) keywordSet.add(kr.keyword);
  }
  for (const kr of keywordRankings) if (kr.keyword) keywordSet.add(kr.keyword);
  const keywords = [...keywordSet];

  // Build periods: all reports with current report using state data
  const periods = allReports.map(r =>
    r.id === report.id
      ? { ...r, lists: { ...(r.lists || {}), keyword_rankings: keywordRankings } }
      : r
  ).sort((a, b) => new Date(a.period_start) - new Date(b.period_start));

  const getPosition = (kw, period) => {
    const list = period.lists?.keyword_rankings || [];
    const found = list.find(k => k.keyword === kw);
    return found ? found.position : null;
  };

  const updatePosition = (kw, value) => {
    const existing = keywordRankings.find(k => k.keyword === kw);
    if (existing) {
      onChange(keywordRankings.map(k => k.keyword === kw ? { ...k, position: value } : k));
    } else {
      onChange([...keywordRankings, { keyword: kw, position: value }]);
    }
  };

  const submitNewKeyword = () => {
    const kw = newKeyword.trim();
    if (!kw) return;
    if (keywords.includes(kw)) { push('Keyword already exists', 'error'); return; }
    onChange([...keywordRankings, { keyword: kw, position: '' }]);
    setNewKeyword('');
    setShowAddInput(false);
    push('Keyword added', 'success');
  };

  const deleteKeyword = (kw) => {
    onChange(keywordRankings.filter(k => k.keyword !== kw));
    push('Keyword removed', 'success');
  };

  const doCopy = () => {
    if (!copySource) { push('Select a month to copy from', 'error'); return; }
    const source = allReports.find(r => String(r.period_start) === String(copySource));
    if (!source) { push('Could not find source month', 'error'); return; }
    const sourceRankings = source.lists?.keyword_rankings || [];

    // Merge rather than replace: keywords already tracked this month keep their
    // row (and take the source position when the source has one), and source
    // keywords we don't have yet are appended.
    const sourceByKw = new Map(sourceRankings.map(k => [k.keyword, k.position ?? '']));
    const merged = keywordRankings.map(k => (
      sourceByKw.has(k.keyword) ? { ...k, position: sourceByKw.get(k.keyword) } : { ...k }
    ));
    const have = new Set(merged.map(k => k.keyword));
    for (const k of sourceRankings) {
      if (!have.has(k.keyword)) { merged.push({ keyword: k.keyword, position: k.position || '' }); have.add(k.keyword); }
    }

    onChange(merged);
    push(`Copied rankings from ${source.period_label}`, 'success');
  };

  // Periods available for copy (all except current)
  const copyOptions = allReports
    .filter(r => r.id !== report.id)
    .sort((a, b) => new Date(b.period_start) - new Date(a.period_start));

  if (!loaded) return <div className='py-8 text-center text-sm text-slate-400 dark:text-slate-500'>Loading keyword data...</div>;

  return (
    <div>
      {/* Copy from previous month bar */}
      {canEdit && copyOptions.length > 0 && (
        <div className='flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700'>
          <span className='text-xs font-semibold text-slate-500 dark:text-slate-400'>Copy rankings from:</span>
          <div className='relative'>
            <select value={copySource} onChange={(e) => setCopySource(e.target.value)}
              className='appearance-none rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 pl-3 pr-8 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40'>
              <option value=''>Select month...</option>
              {copyOptions.map(r => <option key={r.id} value={r.period_start}>{r.period_label}</option>)}
            </select>
            <ChevronDown className='pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
          </div>
          <button onClick={doCopy} disabled={!copySource}
            className='inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition' style={{ backgroundColor: accent }}>
            <Copy className='w-3.5 h-3.5' /> Copy to current month
          </button>
          <span className='text-xs text-slate-400 ml-auto hidden sm:block'>Then just update the keywords that changed.</span>
        </div>
      )}

      {/* Keyword ranking matrix */}
      <div className='overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700'>
        <table className='w-full text-sm border-collapse'>
          <thead>
            <tr className='bg-slate-50 dark:bg-slate-900/50'>
              <th className='sticky left-0 z-10 bg-slate-50 dark:bg-slate-900/50 px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap border-b border-slate-200 dark:border-slate-700'>
                Keyword
              </th>
              {periods.map(p => {
                const isCurrent = p.id === report.id;
                return (
                  <th key={p.id} className={`px-3 py-2 text-center font-semibold text-xs whitespace-nowrap border-b border-slate-200 dark:border-slate-700 ${isCurrent ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`} style={isCurrent ? { backgroundColor: accent } : undefined}>
                    {isCurrent ? '◆ ' : ''}{shortPeriod(p.period_label)}
                  </th>
                );
              })}
              {canEdit && <th className='px-2 py-2 border-b border-slate-200 dark:border-slate-700 w-10'></th>}
            </tr>
          </thead>
          <tbody>
            {keywords.length === 0 ? (
              <tr>
                <td colSpan={periods.length + (canEdit ? 2 : 1)} className='text-center py-8 text-sm text-slate-400 dark:text-slate-500'>
                  No keywords yet. Click "Add keyword" to start tracking rankings.
                </td>
              </tr>
            ) : (
              keywords.map(kw => (
                <tr key={kw} className='hover:bg-slate-50/50 dark:hover:bg-slate-700/30'>
                  <td className='sticky left-0 z-10 bg-white dark:bg-slate-800 px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap border-b border-slate-100 dark:border-slate-700'>
                    {kw}
                  </td>
                  {periods.map(p => {
                    const isCurrent = p.id === report.id;
                    const pos = getPosition(kw, p);
                    return (
                      <td key={p.id} className='px-2 py-2 text-center border-b border-slate-100 dark:border-slate-700'>
                        {isCurrent && canEdit ? (
                          <input
                            type='number'
                            value={pos ?? ''}
                            onChange={(e) => updatePosition(kw, e.target.value)}
                            placeholder='—'
                            className='w-16 text-center rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40'
                          />
                        ) : (
                          <span className={`inline-block min-w-[28px] ${pos === null || pos === '' || pos === undefined ? 'text-slate-300 dark:text-slate-600' : 'text-slate-600 dark:text-slate-400 font-medium'}`}>
                            {pos === null || pos === '' || pos === undefined ? '—' : pos}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {canEdit && (
                    <td className='px-1 py-2 text-center border-b border-slate-100 dark:border-slate-700'>
                      <button onClick={() => deleteKeyword(kw)} className='p-1 rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20' title={`Delete "${kw}"`}>
                        <Trash2 className='w-3.5 h-3.5' />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add keyword — inline input instead of prompt() which is blocked in iframes */}
      {canEdit && (
        showAddInput ? (
          <div className='mt-3 flex items-center gap-2'>
            <input
              type='text'
              autoFocus
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitNewKeyword(); if (e.key === 'Escape') { setShowAddInput(false); setNewKeyword(''); } }}
              placeholder='Enter keyword...'
              className='flex-1 max-w-xs rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40'
            />
            <button onClick={submitNewKeyword} className='inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition' style={{ backgroundColor: accent }}>
              <Plus className='w-4 h-4' /> Add
            </button>
            <button onClick={() => { setShowAddInput(false); setNewKeyword(''); }} className='p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'>
              <X className='w-4 h-4' />
            </button>
          </div>
        ) : (
          <button onClick={() => setShowAddInput(true)}
            className='mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition'>
            <Plus className='w-4 h-4' style={{ color: accent }} /> Add keyword
          </button>
        )
      )}

      {periods.length === 1 && (
        <p className='mt-3 text-xs text-slate-400 dark:text-slate-500'>
          This is the first report — additional month columns will appear automatically as new monthly reports are created.
        </p>
      )}
    </div>
  );
}


/*
 * KeywordRankingTable — used in the ClientDashboard (SEO only, read-only).
 * Shows keywords (rows) × months (columns) with color-coded positions
 * and month-over-month delta indicators.
 */
export function KeywordRankingTable({ series, accent }) {
  if (!series || series.length === 0) {
    return <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5'><p className='text-sm text-slate-400 text-center py-4'>No keyword ranking data yet.</p></div>;
  }

  // Build keyword universe from all reports
  const keywordSet = new Set();
  for (const r of series) {
    for (const kr of (r.lists?.keyword_rankings || [])) if (kr.keyword) keywordSet.add(kr.keyword);
  }
  const keywords = [...keywordSet];

  // Sort periods ascending
  const periods = [...series].sort((a, b) => new Date(a.period_start) - new Date(b.period_start));

  const getPosition = (kw, period) => {
    const list = period.lists?.keyword_rankings || [];
    const found = list.find(k => k.keyword === kw);
    return found ? found.position : null;
  };

  const num = (v) => {
    const n = Number(v);
    return (v === null || v === '' || v === undefined || isNaN(n)) ? null : n;
  };

  const posColor = (cur, prev) => {
    const c = num(cur), p = num(prev);
    if (c === null) return 'text-slate-300 dark:text-slate-600';
    if (p === null) return 'text-slate-600 dark:text-slate-400 font-semibold';
    if (c < p) return 'text-emerald-600 dark:text-emerald-400 font-semibold';
    if (c > p) return 'text-rose-500 dark:text-rose-400 font-semibold';
    return 'text-slate-600 dark:text-slate-400 font-medium';
  };

  const deltaIcon = (cur, prev) => {
    const c = num(cur), p = num(prev);
    if (c === null || p === null) return null;
    if (c < p) return <TrendingUp className='w-3 h-3 text-emerald-500' />;
    if (c > p) return <TrendingDown className='w-3 h-3 text-rose-500' />;
    return <Minus className='w-3 h-3 text-slate-300' />;
  };

  return (
    <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 mb-6'>
      <h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100 mb-1'>Keyword Ranking Tracker</h3>
      <p className='text-xs text-slate-500 dark:text-slate-400 mb-4'>Month-by-month ranking positions for tracked keywords. Lower is better.</p>
      <div className='overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-700'>
        <table className='w-full text-sm border-collapse'>
          <thead>
            <tr className='bg-slate-50 dark:bg-slate-900/50'>
              <th className='sticky left-0 z-10 bg-slate-50 dark:bg-slate-900/50 px-3 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap border-b border-slate-200 dark:border-slate-700'>Keyword</th>
              {periods.map((p, i) => (
                <th key={p.id} className={`px-3 py-2 text-center font-semibold text-xs whitespace-nowrap border-b border-slate-200 dark:border-slate-700 ${i === periods.length - 1 ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`} style={i === periods.length - 1 ? { backgroundColor: accent } : undefined}>
                  {i === periods.length - 1 ? '◆ ' : ''}{shortPeriod(p.period_label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keywords.length === 0 ? (
              <tr><td colSpan={periods.length + 1} className='text-center py-6 text-sm text-slate-400 dark:text-slate-500'>No keywords tracked yet.</td></tr>
            ) : (
              keywords.map(kw => (
                <tr key={kw} className='hover:bg-slate-50/50 dark:hover:bg-slate-700/30'>
                  <td className='sticky left-0 z-10 bg-white dark:bg-slate-800 px-3 py-2 font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap border-b border-slate-100 dark:border-slate-700'>
                    {kw}
                  </td>
                  {periods.map((p, i) => {
                    const pos = getPosition(kw, p);
                    const prevPos = i > 0 ? getPosition(kw, periods[i - 1]) : null;
                    return (
                      <td key={p.id} className='px-2 py-2 text-center border-b border-slate-100 dark:border-slate-700'>
                        <span className={`inline-flex items-center gap-1 ${posColor(pos, prevPos)}`}>
                          {deltaIcon(pos, prevPos)}
                          {pos === null || pos === '' || pos === undefined ? <span className='text-slate-300 dark:text-slate-600'>—</span> : `#${pos}`}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {/* Legend */}
      <div className='flex flex-wrap gap-4 mt-3 text-xs text-slate-400 dark:text-slate-500'>
        <span className='inline-flex items-center gap-1'><TrendingUp className='w-3 h-3 text-emerald-500' /> Improved</span>
        <span className='inline-flex items-center gap-1'><TrendingDown className='w-3 h-3 text-rose-500' /> Declined</span>
        <span className='inline-flex items-center gap-1'><Minus className='w-3 h-3 text-slate-300' /> No change</span>
        <span>— No data</span>
      </div>
    </div>
  );
}
