import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Download, TrendingUp, Target, CalendarRange, Activity, Sparkles, ChevronDown, Building2, Crosshair, CheckSquare, MessageSquarePlus } from 'lucide-react';
import { get } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { FullLoader, EmptyState, useToast, BackButton } from '../components/ui';
import { TrendChart, ComparisonBars } from '../components/charts';
import { KeywordRankingTable } from '../components/KeywordRanking';
import { KeywordStatusView } from '../components/KeywordStatus';
import { SERVICE_META, SERVICE_ORDER } from '../lib/constants';
import { fmtNum, fmtRaw, fmtPct, shortPeriod, formatDate } from '../lib/format';
import { getValue, momDelta, yoyDelta, trailingAvg, vsTarget, compare, rangeAggregate } from '../lib/comparisons';

const MODES = [
  { key: 'mom', label: 'MoM', icon: TrendingUp },
  { key: 'yoy', label: 'YoY', icon: Activity },
  { key: 'trailing3', label: '3-mo avg', icon: Activity },
  { key: 'trailing6', label: '6-mo avg', icon: Activity },
  { key: 'target', label: 'vs Target', icon: Target },
  { key: 'custom', label: 'Custom range', icon: CalendarRange },
];

export default function ClientDashboard() {
  const { clientId: paramClientId } = useParams();
  const { profile } = useAuth();
  const { push } = useToast();
  const clientId = paramClientId || profile?.client_id;
  const role = profile?.role;
  const [client, setClient] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const service = searchParams.get('service') || 'orm';
  // Compare is hideable per client (clients.compare_visible). When hidden the
  // mode selector is removed and we pin to MoM, so delta pills and comparison
  // bars still render — the client sees month-over-month movement, just without
  // the ability to switch modes.
  const compareVisible = client ? client.compare_visible !== false : true;
  const modeParam = searchParams.get('mode') || 'mom';
  const mode = compareVisible ? modeParam : 'mom';
  const reportIdFromUrl = searchParams.get('report');
  const [reports, setReports] = useState([]);
  const [targets, setTargets] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState({ aStart: '', aEnd: '', bStart: '', bEnd: '' });
  const [selectedReportId, setSelectedReportId] = useState(null);

  const load = useCallback(async () => {
    if (!clientId) { setLoading(false); return; }
    setLoading(true);
    try {
      const c = await get(`/api/clients?single=1&id=${clientId}`);
      setClient(c);
      const svcList = c.services || SERVICE_ORDER;
      if (!svcList.includes(service)) {
        setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('service', svcList[0]); return n; }, { replace: true });
        setLoading(false); return;
      }
      const [r, t, a] = await Promise.all([
        get(`/api/reports?clientId=${clientId}&service=${service}`),
        get(`/api/targets?clientId=${clientId}&service=${service}`),
        get(`/api/annotations?clientId=${clientId}&service=${service}`),
      ]);
      // Clients only see published reports. Admins (super_admin, team_admin) see all reports including drafts.
      const isAdmin = role === 'super_admin' || role === 'team_admin';
      const pub = (r || []).filter((x) => isAdmin ? true : x.status === 'published');
      setReports(pub);
      setTargets(t || []);
      setAnnotations(a || []);
      // Use the report ID from the URL if present and valid, otherwise default to latest
      const urlReportId = reportIdFromUrl ? Number(reportIdFromUrl) : null;
      const isValidReport = urlReportId && pub.some(r => r.id === urlReportId);
      setSelectedReportId(isValidReport ? urlReportId : (pub.length ? pub[pub.length - 1].id : null));
    } catch (e) { push(e.message, 'error'); }
    setLoading(false);
  }, [clientId, service, setSearchParams, reportIdFromUrl, role, push]);

  useEffect(() => { load(); }, [load]);

  const meta = SERVICE_META[service];
  const series = useMemo(() => [...reports].sort((a, b) => new Date(a.period_start) - new Date(b.period_start)), [reports]);
  const latest = series.length ? series[series.length - 1] : null;
  const selectedReport = series.find(r => r.id === selectedReportId) || latest;
  const selectedIndex = selectedReport ? series.indexOf(selectedReport) : -1;
  const prev = selectedIndex > 0 ? series[selectedIndex - 1] : null;

  const customSets = useMemo(() => {
    if (mode !== 'custom') return null;
    const inRange = (r, s, e) => (!s || new Date(r.period_start) >= new Date(s)) && (!e || new Date(r.period_start) <= new Date(e));
    const a = series.filter((r) => inRange(r, custom.aStart, custom.aEnd));
    const b = series.filter((r) => inRange(r, custom.bStart, custom.bEnd));
    return { a, b };
  }, [mode, custom, series]);

  if (loading) return <FullLoader label='Loading dashboard...' />;
  if (!client) return <EmptyState icon={Building2} title='No client linked' message='Your account is not linked to a client yet. Contact your agency.' />;

  const services = client.services || SERVICE_ORDER;
  const vis = selectedReport?.lists?._section_visibility || {};
  const sectionOrder = selectedReport?.lists?._section_order || [];
  const show = (k) => vis[k] !== false;
  const getOrder = (id) => { const idx = sectionOrder.indexOf(id); return idx === -1 ? 999 : idx; };

  // Objectives live in their own column.
  const objectives = Array.isArray(client.objectives) ? client.objectives : [];

  // Targets can be hidden from the client by the agency. When hidden, drop the
  // "vs Target" comparison mode and the target overlay on the charts.
  const targetsVisible = client.targets_visible !== false;
  const visibleTargets = targetsVisible ? targets : [];
  const modes = targetsVisible ? MODES : MODES.filter((m) => m.key !== 'target');

  // Custom metrics from the latest report
  const customMetricKeys = selectedReport ? Object.keys(selectedReport.metrics || {}).filter(k => !meta.coreMetrics.some(m => m.key === k)) : [];

  // Free-form closing notes section (agency-authored heading + bullet points).
  const notesTitle = selectedReport?.lists?.notes_title || 'Notes';
  const notesPoints = (selectedReport?.lists?.notes_points || []).filter((p) => p && String(p).trim());

  return (
    <div>
      {/* Only shown when an admin is previewing a specific client's dashboard.
          For a client this route IS their home, so there is nothing to go back to. */}
      {paramClientId && <BackButton to={`/app/clients/${paramClientId}`} className='mb-4 no-print' />}

      <div className='flex flex-wrap items-center justify-between gap-3 mb-6 no-print'>
        <div className='flex items-center gap-3'>
          <div className='h-12 w-12 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden text-slate-400'>{client.logo_url ? <img src={client.logo_url} alt='' className='h-full w-full object-cover' /> : <Building2 className='w-6 h-6' />}</div>
          <div>
            <h1 className='text-xl font-bold text-slate-900 dark:text-slate-100'>{client.company_name}</h1>
            <p className='text-sm text-slate-500 dark:text-slate-400'>Your reporting dashboard</p>
          </div>
        </div>
        <button onClick={() => window.print()} className='inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'><Download className='w-4 h-4' /> Download PDF</button>
      </div>

      <div className='hidden print:block mb-4'>
        <h1 className='text-2xl font-bold'>{client.company_name} — {meta.label} Report</h1>
        <p className='text-slate-500'>Generated {formatDate(new Date().toISOString())}</p>
      </div>

      {/* Objectives box — above service tabs */}
      {objectives.length > 0 && (
        <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 mb-6'>
          <h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-3'><Crosshair className='w-4 h-4' style={{ color: meta.accent }} /> Objectives</h3>
          <ul className='space-y-2'>
            {objectives.filter(o => o && o.trim()).map((obj, i) => (
              <li key={i} className='flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300'>
                <span className='mt-1.5 w-1.5 h-1.5 rounded-full shrink-0' style={{ background: meta.accent }} />
                {obj}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Service tabs */}
      <div className='flex gap-1 mb-5 overflow-x-auto pb-1 no-print'>
        {services.map((s) => {
          const m = SERVICE_META[s]; const on = s === service;
          return <button key={s} onClick={() => setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('service', s); return n; })} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition ${on ? 'text-white shadow-sm' : 'text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'}`} style={on ? { backgroundColor: m.accent } : undefined}><m.icon className='w-4 h-4' style={on ? undefined : { color: m.accent }} /> {m.label}</button>;
        })}
      </div>

      {series.length === 0 ? (
        <EmptyState icon={meta.icon} title={`No ${meta.label} reports yet`} message="Your agency hasn't published a report for this service yet. You'll get a notification the moment one goes live." accent={meta.accent} />
      ) : (
        <>
          {/* Month picker — lets client select which month's report to view */}
          <div className='flex flex-wrap items-center gap-3 mb-5 no-print'>
            <span className='text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide'>Report period</span>
            <div className='relative'>
              <select value={selectedReportId || ''} onChange={(e) => setSelectedReportId(Number(e.target.value))}
                className='appearance-none rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 pl-3.5 pr-9 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40'>
                {series.map((r) => <option key={r.id} value={r.id}>{r.period_label}</option>)}
              </select>
              <ChevronDown className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
            </div>
          </div>

          {/* Comparison mode selector — hidden when the agency turns it off for this client */}
          {compareVisible && (
            <div className='flex flex-wrap items-center gap-2 mb-5 no-print'>
              <span className='text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mr-1'>Compare</span>
              <div className='flex flex-wrap gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-1'>
                {modes.map((m) => <button key={m.key} onClick={() => setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('mode', m.key); return n; })} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${mode === m.key ? 'bg-slate-900 dark:bg-slate-700 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}`}><m.icon className='w-3.5 h-3.5' /> {m.label}</button>)}
              </div>
            </div>
          )}
          {compareVisible && mode === 'custom' && (
            <div className='grid sm:grid-cols-2 gap-3 mb-5 no-print'>
              <CustomRangePicker label='Range A' start={custom.aStart} end={custom.aEnd} onChange={(s, e) => setCustom((c) => ({ ...c, aStart: s, aEnd: e }))} />
              <CustomRangePicker label='Range B' start={custom.bStart} end={custom.bEnd} onChange={(s, e) => setCustom((c) => ({ ...c, bStart: s, bEnd: e }))} />
            </div>
          )}

          {/* All sections in a flex container — order controlled by admin's drag-and-drop */}
          <div className='flex flex-col'>
            {/* Work Done — SEO only */}
            {service === "seo" && show("workDone") && (selectedReport?.lists?.work_done || []).length > 0 && (
              <div style={{ order: getOrder('workDone') }} className='mb-6'>
                <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5'>
                  <h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-3'><CheckSquare className='w-4 h-4' style={{ color: meta.accent }} /> Work Done</h3>
                  <ul className='space-y-2'>
                    {(selectedReport?.lists?.work_done || []).map((item, i) => (
                      <li key={i} className='flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300'>
                        <span className='flex-1'>{item.text || '—'}</span>
                        {item.done
                          ? <span className='inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500 text-white shrink-0'><CheckSquare className='w-3.5 h-3.5' /></span>
                          : <span className='inline-flex h-5 w-5 items-center justify-center rounded-md border border-slate-300 dark:border-slate-600 shrink-0' />
                        }
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Core metrics */}
            {show('coreMetrics') && (
              <div style={{ order: getOrder('coreMetrics') }} className='mb-6'>
                {meta.hasPlatforms ? (
                  <div>
                    {meta.platforms.map((p) => (
                      <div key={p.key} className='mb-5'>
                        <div className='flex items-center gap-2 mb-3'>
                          <span className='w-3 h-3 rounded-full' style={{ background: p.color }} />
                          <span className='text-sm font-bold text-slate-700 dark:text-slate-300'>{p.label}</span>
                        </div>
                        <div className='grid sm:grid-cols-2 lg:grid-cols-4 gap-4'>
                          {meta.coreMetrics.map((m) => <MetricCard key={`${p.key}-${m.key}`} meta={meta} metric={m} platform={p} series={series} latest={selectedReport} prev={prev} mode={mode} targets={visibleTargets} customSets={customSets} annotations={annotations} selectedIndex={selectedIndex} />)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className='grid sm:grid-cols-2 lg:grid-cols-3 gap-4'>
                    {meta.coreMetrics.map((m) => <MetricCard key={m.key} meta={meta} metric={m} platform={null} series={series} latest={selectedReport} prev={prev} mode={mode} targets={visibleTargets} customSets={customSets} annotations={annotations} selectedIndex={selectedIndex} />)}
                  </div>
                )}
              </div>
            )}

            {/* GA Metrics — SEO only */}
            {service === 'seo' && show('gaMetrics') && (selectedReport?.lists?.ga_metrics || []).length > 0 && (
              <div style={{ order: getOrder('gaMetrics') }} className='mb-6'>
                <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5'>
                  <h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100 mb-3'>{selectedReport?.lists?.ga_metrics_title || 'GA Metrics'}</h3>
                  <div className='grid sm:grid-cols-2 lg:grid-cols-4 gap-4'>
                    {(selectedReport.lists.ga_metrics || []).filter(m => m.name).map((m, i) => {
                      const val = m.value === '' || m.value === null || m.value === undefined ? null : Number(m.value);
                      return (
                        <div key={i} className='rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600 p-4'>
                          <div className='text-xs font-semibold text-slate-500 dark:text-slate-400 capitalize'>{m.name.replace(/_/g, ' ')}</div>
                          <div className='text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1'>{val === null ? '—' : val.toLocaleString()}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Custom metrics */}
            {show('customMetrics') && customMetricKeys.length > 0 && (
              <div style={{ order: getOrder('customMetrics') }} className='mb-6'>
                <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5'>
                  <h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100 mb-3'>Additional Metrics</h3>
                  <div className='grid sm:grid-cols-2 lg:grid-cols-4 gap-4'>
                    {customMetricKeys.map((key) => {
                      const val = getValue(selectedReport, key, null);
                      const prevVal = prev ? getValue(prev, key, null) : null;
                      const d = compare(val, prevVal, false);
                      return <CustomMetricCard key={key} label={key} value={val} delta={d} accent={meta.accent} format={meta.coreMetrics[0]?.format} series={series} metricKey={key} annotations={annotations} />;
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Breakdown table(s) */}
            {show('breakdown') && (
              <div style={{ order: getOrder('breakdown') }} className='mb-6'>
                {meta.breakdown2 ? (
                  <>
                    <BreakdownTable meta={meta} series={series} categoryFilter={meta.breakdown.defaults} title={meta.breakdown.label} subtitle={`Month-by-month counts by ${meta.breakdown.itemNoun}.`} />
                    {show('backlinkActivity') && <BreakdownTable meta={meta} series={series} categoryFilter={meta.breakdown2.defaults} title={meta.breakdown2.label} subtitle={`Month-by-month counts by ${meta.breakdown2.itemNoun}.`} />}
                  </>
                ) : (
                  <BreakdownTable meta={meta} series={series} />
                )}
              </div>
            )}

            {/* Keyword Ranking Tracker — SEO only */}
            {service === 'seo' && show('keywordRankings') && (
              <div style={{ order: getOrder('keywordRankings') }} className='mb-6'>
                <KeywordRankingTable series={series} accent={meta.accent} />
              </div>
            )}

            {/* Keyword Status Tracker — ORM only */}
            {service === 'orm' && show('keywordStatus') && (
              <div style={{ order: getOrder('keywordStatus') }} className='mb-6'>
                <KeywordStatusView series={series} accent={meta.accent} />
              </div>
            )}

            {/* Lists */}
            {(meta.lists || []).filter((l) => show('list_' + l.key)).length > 0 && (
              <div style={{ order: getOrder('list_backlinks') }} className='mb-6'>
                <ListsSection meta={meta} series={series} listPeriod={selectedReport?.period_start} visibleLists={vis} />
              </div>
            )}

            {/* Additional Inputs (annotations) */}
            {show('annotations') && annotations.filter(a => a.period_start === selectedReport?.period_start).length > 0 && (
              <div style={{ order: getOrder('annotations') }} className='mb-6'>
                <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5'>
                  <h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 mb-3'><MessageSquarePlus className='w-4 h-4' style={{ color: meta.accent }} /> Additional Inputs</h3>
                  <ul className='space-y-2'>
                    {annotations.filter(a => a.period_start === selectedReport?.period_start).map((a) => (
                      <li key={a.id} className='flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300'>
                        <span className='mt-1.5 w-1.5 h-1.5 rounded-full shrink-0' style={{ background: meta.accent }} />
                        {a.note}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Achievements */}
            {show('achievements') && (
              <div style={{ order: getOrder('achievements') }} className='mb-6'>
                <AchievementsSection key={service} series={series} accent={meta.accent} />
              </div>
            )}

            {/* Notes — free-form closing section, heading set by the agency */}
            {show('notes') && notesPoints.length > 0 && (
              <div style={{ order: getOrder('notes') }} className='mb-6'>
                <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5'>
                  <h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100 mb-3'>{notesTitle}</h3>
                  <ul className='space-y-2'>
                    {notesPoints.map((point, i) => (
                      <li key={i} className='flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300'>
                        <span className='mt-1.5 w-1.5 h-1.5 rounded-full shrink-0' style={{ background: meta.accent }} />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CustomRangePicker({ label, start, end, onChange }) {
  return (
    <div className='rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3'>
      <div className='text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2'>{label}</div>
      <div className='grid grid-cols-2 gap-2'>
        <input type='date' value={start || ''} onChange={(e) => onChange(e.target.value, end)} className='rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-200' />
        <input type='date' value={end || ''} onChange={(e) => onChange(start, e.target.value)} className='rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-700 dark:text-slate-200' />
      </div>
    </div>
  );
}

function MetricCard({ meta, metric, platform, series, latest, prev, mode, targets, customSets, annotations, selectedIndex }) {
  // Index of the report the user actually selected — NOT simply the last one.
  // Using series.length - 1 here made the delta badges describe the newest
  // month while the headline figure described the selected month.
  const idx = selectedIndex >= 0 ? selectedIndex : series.length - 1;
  const pkey = platform?.key || null;
  const cur = getValue(latest, metric.key, pkey);
  const targetRow = targets.find((t) => t.metric_key === metric.key && (pkey ? t.platform === pkey : !t.platform));
  const target = targetRow ? Number(targetRow.target_value) : null;

  let badge = null, bars = null, sub = null, chartTarget = null, chartTrailing = null;
  if (mode === 'mom') { const d = momDelta(series, idx, metric.key, pkey, metric.lowerBetter); badge = d; bars = { current: cur, previous: prev ? getValue(prev, metric.key, pkey) : null }; sub = 'vs last period'; }
  else if (mode === 'yoy') { const d = yoyDelta(series, idx, metric.key, pkey, metric.lowerBetter); badge = d; bars = { current: cur, previous: d.prev }; sub = 'vs same period last year'; }
  else if (mode === 'trailing3') { const avg = trailingAvg(series, idx, metric.key, pkey, 3); chartTrailing = series.map((_, i) => trailingAvg(series, i, metric.key, pkey, 3)); sub = `3-mo avg: ${avg === null ? '—' : fmtNum(avg, metric.format)}`; }
  else if (mode === 'trailing6') { const avg = trailingAvg(series, idx, metric.key, pkey, 6); chartTrailing = series.map((_, i) => trailingAvg(series, i, metric.key, pkey, 6)); sub = `6-mo avg: ${avg === null ? '—' : fmtNum(avg, metric.format)}`; }
  else if (mode === 'target') { const v = vsTarget(cur, target, metric.lowerBetter); chartTarget = target; sub = v ? `${fmtPct(v.pct)} of goal${v.met ? ' · reached' : ` · ${fmtNum(Math.abs(v.remaining), metric.format)} to go`}` : 'No target set'; }
  else if (mode === 'custom' && customSets) { const a = rangeAggregate(customSets.a, metric.key, pkey); const b = rangeAggregate(customSets.b, metric.key, pkey); badge = compare(b, a, metric.lowerBetter); bars = { current: b, previous: a }; sub = 'range B vs range A'; }

  const chartData = series.map((r) => ({ label: r.period_label, shortLabel: shortPeriod(r.period_label), value: getValue(r, metric.key, pkey), periodStart: r.period_start }));
  const color = platform?.color || meta.accent;

  return (
    <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <div className='flex items-center gap-1.5'>
            {platform && <span className='w-2 h-2 rounded-full' style={{ background: platform.color }} />}
            <span className='text-xs font-semibold text-slate-500 dark:text-slate-400'>{platform ? `${platform.label} · ` : ''}{metric.label}</span>
          </div>
          <div className='text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1'>{fmtNum(cur, metric.format)}{metric.suffix || ''}</div>
          {sub && <div className='text-[11px] text-slate-400 dark:text-slate-500 mt-0.5'>{sub}</div>}
        </div>
        {badge && <DeltaPill delta={badge} />}
      </div>
      {bars && <div className='mt-3'><ComparisonBars current={bars.current} previous={bars.previous} color={color} /></div>}
      <div className='mt-3'>
        <TrendChart data={chartData} color={color} target={chartTarget} trailing={chartTrailing} annotations={annotations} height={150} valueFmt={(v) => fmtNum(v, metric.format) + (metric.suffix || '')} />
      </div>
    </div>
  );
}

function CustomMetricCard({ label, value, delta, accent, format, series, metricKey, annotations }) {
  const chartData = series.map((r) => ({ label: r.period_label, shortLabel: shortPeriod(r.period_label), value: getValue(r, metricKey, null), periodStart: r.period_start }));
  return (
    <div className='rounded-2xl bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600 p-4'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <span className='text-xs font-semibold text-slate-500 dark:text-slate-400 capitalize'>{label.replace(/_/g, ' ')}</span>
          <div className='text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1'>{fmtNum(value, format)}</div>
          {delta && delta.abs !== null && <div className='text-[11px] text-slate-400 dark:text-slate-500 mt-0.5'>vs last: {delta.abs > 0 ? '+' : ''}{fmtRaw(delta.abs)}</div>}
        </div>
        {delta && delta.abs !== null && <DeltaPill delta={delta} />}
      </div>
      <div className='mt-2'>
        <TrendChart data={chartData} color={accent} annotations={annotations} height={100} valueFmt={fmtRaw} />
      </div>
    </div>
  );
}

function DeltaPill({ delta }) {
  if (!delta || delta.abs === null || delta.abs === undefined) return <span className='text-xs text-slate-400 dark:text-slate-500 font-medium'>—</span>;
  const up = delta.abs > 0; const flat = delta.abs === 0;
  let good = delta.good; if (flat) good = null;
  const cls = good === null ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400' : good ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400';
  const sign = up ? '+' : '';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}>{sign}{Math.abs(delta.abs) >= 1000 ? Math.round(delta.abs).toLocaleString() : fmtRaw(delta.abs)}{delta.pct !== null ? ` · ${sign}${delta.pct.toFixed(1)}%` : ''}</span>;
}

function BreakdownTable({ meta, series, categoryFilter, title, subtitle }) {
  const [platform, setPlatform] = useState(meta.platforms?.[0]?.key || null);
  const cats = useMemo(() => {
    const set = new Set();
    series.forEach((r) => {
      if (meta.hasPlatforms) Object.keys(r.breakdowns?.[platform] || {}).forEach((c) => set.add(c));
      else Object.keys(r.breakdowns || {}).forEach((c) => set.add(c));
    });
    let arr = [...set];
    // If a categoryFilter is provided, include BOTH the defaults AND any custom categories
    // that aren't in the other breakdown's defaults (so new platforms/link types show up)
    if (categoryFilter) {
      const otherDefaults = meta.breakdown2?.defaults || [];
      arr = arr.filter((c) => categoryFilter.includes(c) || !otherDefaults.includes(c));
    }
    return arr;
  }, [series, platform, meta, categoryFilter]);

  const tblTitle = title || meta.breakdown.label;
  const tblSubtitle = subtitle || `Month-by-month counts by ${meta.breakdown.itemNoun}.`;

  const rows = series.map((r) => {
    const bd = meta.hasPlatforms ? (r.breakdowns?.[platform] || {}) : (r.breakdowns || {});
    const total = cats.reduce((a, c) => a + (Number(bd[c]) || 0), 0);
    return { id: r.id, period: r.period_label, short: shortPeriod(r.period_label), ...Object.fromEntries(cats.map((c) => [c, bd[c]])), total };
  }).reverse();

  return (
    <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5'>
      <div className='flex flex-wrap items-center justify-between gap-2 mb-3'>
        <div><h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100'>{tblTitle}</h3><p className='text-xs text-slate-500 dark:text-slate-400'>{tblSubtitle}</p></div>
        {meta.hasPlatforms && (
          <div className='flex gap-1'>
            {meta.platforms.map((p) => <button key={p.key} onClick={() => setPlatform(p.key)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${platform === p.key ? 'text-white' : 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700'}`} style={platform === p.key ? { backgroundColor: p.color } : undefined}>{p.label}</button>)}
          </div>
        )}
      </div>
      {rows.length === 0 ? <p className='text-sm text-slate-400 dark:text-slate-500 py-6 text-center'>No breakdown data yet.</p> : (
        <div className='overflow-x-auto'>
          <table className='w-full text-sm border-collapse'>
            <thead><tr className='text-left'>
              <th className='px-2 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700'>Period</th>
              {cats.map((c) => <th key={c} className='px-2 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 whitespace-nowrap'>{c}</th>)}
              <th className='px-2 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700'>Total</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => <tr key={r.id} className='hover:bg-slate-50 dark:hover:bg-slate-700/30'>
                <td className='px-2 py-2 font-medium text-slate-700 dark:text-slate-300 border-b border-slate-100 dark:border-slate-700 whitespace-nowrap'>{r.period}</td>
                {cats.map((c) => <td key={c} className='px-2 py-2 text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700'>{r[c] === '' || r[c] === null || r[c] === undefined ? '—' : fmtRaw(r[c])}</td>)}
                <td className='px-2 py-2 font-bold text-slate-800 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700'>{r.total}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ListsSection({ meta, series, listPeriod, visibleLists = {} }) {
  const periodReport = series.find((r) => r.period_start === listPeriod) || series[series.length - 1];
  const visibleListsArr = (meta.lists || []).filter((l) => visibleLists['list_' + l.key] !== false);
  return (
    <div className='grid lg:grid-cols-2 gap-4'>
      {visibleListsArr.map((l) => {
        const rows = (periodReport?.lists?.[l.key] || []);
        return (
          <div key={l.key} className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5'>
            <div className='flex items-center justify-between mb-3'>
              <h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100'>{l.label}</h3>
            </div>
            {rows.length === 0 ? <p className='text-sm text-slate-400 dark:text-slate-500 py-4 text-center'>No entries for this period.</p> : (
              <div className='space-y-2 max-h-72 overflow-y-auto'>
                {l.key === 'brand_keywords' ? (
                  <table className='w-full text-sm'><tbody>
                    {rows.map((r, i) => <tr key={i} className='border-b border-slate-50 dark:border-slate-700/50'><td className='py-1.5 font-medium text-slate-700 dark:text-slate-300'>{r.keyword || '—'}</td><td className='py-1.5 text-right text-slate-600 dark:text-slate-400'>{r.position ? `#${fmtRaw(r.position)}` : '—'}</td><td className='py-1.5 text-right text-xs text-slate-400 dark:text-slate-500'>{r.asset || ''}</td></tr>)}
                  </tbody></table>
                ) : l.key === 'reviews' ? (
                  rows.map((r, i) => <div key={i} className='rounded-lg border border-slate-100 dark:border-slate-700 p-2.5'><div className='flex justify-between text-xs'><span className='font-semibold text-slate-700 dark:text-slate-300'>{r.author || 'Anonymous'} · {r.platform || ''}</span><span className='text-amber-500 font-bold'>★ {r.rating || '—'}</span></div>{r.snippet && <p className='text-xs text-slate-500 dark:text-slate-400 mt-1'>{r.snippet}</p>}</div>)
                ) : l.key === 'top_posts' ? (
                  rows.map((r, i) => <div key={i} className='rounded-lg border border-slate-100 dark:border-slate-700 p-2.5'><div className='flex justify-between text-xs'><span className='font-semibold text-slate-700 dark:text-slate-300'>{r.platform} · {r.type}</span><span className='text-slate-400 dark:text-slate-500'>{formatDate(r.date)}</span></div>{r.caption && <p className='text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-2'>{r.caption}</p>}<div className='flex gap-3 text-[11px] text-slate-400 dark:text-slate-500 mt-1'><span>❤ {fmtRaw(r.likes)}</span><span>💬 {fmtRaw(r.comments)}</span><span>👁 {fmtRaw(r.reach)}</span></div></div>)
                ) : l.key === 'published_pages' ? (
                  rows.map((r, i) => <div key={i} className='rounded-lg border border-slate-100 dark:border-slate-700 p-2.5'><div className='flex justify-between text-xs'><a href={r.live_link || '#'} target='_blank' rel='noopener noreferrer' className='font-semibold text-indigo-600 dark:text-indigo-400 hover:underline truncate'>{r.blog_title || r.live_link || '—'}</a><span className='text-slate-400 dark:text-slate-500 shrink-0'>{formatDate(r.published_date)}</span></div><div className='flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500 mt-1'>{r.type && <span className='inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 font-medium'>{r.type}</span>}{r.note && <span className='truncate'>{r.note}</span>}</div></div>)
                ) : (
                  rows.map((r, i) => <div key={i} className='flex items-center justify-between text-sm border-b border-slate-50 dark:border-slate-700/50 py-1.5'><span className='text-slate-700 dark:text-slate-300 truncate'>{r.url || r.anchor_text || '—'}</span><span className='text-xs text-slate-400 dark:text-slate-500 ml-2 shrink-0'>{r.type || ''} · {formatDate(r.date)}</span></div>)
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AchievementsSection({ series, accent }) {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const periodsWithAchievements = series.filter(r => (r.achievements || []).some(a => a && a.trim()));
  const lastWith = periodsWithAchievements[periodsWithAchievements.length - 1];
  const lastDate = lastWith ? new Date(lastWith.period_start) : new Date();
  const [selYear, setSelYear] = useState(lastDate.getFullYear());
  const [selMonth, setSelMonth] = useState(lastDate.getMonth() + 1);

  const years = [...new Set(series.map(r => new Date(r.period_start).getFullYear()))].sort();

  const filtered = series.filter((r) => {
    const d = new Date(r.period_start);
    return d.getFullYear() === selYear && (d.getMonth() + 1) === selMonth;
  });
  const items = filtered.flatMap(r => (r.achievements || []).filter(a => a && a.trim()));

  return (
    <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5'>
      <div className='flex flex-wrap items-center justify-between gap-3 mb-4'>
        <div>
          <h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2'><Sparkles className='w-4 h-4' style={{ color: accent }} /> Monthly achievements</h3>
          <p className='text-xs text-slate-500 dark:text-slate-400 mt-0.5'>Plain-language wins for the selected period.</p>
        </div>
        <div className='flex items-center gap-2'>
          <div className='relative'>
            <select value={selMonth} onChange={(e) => setSelMonth(Number(e.target.value))} className='appearance-none rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-3 pr-8 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40'>
              {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <ChevronDown className='pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
          </div>
          <div className='relative'>
            <select value={selYear} onChange={(e) => setSelYear(Number(e.target.value))} className='appearance-none rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-3 pr-8 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40'>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className='pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
          </div>
        </div>
      </div>
      {items.length === 0 ? (
        <p className='text-sm text-slate-400 dark:text-slate-500 py-6 text-center'>No achievements recorded for {MONTHS[selMonth - 1]} {selYear}.</p>
      ) : (
        <ul className='space-y-2'>
          {items.map((a, i) => (
            <li key={i} className='flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300'>
              <span className='mt-1.5 w-1.5 h-1.5 rounded-full shrink-0' style={{ background: accent }} />
              {a}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
