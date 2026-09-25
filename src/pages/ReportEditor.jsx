import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, Send, Undo2, Sparkles, Tag, ListChecks, Save as SaveIcon, AlertTriangle, MessageSquarePlus, Search, Columns, CheckSquare } from 'lucide-react';
import { get, put, del, post } from '../lib/api';
import { Button, Input, Select, Field, Badge, Modal, ConfirmDialog, useToast, FullLoader, SectionCard, BackButton } from '../components/ui';
import { KeywordRankingEditor } from '../components/KeywordRanking';
import { KeywordStatusTracker } from '../components/KeywordStatus';
import { SectionToggle } from '../components/SectionToggle';
import { DraggableSection } from '../components/DraggableSection';
import { CopyFromMonth } from '../components/CopyFromMonth';
import { SERVICE_META, NOTE_SECTIONS } from '../lib/constants';
import { useAuth } from '../contexts/AuthContext';

function cleanVal(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return isNaN(n) ? v : n; }
function cleanObj(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = cleanObj(v);
    else out[k] = cleanVal(v);
  }
  return out;
}

function splitMetrics(rawMetrics, meta) {
  const keys = meta.coreMetrics.map((m) => m.key);
  if (!meta.hasPlatforms) {
    const coreValues = {}; const custom = [];
    for (const [k, v] of Object.entries(rawMetrics || {})) {
      if (keys.includes(k)) coreValues[k] = v ?? ''; else custom.push({ name: k, value: v ?? '' });
    }
    keys.forEach((k) => { if (!(k in coreValues)) coreValues[k] = ''; });
    return { coreValues, custom };
  }
  const coreValues = {}; const custom = {};
  meta.platforms.forEach((p) => {
    coreValues[p.key] = {}; custom[p.key] = [];
    for (const [k, v] of Object.entries(rawMetrics?.[p.key] || {})) {
      if (keys.includes(k)) coreValues[p.key][k] = v ?? ''; else custom[p.key].push({ name: k, value: v ?? '' });
    }
    keys.forEach((k) => { if (!(k in coreValues[p.key])) coreValues[p.key][k] = ''; });
  });
  return { coreValues, custom };
}
function splitBreakdown(rawBreakdowns, meta) {
  if (!meta.hasPlatforms) return Object.entries(rawBreakdowns || {}).map(([name, value]) => ({ name, value: value ?? '' }));
  const out = {};
  meta.platforms.forEach((p) => { out[p.key] = Object.entries(rawBreakdowns?.[p.key] || {}).map(([name, value]) => ({ name, value: value ?? '' })); });
  return out;
}

// Repeating free-form sections: an editable heading plus bullet points.
// The section list is shared with the dashboard renderer.

function blankNotes() {
  return Object.fromEntries(NOTE_SECTIONS.map((s) => [s.id, { title: s.fallback, points: [] }]));
}

function notesFromReport(lists) {
  return Object.fromEntries(NOTE_SECTIONS.map((s) => [s.id, {
    title: lists?.[s.titleKey] || s.fallback,
    points: Array.isArray(lists?.[s.pointsKey]) ? lists[s.pointsKey] : [],
  }]));
}

function notesToPayload(notes) {
  const out = {};
  NOTE_SECTIONS.forEach((s) => {
    out[s.titleKey] = notes?.[s.id]?.title ?? s.fallback;
    out[s.pointsKey] = notes?.[s.id]?.points ?? [];
  });
  return out;
}

export default function ReportEditor() {
  const { reportId } = useParams();
  const nav = useNavigate();
  const { push } = useToast();
  const { profile } = useAuth();
  // Only a super admin deletes for real; a team admin's delete is a request
  // that a super admin has to action, so the copy must differ.
  const isSuperAdmin = profile?.role === 'super_admin';
  const [report, setReport] = useState(null);
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [coreValues, setCoreValues] = useState({});
  const [custom, setCustom] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [backlinkBreakdown, setBacklinkBreakdown] = useState([]);
  const [lists, setLists] = useState({});
  const [achievements, setAchievements] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const activePlatform = searchParams.get('platform');
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseNote, setReviseNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [annotations, setAnnotations] = useState([]);
  const [annInput, setAnnInput] = useState('');
  const [keywordRankings, setKeywordRankings] = useState([]);
  const [keywordStatus, setKeywordStatus] = useState([]);
  const [sectionVisibility, setSectionVisibility] = useState({});
  const [workDone, setWorkDone] = useState([]);
  const [sectionOrder, setSectionOrder] = useState([]);
  const [gaMetrics, setGaMetrics] = useState([]);
  const [gaMetricsTitle, setGaMetricsTitle] = useState('GA Metrics');
  // Five free-form sections, keyed by id so they share one piece of state.
  const [notes, setNotes] = useState(blankNotes);

  useEffect(() => {
    (async () => {
      try {
        const rep = await get(`/api/reports?single=1&id=${reportId}`);
        setReport(rep);
        const meta = SERVICE_META[rep.service];
        const c = await get(`/api/clients?single=1&id=${rep.client_id}`);
        setClient(c);
        let mRaw = rep.metrics || {}, bRaw = rep.breakdowns || {};
        const isEmpty = Object.keys(mRaw).length === 0 && Object.keys(bRaw).length === 0;
        if (rep.status === 'draft' && isEmpty) {
          try {
            const st = await get(`/api/reports/structure?clientId=${rep.client_id}&service=${rep.service}`);
            mRaw = applyStructureMetrics(st, meta, mRaw);
            bRaw = applyStructureBreakdown(st, meta, bRaw);
          } catch {}
        }
        const sp = splitMetrics(mRaw, meta);
        setCoreValues(sp.coreValues);
        setCustom(sp.custom);
        let br = splitBreakdown(bRaw, meta);
        br = seedDefaults(br, meta);
        // For ORM with breakdown2 (backlink activity), split out backlink-type categories
        // from the already-seeded breakdown so we don't lose seeded defaults
        if (meta.breakdown2) {
          const bkDefaults = meta.breakdown2.defaults;
          const reviewDefaults = meta.breakdown.defaults;
          // Split: backlink categories go to bkBr, review categories stay in br
          const bkBr = br.filter((b) => bkDefaults.includes(b.name) || (!reviewDefaults.includes(b.name) && b.name));
          br = br.filter((b) => !bkDefaults.includes(b.name));
          setBreakdown(br);
          // Seed defaults for backlink breakdown
          const bkNames = new Set(bkBr.map((b) => b.name));
          bkDefaults.forEach((d) => { if (!bkNames.has(d)) bkBr.push({ name: d, value: '' }); });
          setBacklinkBreakdown(bkBr);
        } else {
          setBreakdown(br);
        }
        const initLists = {};
        (meta.lists || []).forEach((l) => {
          const rows = rep.lists?.[l.key] || [];
          initLists[l.key] = rows.map((r) => ({ ...r }));
        });
        if (rep.status === 'draft' && isEmpty && !meta.hasPlatforms) {
          try {
            const st = await get(`/api/reports/structure?clientId=${rep.client_id}&service=${rep.service}`);
            if (st.brandKeywords && st.brandKeywords.length && (!rep.lists?.brand_keywords || rep.lists.brand_keywords.length === 0)) {
              initLists.brand_keywords = st.brandKeywords.map((k) => ({ keyword: k.keyword, position: '', asset: '' }));
            }
          } catch {}
        }
        setLists(initLists);
        setAchievements(rep.achievements || []);
        // Initialize keyword rankings from report data or carry forward from structure
        let krInit = rep.lists?.keyword_rankings || [];
        if (rep.status === 'draft' && krInit.length === 0 && !meta.hasPlatforms) {
          try {
            const st = await get(`/api/reports/structure?clientId=${rep.client_id}&service=${rep.service}`);
            if (st.rankingKeywords && st.rankingKeywords.length) {
              krInit = st.rankingKeywords.map(k => ({ keyword: k.keyword, position: '' }));
            }
          } catch {}
        }
        setKeywordRankings(krInit.map(k => ({ ...k })));
        setKeywordStatus(rep.lists?.keyword_status || []);
        setSectionVisibility(rep.lists?._section_visibility || {});
        setWorkDone(rep.lists?.work_done || []);
        setSectionOrder(rep.lists?._section_order || []);
        setGaMetrics(rep.lists?.ga_metrics || []);
        setGaMetricsTitle(rep.lists?.ga_metrics_title || 'GA Metrics');
        setNotes(notesFromReport(rep.lists));
        if (meta.hasPlatforms && !activePlatform) setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('platform', meta.platforms[0].key); return n; }, { replace: true });
        try { const anns = await get(`/api/annotations?clientId=${rep.client_id}&service=${rep.service}`); setAnnotations(anns || []); } catch {}
      } catch (e) { push(e.message, 'error'); }
      setLoading(false);
    })();
    // Loads once per report id. activePlatform/push/setSearchParams are read as
    // the mount-time values on purpose — re-running this would refetch the whole
    // report and discard the admin's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const meta = report ? SERVICE_META[report.service] : null;

  const buildPayload = () => {
    if (!meta) return {};
    let metrics;
    if (!meta.hasPlatforms) {
      metrics = { ...coreValues };
      custom.forEach((c) => { if (c.name) metrics[c.name] = c.value; });
    } else {
      metrics = {};
      meta.platforms.forEach((p) => {
        metrics[p.key] = { ...(coreValues[p.key] || {}) };
        (custom[p.key] || []).forEach((c) => { if (c.name) metrics[p.key][c.name] = c.value; });
      });
    }
    let breakdowns;
    if (!meta.hasPlatforms) {
      breakdowns = {};
      breakdown.forEach((b) => { if (b.name) breakdowns[b.name] = b.value; });
      // Merge backlink breakdown if exists (ORM)
      if (meta.breakdown2) {
        backlinkBreakdown.forEach((b) => { if (b.name) breakdowns[b.name] = b.value; });
      }
    } else {
      breakdowns = {};
      meta.platforms.forEach((p) => {
        breakdowns[p.key] = {};
        (breakdown[p.key] || []).forEach((b) => { if (b.name) breakdowns[p.key][b.name] = b.value; });
      });
    }
    return { metrics: cleanObj(metrics), breakdowns: cleanObj(breakdowns), lists: { ...lists, keyword_rankings: keywordRankings, keyword_status: keywordStatus, work_done: workDone, ga_metrics: gaMetrics, ga_metrics_title: gaMetricsTitle, ...notesToPayload(notes), _section_visibility: sectionVisibility, _section_order: sectionOrder }, achievements };
  };

  const doSave = async (action, note) => {
    setSaving(true);
    try {
      const payload = buildPayload();
      await put('/api/reports', { id: report.id, action, note, ...payload });
      push(action === 'publish' ? 'Published — client notified' : action === 'revise' ? 'Revision published' : 'Draft saved', 'success');
      if (action === 'publish' || action === 'revise' || action === 'revert-to-draft') nav(`/app/clients/${report.client_id}`);
      else { const fresh = await get(`/api/reports?single=1&id=${report.id}`); setReport(fresh); }
    } catch (e) { push(e.message, 'error'); }
    setSaving(false);
  };

  if (loading) return <FullLoader label='Loading editor...' />;
  if (!report || !meta) return <div className='text-center py-20 text-slate-500'>Report not found.</div>;
  const isDraft = report.status === 'draft';
  const accent = meta.accent;

  // Default section order based on service
  const defaultSections = report.service === 'seo'
    ? ['workDone', 'coreMetrics', 'gaMetrics', 'list_ga_top_pages', 'list_ga_demographics', 'customMetrics', 'breakdown', 'keywordRankings', 'list_backlinks', 'list_published_pages', 'achievements', 'notes', 'notes2', 'notes3', 'notes4', 'notes5', 'annotations']
    : report.service === 'orm'
    ? ['coreMetrics', 'customMetrics', 'breakdown', 'backlinkActivity', 'list_brand_keywords', 'list_reviews', 'list_backlinks', 'keywordStatus', 'achievements', 'notes', 'notes2', 'notes3', 'notes4', 'notes5', 'annotations']
    : ['coreMetrics', 'customMetrics', 'breakdown', 'list_top_posts', 'achievements', 'notes', 'notes2', 'notes3', 'notes4', 'notes5', 'annotations'];

  const activeOrder = sectionOrder.length ? sectionOrder : defaultSections;

  const getSectionOrder = (id) => {
    const idx = activeOrder.indexOf(id);
    return idx === -1 ? 999 : idx;
  };

  const handleReorder = (fromId, toId) => {
    const fromIdx = activeOrder.indexOf(fromId);
    const toIdx = activeOrder.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const newOrder = [...activeOrder];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, fromId);
    setSectionOrder(newOrder);
    push('Section order updated — save to persist', 'info');
  };

  return (
    <div className='max-w-4xl mx-auto'>
      <BackButton to={`/app/clients/${report.client_id}`} label={`Back to ${client?.company_name || 'client'}`} className='mb-4' />
      <div className='flex flex-wrap items-center justify-between gap-3 mb-6'>
        <div>
          <div className='flex items-center gap-2'>
            <span className='inline-flex h-8 w-8 items-center justify-center rounded-lg' style={{ background: accent + '1a', color: accent }}><meta.icon className='w-4.5 h-4.5' /></span>
            <h1 className='text-xl font-bold text-slate-900 dark:text-slate-100'>{meta.label} · {report.period_label}</h1>
          </div>
          <p className='text-sm text-slate-500 dark:text-slate-400 mt-1'>{client?.company_name} · {report.period_type === 'cycle' ? 'Billing cycle' : 'Calendar month'}</p>
        </div>
        <div className='flex items-center gap-2'>
          {isDraft ? <Badge color='amber'>Draft</Badge> : <Badge color='emerald'>Published v{report.version}</Badge>}
          {report.version > 1 && <Badge color='sky'>updated</Badge>}
        </div>
      </div>

      {/* All sections in a flex container — CSS order controls position */}
      <div className='flex flex-col gap-0'>
      {/* Work Done — SEO only */}
      {report.service === 'seo' && (
        <DraggableSection id='workDone' onReorder={handleReorder} accent={accent} order={getSectionOrder('workDone')}>
        <SectionCard title='Work Done' subtitle='Tasks completed this month. Tick the checkbox when done.' icon={CheckSquare} accent={accent}
          actions={<><SectionToggle visible={sectionVisibility.workDone} onChange={(v) => setSectionVisibility((s) => ({ ...s, workDone: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={() => setWorkDone((w) => [...w, { text: '', done: false }])}><Plus className='w-3.5 h-3.5' /> Add task</Button></>} className={`mb-6 ${sectionVisibility.workDone === false ? 'opacity-50' : ''}`}>
          <div className='space-y-2'>
            {workDone.length === 0 && <p className='text-sm text-slate-400 dark:text-slate-500'>No tasks yet. Add what was done this month.</p>}
            {workDone.map((item, i) => (
              <div key={i} className='flex items-center gap-2'>
                <Input value={item.text || ''} onChange={(e) => setWorkDone((w) => w.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder='e.g. Published 3 blog articles on DR-50+ sites' />
                <input type='checkbox' checked={item.done || false} onChange={(e) => setWorkDone((w) => w.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} className='w-5 h-5 rounded-md accent-emerald-600 shrink-0 cursor-pointer' title='Mark as done' />
                <button onClick={() => setWorkDone((w) => w.filter((_, j) => j !== i))} className='p-2 rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600'><Trash2 className='w-4 h-4' /></button>
              </div>
            ))}
          </div>
        </SectionCard>
        </DraggableSection>
      )}

      {/* Core metrics */}
      <DraggableSection id='coreMetrics' onReorder={handleReorder} accent={accent} order={getSectionOrder('coreMetrics')}>
      <SectionCard title='Core metrics' subtitle='Fixed fields for clean, comparable charts.' icon={Sparkles} accent={accent} className={`mb-6 ${sectionVisibility.coreMetrics === false ? 'opacity-50' : ''}`}
        actions={<SectionToggle visible={sectionVisibility.coreMetrics} onChange={(v) => setSectionVisibility((s) => ({ ...s, coreMetrics: v }))} accent={accent} />}>
        {meta.hasPlatforms ? (
          <div>
            <div className='flex gap-1 mb-4 overflow-x-auto'>
              {meta.platforms.map((p) => (
                <button key={p.key} onClick={() => setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('platform', p.key); return n; })} className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition ${activePlatform === p.key ? 'text-white' : 'text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700'}`} style={activePlatform === p.key ? { backgroundColor: p.color } : undefined}>
                  <span className='w-2 h-2 rounded-full' style={{ background: activePlatform === p.key ? '#fff' : p.color }} /> {p.label}
                </button>
              ))}
            </div>
            <div className='grid sm:grid-cols-2 gap-4'>
              {meta.coreMetrics.map((m) => (
                <Field key={m.key} label={m.label}>
                  <Input type='number' step='any' value={coreValues[activePlatform]?.[m.key] ?? ''} onChange={(e) => setCoreValues((cv) => ({ ...cv, [activePlatform]: { ...cv[activePlatform], [m.key]: e.target.value } }))} placeholder='0' />
                </Field>
              ))}
            </div>
          </div>
        ) : (
          <div className='grid sm:grid-cols-3 gap-4'>
            {meta.coreMetrics.map((m) => (
              <Field key={m.key} label={m.label} hint={m.lowerBetter ? 'Lower is better' : undefined}>
                <Input type='number' step='any' value={coreValues[m.key] ?? ''} onChange={(e) => setCoreValues((cv) => ({ ...cv, [m.key]: e.target.value }))} placeholder='0' />
              </Field>
            ))}
          </div>
        )}
      </SectionCard>
      </DraggableSection>

      {/* GA Metrics — SEO only, editable name+value pairs with editable title */}
      {meta.gaMetrics && (
        <DraggableSection id='gaMetrics' onReorder={handleReorder} accent={accent} order={getSectionOrder('gaMetrics')}>
        <SectionCard title={gaMetricsTitle} subtitle='Google Analytics metrics — add your own fields below.' icon={Sparkles} accent={accent} className={`mb-6 ${sectionVisibility.gaMetrics === false ? 'opacity-50' : ''}`}
          actions={<><SectionToggle visible={sectionVisibility.gaMetrics} onChange={(v) => setSectionVisibility((s) => ({ ...s, gaMetrics: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={() => setGaMetrics((g) => [...g, { name: '', value: '' }])}><Plus className='w-3.5 h-3.5' /> Add metric</Button></>}>
          <div className='space-y-3'>
            {/* Editable title */}
            <Field label='Section title'><Input value={gaMetricsTitle} onChange={(e) => setGaMetricsTitle(e.target.value)} placeholder='GA Metrics' className='font-semibold' /></Field>
            {gaMetrics.length === 0 && <p className='text-sm text-slate-400 dark:text-slate-500'>No GA metrics yet. Add your own fields below.</p>}
            {gaMetrics.map((item, i) => (
              <div key={i} className='grid grid-cols-[1fr_140px_auto] gap-2'>
                <Input value={item.name || ''} onChange={(e) => setGaMetrics((g) => g.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder='Metric name (e.g. Sessions)' />
                <Input type='number' step='any' value={item.value ?? ''} onChange={(e) => setGaMetrics((g) => g.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder='Value' />
                <button onClick={() => setGaMetrics((g) => g.filter((_, j) => j !== i))} className='p-2 rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600'><Trash2 className='w-4 h-4' /></button>
              </div>
            ))}
          </div>
        </SectionCard>
        </DraggableSection>
      )}

      {/* Custom metrics */}
      <DraggableSection id='customMetrics' onReorder={handleReorder} accent={accent} order={getSectionOrder('customMetrics')}>
      <SectionCard title='Custom metrics' subtitle='Add one-off or recurring metrics unique to this client. Carry forward automatically.' icon={Tag} accent={accent}
        actions={<><SectionToggle visible={sectionVisibility.customMetrics} onChange={(v) => setSectionVisibility((s) => ({ ...s, customMetrics: v }))} accent={accent} /><CopyFromMonth report={report} accent={accent} what='Custom metrics' onCopy={(src) => {
          const next = copyCustomMetrics(src, meta);
          setCustom(next);
          const n = countRows(next);
          push(`${n} custom metric${n === 1 ? '' : 's'} copied from ${src.period_label}`, n ? 'success' : 'info');
        }} /><Button size='sm' variant='outline' onClick={() => addCustom(meta, custom, setCustom, activePlatform)}><Plus className='w-3.5 h-3.5' /> Add metric</Button></>} className={`mb-6 ${sectionVisibility.customMetrics === false ? 'opacity-50' : ''}`}>
        <CustomMetricsList meta={meta} custom={custom} setCustom={setCustom} activePlatform={activePlatform} />
      </SectionCard>
      </DraggableSection>

      {/* Breakdown */}
      <DraggableSection id='breakdown' onReorder={handleReorder} accent={accent} order={getSectionOrder('breakdown')}>
      <SectionCard title={meta.breakdown.label} subtitle={`Month-by-month counts by ${meta.breakdown.itemNoun}. Add new categories as your package evolves.`} icon={ListChecks} accent={accent}
        actions={<><SectionToggle visible={sectionVisibility.breakdown} onChange={(v) => setSectionVisibility((s) => ({ ...s, breakdown: v }))} accent={accent} /><CopyFromMonth report={report} accent={accent} what={meta.breakdown.label} onCopy={(src) => {
          const next = copyBreakdown(src, meta, 'primary');
          setBreakdown(next);
          const n = countRows(next);
          push(`${n} ${meta.breakdown.itemNoun}${n === 1 ? '' : 's'} copied from ${src.period_label}`, n ? 'success' : 'info');
        }} /><Button size='sm' variant='outline' onClick={() => addCategory(meta, breakdown, setBreakdown, activePlatform)}><Plus className='w-3.5 h-3.5' /> Add {meta.breakdown.itemNoun}</Button></>} className={`mb-6 ${sectionVisibility.breakdown === false ? 'opacity-50' : ''}`}>
        <BreakdownEditor meta={meta} breakdown={breakdown} setBreakdown={setBreakdown} activePlatform={activePlatform} />
      </SectionCard>
      </DraggableSection>

      {/* Backlink Activity — ORM (second breakdown, same as SEO) */}
      {meta.breakdown2 && (
        <DraggableSection id='backlinkActivity' onReorder={handleReorder} accent={accent} order={getSectionOrder('backlinkActivity')}>
        <SectionCard title={meta.breakdown2.label} subtitle={`Month-by-month counts by ${meta.breakdown2.itemNoun}. Add new categories as your package evolves.`} icon={ListChecks} accent={accent}
          actions={<><SectionToggle visible={sectionVisibility.backlinkActivity} onChange={(v) => setSectionVisibility((s) => ({ ...s, backlinkActivity: v }))} accent={accent} /><CopyFromMonth report={report} accent={accent} what={meta.breakdown2.label} onCopy={(src) => {
            const next = copyBreakdown(src, meta, 'backlink');
            setBacklinkBreakdown(next);
            const n = countRows(next);
            push(`${n} ${meta.breakdown2.itemNoun}${n === 1 ? '' : 's'} copied from ${src.period_label}`, n ? 'success' : 'info');
          }} /><Button size='sm' variant='outline' onClick={() => {
            if (!meta.hasPlatforms) setBacklinkBreakdown((b) => [...b, { name: '', value: '' }]);
          }}><Plus className='w-3.5 h-3.5' /> Add {meta.breakdown2.itemNoun}</Button></>} className={`mb-6 ${sectionVisibility.backlinkActivity === false ? 'opacity-50' : ''}`}>
          <BreakdownEditor meta={meta} breakdown={backlinkBreakdown} setBreakdown={setBacklinkBreakdown} activePlatform={activePlatform} />
        </SectionCard>
        </DraggableSection>
      )}

      {/* Keyword Ranking Tracker — SEO only */}
      {report.service === 'seo' && (
        <DraggableSection id='keywordRankings' onReorder={handleReorder} accent={accent} order={getSectionOrder('keywordRankings')}>
        <SectionCard title='Keyword Ranking Tracker' subtitle='Track keyword positions month-over-month. Copy a previous month to save time.' icon={Search} accent={accent} className={`mb-6 ${sectionVisibility.keywordRankings === false ? 'opacity-50' : ''}`}
          actions={<SectionToggle visible={sectionVisibility.keywordRankings} onChange={(v) => setSectionVisibility((s) => ({ ...s, keywordRankings: v }))} accent={accent} />}>
          <KeywordRankingEditor report={report} keywordRankings={keywordRankings} onChange={setKeywordRankings} accent={accent} canEdit={true} />
        </SectionCard>
        </DraggableSection>
      )}

      {/* Lists */}
      {(meta.lists || []).map((l) => (
        <DraggableSection key={l.key} id={'list_' + l.key} onReorder={handleReorder} accent={accent} order={getSectionOrder('list_' + l.key)}>
        <SectionCard title={l.label} subtitle='Detail entries shown to the client.' icon={ListChecks} accent={accent}
          actions={<><SectionToggle visible={sectionVisibility['list_' + l.key]} onChange={(v) => setSectionVisibility((s) => ({ ...s, ['list_' + l.key]: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={() => setLists((s) => ({ ...s, [l.key]: [...(s[l.key] || []), emptyRow(l)] }))}><Plus className='w-3.5 h-3.5' /> {l.addLabel}</Button></>} className={`mb-6 ${sectionVisibility['list_' + l.key] === false ? 'opacity-50' : ''}`}>
          <ListEditor listDef={l} rows={lists[l.key] || []} onChange={(rows) => setLists((s) => ({ ...s, [l.key]: rows }))} />
        </SectionCard>
        </DraggableSection>
      ))}

      {/* Keyword Status Tracker — ORM only */}
      {report.service === 'orm' && (
        <DraggableSection id='keywordStatus' onReorder={handleReorder} accent={accent} order={getSectionOrder('keywordStatus')}>
        <SectionCard title='Keyword Status Tracker' subtitle='Keyword positions across Page 1/2/3 of search results. Left = compare month, right = current month. Keywords auto-pulled from SEO reports.' icon={Columns} accent={accent} className={`mb-6 ${sectionVisibility.keywordStatus === false ? 'opacity-50' : ''}`}
          actions={<SectionToggle visible={sectionVisibility.keywordStatus} onChange={(v) => setSectionVisibility((s) => ({ ...s, keywordStatus: v }))} accent={accent} />}>
          <KeywordStatusTracker report={report} keywordStatus={keywordStatus} onChange={setKeywordStatus} accent={accent} canEdit={true} />
        </SectionCard>
        </DraggableSection>
      )}

      {/* Achievements */}
      <DraggableSection id='achievements' onReorder={handleReorder} accent={accent} order={getSectionOrder('achievements')}>
      <SectionCard title='Monthly achievements' subtitle='Plain-language wins shown alongside the numbers.' icon={Sparkles} accent={accent}
        actions={<><SectionToggle visible={sectionVisibility.achievements} onChange={(v) => setSectionVisibility((s) => ({ ...s, achievements: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={() => setAchievements((a) => [...a, ''])}><Plus className='w-3.5 h-3.5' /> Add achievement</Button></>} className={`mb-6 ${sectionVisibility.achievements === false ? 'opacity-50' : ''}`}>
        <div className='space-y-2'>
          {achievements.length === 0 && <p className='text-sm text-slate-400 dark:text-slate-500'>No achievements yet.</p>}
          {achievements.map((a, i) => (
            <div key={i} className='flex gap-2'>
              <Input value={a} onChange={(e) => setAchievements((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} placeholder='e.g. Secured 3 guest posts on DR-60+ sites' />
              <button onClick={() => setAchievements((arr) => arr.filter((_, j) => j !== i))} className='p-2 rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600'><Trash2 className='w-4 h-4' /></button>
            </div>
          ))}
        </div>
      </SectionCard>
      </DraggableSection>

      {/* Free-form sections — editable heading plus bullet points */}
      {NOTE_SECTIONS.map((s) => {
        const note = notes[s.id] || { title: s.fallback, points: [] };
        const points = note.points || [];
        const setNote = (patch) => setNotes((n) => ({ ...n, [s.id]: { ...n[s.id], ...patch } }));
        return (
          <DraggableSection key={s.id} id={s.id} onReorder={handleReorder} accent={accent} order={getSectionOrder(s.id)}>
          <SectionCard title={note.title || s.fallback} subtitle='Your own heading and bullet points, shown on the client report.' icon={ListChecks} accent={accent}
            actions={<><SectionToggle visible={sectionVisibility[s.id]} onChange={(v) => setSectionVisibility((prev) => ({ ...prev, [s.id]: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={() => setNote({ points: [...points, ''] })}><Plus className='w-3.5 h-3.5' /> Add point</Button></>} className={`mb-6 ${sectionVisibility[s.id] === false ? 'opacity-50' : ''}`}>
            <div className='space-y-3'>
              <Field label='Section title'>
                <Input value={note.title} onChange={(e) => setNote({ title: e.target.value })} placeholder={s.fallback} className='font-semibold' />
              </Field>
              {points.length === 0 && <p className='text-sm text-slate-400 dark:text-slate-500'>No points yet. Add what you want the client to read here.</p>}
              {points.map((point, i) => (
                <div key={i} className='flex gap-2'>
                  <Input value={point} onChange={(e) => setNote({ points: points.map((x, j) => (j === i ? e.target.value : x)) })} placeholder='e.g. Recommend continuing the current content cadence' />
                  <button onClick={() => setNote({ points: points.filter((_, j) => j !== i) })} className='p-2 rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600'><Trash2 className='w-4 h-4' /></button>
                </div>
              ))}
            </div>
          </SectionCard>
          </DraggableSection>
        );
      })}

      {/* Additional Inputs — chart notes pinned to this period */}
      <DraggableSection id='annotations' onReorder={handleReorder} accent={accent} order={getSectionOrder('annotations')}>
      <SectionCard title='Additional Inputs' subtitle='Notes pinned to this period on the client dashboard trend charts.' icon={MessageSquarePlus} accent={accent}
        actions={<><SectionToggle visible={sectionVisibility.annotations} onChange={(v) => setSectionVisibility((s) => ({ ...s, annotations: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={async () => {
          if (!annInput.trim()) return;
          try { const a = await post('/api/annotations', { client_id: report.client_id, service: report.service, period_start: report.period_start, note: annInput.trim() }); setAnnotations((arr) => [...arr, a]); setAnnInput(''); push('Input added', 'success'); }
          catch (e) { push(e.message, 'error'); }
        }}><Plus className='w-3.5 h-3.5' /> Add note</Button></>} className={`mb-6 ${sectionVisibility.annotations === false ? 'opacity-50' : ''}`}>
        <div className='space-y-2'>
          <Input value={annInput} onChange={(e) => setAnnInput(e.target.value)} placeholder='e.g. Launched new website · Google algorithm update' />
          {annotations.filter(a => a.period_start === report.period_start).length === 0 ? (
            <p className='text-sm text-slate-400'>No additional inputs for this period yet. Add one to explain spikes or dips on the client dashboard.</p>
          ) : (
            annotations.filter(a => a.period_start === report.period_start).map((a) => (
              <div key={a.id} className='flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2'>
                <span className='text-sm text-slate-700 flex items-center gap-2'><span className='w-2 h-2 rounded-full bg-amber-500' /> {a.note}</span>
                <button onClick={async () => { try { await del('/api/annotations', { id: a.id }); setAnnotations((arr) => arr.filter((x) => x.id !== a.id)); push('Annotation removed', 'success'); } catch (e) { push(e.message, 'error'); } }} className='p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600'><Trash2 className='w-3.5 h-3.5' /></button>
              </div>
            ))
          )}
        </div>
      </SectionCard>
      </DraggableSection>
      </div>{/* end flex container */}

      {/* Actions */}
      <div className='sticky bottom-0 bg-white/90 dark:bg-slate-800/90 backdrop-blur border-t border-slate-200 dark:border-slate-700 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2'>
        <div className='flex gap-2'>
          {isDraft ? (
            <>
              <Button variant='outline' disabled={saving} onClick={() => doSave('save')}><SaveIcon className='w-4 h-4' /> Save draft</Button>
              <Button accent={accent} variant='accent' disabled={saving} onClick={() => doSave('publish')}><Send className='w-4 h-4' /> Publish & notify</Button>
            </>
          ) : (
            <>
              <Button accent={accent} variant='accent' disabled={saving} onClick={() => setReviseOpen(true)}><Send className='w-4 h-4' /> Publish revision</Button>
              <Button variant='outline' disabled={saving} onClick={() => doSave('revert-to-draft')}><Undo2 className='w-4 h-4' /> Revert to draft</Button>
            </>
          )}
        </div>
        {isDraft && !report.delete_requested && (
          <button onClick={() => setConfirmDelete(true)} className='text-sm text-rose-600 font-semibold hover:underline inline-flex items-center gap-1'>
            <Trash2 className='w-4 h-4' /> {isSuperAdmin ? 'Delete draft' : 'Request deletion'}
          </button>
        )}
        {isDraft && report.delete_requested && (
          <span className='text-sm font-semibold text-amber-600 dark:text-amber-500 inline-flex items-center gap-1'>
            <AlertTriangle className='w-4 h-4' /> Deletion requested — awaiting super admin review
          </span>
        )}
      </div>

      <Modal open={reviseOpen} onClose={() => setReviseOpen(false)} title='Publish a correction'
        footer={<><Button variant='outline' onClick={() => setReviseOpen(false)}>Cancel</Button><Button accent={accent} variant='accent' disabled={saving} onClick={() => { doSave('revise', reviseNote); setReviseOpen(false); }}>Publish revision</Button></>}>
        <div className='space-y-3'>
          <div className='flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800'><AlertTriangle className='w-4 h-4 mt-0.5 shrink-0' /> The current published version is snapshotted to the audit history (v{report.version}). The client is notified of the update.</div>
          <Field label='Correction note (optional)'><Input value={reviseNote} onChange={(e) => setReviseNote(e.target.value)} placeholder='e.g. Corrected backlink count' /></Field>
        </div>
      </Modal>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)}
        title={isSuperAdmin ? 'Delete this draft?' : 'Request deletion?'}
        message={isSuperAdmin
          ? 'The draft and all entered data will be permanently removed.'
          : 'This flags the draft for a super admin to review. The draft and its data stay in place until they action the request.'}
        confirmText={isSuperAdmin ? 'Delete' : 'Request deletion'} danger
        onConfirm={async () => {
          try {
            await del('/api/reports', { id: report.id });
            push(isSuperAdmin ? 'Draft deleted' : 'Deletion requested — super admin will review', 'success');
            nav(`/app/clients/${report.client_id}`);
          } catch (e) { push(e.message, 'error'); }
        }} />
    </div>
  );
}

function emptyRow(listDef) {
  const row = {};
  listDef.columns.forEach((c) => (row[c.key] = c.type === 'number' ? '' : ''));
  return row;
}
function addCustom(meta, custom, setCustom, activePlatform) {
  if (!meta.hasPlatforms) setCustom((c) => [...c, { name: '', value: '' }]);
  else setCustom((c) => ({ ...c, [activePlatform]: [...(c[activePlatform] || []), { name: '', value: '' }] }));
}
function addCategory(meta, breakdown, setBreakdown, activePlatform) {
  if (!meta.hasPlatforms) setBreakdown((b) => [...b, { name: '', value: '' }]);
  else setBreakdown((b) => ({ ...b, [activePlatform]: [...(b[activePlatform] || []), { name: '', value: '' }] }));
}

// --- copy-from-previous-month -------------------------------------------------
// These rebuild a section's editor state from a previously saved report. They
// replace rather than merge: the point is to re-baseline on an earlier month.

// Any metric key that is not one of the service's core metrics.
function copyCustomMetrics(src, meta) {
  const core = meta.coreMetrics.map((m) => m.key);
  const pick = (bag) => Object.entries(bag || {})
    .filter(([k]) => !core.includes(k))
    .map(([name, value]) => ({ name, value: value ?? '' }));

  if (!meta.hasPlatforms) return pick(src.metrics);
  const out = {};
  meta.platforms.forEach((p) => { out[p.key] = pick(src.metrics?.[p.key]); });
  return out;
}

// `target` is 'primary' (the section's main breakdown) or 'backlink' (ORM's
// second breakdown). buildPayload merges both into a single flat `breakdowns`
// object, so they have to be split apart again on the way back in — mirroring
// the split done in the load effect above.
function copyBreakdown(src, meta, target) {
  const entries = Object.entries(src.breakdowns || {});
  const toRows = (list) => list.map(([name, value]) => ({ name, value: value ?? '' }));

  if (meta.hasPlatforms) {
    const out = {};
    meta.platforms.forEach((p) => { out[p.key] = toRows(Object.entries(src.breakdowns?.[p.key] || {})); });
    return out;
  }

  if (meta.breakdown2) {
    const backlinkDefaults = meta.breakdown2.defaults;
    const reviewDefaults = meta.breakdown.defaults;
    if (target === 'backlink') {
      return toRows(entries.filter(([name]) => backlinkDefaults.includes(name) || (!reviewDefaults.includes(name) && name)));
    }
    return toRows(entries.filter(([name]) => !backlinkDefaults.includes(name)));
  }

  return toRows(entries);
}

// Rows copied, for the confirmation toast. Handles both the flat array shape
// and the per-platform object shape.
function countRows(value) {
  if (Array.isArray(value)) return value.length;
  return Object.values(value || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
}
function seedDefaults(br, meta) {
  const defs = meta.breakdown.defaults;
  if (!meta.hasPlatforms) {
    const names = new Set(br.map((b) => b.name));
    defs.forEach((d) => { if (!names.has(d)) br.push({ name: d, value: '' }); });
    return br;
  }
  meta.platforms.forEach((p) => {
    const arr = br[p.key] || (br[p.key] = []);
    const names = new Set(arr.map((b) => b.name));
    defs.forEach((d) => { if (!names.has(d)) arr.push({ name: d, value: '' }); });
  });
  return br;
}
function applyStructureMetrics(st, meta, raw) {
  if (meta.hasPlatforms) {
    const out = { ...raw };
    (st.platforms || []).forEach((p) => {
      out[p] = { ...(out[p] || {}) };
      (st.platformMetricKeys?.[p] || []).forEach((k) => { if (!(k in out[p]) && !meta.coreMetrics.some((m) => m.key === k)) out[p][k] = ''; });
    });
    return out;
  }
  const out = { ...raw };
  (st.metricKeys || []).forEach((k) => { if (!(k in out) && !meta.coreMetrics.some((m) => m.key === k)) out[k] = ''; });
  return out;
}
function applyStructureBreakdown(st, meta, raw) {
  if (meta.hasPlatforms) {
    const out = { ...raw };
    meta.platforms.forEach((p) => {
      out[p] = { ...(out[p] || {}) };
      (st.platformBreakdownCategories?.[p] || []).forEach((c) => { if (!(c in out[p])) out[p][c] = ''; });
    });
    return out;
  }
  const out = { ...raw };
  (st.breakdownCategories || []).forEach((c) => { if (!(c in out)) out[c] = ''; });
  return out;
}

function CustomMetricsList({ meta, custom, setCustom, activePlatform }) {
  const rows = meta.hasPlatforms ? (custom[activePlatform] || []) : custom;
  if (rows.length === 0) return <p className='text-sm text-slate-400 dark:text-slate-500'>No custom metrics. Add one if this client's package needs a field beyond the core set.</p>;
  const update = (i, field, val) => {
    if (meta.hasPlatforms) setCustom((c) => ({ ...c, [activePlatform]: c[activePlatform].map((r, j) => (j === i ? { ...r, [field]: val } : r)) }));
    else setCustom((c) => c.map((r, j) => (j === i ? { ...r, [field]: val } : r)));
  };
  const remove = (i) => {
    if (meta.hasPlatforms) setCustom((c) => ({ ...c, [activePlatform]: c[activePlatform].filter((_, j) => j !== i) }));
    else setCustom((c) => c.filter((_, j) => j !== i));
  };
  return (
    <div className='space-y-2'>
      {rows.map((r, i) => (
        <div key={i} className='grid grid-cols-[1fr_140px_auto] gap-2'>
          <Input value={r.name} onChange={(e) => update(i, 'name', e.target.value)} placeholder='Metric name (e.g. Local citations)' />
          <Input type='number' step='any' value={r.value} onChange={(e) => update(i, 'value', e.target.value)} placeholder='Value' />
          <button onClick={() => remove(i)} className='p-2 rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600'><Trash2 className='w-4 h-4' /></button>
        </div>
      ))}
    </div>
  );
}

function BreakdownEditor({ meta, breakdown, setBreakdown, activePlatform }) {
  const rows = meta.hasPlatforms ? (breakdown[activePlatform] || []) : breakdown;
  const update = (i, field, val) => {
    if (meta.hasPlatforms) setBreakdown((b) => ({ ...b, [activePlatform]: b[activePlatform].map((r, j) => (j === i ? { ...r, [field]: val } : r)) }));
    else setBreakdown((b) => b.map((r, j) => (j === i ? { ...r, [field]: val } : r)));
  };
  const remove = (i) => {
    if (meta.hasPlatforms) setBreakdown((b) => ({ ...b, [activePlatform]: b[activePlatform].filter((_, j) => j !== i) }));
    else setBreakdown((b) => b.filter((_, j) => j !== i));
  };
  return (
    <div className='space-y-2'>
      {rows.map((r, i) => (
        <div key={i} className='grid grid-cols-[1fr_140px_auto] gap-2'>
          <Input value={r.name} onChange={(e) => update(i, 'name', e.target.value)} placeholder={`${meta.breakdown.itemNoun} name`} />
          <Input type='number' step='any' value={r.value} onChange={(e) => update(i, 'value', e.target.value)} placeholder='Count' />
          <button onClick={() => remove(i)} className='p-2 rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600'><Trash2 className='w-4 h-4' /></button>
        </div>
      ))}
    </div>
  );
}

function ListEditor({ listDef, rows, onChange }) {
  const update = (i, field, val) => onChange(rows.map((r, j) => (j === i ? { ...r, [field]: val } : r)));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));
  if (rows.length === 0) return <p className='text-sm text-slate-400 dark:text-slate-500'>No entries yet. Click “{listDef.addLabel}” to add one.</p>;
  return (
    <div className='space-y-2'>
      {rows.map((r, i) => (
        <div key={i} className='rounded-xl border border-slate-200 p-3'>
          <div className='flex justify-end mb-1'>
            <button onClick={() => remove(i)} className='text-slate-400 hover:text-rose-600 p-1 -m-1'><Trash2 className='w-4 h-4' /></button>
          </div>
          <div className='grid grid-cols-2 sm:grid-cols-3 gap-2'>
            {listDef.columns.map((c) => (
              <Field key={c.key} label={c.label} className={c.key === 'snippet' || c.key === 'caption' || c.key === 'url' || c.key === 'anchor_text' ? 'col-span-2 sm:col-span-3' : ''}>
                {c.type === 'select' ? (
                  <Select value={r[c.key] || ''} onChange={(e) => update(i, c.key, e.target.value)}>{c.options.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
                ) : c.type === 'date' ? (
                  <Input type='date' value={r[c.key] || ''} onChange={(e) => update(i, c.key, e.target.value)} />
                ) : (
                  <Input type={c.type === 'number' ? 'number' : 'text'} value={r[c.key] ?? ''} onChange={(e) => update(i, c.key, e.target.value)} placeholder={c.placeholder || ''} />
                )}
              </Field>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
