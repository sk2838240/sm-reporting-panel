import { useState, useEffect, useMemo } from 'react';
import { Info, Pencil, AlertTriangle } from 'lucide-react';
import { get, put } from '../lib/api';
import { Button, Textarea, Badge, FullLoader, InlineEmpty, SectionCard, useToast } from './ui';
import { SERVICE_META, SERVICE_ORDER, defaultDefinition } from '../lib/constants';
import { serviceIcon } from '../lib/service-icons';

// Which columns of a list are worth documenting. Only numeric ones: a
// definition explains a metric, and the text columns ('url', 'note', 'type')
// are fields, not measurements.
function metricsForService(service) {
  const meta = SERVICE_META[service];
  if (!meta) return [];
  const out = new Map();

  for (const m of meta.coreMetrics || []) out.set(m.key, { key: m.key, label: m.label, source: 'core' });

  for (const list of meta.lists || []) {
    for (const col of list.columns || []) {
      if (col.type !== 'number') continue;
      // Same key can appear in several tables ('sessions' is in both GA4
      // tables, 'reach' is a core metric and a Top Posts column). One
      // definition per (service, key), so the first label wins.
      if (!out.has(col.key)) out.set(col.key, { key: col.key, label: col.label, source: list.label });
    }
  }
  return [...out.values()];
}

function MetricRow({ service, metric, override, onSaved }) {
  const { push } = useToast();
  const fallback = defaultDefinition(service, metric.key);
  const [value, setValue] = useState(override ?? fallback);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(override ?? fallback); }, [override, fallback]);

  const save = async () => {
    setSaving(true);
    try {
      await put('/api/metric-definitions', { service, metric_key: metric.key, definition: draft });
      setValue(draft.trim());
      setEditing(false);
      push(`Saved “${metric.label}”`, 'success');
      onSaved();
    } catch (e) { push(e.message, 'error'); }
    setSaving(false);
  };

  const isOverride = Boolean(override);
  const isBlank = !value;

  return (
    <div className='rounded-xl border border-slate-200 dark:border-slate-700 p-3'>
      <div className='flex flex-wrap items-center gap-2 mb-1.5'>
        <span className='text-sm font-semibold text-slate-800 dark:text-slate-200'>{metric.label}</span>
        <code className='text-[11px] text-slate-400 dark:text-slate-500'>{metric.key}</code>
        {isOverride
          ? <Badge color='indigo'>edited</Badge>
          : <Badge color='slate'>default</Badge>}
        {isBlank && <Badge color='amber'>no wording</Badge>}
        <span className='ml-auto text-[11px] text-slate-400 dark:text-slate-500'>{metric.source}</span>
      </div>

      {editing ? (
        <div className='space-y-2'>
          <Textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='Explain this metric in plain language for the client…' />
          <div className='flex items-center gap-2'>
            <Button size='sm' disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Save'}</Button>
            <button onClick={() => setEditing(false)} className='text-xs font-semibold text-slate-500 dark:text-slate-400'>Cancel</button>
          </div>
        </div>
      ) : (
        <div className='flex items-start justify-between gap-3'>
          <p className={`text-sm leading-relaxed ${isBlank ? 'text-amber-600 dark:text-amber-500 italic' : 'text-slate-600 dark:text-slate-300'}`}>
            {isBlank ? 'No definition yet — clients see nothing behind the ⓘ.' : value}
          </p>
          <button onClick={() => { setDraft(value); setEditing(true); }}
            className='shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline'>
            <Pencil className='w-3 h-3' /> Edit
          </button>
        </div>
      )}
    </div>
  );
}

/*
 * MetricDefinitionsTab — the admin console's Definitions tab.
 *
 * Lists every metric the app knows about, per service, with its current wording
 * (a database override if one exists, otherwise the built-in default from
 * src/lib/constants.js) and an inline editor.
 *
 * Custom metrics found in existing reports are listed after the built-ins, so
 * a metric someone invented for one client can be documented too. They have no
 * default, so they show as "no wording".
 */
export default function MetricDefinitionsTab() {
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [definitions, setDefinitions] = useState({});
  const [custom, setCustom] = useState({});
  const [migrationMissing, setMigrationMissing] = useState(false);

  const load = async () => {
    try {
      const data = await get('/api/metric-definitions');
      setDefinitions(data?.definitions || {});
      setCustom(data?.custom || {});
      setMigrationMissing(Boolean(data?.migrationMissing));
    } catch (e) { push(e.message, 'error'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byService = useMemo(() => Object.fromEntries(
    SERVICE_ORDER.map((s) => {
      const known = metricsForService(s);
      const knownKeys = new Set(known.map((m) => m.key));
      const extras = (custom[s] || [])
        .filter((k) => !knownKeys.has(k))
        .map((k) => ({ key: k, label: k, source: 'from reports' }));
      return [s, [...known, ...extras]];
    }),
  ), [custom]);

  if (loading) return <FullLoader />;

  return (
    <div className='space-y-6'>
      <div className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4 flex items-start gap-3'>
        <Info className='w-4 h-4 text-indigo-500 mt-0.5 shrink-0' />
        <div className='text-sm text-slate-600 dark:text-slate-300'>
          These are the explanations shown behind the <b>ⓘ</b> on a metric — in the report editor and on the client dashboard.
          Metrics marked <Badge color='slate'>default</Badge> use the built-in wording; editing one creates an override that applies
          to <b>every client and every month</b>.
        </div>
      </div>

      {migrationMissing && (
        <div className='rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 flex items-start gap-3'>
          <AlertTriangle className='w-4 h-4 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0' />
          <div className='text-sm text-amber-800 dark:text-amber-400'>
            <b>Editing is disabled until the database has been prepared.</b> Run{' '}
            <code className='font-semibold'>supabase/migrations/0007_metric_definitions.sql</code> in the Supabase SQL editor,
            then reload this page. The wording below is still correct — it is the built-in default.
          </div>
        </div>
      )}

      {SERVICE_ORDER.map((service) => {
        const meta = SERVICE_META[service];
        const rows = byService[service] || [];
        if (!rows.length) return null;
        const Icon = serviceIcon(meta.icon);
        const edited = rows.filter((m) => definitions[service]?.[m.key]).length;
        return (
          <SectionCard key={service} title={meta.label} icon={Icon} accent={meta.accent}
            subtitle={`${rows.length} metric${rows.length === 1 ? '' : 's'} · ${edited} edited`}>
            <div className='space-y-2'>
              {rows.map((m) => (
                <MetricRow key={m.key} service={service} metric={m}
                  override={definitions[service]?.[m.key]} onSaved={load} />
              ))}
            </div>
          </SectionCard>
        );
      })}

      {!SERVICE_ORDER.some((s) => (byService[s] || []).length) && (
        <InlineEmpty>No metrics found to document.</InlineEmpty>
      )}
    </div>
  );
}
