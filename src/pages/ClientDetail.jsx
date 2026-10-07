import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Send, Undo2, RefreshCw, Target, Building2, Calendar, Flag, Eye, Crosshair, Save, ExternalLink } from 'lucide-react';
import { get, post, put, del } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Button, Input, Select, Field, Badge, Modal, ConfirmDialog, DataTable, EmptyState, useToast, FullLoader, SectionCard, BackButton, SegmentedControl, IconButton, InlineEmpty } from '../components/ui';
import { SectionToggle } from '../components/SectionToggle';
import { serviceIcon } from '../lib/service-icons';
import { SERVICE_META, SERVICE_ORDER } from '../lib/constants';
import { monthLabel, monthBounds, formatDate } from '../lib/format';

export default function ClientDetail() {
  const { clientId } = useParams();
  const nav = useNavigate();
  const { push } = useToast();
  const { profile } = useAuth();
  const [client, setClient] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const service = searchParams.get('service') || 'orm';
  const [reports, setReports] = useState([]);
  const [targets, setTargets] = useState([]);
  // Which service the current `targets` batch was fetched for. `targets` is a
  // single slot shared across service tabs, so without this the card cannot
  // tell fresh data from the previous tab's leftovers.
  const [targetsForService, setTargetsForService] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [confirmRevert, setConfirmRevert] = useState(null);
  const [confirmPublish, setConfirmPublish] = useState(null);
  const [confirmRequest, setConfirmRequest] = useState(null);
  const [objectives, setObjectives] = useState([]);
  const [savingObjectives, setSavingObjectives] = useState(false);
  const [compareVisible, setCompareVisible] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const c = await get(`/api/clients?single=1&id=${clientId}`);
      setClient(c);
      setObjectives(Array.isArray(c.objectives) ? c.objectives : []);
      setCompareVisible(c.compare_visible !== false);
      const svcList = Array.isArray(c.services) && c.services.length ? c.services : SERVICE_ORDER;
      // No services enabled: there is nothing to report on, and falling through
      // set the URL to ?service=undefined, which made SERVICE_META[service]
      // undefined and threw on meta.accent below — a permanently blank page.
      if (!Array.isArray(c.services) || !c.services.length) { setLoading(false); return; }
      if (!svcList.includes(service)) {
        setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('service', svcList[0]); return n; }, { replace: true });
        setLoading(false); return;
      }
      // The two requests are independent — a reports failure must not blank the
      // targets form, or vice versa. Sequential awaits also mean `finally` below
      // can always clear the service tag, so a failed fetch can never leave the
      // TargetsCard stuck on "Loading targets…" with Save disabled and no retry.
      try { setReports(await get(`/api/reports?clientId=${clientId}&service=${service}`) || []); }
      catch (e) { setReports([]); push(`Could not load ${SERVICE_META[service]?.label} reports: ${e.message}`, 'error'); }
      try { setTargets(await get(`/api/targets?clientId=${clientId}&service=${service}`) || []); }
      catch (e) { setTargets([]); push(`Could not load targets: ${e.message}`, 'error'); }
      // Tag the batch with the service it was fetched for. A tab switch leaves
      // the previous service's rows in `targets` until this resolves, and the
      // TargetsCard must not render or save from them. Set unconditionally so a
      // failure cannot strand the card.
      setTargetsForService(service);
    } catch (e) { push(e.message, 'error'); }
    setLoading(false);
  }, [clientId, service, setSearchParams, push]);

  useEffect(() => { load(); }, [load]);

  const publish = async (rep) => { try { await put('/api/reports', { id: rep.id, action: 'publish' }); push('Report published — client notified', 'success'); load(); } catch (e) { push(e.message, 'error'); } };
  const revert = async (rep) => { try { await put('/api/reports', { id: rep.id, action: 'revert-to-draft' }); push('Reverted to draft', 'success'); load(); } catch (e) { push(e.message, 'error'); } };
  const remove = async (rep) => { try { await del('/api/reports', { id: rep.id }); push('Report deleted permanently', 'success'); load(); } catch (e) { push(e.message, 'error'); } };
  const requestDelete = async (rep) => { try { await del('/api/reports', { id: rep.id }); push('Deletion requested — super admin will review', 'success'); load(); } catch (e) { push(e.message, 'error'); } };
  // The delete request is a one-way flag server-side; without this the only
  // resolution was actually deleting the report.
  const cancelDelete = async (rep) => {
    try { await put('/api/reports', { id: rep.id, action: 'cancel-delete-request' }); push('Deletion request dismissed', 'success'); load(); }
    catch (e) { push(e.message, 'error'); }
  };

  // Show/hide the comparison-mode selector on the client dashboard. Optimistic,
  // reverted if the save fails.
  const toggleCompare = async (v) => {
    setCompareVisible(v);
    try {
      await put('/api/clients', { id: clientId, compare_visible: v });
      push(v ? 'Comparison modes visible to client' : 'Comparison modes hidden from client', 'success');
      load();
    } catch (e) {
      setCompareVisible(!v);
      // The server now redacts Postgres error detail (see publicMessage in
      // server/helpers.js), so the message no longer names the missing column —
      // matching on it silently stopped working. Key off the status instead:
      // a 500 here means the write failed server-side, and an unapplied
      // migration is by far the most common reason.
      const hint = e.status === 500 ? ' If migration 0005_compare_visible.sql has not been run on this database, that is the usual cause.' : '';
      push(`${e.message}${hint}`, 'error');
    }
  };

  const meta = SERVICE_META[service];
  // Array-checked: `client?.services` could hold a non-array (legacy or
  // hand-edited row), and every consumer below maps over it.
  const services = Array.isArray(client?.services) ? client.services : SERVICE_ORDER;

  const reportCols = [
    { key: 'period_label', label: 'Month', render: (r) => <span className={`font-semibold ${r.delete_requested ? 'text-rose-500 line-through' : 'text-slate-800 dark:text-slate-200'}`}>{r.period_label}</span> },
    { key: 'preview', label: 'Preview Report', render: (r) => <button onClick={() => window.open(`/app/clients/${clientId}/dashboard?service=${r.service}&report=${r.id}`, '_blank')} className='inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-indigo-600 hover:bg-indigo-50' title='Open in new tab'><Eye className='w-3.5 h-3.5' /> View <ExternalLink className='w-3 h-3 opacity-50' /></button> },
    { key: 'date', label: 'Date', render: (r) => <span className='text-slate-500 dark:text-slate-400 text-xs'>{formatDate(r.published_at || r.updated_at)}</span> },
    { key: 'status', label: 'Status', render: (r) => (
      <div className='flex items-center gap-1.5'>
        {r.status === 'draft' && <Badge color='amber'>Draft</Badge>}
        {r.status === 'published' && <Badge color='emerald'>Published</Badge>}
        {r.delete_requested && <Badge color='rose'>Delete Requested</Badge>}
        {r.status === 'published' && r.version > 1 && <Badge color='sky'>v{r.version}</Badge>}
      </div>
    ) },
    { key: 'edit', label: 'Edit', render: (r) => (
      <div className='flex gap-1 justify-end'>
        {!r.delete_requested && <button onClick={() => nav(`/app/reports/${r.id}/edit`)} className='inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700' title={r.status === 'draft' ? 'Edit draft' : 'Revise'}><Pencil className='w-3.5 h-3.5' /> {r.status === 'draft' ? 'Edit' : 'Revise'}</button>}
        {r.status === 'draft' && <button onClick={() => setConfirmPublish(r)} className='inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' title='Publish and notify client'><Send className='w-3.5 h-3.5' /></button>}
        {r.status === 'published' && !r.delete_requested && <button onClick={() => setConfirmRevert(r)} className='p-1.5 rounded-lg text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-600' title='Unpublish report'><Undo2 className='w-3.5 h-3.5' /></button>}
        {/* Super admin: delete any report. Team admin: request deletion (strikethrough). */}
        {profile?.role === 'super_admin' && <button onClick={() => setConfirm(r)} className='p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600' title='Delete report'><Trash2 className='w-3.5 h-3.5' /></button>}
        {profile?.role === 'team_admin' && !r.delete_requested && <button onClick={() => setConfirmRequest(r)} className='p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600' title='Request deletion'><Trash2 className='w-3.5 h-3.5' /></button>}
        {/* A pending request can be dismissed — otherwise the report is stuck. */}
        {r.delete_requested && profile?.role === 'super_admin' && <button onClick={() => cancelDelete(r)} className='inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700' title='Dismiss the deletion request and keep this report'><Flag className='w-3.5 h-3.5' /> Keep report</button>}
      </div>
    ) },
  ];

  // Only gate on the FIRST load. Returning FullLoader on every reload unmounted
  // the whole subtree — including TargetsCard, which owns the unsaved draft,
  // pending deletions and new-goal rows. Toggling "targets visible", saving
  // objectives, or publishing any report all call load(), so each of those
  // silently discarded whatever the user was still typing.
  if (loading && !client) return <FullLoader label='Loading client...' />;
  if (!client) return <EmptyState icon={Building2} title='Client not found' message='You may not have access to this client.' />;
  // No services enabled: there is nothing to report on, and every service view
  // below indexes SERVICE_META by the selected key.
  if (!services.length) return <EmptyState icon={Building2} title='No services enabled' message={`${client.company_name} has no reporting services enabled. Enable at least one from the client record in the admin console.`} />;

  return (
    <div>
      <BackButton to='/app' className='mb-4' />
      <div className='card-surface p-5 mb-6 flex flex-wrap items-center gap-4'>
        {/* h-12 with a border, matching ClientDashboard — the same company is
            shown on two consecutive screens and was rendering at a different
            size with a different treatment on each. */}
        <div className='h-12 w-12 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden text-slate-400'>{client.logo_url ? <img src={client.logo_url} alt='' className='h-full w-full object-cover' /> : <Building2 className='w-6 h-6' />}</div>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 flex-wrap'>
            <h1 className='text-xl font-bold text-slate-900 dark:text-slate-100'>{client.company_name}</h1>
            <Badge color={client.status === 'active' ? 'emerald' : 'slate'}>{client.status}</Badge>
          </div>
          <div className='text-sm text-slate-500 dark:text-slate-400 mt-0.5'>{client.contact_name}{client.email ? ` · ${client.email}` : ''}{client.phone ? ` · ${client.phone}` : ''}</div>
          <div className='flex gap-1.5 mt-2'>{services.map((s) => <Badge key={s} color={s === 'seo' ? 'indigo' : s === 'orm' ? 'emerald' : 'amber'}>{SERVICE_META[s]?.label}</Badge>)}</div>
        </div>
        <Button variant='outline' onClick={() => window.open(`/app/clients/${clientId}/dashboard`, '_blank')}><Eye className='w-4 h-4' /> Preview dashboard</Button>
      </div>

      {/* Objectives — editable text rows above service tabs */}
      <SectionCard title='Objectives' subtitle='Client goals and objectives for this reporting cycle.' icon={Crosshair} accent={meta.accent}
        actions={<Button size='sm' variant='outline' onClick={() => setObjectives((o) => [...o, ''])}><Plus className='w-3.5 h-3.5' /> Add objective</Button>} className='mb-6'>
        <div className='space-y-2'>
          {objectives.length === 0 && <InlineEmpty>No objectives set yet.</InlineEmpty>}
          {objectives.map((obj, i) => (
            <div key={i} className='flex gap-2'>
              <Input value={obj} onChange={(e) => setObjectives((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} placeholder='e.g. Increase organic traffic by 25% in Q3' />
              <IconButton label='Delete objective' tone='danger' onClick={() => setObjectives((arr) => arr.filter((_, j) => j !== i))}>
            <Trash2 className='w-4 h-4' />
          </IconButton>
            </div>
          ))}
        </div>
        <div className='mt-3'>
          <Button size='sm' accent={meta.accent} variant='accent' disabled={savingObjectives} onClick={async () => {
            setSavingObjectives(true);
            try {
              // Always send the array — including when it is empty, so clearing
              // the last objective can actually be persisted.
              const cleaned = objectives.map((o) => String(o ?? '').trim()).filter(Boolean);
              await put('/api/clients', { id: clientId, objectives: cleaned });
              setObjectives(cleaned);
              push('Objectives saved', 'success');
            } catch (e) { push(e.message, 'error'); }
            setSavingObjectives(false);
          }}><Save className='w-3.5 h-3.5' /> {savingObjectives ? 'Saving...' : 'Save objectives'}</Button>
        </div>
      </SectionCard>

      {/* Same strip as ClientDashboard's, which used to be a verbatim
          copy-paste. Both now render <SegmentedControl>. */}
      <SegmentedControl
        className='mb-5 pb-1'
        ariaLabel='Reporting service'
        value={service}
        onChange={(s) => setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('service', s); return n; })}
        options={services.map((s) => ({
          key: s,
          label: SERVICE_META[s].label,
          accent: SERVICE_META[s].accent,
          accentText: SERVICE_META[s].accentText,
          icon: serviceIcon(SERVICE_META[s].icon),
        }))}
      />

      <div className='grid lg:grid-cols-3 gap-6'>
        <div className='lg:col-span-2'>
          <SectionCard title={`${meta.label} reports`} subtitle='Draft → Publish workflow. Clients see published periods only.' icon={serviceIcon(meta.icon)} accent={meta.accent}
            actions={<Button accent={meta.accent} variant='accent' onClick={() => setNewOpen(true)}><Plus className='w-4 h-4' /> New report</Button>}>
            <DataTable columns={reportCols} rows={[...reports].reverse()} empty='No reports yet. Create the first one to get started.' />
          </SectionCard>
        </div>
        <div>
          <TargetsCard clientId={clientId} service={service} targets={targets} targetsBelongToService={targetsForService === service} targetsVisible={client.targets_visible !== false} onChanged={load} />

          <SectionCard title='Client dashboard' subtitle='What the client sees on their dashboard.' icon={Eye} accent={meta.accent} className='mt-6'
            actions={<SectionToggle visible={compareVisible} onChange={toggleCompare} accent={meta.accent} />}>
            <div className='text-sm font-medium text-slate-700 dark:text-slate-300'>Comparison modes</div>
            <p className='text-xs text-slate-400 dark:text-slate-500 mt-1 leading-relaxed'>
              The MoM, YoY, rolling-average, vs-target and custom-range selector.
              Hidden, the client still sees month-over-month change on each metric —
              only the ability to switch modes is removed.
            </p>
          </SectionCard>
        </div>
      </div>

      {newOpen && <NewReportModal clientId={clientId} service={service} meta={meta} onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); nav(`/app/reports/${id}/edit`); }} />}
      <ConfirmDialog open={!!confirmRevert} onClose={() => setConfirmRevert(null)} title='Unpublish this report?'
        message={`The ${confirmRevert?.period_label} report will return to draft and disappear from the client dashboard until it is published again. This is a live report the client can currently see.`}
        confirmText='Unpublish' danger
        onConfirm={() => { revert(confirmRevert); setConfirmRevert(null); }} />
      <ConfirmDialog open={!!confirmPublish} onClose={() => setConfirmPublish(null)} title='Publish this report?'
        message={`The ${confirmPublish?.period_label} report will go live on the client dashboard and the client will be notified. Open it first to check the numbers — this publishes the saved draft exactly as it is.`}
        confirmText='Publish & notify'
        onConfirm={() => { publish(confirmPublish); setConfirmPublish(null); }} />
      <ConfirmDialog open={!!confirmRequest} onClose={() => setConfirmRequest(null)} title='Request deletion?'
        message={`Flag the ${confirmRequest?.period_label} report for a super admin to review? Editing is blocked while the request is pending, and a super admin can dismiss it if they disagree.`}
        confirmText='Request deletion' danger
        onConfirm={() => { requestDelete(confirmRequest); setConfirmRequest(null); }} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} title='Delete report?' message={`Delete the ${confirm?.period_label} report? This permanently removes all data for this period. This cannot be undone.`} confirmText='Delete permanently' danger onConfirm={() => { remove(confirm); setConfirm(null); }} />
    </div>
  );
}

function NewReportModal({ clientId, service, meta, onClose, onCreated }) {
  const { push } = useToast();
  const now = new Date();
  const [type, setType] = useState('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState(true);
  const [lastReport, setLastReport] = useState(null);

  useEffect(() => {
    get(`/api/reports?clientId=${clientId}&service=${service}`).then((reports) => {
      const pub = (reports || []).filter(r => r.status === 'published');
      if (pub.length) setLastReport(pub[pub.length - 1]);
    }).catch(() => {});
  }, [clientId, service]);

  const create = async () => {
    setSaving(true);
    let period_label, period_start, period_end;
    if (type === 'month') { period_label = monthLabel(year, month); const b = monthBounds(year, month); period_start = b.start; period_end = b.end; }
    else { period_label = label || `${start} → ${end}`; period_start = start; period_end = end; if (!start || !end) { push('Set start and end dates', 'error'); setSaving(false); return; } }
    try {
      const rep = await post('/api/reports', {
        client_id: clientId, service, period_type: type, period_label, period_start, period_end,
        duplicateFromId: duplicate && lastReport ? lastReport.id : null,
      });
      push(duplicate && lastReport ? 'Draft created — last month\'s data copied' : 'Draft created — structure carried forward', 'success');
      onCreated(rep.id);
    } catch (e) { push(e.message, 'error'); }
    setSaving(false);
  };

  const years = Array.from({ length: 2035 - 2020 + 1 }, (_, i) => 2020 + i);
  return (
    <Modal open onClose={onClose} title={`New ${meta.label} report`}
      footer={<><Button variant='outline' onClick={onClose}>Cancel</Button><Button accent={meta.accent} variant='accent' disabled={saving} onClick={create}><RefreshCw className='w-4 h-4' /> {saving ? 'Creating...' : 'Create draft'}</Button></>}>
      <div className='space-y-4'>
        <div className='flex gap-2'>
          <button onClick={() => setType('month')} className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold border transition ${type === 'month' ? 'bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}><Calendar className='w-4 h-4 inline mr-1.5' /> Calendar month</button>
          <button onClick={() => setType('cycle')} className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold border transition ${type === 'cycle' ? 'bg-slate-900 dark:bg-slate-700 text-white border-slate-900 dark:border-slate-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>Custom billing cycle</button>
        </div>
        {type === 'month' ? (
          <div className='grid grid-cols-2 gap-3'>
            <Field label='Year'><Select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
            <Field label='Month'><Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{monthLabel(2000, m).split(' ')[0]}</option>)}</Select></Field>
          </div>
        ) : (
          <div className='space-y-3'>
            <div className='grid grid-cols-2 gap-3'>
              <Field label='Start date'><Input type='date' value={start} onChange={(e) => setStart(e.target.value)} /></Field>
              <Field label='End date'><Input type='date' value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
            </div>
            <Field label='Period label'><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder='e.g. Cycle 1 — Jan 1–15 2025' /></Field>
          </div>
        )}
        <div className='rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400 flex items-start gap-2'><RefreshCw className='w-4 h-4 mt-0.5 shrink-0' /> Custom metrics, breakdown categories and brand keywords from previous periods are carried forward automatically — no re-typing needed.</div>
        {lastReport && (
          <label className='flex items-center gap-2.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/20 px-3 py-2.5 cursor-pointer hover:bg-indigo-50 transition'>
            <input type='checkbox' checked={duplicate} onChange={(e) => setDuplicate(e.target.checked)} className='w-4 h-4 rounded accent-indigo-600' />
            <span className='text-sm text-slate-700 dark:text-slate-300'>
              <span className='font-semibold'>Duplicate last month's data</span>
              <span className='block text-xs text-slate-400 dark:text-slate-500 mt-0.5'>Copies metrics, breakdowns and lists from {lastReport.period_label} as a starting point — just edit what changed.</span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}

function TargetsCard({ clientId, service, targets, targetsBelongToService, targetsVisible, onChanged }) {
  const { push } = useToast();
  const { profile } = useAuth();
  const meta = SERVICE_META[service];
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(targetsVisible);
  const [customGoals, setCustomGoals] = useState([]);
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalValue, setNewGoalValue] = useState('');
  // Ids of rows the user deleted since the last save, paired with the service
  // they belong to. The list endpoint only ever grows by re-posting, so removal
  // has to be issued explicitly — and the DELETE is by id alone, so an unscoped
  // id deleted by the wrong tab would destroy another service's target.
  const [removed, setRemoved] = useState([]);

  // Keyed on the *content* of `targets`, not its array identity: `load()` builds
  // a fresh array on every fetch, so an identity-keyed effect re-seeded the
  // draft from the server and discarded whatever the user was still typing.
  const targetsKey = useMemo(
    () => (targets || []).map((t) => `${t.id}:${t.metric_key}:${t.platform || ''}:${t.target_value}`).join('|'),
    [targets]
  );
  useEffect(() => {
    // Don't re-seed while `targets` still belongs to the previous service tab.
    if (!targetsBelongToService) return;
    const map = {};
    const custom = [];
    (targets || []).forEach((t) => {
      const isCore = meta.coreMetrics.some(m => m.key === t.metric_key);
      if (isCore) {
        map[t.metric_key + (t.platform ? `__${t.platform}` : '')] = t.target_value;
      } else {
        custom.push({ id: t.id, metric_key: t.metric_key, target_value: t.target_value });
        map['custom_' + t.metric_key] = t.target_value;
      }
    });
    setDraft(map);
    setCustomGoals(custom);
    // Pending deletions belong to the tab that queued them. Carrying them across
    // a service switch made the next tab's Save delete the previous service's
    // rows, so drop them whenever the tab changes.
    setRemoved([]);
    // `meta` is a stable module constant derived from `service`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey, service, meta, targetsBelongToService]);

  const items = meta.hasPlatforms
    ? meta.platforms.flatMap((p) => meta.coreMetrics.map((m) => ({ key: m.key, platform: p.key, label: `${p.label} · ${m.label}`, suffix: m.suffix })))
    : meta.coreMetrics.map((m) => ({ key: m.key, platform: null, label: m.label, suffix: m.suffix }));

  // Existing row id for a core-metric field, so a cleared value can delete the
  // row instead of silently keeping the previous number.
  const coreRowId = (key, platform) => {
    const t = (targets || []).find((r) => r.metric_key === key && (r.platform || null) === (platform || null));
    return t?.id || null;
  };

  // Deletes tolerate a 404: it means a teammate already removed the row, which
  // is the desired end state. Throwing would abort the whole save and skip every
  // remaining write, so the admin sees a failure toast for input that was valid.
  const removeRow = async (id) => {
    if (!id) return;
    try { await del('/api/targets', { id }); }
    catch (e) { if (e.status !== 404) throw e; }
  };

  const save = async () => {
    // Refuse to write while `targets` still belongs to the previous tab.
    if (!targetsBelongToService) { push('Still loading targets for this service', 'error'); return; }
    setSaving(true);
    try {
      for (const id of removed) await removeRow(id);
      setRemoved([]);

      for (const it of items) {
        const fkey = it.key + (it.platform ? `__${it.platform}` : '');
        const val = draft[fkey];
        if (val === '' || val === undefined || val === null) {
          // Cleared by the user — remove the row rather than reporting a
          // successful save that kept the old value.
          await removeRow(coreRowId(it.key, it.platform));
          continue;
        }
        await post('/api/targets', { client_id: clientId, service, metric_key: it.key, platform: it.platform || null, target_value: Number(val), unit: it.suffix || null });
      }

      for (const cg of customGoals) {
        // A blank custom goal means "remove it", matching the core-metric
        // behaviour. `Number('') || 0` used to store a zero target, which then
        // rendered on the client dashboard as a real goal.
        if (cg.target_value === '' || cg.target_value === null || cg.target_value === undefined) {
          await removeRow(cg.id);
          continue;
        }
        await post('/api/targets', { client_id: clientId, service, metric_key: cg.metric_key, target_value: Number(cg.target_value), platform: null });
      }
      push('Targets saved', 'success');
      onChanged();
    } catch (e) { push(e.message, 'error'); }
    setSaving(false);
  };

  const addCustomGoal = () => {
    if (!newGoalName.trim()) { push('Goal name required', 'error'); return; }
    const key = newGoalName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    // Slugification collides: "Domain Authority" and "domain-authority" both
    // become domain_authority, producing two rows with the same metric_key and
    // two identical-looking inputs bound to one draft field.
    if (customGoals.some((cg) => cg.metric_key === key)) {
      push(`"${key.replace(/_/g, ' ')}" already exists — give this goal a different name`, 'error');
      return;
    }
    // It can also collide with a CORE metric. Both live in the same targets
    // table and the server upserts on (client_id, service, metric_key, platform)
    // with platform IS NULL, so posting it would overwrite that core target's
    // value rather than adding a goal.
    const core = meta.coreMetrics.find((m) => m.key === key);
    if (core) {
      push(`"${key.replace(/_/g, ' ')}" is already a tracked metric — set its target in the list above`, 'error');
      return;
    }
    setCustomGoals([...customGoals, { id: null, metric_key: key, target_value: newGoalValue || '' }]);
    setNewGoalName(''); setNewGoalValue('');
    push('Custom goal added — click Save to persist', 'success');
  };

  const removeCustomGoal = (idx) => {
    const gone = customGoals[idx];
    // Remember the row so save() can actually delete it. Dropping it from local
    // state alone left the row in the database, and the sync effect brought it
    // straight back on the next fetch.
    if (gone?.id) setRemoved((r) => [...r, gone.id]);
    setCustomGoals(customGoals.filter((_, i) => i !== idx));
    push('Goal removed — click Save to persist', 'info');
  };

  return (
    <SectionCard title='Goals & targets' subtitle='Used for the on-track comparison on the client dashboard.' icon={Target} accent={meta.accent}
      actions={<><SectionToggle visible={visible} onChange={async (v) => {
        setVisible(v);
        try {
          await put('/api/clients', { id: clientId, targets_visible: v });
          push(v ? 'Targets visible to client' : 'Targets hidden from client', 'success');
          onChanged();
        } catch (e) { setVisible(!v); push(e.message, 'error'); }
      }} accent={meta.accent} /><Button size='sm' accent={meta.accent} variant='accent' disabled={saving || !targetsBelongToService} onClick={save}><Flag className='w-3.5 h-3.5' /> Save</Button></>} className={visible === false ? 'opacity-50' : ''}>
      <div className='space-y-2.5'>
        {!targetsBelongToService && <p className='text-sm text-slate-400 dark:text-slate-500 py-2'>Loading targets…</p>}        {targetsBelongToService && items.map((it) => {
          const fkey = it.key + (it.platform ? `__${it.platform}` : '');
          return (
            <div key={fkey} className='flex items-center justify-between gap-3'>
              <span className='text-sm text-slate-600 dark:text-slate-400'>{it.label}</span>
              <Input type='number' value={draft[fkey] ?? ''} onChange={(e) => setDraft({ ...draft, [fkey]: e.target.value })} className='w-28 text-right' placeholder='target' />
            </div>
          );
        })}
        {/* Custom goals */}
        {targetsBelongToService && customGoals.map((cg, i) => (
          <div key={i} className='flex items-center justify-between gap-3'>
            <span className='text-sm text-slate-600 dark:text-slate-400 font-medium capitalize'>{cg.metric_key.replace(/_/g, ' ')}</span>
            <div className='flex items-center gap-2'>
              <Input type='number' value={cg.target_value ?? ''} onChange={(e) => setCustomGoals((arr) => arr.map((x, j) => (j === i ? { ...x, target_value: e.target.value } : x)))} className='w-28 text-right' placeholder='target' />
              {profile?.role === 'super_admin' && <IconButton label='Delete custom goal' tone='danger' size='sm' onClick={() => removeCustomGoal(i)}>
              <Trash2 className='w-3.5 h-3.5' />
            </IconButton>}
            </div>
          </div>
        ))}
        {/* Add custom goal — super admin only */}
        {targetsBelongToService && profile?.role === 'super_admin' && (
          <div className='pt-2 border-t border-slate-100 dark:border-slate-700 space-y-2'>
            <p className='text-xs font-semibold text-slate-500 dark:text-slate-400'>Add custom goal</p>
            <div className='flex items-center gap-2'>
              <Input value={newGoalName} onChange={(e) => setNewGoalName(e.target.value)} placeholder='Goal name (e.g. Domain Authority)' className='flex-1 min-w-[160px]' />
              <Input type='number' value={newGoalValue} onChange={(e) => setNewGoalValue(e.target.value)} className='w-20 text-right' placeholder='target' />
              <Button size='sm' variant='outline' onClick={addCustomGoal} aria-label='Add custom goal' title='Add custom goal'><Plus className='w-3.5 h-3.5' /></Button>
            </div>
          </div>
        )}
        {items.length === 0 && customGoals.length === 0 && <InlineEmpty>No metrics for this service.</InlineEmpty>}
      </div>
    </SectionCard>
  );
}
