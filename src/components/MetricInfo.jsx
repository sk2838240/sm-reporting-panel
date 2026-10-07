import { useState, useEffect, useRef } from 'react';
import { Info, Pencil, Check, X } from 'lucide-react';
import { get, put } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast, Textarea } from './ui';
import { defaultDefinition } from '../lib/constants';

/*
 * MetricInfo — the ⓘ button that explains what a metric means.
 *
 * The definition shown is the built-in default (src/lib/constants.js) unless a
 * row in metric_definitions overrides it, so this renders correctly even before
 * migration 0007 has been applied. The override is fetched lazily, the first
 * time the popover is opened, rather than shipping every definition with every
 * page.
 *
 * Super admins can reword the definition inline. That is deliberate: the
 * wording is agency-wide, so it is not a team admin's to change.
 */
export function MetricInfo({ service, metricKey, name }) {
  const { profile } = useAuth();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [definition, setDefinition] = useState(() => defaultDefinition(service, metricKey));
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef(null);

  const canEdit = profile?.role === 'super_admin';

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setEditing(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setEditing(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openPopover = async (e) => {
    // The button often sits inside a <label>, where a click would forward focus
    // to the associated input and pull the user out of the popover.
    e.preventDefault();
    e.stopPropagation();
    const next = !open;
    setOpen(next);
    setEditing(false);
    if (!next || fetched) return;

    setFetched(true);
    try {
      const data = await get(`/api/metric-definitions?service=${encodeURIComponent(service)}&metricKey=${encodeURIComponent(metricKey)}`);
      const override = data?.definitions?.[metricKey];
      // An absent override is the normal case, not a failure — keep the default.
      if (override) setDefinition(override);
    } catch {
      // Offline, or the route is unavailable. The built-in default is already
      // on screen, so there is nothing to report.
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await put('/api/metric-definitions', { service, metric_key: metricKey, definition: draft });
      setDefinition(draft.trim());
      setEditing(false);
      push('Definition saved', 'success');
    } catch (e) { push(e.message, 'error'); }
    setSaving(false);
  };

  return (
    <span ref={wrapRef} className='relative inline-flex align-middle'>
      <button
        type='button'
        onClick={openPopover}
        aria-label={`What is ${name || metricKey}?`}
        aria-expanded={open}
        className='inline-flex items-center justify-center rounded-full text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 no-print'
      >
        <Info className='w-3.5 h-3.5' />
      </button>

      {open && (
        <div role='dialog' aria-label={`Definition of ${name || metricKey}`}
          className='absolute left-0 top-full mt-2 z-50 w-72 max-w-[80vw] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-lg text-left'>
          <div className='flex items-start justify-between gap-2 mb-1.5'>
            <span className='text-xs font-bold text-slate-900 dark:text-slate-100'>{name || metricKey}</span>
            <button type='button' onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); setEditing(false); }}
              className='text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0'>
              <X className='w-3.5 h-3.5' />
            </button>
          </div>

          {editing ? (
            <div className='space-y-2'>
              <Textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} className='text-xs' />
              <div className='flex items-center gap-2'>
                <button type='button' onClick={(e) => { e.preventDefault(); e.stopPropagation(); save(); }} disabled={saving}
                  className='inline-flex items-center gap-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-2.5 py-1 text-xs font-semibold disabled:opacity-60'>
                  <Check className='w-3 h-3' /> {saving ? 'Saving...' : 'Save'}
                </button>
                <button type='button' onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(false); }}
                  className='text-xs font-semibold text-slate-500 dark:text-slate-400'>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <p className='text-xs leading-relaxed text-slate-600 dark:text-slate-300'>
                {definition || 'No definition written for this metric yet.'}
              </p>
              {canEdit && (
                <button type='button' onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDraft(definition); setEditing(true); }}
                  className='mt-2 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline'>
                  <Pencil className='w-3 h-3' /> Edit
                </button>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
