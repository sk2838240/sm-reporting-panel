import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, useBlocker } from 'react-router-dom';
import { Plus, Trash2, Send, Undo2, Sparkles, Tag, ListChecks, Save as SaveIcon, AlertTriangle, MessageSquarePlus, Search, Columns, CheckSquare } from 'lucide-react';
import { get, put, del, post } from '../lib/api';
import { BackButton, Badge, Button, ConfirmDialog, Field, FullLoader, IconButton, InlineEmpty, Input, Modal, SegmentedControl, SectionCard, Select, useToast } from '../components/ui';
import { KeywordRankingEditor } from '../components/KeywordRanking';
import { KeywordStatusTracker } from '../components/KeywordStatus';
import { SectionToggle } from '../components/SectionToggle';
import { DraggableSection } from '../components/DraggableSection';
import { CopyFromMonth } from '../components/CopyFromMonth';
import { ServiceIcon } from '../lib/service-icons';
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
  const [confirmRevert, setConfirmRevert] = useState(false);
  // Publishing is the one irreversible, client-visible action: it writes the
  // whole in-editor payload and emails the client. Revise, revert and delete are
  // all confirmed; this was a bare button next to them.
  const [confirmPublish, setConfirmPublish] = useState(false);
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

  // Unsaved-changes guard. The editor holds ~15 independent state slices; a
  // back-swipe, browser Back, or a closed laptop discarded all of them silently.
  // A beforeunload handler cannot break in-app navigation, so it is used instead
  // of a router blocker (which would also have to handle publish/revert, which
  // legitimately discard the draft). The baseline is state, not a ref — reading
  // a ref during render does not re-render when it changes, so the "Unsaved
  // changes" badge and the dialog would silently stop tracking edits.
  const [savedSnapshot, setSavedSnapshot] = useState('');
  // Flipped at the end of the load effect; the effect below turns that into the
  // baseline once every slice has been seeded and currentDraft is non-empty.
  const [formReady, setFormReady] = useState(false);
  const currentDraft = useMemo(
    () => JSON.stringify([
      coreValues, custom, breakdown, backlinkBreakdown, lists, achievements,
      keywordRankings, keywordStatus, sectionVisibility, workDone, sectionOrder,
      gaMetrics, gaMetricsTitle, notes,
    ]),
    [coreValues, custom, breakdown, backlinkBreakdown, lists, achievements,
     keywordRankings, keywordStatus, sectionVisibility, workDone, sectionOrder,
     gaMetrics, gaMetricsTitle, notes]
  );
  // Not dirty until a baseline exists, otherwise the empty initial form reads
  // as "unsaved" before the report has loaded.
  const dirty = !!report && !!savedSnapshot && currentDraft !== savedSnapshot;

  // beforeunload covers closing the tab and reloading. It does NOT fire for
  // in-app navigation, so useBlocker intercepts every router navigation —
  // including the browser's own Back button, which onBeforeNavigate on the
  // in-app BackButton cannot see. App.jsx uses createBrowserRouter because
  // useBlocker throws without a data router.
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Only block LEAVING. A bare `useBlocker(dirty)` also fires on a search-param
  // change, and the platform tab bar does `setSearchParams` with a PUSH — so
  // typing in a Social draft and then clicking "Facebook" raised a bogus
  // "Leave without saving? Nothing is discarded, you never left the page" dialog
  // with no way to save and continue.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    dirty && currentLocation.pathname !== nextLocation.pathname
  ));
  useEffect(() => {
    if (blocker.state === 'blocked') setConfirmLeave(true);
  }, [blocker.state]);

  useEffect(() => {
    if (!report || !currentDraft) return;
    const handler = (e) => {
      if (currentDraft === savedSnapshot) return;
      e.preventDefault();
      // Chrome ignores the string; setting returnValue is what triggers the
      // browser's own "Leave site?" prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [report, currentDraft, savedSnapshot]);

  const markSaved = () => setSavedSnapshot(currentDraft);

  // Take the baseline once the form has been seeded. Until then `dirty` stays
  // false, so the pre-load empty form never reads as "unsaved changes".
  useEffect(() => {
    if (!formReady || !currentDraft) return;
    setSavedSnapshot(currentDraft);
    setFormReady(false);
  }, [formReady, currentDraft]);

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
        // Three call sites below need the same carry-forward structure, so the
        // request is memoised on this report rather than issued once per use.
        // A failure resolves to null so every branch degrades independently.
        let stCache = null;
        const loadStructure = () => {
          if (!stCache) {
            // Single segment on purpose. Vercel's `/api/:route` rewrite matches ONE
        // path segment, so the old two-segment `/api/reports/structure` fell
        // through to the SPA catch-all, came back 200 + HTML, and was swallowed
        // by the .catch below — leaving this feature silently dead on every
        // draft. The handler is registered as 'reports-structure'.
        stCache = get(`/api/reports-structure?clientId=${rep.client_id}&service=${rep.service}`)
          .catch((e) => { console.warn('[reports-structure] carry-forward unavailable:', e?.message || e); return null; });
          }
          return stCache;
        };
        if (rep.status === 'draft' && isEmpty) {
          const st = await loadStructure();
          if (st) {
            mRaw = applyStructureMetrics(st, meta, mRaw);
            bRaw = applyStructureBreakdown(st, meta, bRaw);
          }
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
          // The two buckets must be disjoint. A category in neither default list
          // used to satisfy `!reviewDefaults.includes(...)` and land in BOTH, so
          // it rendered twice and the empty backlink copy overwrote the typed
          // review value in buildPayload — the number was silently lost on save.
          // Ownership rule: a category belongs to the backlink section only if
          // it is one of its seeded defaults; everything else is a review row.
          const bkBr = br.filter((b) => bkDefaults.includes(b.name));
          br = br.filter((b) => !bkDefaults.includes(b.name));
          setBreakdown(br);
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
          const st = await loadStructure();
          if (st?.brandKeywords?.length && (!rep.lists?.brand_keywords || rep.lists.brand_keywords.length === 0)) {
            initLists.brand_keywords = st.brandKeywords.map((k) => ({ keyword: k.keyword, position: '', asset: '' }));
          }
        }
        setLists(initLists);
        setAchievements(rep.achievements || []);
        // Initialize keyword rankings from report data or carry forward from structure
        let krInit = rep.lists?.keyword_rankings || [];
        if (rep.status === 'draft' && krInit.length === 0 && !meta.hasPlatforms) {
          const st = await loadStructure();
          if (st?.rankingKeywords?.length) {
            krInit = st.rankingKeywords.map(k => ({ keyword: k.keyword, position: '' }));
          }
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
        // Everything is now seeded. The setState calls above batch into one
        // render, so currentDraft is still empty here — signal the effect below
        // to take the baseline once the seeded values exist.
        setFormReady(true);
      } catch (e) { push(e.message, 'error'); }
      setLoading(false);
    })();
    // Loads once per report id. activePlatform/push/setSearchParams are read as
    // the mount-time values on purpose — re-running this would refetch the whole
    // report and discard the admin's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const meta = report ? SERVICE_META[report.service] : null;

  // Extracted so the Add button and the Enter key in the input share it, and so
  // an empty submit reports why instead of doing nothing.
  const addAnnotation = async () => {
    if (!annInput.trim()) { push('Type a note first', 'error'); return; }
    try {
      const a = await post('/api/annotations', {
        client_id: report.client_id, service: report.service,
        period_start: report.period_start, note: annInput.trim(),
      });
      setAnnotations((arr) => [...arr, a]);
      setAnnInput('');
      push('Input added', 'success');
    } catch (e) { push(e.message, 'error'); }
  };

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
      // Backlink rows first, review rows second: breakdowns is a flat
      // name->value map, so on any name collision the review value is the one
      // that should win. The two sections are kept disjoint when loading, so
      // this is only a guard against a hand-edited or legacy report.
      // Seeded-but-untouched default rows are skipped: writing them stored an
      // explicit null for every category on every save.
      const put = (b) => { if (b.name && b.value !== '' && b.value !== null && b.value !== undefined) breakdowns[b.name] = b.value; };
      if (meta.breakdown2) backlinkBreakdown.forEach(put);
      breakdown.forEach(put);
    } else {
      breakdowns = {};
      meta.platforms.forEach((p) => {
        breakdowns[p.key] = {};
        (breakdown[p.key] || []).forEach((b) => {
          if (b.name && b.value !== '' && b.value !== null && b.value !== undefined) breakdowns[p.key][b.name] = b.value;
        });
      });
    }
    return { metrics: cleanObj(metrics), breakdowns: cleanObj(breakdowns), lists: { ...lists, keyword_rankings: keywordRankings, keyword_status: keywordStatus, work_done: workDone, ga_metrics: gaMetrics, ga_metrics_title: gaMetricsTitle, ...notesToPayload(notes), _section_visibility: sectionVisibility, _section_order: sectionOrder }, achievements };
  };

  const doSave = async (action, note) => {
    setSaving(true);
    try {
      // Unpublishing is a status change, not a content save. Spreading the full
      // payload here overwrote the client's LIVE report with whatever happened
      // to be in the editor — losing the published figures for a month. The
      // server also honours an explicit patch on revert, so any deliberate
      // edit-and-unpublish still goes through Save draft first.
      const body = action === 'revert-to-draft'
        ? { id: report.id, action }
        : { id: report.id, action, note, ...buildPayload() };
      await put('/api/reports', body);
      // Clear `dirty` before navigating. This MUST happen for publish/revise/
      // revert: they all call nav(), and leaving `dirty` true made useBlocker
      // intercept the navigation and pop a second, contradictory "Leave without
      // saving?" dialog immediately after a successful publish.
      // For revert the on-screen edits are genuinely discarded — the confirm
      // dialog above already says so explicitly — so clearing the flag is the
      // honest description of what just happened.
      markSaved();
      const msg = action === 'publish' ? 'Published — client notified'
        : action === 'revise' ? 'Revision published'
        : action === 'revert-to-draft' ? 'Reverted to draft'
        : 'Draft saved';
      push(msg, 'success');
      if (action === 'publish' || action === 'revise' || action === 'revert-to-draft') nav(`/app/clients/${report.client_id}`);
      else { const fresh = await get(`/api/reports?single=1&id=${report.id}`); setReport(fresh); }
    } catch (e) { push(e.message, 'error'); }
    setSaving(false);
  };

  // Destructured so the dependency is honest: the body only reads the service,
  // and depending on the whole `report` object would invalidate this memo (and
  // activeOrder, which depends on it) after every save and refetch.
  const reportService = report?.service;
  // Default section order based on service. Memoised because activeOrder merges
  // against it, and a fresh array each render would invalidate that memo.
  // Declared above the early returns: hooks cannot be called conditionally.
  const defaultSections = useMemo(() => {
    if (!reportService) return [];
    if (reportService === 'seo') {
      return ['workDone', 'coreMetrics', 'gaMetrics', 'list_ga_top_pages', 'list_ga_demographics', 'customMetrics', 'breakdown', 'keywordRankings', 'list_backlinks', 'list_published_pages', 'achievements', 'notes', 'notes2', 'notes3', 'notes4', 'notes5', 'annotations'];
    }
    if (reportService === 'orm') {
      return ['coreMetrics', 'customMetrics', 'breakdown', 'backlinkActivity', 'list_brand_keywords', 'list_reviews', 'list_backlinks', 'keywordStatus', 'achievements', 'notes', 'notes2', 'notes3', 'notes4', 'notes5', 'annotations'];
    }
    return ['coreMetrics', 'customMetrics', 'breakdown', 'list_top_posts', 'achievements', 'notes', 'notes2', 'notes3', 'notes4', 'notes5', 'annotations'];
  }, [reportService]);

  // A report saved before a section existed (the GA4 tables, a new note block)
  // has a partial _section_order. Those ids were absent from the array, so they
  // rendered last via the 999 fallback and could never be dragged anywhere.
  // Merge them back in behind the stored order before using it.
  const activeOrder = useMemo(() => {
    if (!sectionOrder.length) return defaultSections;
    const known = new Set(sectionOrder);
    return [...sectionOrder, ...defaultSections.filter((id) => !known.has(id))];
  }, [sectionOrder, defaultSections]);

  if (loading) return <FullLoader label='Loading editor...' />;
  if (!report || !meta) return <div className='text-center py-20 text-slate-500'>Report not found.</div>;
  const isDraft = report.status === 'draft';
  const accent = meta.accent;

  const getSectionOrder = (id) => {
    const idx = activeOrder.indexOf(id);
    return idx === -1 ? 999 : idx;
  };

  // toId '@prev' / '@next' come from the keyboard handler on the drag handle and
  // move a section one slot; a concrete id comes from a drag-and-drop.
  // All three insertAt values are indices into the array AFTER the removal
  // (fromIdx's element has already been spliced out), so no second adjustment.
  const handleReorder = (fromId, toId) => {
    const newOrder = [...activeOrder];
    const fromIdx = newOrder.indexOf(fromId);
    if (fromIdx === -1) return;
    let insertAt;
    if (toId === '@prev' || toId === '@next') {
      insertAt = toId === '@prev' ? fromIdx - 1 : fromIdx + 1;
      if (insertAt < 0 || insertAt >= newOrder.length) return; // already at that end
    } else {
      insertAt = newOrder.indexOf(toId);
      if (insertAt === -1) return;
    }
    newOrder.splice(fromIdx, 1);
    newOrder.splice(insertAt, 0, fromId);
    setSectionOrder(newOrder);
    push('Section order updated — save to persist', 'info');
  };

  return (
    <div className='max-w-4xl mx-auto'>
      <BackButton to={`/app/clients/${report.client_id}`} label={`Back to ${client?.company_name || 'client'}`} className='mb-4' />
      <div className='flex flex-wrap items-center justify-between gap-3 mb-6'>
        <div>
          <div className='flex items-center gap-2'>
            <span className='inline-flex h-8 w-8 items-center justify-center rounded-lg' style={{ background: accent + '1a', color: accent }}><ServiceIcon name={meta.icon} className='w-4.5 h-4.5' /></span>
            <h1 className='text-xl font-bold text-slate-900 dark:text-slate-100'>{meta.label} · {report.period_label}</h1>
          </div>
          <p className='text-sm text-slate-500 dark:text-slate-400 mt-1'>{client?.company_name} · {report.period_type === 'cycle' ? 'Billing cycle' : 'Calendar month'}</p>
        </div>
        <div className='flex items-center gap-2'>
          {isDraft ? <Badge color='amber'>Draft</Badge> : <Badge color='emerald'>Published v{report.version}</Badge>}
          {report.version > 1 && <Badge color='sky'>updated</Badge>}
          {dirty && <span className='inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400' title='You have edits that are not saved yet. Leaving this page or closing the tab will prompt you.'><span className='w-1.5 h-1.5 rounded-full bg-amber-500' /> Unsaved changes</span>}
        </div>
      </div>

      {/* All sections in a flex container — CSS order controls position */}
      <div className='flex flex-col gap-0'>
      {/* Work Done — SEO only */}
      {report.service === 'seo' && (
        <DraggableSection id='workDone' label='Work Done' onReorder={handleReorder} accent={accent} order={getSectionOrder('workDone')}>
        <SectionCard title='Work Done' subtitle='Tasks completed this month. Tick the checkbox when done.' icon={CheckSquare} accent={accent}
          actions={<><SectionToggle visible={sectionVisibility.workDone} onChange={(v) => setSectionVisibility((s) => ({ ...s, workDone: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={() => setWorkDone((w) => [...w, { text: '', done: false }])}><Plus className='w-3.5 h-3.5' /> Add task</Button></>} className={`mb-6 ${sectionVisibility.workDone === false ? 'opacity-50' : ''}`}>
          <div className='space-y-2'>
            {workDone.length === 0 && <InlineEmpty>No tasks yet. Add what was done this month.</InlineEmpty>}
            {workDone.map((item, i) => (
              <div key={i} className='flex items-center gap-2'>
                <Input value={item.text || ''} onChange={(e) => setWorkDone((w) => w.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder='e.g. Published 3 blog articles on DR-50+ sites' />
                <input type='checkbox' checked={item.done || false} onChange={(e) => setWorkDone((w) => w.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} className='w-5 h-5 rounded-md accent-emerald-600 shrink-0 cursor-pointer' title='Mark as done' />
                <IconButton label='Delete task' tone='danger' onClick={() => setWorkDone((w) => w.filter((_, j) => j !== i))}>
                <Trash2 className='w-4 h-4' />
              </IconButton>
              </div>
            ))}
          </div>
        </SectionCard>
        </DraggableSection>
      )}

      {/* Core metrics */}
      <DraggableSection id='coreMetrics' label='Core metrics' onReorder={handleReorder} accent={accent} order={getSectionOrder('coreMetrics')}>
      <SectionCard title='Core metrics' subtitle='Fixed fields for clean, comparable charts.' icon={Sparkles} accent={accent} className={`mb-6 ${sectionVisibility.coreMetrics === false ? 'opacity-50' : ''}`}
        actions={<SectionToggle visible={sectionVisibility.coreMetrics} onChange={(v) => setSectionVisibility((s) => ({ ...s, coreMetrics: v }))} accent={accent} />}>
        {meta.hasPlatforms ? (
          <div>
            <div className='mb-4 overflow-x-auto'>
              <SegmentedControl
                ariaLabel='Platform'
                value={activePlatform}
                onChange={(k) => setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('platform', k); return n; })}
                options={meta.platforms.map((p) => ({ key: p.key, label: p.label, accent: p.color, accentText: p.colorText }))}
              />
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
        <DraggableSection id='gaMetrics' label='GA metrics' onReorder={handleReorder} accent={accent} order={getSectionOrder('gaMetrics')}>
        <SectionCard title={gaMetricsTitle} subtitle='Google Analytics metrics — add your own fields below.' icon={Sparkles} accent={accent} className={`mb-6 ${sectionVisibility.gaMetrics === false ? 'opacity-50' : ''}`}
          actions={<><SectionToggle visible={sectionVisibility.gaMetrics} onChange={(v) => setSectionVisibility((s) => ({ ...s, gaMetrics: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={() => setGaMetrics((g) => [...g, { name: '', value: '' }])}><Plus className='w-3.5 h-3.5' /> Add metric</Button></>}>
          <div className='space-y-3'>
            {/* Editable title */}
            <Field label='Section title'><Input value={gaMetricsTitle} onChange={(e) => setGaMetricsTitle(e.target.value)} placeholder='GA Metrics' className='font-semibold' /></Field>
            {gaMetrics.length === 0 && <InlineEmpty>No GA metrics yet. Add your own fields below.</InlineEmpty>}
            {gaMetrics.map((item, i) => (
              <div key={i} className='grid grid-cols-[1fr_140px_auto] gap-2'>
                <Input value={item.name || ''} onChange={(e) => setGaMetrics((g) => g.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder='Metric name (e.g. Sessions)' />
                <Input type='number' step='any' value={item.value ?? ''} onChange={(e) => setGaMetrics((g) => g.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder='Value' />
                <IconButton label='Delete GA metric' tone='danger' onClick={() => setGaMetrics((g) => g.filter((_, j) => j !== i))}>
                <Trash2 className='w-4 h-4' />
              </IconButton>
              </div>
            ))}
          </div>
        </SectionCard>
        </DraggableSection>
      )}

      {/* Custom metrics */}
      <DraggableSection id='customMetrics' label='Custom metrics' onReorder={handleReorder} accent={accent} order={getSectionOrder('customMetrics')}>
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
      <DraggableSection id='breakdown' label='Breakdown' onReorder={handleReorder} accent={accent} order={getSectionOrder('breakdown')}>
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
        <DraggableSection id='backlinkActivity' label='Backlink activity' onReorder={handleReorder} accent={accent} order={getSectionOrder('backlinkActivity')}>
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
        <DraggableSection id='keywordRankings' label='Keyword ranking tracker' onReorder={handleReorder} accent={accent} order={getSectionOrder('keywordRankings')}>
        <SectionCard title='Keyword Ranking Tracker' subtitle='Track keyword positions month-over-month. Copy a previous month to save time.' icon={Search} accent={accent} className={`mb-6 ${sectionVisibility.keywordRankings === false ? 'opacity-50' : ''}`}
          actions={<SectionToggle visible={sectionVisibility.keywordRankings} onChange={(v) => setSectionVisibility((s) => ({ ...s, keywordRankings: v }))} accent={accent} />}>
          <KeywordRankingEditor report={report} keywordRankings={keywordRankings} onChange={setKeywordRankings} accent={accent} canEdit={true} />
        </SectionCard>
        </DraggableSection>
      )}

      {/* Lists */}
      {(meta.lists || []).map((l) => (
        <DraggableSection key={l.key} id={'list_' + l.key} label={l.label} onReorder={handleReorder} accent={accent} order={getSectionOrder('list_' + l.key)}>
        <SectionCard title={l.label} subtitle='Detail entries shown to the client.' icon={ListChecks} accent={accent}
          actions={<><SectionToggle visible={sectionVisibility['list_' + l.key]} onChange={(v) => setSectionVisibility((s) => ({ ...s, ['list_' + l.key]: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={() => setLists((s) => ({ ...s, [l.key]: [...(s[l.key] || []), emptyRow(l)] }))}><Plus className='w-3.5 h-3.5' /> {l.addLabel}</Button></>} className={`mb-6 ${sectionVisibility['list_' + l.key] === false ? 'opacity-50' : ''}`}>
          <ListEditor listDef={l} rows={lists[l.key] || []} onChange={(rows) => setLists((s) => ({ ...s, [l.key]: rows }))} />
        </SectionCard>
        </DraggableSection>
      ))}

      {/* Keyword Status Tracker — ORM only */}
      {report.service === 'orm' && (
        <DraggableSection id='keywordStatus' label='Keyword status tracker' onReorder={handleReorder} accent={accent} order={getSectionOrder('keywordStatus')}>
        <SectionCard title='Keyword Status Tracker' subtitle='Keyword positions across Page 1/2/3 of search results. Left = compare month, right = current month. Keywords auto-pulled from SEO reports.' icon={Columns} accent={accent} className={`mb-6 ${sectionVisibility.keywordStatus === false ? 'opacity-50' : ''}`}
          actions={<SectionToggle visible={sectionVisibility.keywordStatus} onChange={(v) => setSectionVisibility((s) => ({ ...s, keywordStatus: v }))} accent={accent} />}>
          <KeywordStatusTracker report={report} keywordStatus={keywordStatus} onChange={setKeywordStatus} accent={accent} canEdit={true} />
        </SectionCard>
        </DraggableSection>
      )}

      {/* Achievements */}
      <DraggableSection id='achievements' label='Monthly achievements' onReorder={handleReorder} accent={accent} order={getSectionOrder('achievements')}>
      <SectionCard title='Monthly achievements' subtitle='Plain-language wins shown alongside the numbers.' icon={Sparkles} accent={accent}
        actions={<><SectionToggle visible={sectionVisibility.achievements} onChange={(v) => setSectionVisibility((s) => ({ ...s, achievements: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={() => setAchievements((a) => [...a, ''])}><Plus className='w-3.5 h-3.5' /> Add achievement</Button></>} className={`mb-6 ${sectionVisibility.achievements === false ? 'opacity-50' : ''}`}>
        <div className='space-y-2'>
          {achievements.length === 0 && <InlineEmpty>No achievements yet.</InlineEmpty>}
          {achievements.map((a, i) => (
            <div key={i} className='flex gap-2'>
              <Input value={a} onChange={(e) => setAchievements((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} placeholder='e.g. Secured 3 guest posts on DR-60+ sites' />
              <IconButton label='Delete achievement' tone='danger' onClick={() => setAchievements((arr) => arr.filter((_, j) => j !== i))}>
                <Trash2 className='w-4 h-4' />
              </IconButton>
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
          <DraggableSection key={s.id} id={s.id} label={note.title || s.fallback} onReorder={handleReorder} accent={accent} order={getSectionOrder(s.id)}>
          <SectionCard title={note.title || s.fallback} subtitle='Your own heading and bullet points, shown on the client report.' icon={ListChecks} accent={accent}
            actions={<><SectionToggle visible={sectionVisibility[s.id]} onChange={(v) => setSectionVisibility((prev) => ({ ...prev, [s.id]: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={() => setNote({ points: [...points, ''] })}><Plus className='w-3.5 h-3.5' /> Add point</Button></>} className={`mb-6 ${sectionVisibility[s.id] === false ? 'opacity-50' : ''}`}>
            <div className='space-y-3'>
              <Field label='Section title'>
                <Input value={note.title} onChange={(e) => setNote({ title: e.target.value })} placeholder={s.fallback} className='font-semibold' />
              </Field>
              {points.length === 0 && <InlineEmpty>No points yet. Add what you want the client to read here.</InlineEmpty>}
              {points.map((point, i) => (
                <div key={i} className='flex gap-2'>
                  <Input value={point} onChange={(e) => setNote({ points: points.map((x, j) => (j === i ? e.target.value : x)) })} placeholder='e.g. Recommend continuing the current content cadence' />
                  <IconButton label='Delete note point' tone='danger' onClick={() => setNote({ points: points.filter((_, j) => j !== i) })}>
                <Trash2 className='w-4 h-4' />
              </IconButton>
                </div>
              ))}
            </div>
          </SectionCard>
          </DraggableSection>
        );
      })}

      {/* Additional Inputs — chart notes pinned to this period */}
      <DraggableSection id='annotations' label='Additional inputs' onReorder={handleReorder} accent={accent} order={getSectionOrder('annotations')}>
      <SectionCard title='Additional Inputs' subtitle='Notes pinned to this period on the client dashboard trend charts.' icon={MessageSquarePlus} accent={accent}
        actions={<><SectionToggle visible={sectionVisibility.annotations} onChange={(v) => setSectionVisibility((s) => ({ ...s, annotations: v }))} accent={accent} /><Button size='sm' variant='outline' onClick={addAnnotation}><Plus className='w-3.5 h-3.5' /> Add note</Button></>} className={`mb-6 ${sectionVisibility.annotations === false ? 'opacity-50' : ''}`}>
        <div className='space-y-2'>
          <Input value={annInput} onChange={(e) => setAnnInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAnnotation(); } }} placeholder='e.g. Launched new website · Google algorithm update' />
          {annotations.filter(a => a.period_start === report.period_start).length === 0 ? (
            <InlineEmpty>No additional inputs for this period yet. Add one to explain spikes or dips on the client dashboard.</InlineEmpty>
          ) : (
            annotations.filter(a => a.period_start === report.period_start).map((a) => (
              <div key={a.id} className='flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2'>
                <span className='text-sm text-slate-700 flex items-center gap-2'><span className='w-2 h-2 rounded-full bg-amber-500' /> {a.note}</span>
                <IconButton label={`Delete input: ${a.note}`} tone='danger' size='sm'
                  onClick={async () => { try { await del('/api/annotations', { id: a.id }); setAnnotations((arr) => arr.filter((x) => x.id !== a.id)); push('Annotation removed', 'success'); } catch (e) { push(e.message, 'error'); } }}>
                  <Trash2 className='w-3.5 h-3.5' />
                </IconButton>
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
              <Button accent={accent} variant='accent' disabled={saving} onClick={() => setConfirmPublish(true)}><Send className='w-4 h-4' /> Publish & notify</Button>
            </>
          ) : (
            <>
              <Button accent={accent} variant='accent' disabled={saving} onClick={() => setReviseOpen(true)}><Send className='w-4 h-4' /> Publish revision</Button>
              <Button variant='outline' disabled={saving} onClick={() => setConfirmRevert(true)}><Undo2 className='w-4 h-4' /> Revert to draft</Button>
            </>
          )}
        </div>
        {isDraft && !report.delete_requested && (
          <button onClick={() => setConfirmDelete(true)} className='text-sm text-rose-600 font-semibold hover:underline inline-flex items-center gap-1'>
            <Trash2 className='w-4 h-4' /> {isSuperAdmin ? 'Delete draft' : 'Request deletion'}
          </button>
        )}
        {isDraft && report.delete_requested && (
          <div className='flex items-center gap-3'>
            <span className='text-sm font-semibold text-amber-600 dark:text-amber-500 inline-flex items-center gap-1'>
              <AlertTriangle className='w-4 h-4' /> Deletion requested — awaiting super admin review
            </span>
            {isSuperAdmin && (
              <button
                onClick={async () => {
                  try {
                    const updated = await put('/api/reports', { id: report.id, action: 'cancel-delete-request' });
                    setReport((r) => ({ ...r, ...updated }));
                    push('Deletion request dismissed', 'success');
                  } catch (e) { push(e.message, 'error'); }
                }}
                className='text-sm text-slate-600 dark:text-slate-300 font-semibold hover:underline'
              >
                Keep report
              </button>
            )}
          </div>
        )}
      </div>

      <Modal open={reviseOpen} onClose={() => setReviseOpen(false)} title='Publish a correction'
        footer={<><Button variant='outline' onClick={() => setReviseOpen(false)}>Cancel</Button><Button accent={accent} variant='accent' disabled={saving} onClick={() => { doSave('revise', reviseNote); setReviseOpen(false); }}>Publish revision</Button></>}>
        <div className='space-y-3'>
          <div className='flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800'><AlertTriangle className='w-4 h-4 mt-0.5 shrink-0' /> The current published version is snapshotted to the audit history (v{report.version}). The client is notified of the update.</div>
          <Field label='Correction note (optional)'><Input value={reviseNote} onChange={(e) => setReviseNote(e.target.value)} placeholder='e.g. Corrected backlink count' /></Field>
        </div>
      </Modal>
      <ConfirmDialog open={confirmLeave} onClose={() => { setConfirmLeave(false); if (blocker.state === 'blocked') blocker.reset(); }}
        title='Leave without saving?'
        message='You have unsaved changes on this report. Leaving now discards them — they are not recoverable.'
        confirmText='Discard changes' danger
        onConfirm={() => { setConfirmLeave(false); if (blocker.state === 'blocked') blocker.proceed(); }} />
      <ConfirmDialog open={confirmPublish} onClose={() => setConfirmPublish(false)}
        title='Publish this report to the client?'
        message={`The ${report.period_label} ${meta.label} report will go live on the client dashboard and the client will be notified immediately. Everything currently on this screen is published as-is — check the numbers before continuing. Use “Publish revision” afterwards to correct anything.`}
        confirmText='Publish & notify'
        onConfirm={async () => { await doSave('publish'); setConfirmPublish(false); }} />
      <ConfirmDialog open={confirmRevert} onClose={() => setConfirmRevert(false)}
        title='Unpublish this report?'
        message='The report will return to draft and disappear from the client dashboard until it is published again. The published figures are left exactly as they are — any edits on this screen are not applied, so save them first if you want to keep them.'
        confirmText='Revert to draft' danger
        onConfirm={async () => { await doSave('revert-to-draft'); setConfirmRevert(false); }} />
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
            // Clear `dirty` first, or useBlocker intercepts this nav and pops a
            // spurious "Leave without saving?" over a successful delete.
            markSaved();
            nav(`/app/clients/${report.client_id}`);
          } catch (e) { push(e.message, 'error'); }
        }} />
    </div>
  );
}

function emptyRow(listDef) {
  const row = {};
  // Both branches were '', so the `c.type` check implied number columns were
  // initialised differently when they are not. Kept as a single assignment.
  listDef.columns.forEach((c) => { row[c.key] = ''; });
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
    // Same disjoint ownership rule as the load effect: only seeded backlink
    // defaults belong to the backlink section. The old filter also matched any
    // category in neither default list, so a custom review row was copied into
    // both sections and its value was then overwritten on save.
    if (target === 'backlink') {
      return toRows(entries.filter(([name]) => backlinkDefaults.includes(name)));
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
  if (rows.length === 0) return <InlineEmpty>No custom metrics. Add one if this client's package needs a field beyond the core set.</InlineEmpty>;
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
          <IconButton label={`Delete ${meta.breakdown.itemNoun}`} tone='danger' onClick={() => remove(i)}>
                <Trash2 className='w-4 h-4' />
              </IconButton>
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
          <IconButton label={`Delete ${meta.breakdown2?.itemNoun || 'backlink activity'} row`} tone='danger' onClick={() => remove(i)}>
                <Trash2 className='w-4 h-4' />
              </IconButton>
        </div>
      ))}
    </div>
  );
}

function ListEditor({ listDef, rows, onChange }) {
  const update = (i, field, val) => onChange(rows.map((r, j) => (j === i ? { ...r, [field]: val } : r)));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));
  if (rows.length === 0) return <InlineEmpty>No entries yet. Click “{listDef.addLabel}” to add one.</InlineEmpty>;
  return (
    <div className='space-y-2'>
      {rows.map((r, i) => (
        <div key={i} className='rounded-xl border border-slate-200 p-3'>
          <div className='flex justify-end mb-1'>
            <IconButton label={`Delete ${r.name || listDef.addLabel} row`} tone='danger' size='sm' className='-m-1' onClick={() => remove(i)}>
              <Trash2 className='w-4 h-4' />
            </IconButton>
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
