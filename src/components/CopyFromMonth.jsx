import { useState, useEffect } from 'react';
import { Copy, AlertTriangle } from 'lucide-react';
import { get } from '../lib/api';
import { Button, Select, Field, Modal, useToast } from './ui';

/*
 * CopyFromMonth — "copy from a previous month" for a report section.
 *
 * Fetches the client+service report list when opened, lets the admin pick a
 * source period, and hands the chosen report to `onCopy`. Values from the
 * source REPLACE whatever is currently in the section (a deliberate product
 * decision — the point is to re-baseline on last month's figures), so the
 * dialog says so plainly rather than surprising anyone.
 *
 * `what` describes the affected values, e.g. "Custom metrics".
 */
export function CopyFromMonth({ report, onCopy, accent, what = 'Values', label = 'Copy from month' }) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState([]);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rs = await get(`/api/reports?clientId=${report.client_id}&service=${report.service}`);
        if (cancelled) return;
        // Newest first, excluding the report being edited.
        const previous = (rs || [])
          .filter((r) => r.id !== report.id)
          .sort((a, b) => new Date(b.period_start) - new Date(a.period_start));
        setReports(previous);
        setSource(previous.length ? String(previous[0].period_start) : '');
      } catch (e) {
        if (!cancelled) push(e.message, 'error');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, report.client_id, report.service, report.id, push]);

  const chosen = reports.find((r) => String(r.period_start) === String(source));

  const apply = () => {
    if (!chosen) { push('Pick a month to copy from', 'error'); return; }
    onCopy(chosen);
    setOpen(false);
  };

  return (
    <>
      <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
        <Copy className='w-3.5 h-3.5' /> {label}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={label}
        footer={<>
          <Button variant='outline' onClick={() => setOpen(false)}>Cancel</Button>
          <Button accent={accent} variant='accent' disabled={!chosen || loading} onClick={apply}>Copy values</Button>
        </>}>
        {loading ? (
          <p className='text-sm text-slate-400 dark:text-slate-500'>Loading previous reports…</p>
        ) : reports.length === 0 ? (
          <p className='text-sm text-slate-500 dark:text-slate-400'>
            There are no earlier reports for this client and service to copy from yet.
          </p>
        ) : (
          <div className='space-y-4'>
            <Field label='Copy from'>
              <Select value={source} onChange={(e) => setSource(e.target.value)}>
                {reports.map((r) => (
                  <option key={r.id} value={r.period_start}>
                    {r.period_label}{r.status === 'draft' ? ' — draft, not published' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <div className='flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-400'>
              <AlertTriangle className='w-4 h-4 mt-0.5 shrink-0' />
              <span>
                {what} already entered for this period will be <b>replaced</b> by the values from
                the month you pick. You can keep editing after copying.
              </span>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
