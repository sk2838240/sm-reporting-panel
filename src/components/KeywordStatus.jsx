import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, Columns, Plus, X, ArrowRight, Trash2 } from 'lucide-react';
import { get } from '../lib/api';
import { useToast } from './ui';


/*
 * KeywordStatusTracker — used in the ReportEditor (ORM only).
 * Two side-by-side tables:
 *   Left = previous month (selectable via dropdown, read-only)
 *   Right = current report month (editable by admin+team)
 * Keywords auto-pulled from the SEO keyword_rankings list for the same client.
 * Each cell (Page 1/2/3) holds multiple free-text line items.
 * Stored in report.lists.keyword_status as [{ keyword, page1: [lines], page2: [lines], page3: [lines] }].
 */
export function KeywordStatusTracker({ report, keywordStatus, onChange, accent, canEdit }) {
  const { push } = useToast();
  const [ormReports, setOrmReports] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [showAddKw, setShowAddKw] = useState(false);
  const [newKw, setNewKw] = useState('');

  // SEO supplies the keyword universe; ORM supplies the month-by-month status
  // history. Both are fetched together — this used to run as two separate
  // effects, issuing the ORM request twice.
  useEffect(() => {
    (async () => {
      try {
        const [seoRaw, ormRaw] = await Promise.all([
          get(`/api/reports?clientId=${report.client_id}&service=seo`),
          get(`/api/reports?clientId=${report.client_id}&service=orm`),
        ]);
        const byPeriod = (a, b) => new Date(a.period_start) - new Date(b.period_start);
        const seoSorted = [...(seoRaw || [])].sort(byPeriod);
        const ormSorted = [...(ormRaw || [])].sort(byPeriod);
        setOrmReports(ormSorted);

        // Extract keyword universe from SEO keyword_rankings (single source of truth)
        const kwSet = new Set();
        for (const r of seoSorted) {
          for (const kr of (r.lists?.keyword_rankings || [])) {
            if (kr.keyword) kwSet.add(kr.keyword);
          }
        }
        // Also include any keywords already in the current keyword_status state
        for (const ks of keywordStatus) {
          if (ks.keyword) kwSet.add(ks.keyword);
        }
        const kwList = [...kwSet];
        setKeywords(kwList);

        // Ensure keyword_status has entries for all keywords
        const existingKws = keywordStatus.map(ks => ks.keyword);
        const missing = kwList.filter(kw => !existingKws.includes(kw));
        if (missing.length) {
          onChange([
            ...keywordStatus,
            ...missing.map(kw => ({ keyword: kw, page1: [], page2: [], page3: [] })),
          ]);
        }

        // Default left-side to the most recent month before current
        const prevReports = ormSorted.filter(r => r.id !== report.id);
        if (prevReports.length) {
          setSelectedPeriod(prevReports[prevReports.length - 1].period_start);
        }
      } catch {
        // Fallback: if no SEO reports exist, ORM keyword_status history alone
        // is still usable.
      }
      setLoaded(true);
    })();
    // Deliberately mount-scoped: this reads keywordStatus/onChange as the
    // mount-time snapshot. Re-running on every parent update would clobber
    // edits the admin has typed into the tracker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.client_id, report.id]);

  // Find left-side report's keyword_status data
  const leftReport = ormReports.find(r => String(r.period_start) === String(selectedPeriod));
  const leftStatus = leftReport?.lists?.keyword_status || [];

  // Get cell content for a keyword on a page from a status array
  const getCell = (statusArr, kw, page) => {
    const entry = statusArr.find(s => s.keyword === kw);
    if (!entry) return [];
    return entry[page] || [];
  };

  // Update a cell in the current report's keyword_status
  const updateCell = (kw, page, lines) => {
    const existing = keywordStatus.find(s => s.keyword === kw);
    if (existing) {
      onChange(keywordStatus.map(s => s.keyword === kw ? { ...s, [page]: lines } : s));
    } else {
      onChange([...keywordStatus, { keyword: kw, [page]: lines, page1: page === 'page1' ? lines : [], page2: page === 'page2' ? lines : [], page3: page === 'page3' ? lines : [] }]);
    }
  };

  // Add a line to a cell
  const addLine = (kw, page) => {
    const lines = getCell(keywordStatus, kw, page);
    updateCell(kw, page, [...lines, '']);
  };

  // Update a specific line in a cell
  const setLine = (kw, page, idx, value) => {
    const lines = getCell(keywordStatus, kw, page);
    const newLines = lines.map((l, i) => i === idx ? value : l);
    updateCell(kw, page, newLines);
  };

  // Remove a line from a cell
  const removeLine = (kw, page, idx) => {
    const lines = getCell(keywordStatus, kw, page);
    updateCell(kw, page, lines.filter((_, i) => i !== idx));
  };

  // Copy all cells from the selected left-side month to the current month
  const copyFromLeft = () => {
    if (!leftStatus.length) { push('No data to copy from selected month', 'error'); return; }

    // Merge rather than replace: keywords added in the current month are kept,
    // and their cells are overwritten only when the source month has that
    // keyword. Source-only keywords are appended.
    const leftByKw = new Map(leftStatus.map(s => [s.keyword, s]));
    const copyCells = (s) => ({ page1: [...(s.page1 || [])], page2: [...(s.page2 || [])], page3: [...(s.page3 || [])] });

    const merged = keywordStatus.map(s => {
      const src = leftByKw.get(s.keyword);
      return src ? { ...s, ...copyCells(src) } : { ...s };
    });
    const have = new Set(merged.map(s => s.keyword));
    for (const s of leftStatus) {
      if (!have.has(s.keyword)) { merged.push({ keyword: s.keyword, ...copyCells(s) }); have.add(s.keyword); }
    }

    onChange(merged);
    push(`Copied keyword status from ${leftReport?.period_label || 'selected month'}`, 'success');
  };

  // Admin-only: add a new keyword directly in the status tracker
  const addKeywordDirect = () => {
    const kw = newKw.trim();
    if (!kw) return;
    if (keywords.includes(kw)) { push('Keyword already exists', 'error'); return; }
    setKeywords([...keywords, kw]);
    onChange([...keywordStatus, { keyword: kw, page1: [], page2: [], page3: [] }]);
    setNewKw('');
    setShowAddKw(false);
    push('Keyword added', 'success');
  };

  // Admin-only: delete a keyword from the status tracker
  const deleteKeywordDirect = (kw) => {
    setKeywords(keywords.filter(k => k !== kw));
    onChange(keywordStatus.filter(s => s.keyword !== kw));
    push('Keyword removed', 'success');
  };

  if (!loaded) return <div className='py-8 text-center text-sm text-slate-400 dark:text-slate-500'>Loading keyword status data...</div>;

  const PAGES = [
    { key: 'page1', label: 'Page 1' },
    { key: 'page2', label: 'Page 2' },
    { key: 'page3', label: 'Page 3' },
  ];

  const prevOptions = ormReports.filter(r => r.id !== report.id).sort((a, b) => new Date(b.period_start) - new Date(a.period_start));

  return (
    <div>
      {/* Copy bar */}
      {canEdit && prevOptions.length > 0 && (
        <div className='flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700'>
          <button onClick={copyFromLeft} className='inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition' style={{ backgroundColor: accent }}>
            <ArrowRight className='w-3.5 h-3.5' /> Copy left table → current month
          </button>
          <span className='text-xs text-slate-400 ml-auto hidden sm:block'>Copies all cells from the selected month. Then edit only what changed.</span>
        </div>
      )}

      {/* Side-by-side tables */}
      <div className='grid lg:grid-cols-2 gap-4'>
        {/* LEFT TABLE — previous month (read-only) */}
        <div className='rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden'>
          {/* Month selector */}
          <div className='flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700'>
            <span className='text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap'>Compare:</span>
            <div className='relative flex-1'>
              <select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}
                className='appearance-none w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 pl-3 pr-8 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40'>
                <option value=''>— Select month —</option>
                {prevOptions.map(r => <option key={r.id} value={r.period_start}>{r.period_label}</option>)}
              </select>
              <ChevronDown className='pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
            </div>
          </div>
          {/* Left table */}
          <div className='overflow-x-auto max-h-[500px] overflow-y-auto'>
            <table className='w-full text-xs border-collapse'>
              <thead className='sticky top-0'>
                <tr className='bg-slate-50 dark:bg-slate-900/50'>
                  <th className='px-2 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 text-xs border-b border-slate-200 dark:border-slate-700 min-w-[120px]'>Keyword</th>
                  {PAGES.map(p => <th key={p.key} className='px-2 py-2 text-center font-semibold text-slate-500 dark:text-slate-400 text-xs border-b border-slate-200 dark:border-slate-700 min-w-[120px]'>{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {keywords.length === 0 ? (
                  <tr><td colSpan={4} className='text-center py-6 text-slate-400 dark:text-slate-500'>No keywords found in SEO reports.</td></tr>
                ) : keywords.map(kw => (
                  <tr key={kw} className='border-b border-slate-50 dark:border-slate-700/50'>
                    <td className='px-2 py-2 font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap'>{kw}</td>
                    {PAGES.map(p => {
                      const lines = getCell(leftStatus, kw, p.key);
                      return (
                        <td key={p.key} className='px-2 py-2 text-slate-500 dark:text-slate-400 border-l border-slate-50 dark:border-slate-700/50'>
                          {lines.length === 0 ? <span className='text-slate-300 dark:text-slate-600'>—</span> : (
                            <div className='space-y-0.5'>
                              {lines.map((line, i) => <div key={i} className='whitespace-nowrap'>{line || <span className='text-slate-300'>—</span>}</div>)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT TABLE — current month (editable) */}
        <div className='rounded-xl border-2 overflow-hidden' style={{ borderColor: accent }}>
          <div className='flex items-center gap-2 px-3 py-2 border-b' style={{ backgroundColor: accent + '10', borderColor: accent }}>
            <span className='text-xs font-bold whitespace-nowrap' style={{ color: accent }}>◆ Current: {report.period_label}</span>
            {canEdit && (
              <div className='ml-auto flex items-center gap-2'>
                {showAddKw ? (
                  <>
                    <input type='text' autoFocus value={newKw} onChange={(e) => setNewKw(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addKeywordDirect(); if (e.key === 'Escape') { setShowAddKw(false); setNewKw(''); } }}
                      placeholder='Enter keyword...' className='rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 w-40' />
                    <button onClick={addKeywordDirect} className='inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-white' style={{ backgroundColor: accent }}><Plus className='w-3 h-3' /> Add</button>
                    <button onClick={() => { setShowAddKw(false); setNewKw(''); }} className='p-1 text-slate-400 hover:text-slate-600'><X className='w-3.5 h-3.5' /></button>
                  </>
                ) : (
                  <button onClick={() => setShowAddKw(true)} className='inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400'><Plus className='w-3.5 h-3.5' /> Add keyword</button>
                )}
              </div>
            )}
          </div>
          <div className='overflow-x-auto max-h-[500px] overflow-y-auto'>
            <table className='w-full text-xs border-collapse'>
              <thead className='sticky top-0'>
                <tr className='bg-slate-50 dark:bg-slate-900/50'>
                  <th className='px-2 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 text-xs border-b border-slate-200 dark:border-slate-700 min-w-[120px]'>Keyword</th>
                  {PAGES.map(p => <th key={p.key} className='px-2 py-2 text-center font-semibold text-slate-500 dark:text-slate-400 text-xs border-b border-slate-200 dark:border-slate-700 min-w-[120px]'>{p.label}</th>)}
                  {canEdit && <th className='px-1 py-2 border-b border-slate-200 dark:border-slate-700 w-8'></th>}
                </tr>
              </thead>
              <tbody>
                {keywords.length === 0 ? (
                  <tr><td colSpan={canEdit ? 5 : 4} className='text-center py-6 text-slate-400 dark:text-slate-500'>No keywords yet. Click "Add keyword" to start tracking.</td></tr>
                ) : keywords.map(kw => (
                  <tr key={kw} className='border-b border-slate-50 dark:border-slate-700/50'>
                    <td className='px-2 py-2 font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap'>{kw}</td>
                    {PAGES.map(p => {
                      const lines = getCell(keywordStatus, kw, p.key);
                      return (
                        <td key={p.key} className='px-2 py-2 border-l border-slate-50 dark:border-slate-700/50'>
                          {canEdit ? (
                            <div className='space-y-1'>
                              {lines.map((line, i) => (
                                <div key={i} className='flex items-center gap-1'>
                                  <input
                                    type='text'
                                    value={line}
                                    onChange={(e) => setLine(kw, p.key, i, e.target.value)}
                                    placeholder='e.g. Assets: 4, 5'
                                    className='w-full min-w-[100px] rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-xs text-slate-700 dark:text-slate-200 placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/40'
                                  />
                                  <button onClick={() => removeLine(kw, p.key, i)} className='text-slate-300 hover:text-rose-500 shrink-0'>
                                    <X className='w-3 h-3' />
                                  </button>
                                </div>
                              ))}
                              <button onClick={() => addLine(kw, p.key)} className='inline-flex items-center gap-0.5 text-xs font-semibold text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'>
                                <Plus className='w-3 h-3' /> Add line
                              </button>
                            </div>
                          ) : (
                            lines.length === 0 ? <span className='text-slate-300 dark:text-slate-600'>—</span> : (
                              <div className='space-y-0.5'>
                                {lines.map((line, i) => <div key={i} className='whitespace-nowrap'>{line || '—'}</div>)}
                              </div>
                            )
                          )}
                        </td>
                      );
                    })}
                    {canEdit && (
                      <td className='px-1 py-2 text-center'>
                        <button onClick={() => deleteKeywordDirect(kw)} className='p-1 rounded text-slate-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20' title={`Delete "${kw}"`}>
                          <Trash2 className='w-3 h-3' />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {keywords.length === 0 && (
        <p className='mt-3 text-xs text-slate-400 dark:text-slate-500'>
          No keywords yet. {canEdit ? 'Click "Add keyword" in the current month table to start tracking.' : 'Ask your agency to add keywords.'}
        </p>
      )}
    </div>
  );
}


/*
 * KeywordStatusView — used in the ClientDashboard (ORM only, read-only).
 * Same two-table layout but fully read-only with the left-side month selector.
 */
export function KeywordStatusView({ series, accent }) {
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [seoKeywords, setSeoKeywords] = useState([]);

  // Fetch SEO keywords for the same client (single source of truth)
  const clientId = series[0]?.client_id;
  useEffect(() => {
    if (!clientId) return;
    (async () => {
      try {
        const seoReports = await get(`/api/reports?clientId=${clientId}&service=seo`);
        const kwSet = new Set();
        for (const r of (seoReports || [])) {
          for (const kr of (r.lists?.keyword_rankings || [])) if (kr.keyword) kwSet.add(kr.keyword);
        }
        // Also include keywords from ORM keyword_status data
        for (const r of series) {
          for (const ks of (r.lists?.keyword_status || [])) if (ks.keyword) kwSet.add(ks.keyword);
        }
        setSeoKeywords([...kwSet]);
      } catch {}
    })();
  }, [clientId, series]);

  // Sort ORM reports ascending. Memoised so the effects below can depend on it
  // without re-running on every render (sorting returns a new array each time).
  const periods = useMemo(
    () => [...series].sort((a, b) => new Date(a.period_start) - new Date(b.period_start)),
    [series]
  );
  const latest = periods[periods.length - 1];

  // Default left-side to the month before latest
  useEffect(() => {
    if (periods.length > 1 && !selectedPeriod) {
      setSelectedPeriod(periods[periods.length - 2].period_start);
    }
  }, [periods, selectedPeriod]);

  if (!periods.length) return null;

  const prevOptions = periods.filter(r => r.id !== latest?.id).sort((a, b) => new Date(b.period_start) - new Date(a.period_start));
  const leftReport = periods.find(r => String(r.period_start) === String(selectedPeriod));
  const leftStatus = leftReport?.lists?.keyword_status || [];
  const rightStatus = latest?.lists?.keyword_status || [];

  const PAGES = [
    { key: 'page1', label: 'Page 1' },
    { key: 'page2', label: 'Page 2' },
    { key: 'page3', label: 'Page 3' },
  ];

  const getCell = (statusArr, kw, page) => {
    const entry = statusArr.find(s => s.keyword === kw);
    if (!entry) return [];
    return entry[page] || [];
  };

  return (
    <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 mb-6'>
      <h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2'>
        <Columns className='w-4 h-4' style={{ color: accent }} /> Keyword Status Tracker
      </h3>
      <p className='text-xs text-slate-500 dark:text-slate-400 mb-4'>Keyword positions across search result pages. Compare any past month against the current month.</p>

      <div className='grid lg:grid-cols-2 gap-4'>
        {/* LEFT TABLE — selectable past month (read-only) */}
        <div className='rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden'>
          <div className='flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700'>
            <span className='text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap'>Compare:</span>
            <div className='relative flex-1'>
              <select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}
                className='appearance-none w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 pl-3 pr-8 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40'>
                <option value=''>— Select month —</option>
                {prevOptions.map(r => <option key={r.id} value={r.period_start}>{r.period_label}</option>)}
              </select>
              <ChevronDown className='pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
            </div>
          </div>
          <div className='overflow-x-auto max-h-[400px] overflow-y-auto'>
            <table className='w-full text-xs border-collapse'>
              <thead className='sticky top-0'>
                <tr className='bg-slate-50 dark:bg-slate-900/50'>
                  <th className='px-2 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 text-xs border-b border-slate-200 dark:border-slate-700 min-w-[120px]'>Keyword</th>
                  {PAGES.map(p => <th key={p.key} className='px-2 py-2 text-center font-semibold text-slate-500 dark:text-slate-400 text-xs border-b border-slate-200 dark:border-slate-700 min-w-[120px]'>{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {seoKeywords.map(kw => (
                  <tr key={kw} className='border-b border-slate-50 dark:border-slate-700/50'>
                    <td className='px-2 py-2 font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap'>{kw}</td>
                    {PAGES.map(p => {
                      const lines = getCell(leftStatus, kw, p.key);
                      return (
                        <td key={p.key} className='px-2 py-2 text-slate-500 dark:text-slate-400 border-l border-slate-50 dark:border-slate-700/50'>
                          {lines.length === 0 ? <span className='text-slate-300 dark:text-slate-600'>—</span> : (
                            <div className='space-y-0.5'>
                              {lines.map((line, i) => <div key={i} className='whitespace-nowrap'>{line || '—'}</div>)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT TABLE — current month (read-only) */}
        <div className='rounded-xl border-2 overflow-hidden' style={{ borderColor: accent }}>
          <div className='flex items-center px-3 py-2 border-b' style={{ backgroundColor: accent + '10', borderColor: accent }}>
            <span className='text-xs font-bold whitespace-nowrap' style={{ color: accent }}>◆ {latest?.period_label || 'Current'}</span>
          </div>
          <div className='overflow-x-auto max-h-[400px] overflow-y-auto'>
            <table className='w-full text-xs border-collapse'>
              <thead className='sticky top-0'>
                <tr className='bg-slate-50 dark:bg-slate-900/50'>
                  <th className='px-2 py-2 text-left font-semibold text-slate-500 dark:text-slate-400 text-xs border-b border-slate-200 dark:border-slate-700 min-w-[120px]'>Keyword</th>
                  {PAGES.map(p => <th key={p.key} className='px-2 py-2 text-center font-semibold text-slate-500 dark:text-slate-400 text-xs border-b border-slate-200 dark:border-slate-700 min-w-[120px]'>{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {seoKeywords.map(kw => (
                  <tr key={kw} className='border-b border-slate-50 dark:border-slate-700/50'>
                    <td className='px-2 py-2 font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap'>{kw}</td>
                    {PAGES.map(p => {
                      const lines = getCell(rightStatus, kw, p.key);
                      return (
                        <td key={p.key} className='px-2 py-2 text-slate-500 dark:text-slate-400 border-l border-slate-50 dark:border-slate-700/50'>
                          {lines.length === 0 ? <span className='text-slate-300 dark:text-slate-600'>—</span> : (
                            <div className='space-y-0.5'>
                              {lines.map((line, i) => <div key={i} className='whitespace-nowrap'>{line || '—'}</div>)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
