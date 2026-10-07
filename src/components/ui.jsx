import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Info, X, ChevronDown, Loader2, ArrowLeft } from 'lucide-react';

/* ---------------- Back navigation ---------------- */

// React Router keeps a stack index in history state. A fresh tab or a direct
// deep link starts at 0, where navigate(-1) would leave the app entirely —
// so in that case we fall back to an explicit destination instead.
function useCanGoBack() {
  if (typeof window === 'undefined') return false;
  return (window.history.state?.idx ?? 0) > 0;
}

/*
 * BackButton — returns the user to the screen they navigated from.
 * Uses real history-back when there is somewhere to go, otherwise lands on
 * `to` (replace, so it doesn't pollute the history stack).
 */
export function BackButton({ to = '/app', label = 'Back', className = '' }) {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();

  const go = () => {
    if (canGoBack) navigate(-1);
    else navigate(to, { replace: true });
  };

  return (
    <button
      type='button'
      onClick={go}
      className={`inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition ${className}`}
    >
      <ArrowLeft className='w-4 h-4' /> {label}
    </button>
  );
}

/* ---------------- Toasts ---------------- */
const ToastCtx = createContext();
// Stable fallback for useToast() when the provider is not mounted — a fresh
// object per call would give consumers a new context identity every render.
const noopPush = () => {};
const NOOP_TOAST = { push: noopPush };

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Must be referentially stable. Every page puts `push` in a useCallback dep
  // array for its data loader, so an identity that changed on each render made
  // the provider re-render (every toast, plus every auto-dismiss) invalidate
  // those loaders and refetch. A failing request pushed a toast, whose render
  // re-ran the loader, which failed again — an unbounded error loop.
  const push = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);
  const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
  const colors = { success: 'text-emerald-600', error: 'text-rose-600', info: 'text-indigo-600' };
  return (
    <ToastCtx.Provider value={useMemo(() => ({ push }), [push])}>
      {children}
      <div className='fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-[92vw]'>
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = icons[t.type] || Info;
            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }}
                className='flex items-center gap-2 rounded-xl bg-white dark:bg-slate-800 shadow-lg shadow-slate-900/10 border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-medium text-slate-800 dark:text-slate-200'>
                <Icon className={`w-4 h-4 ${colors[t.type]}`} />
                <span>{t.message}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
// Tolerates being called outside the provider: loaders invoke push() from
// effects that can run before the tree above them is mounted, and useContext
// returns undefined there, which would throw.
export const useToast = () => useContext(ToastCtx) || NOOP_TOAST;

/* ---------------- Spinner ---------------- */
export function Spinner({ size = 24, className = '' }) {
  return <Loader2 className={`animate-spin text-slate-400 ${className}`} style={{ width: size, height: size }} />;
}
export function FullLoader({ label = 'Loading...' }) {
  return (
    <div className='flex flex-col items-center justify-center py-16 gap-3 text-slate-400'>
      <Spinner size={28} />
      <span className='text-sm font-medium'>{label}</span>
    </div>
  );
}

/* ---------------- Card ---------------- */
// The surface itself lives in index.css as `.card-surface`, which all 24 of the
// hand-rolled card class strings now use too. It was previously defined three
// times over — here, in the token block, and as 23 inline copies.
export function Card({ children, className = '', accent }) {
  return (
    <div className={`card-surface ${className}`} style={accent ? { borderColor: accent + '55' } : undefined}>
      {children}
    </div>
  );
}
export function SectionCard({ title, subtitle, icon: Icon, actions, accent, children, className = '' }) {
  return (
    <Card accent={accent} className={`overflow-hidden ${className}`}>
      <div className='flex items-start justify-between gap-3 px-5 pt-5 pb-3'>
        <div className='flex items-start gap-3 min-w-0'>
          {Icon && (
            <div className='mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl' style={{ background: (accent || '#6366f1') + '1a', color: accent || '#6366f1' }}>
              <Icon className='w-5 h-5' />
            </div>
          )}
          <div className='min-w-0'>
            {/* dark: was missing here, so every SectionCard title rendered
                slate-900 on dark:bg-slate-800 — near-invisible in dark mode
                across all 19 usages, including the report editor's sections. */}
            <h3 className='text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-tight'>{title}</h3>
            {subtitle && <p className='text-xs text-slate-500 dark:text-slate-400 mt-0.5'>{subtitle}</p>}
          </div>
        </div>
        {actions && <div className='flex items-center gap-2 shrink-0'>{actions}</div>}
      </div>
      <div className='px-5 pb-5'>{children}</div>
    </Card>
  );
}

/* ---------------- Badge / Pill ---------------- */
export function Badge({ children, color = 'slate', className = '' }) {
  // Every colour had a light-mode pairing only, so in dark mode a badge was a
  // near-white chip with dark text on dark:bg-slate-800 — the brightest thing
  // on the page. These mirror ClientDashboard's DeltaPill, which had them right.
  const map = {
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    sky: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[color] || map.slate} ${className}`}>{children}</span>;
}
// DeltaBadge was removed: never imported, and ClientDashboard's local DeltaPill
// is the live implementation of the same concept. Keeping both meant two
// renderings of one green/rose pill with different padding and weight.

/* ---------------- Button ---------------- */
export function Button({ children, variant = 'primary', size = 'md', className = '', accent, ...props }) {
  const variants = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white disabled:bg-slate-300 dark:disabled:bg-slate-700',
    accent: 'text-white hover:brightness-110 disabled:opacity-50',
    outline: 'border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50',
    ghost: 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50',
    danger: 'bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' };
  const style = variant === 'accent' && accent ? { backgroundColor: accent } : undefined;
  return (
    <button className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`} style={style} {...props}>
      {children}
    </button>
  );
}

/* ---------------- Form fields ---------------- */
export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className='block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5'>{label}</span>}
      {children}
      {hint && <span className='block text-[11px] text-slate-400 dark:text-slate-500 mt-1'>{hint}</span>}
    </label>
  );
}
const inputBase = 'w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition';
export function Input({ className = '', ...props }) {
  return <input className={`${inputBase} ${className}`} {...props} />;
}
export function Textarea({ className = '', ...props }) {
  return <textarea className={`${inputBase} resize-y min-h-[80px] ${className}`} {...props} />;
}
export function Select({ className = '', children, ...props }) {
  return (
    <div className='relative'>
      <select className={`${inputBase} appearance-none pr-9 ${className}`} {...props}>{children}</select>
      <ChevronDown className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500' />
    </div>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className='fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm' onClick={onClose}>
          <motion.div initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'} rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col`}>
            {/* The modal frame had no dark: variants at all, and it is the frame
                for every destructive confirm in the app — exactly where a user
                must be able to read the warning clearly. */}
            <div className='flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700'>
              <h3 className='text-base font-semibold text-slate-900 dark:text-slate-100'>{title}</h3>
              <button onClick={onClose} aria-label='Close' className='text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1 -m-1'><X className='w-5 h-5' /></button>
            </div>
            <div className='px-5 py-4 overflow-y-auto'>{children}</div>
            {footer && <div className='flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 rounded-b-2xl'>{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------- DataTable ---------------- */
export function DataTable({ columns, rows, empty = 'No data yet.' }) {
  if (!rows || rows.length === 0) {
    return <div className='text-center py-8 text-sm text-slate-400 dark:text-slate-500'>{empty}</div>;
  }
  return (
    <div className='overflow-x-auto -mx-1'>
      <table className='w-full text-sm border-collapse'>
        <thead>
          <tr className='text-left'>
            {columns.map((c) => (
              <th key={c.key} className={`px-3 py-2 font-semibold text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap border-b border-slate-200 dark:border-slate-700`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i} className='group hover:bg-slate-50/80 dark:hover:bg-slate-700/50 transition'>
              {columns.map((c) => (
                <td key={c.key} className='px-3 py-2.5 text-slate-700 dark:text-slate-300 border-b border-slate-100 dark:border-slate-700 whitespace-nowrap'>
                  {c.render ? c.render(r, i) : (r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Empty state ---------------- */
export function EmptyState({ icon: Icon, title, message, action, accent = '#6366f1' }) {
  return (
    <div className='flex flex-col items-center justify-center text-center py-14 px-6'>
      {Icon && (
        <div className='flex h-14 w-14 items-center justify-center rounded-2xl mb-4' style={{ background: accent + '14', color: accent }}>
          <Icon className='w-7 h-7' />
        </div>
      )}
      <h3 className='text-base font-semibold text-slate-800 dark:text-slate-100'>{title}</h3>
      {message && <p className='text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm'>{message}</p>}
      {action && <div className='mt-5'>{action}</div>}
    </div>
  );
}

/* ---------------- Segmented control ---------------- */
// Replaces 11 hand-rolled "row of pill buttons, one selected" strips that had
// drifted apart in padding, selected state, hover treatment and dark-mode
// coverage. Two of them (ClientDetail and ClientDashboard service tabs) were a
// verbatim ~300-character copy-paste. Sizes: 'md' for page-level tab bars,
// 'sm' for inline filters. `accent` themes the selected pill per service.
export function SegmentedControl({ options, value, onChange, size = 'md', accent, tone = 'accent', className = '', ariaLabel }) {
  const dims = size === 'sm'
    ? 'px-2.5 py-1.5 text-xs gap-1.5'
    : 'px-3.5 py-2 text-sm gap-2';
  // tone='accent'  — selected pill takes the service/platform colour (page tabs)
  // tone='neutral' — selected pill is slate (filter chips, compare modes)
  const selectedNeutral = 'bg-slate-900 dark:bg-slate-700 text-white';
  return (
    <div role='tablist' aria-label={ariaLabel} className={`flex flex-row gap-1 overflow-x-auto ${className}`}>
      {options.map((o) => {
        const on = o.key === value;
        const selectedBg = tone === 'neutral'
          ? selectedNeutral
          : { backgroundColor: o.accentText || accent || '#6366f1' };
        return (
          <button
            key={o.key} type='button' role='tab' aria-selected={on}
            onClick={() => onChange(o.key)}
            className={`inline-flex items-center rounded-xl font-semibold whitespace-nowrap transition ${dims} ${
              on
                ? tone === 'neutral' ? selectedNeutral : 'text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
            // For accent tone the selected pill uses the service's own
            // accentText rather than accent: amber (#f59e0b) and pink (#ec4899)
            // both fall below 4.5:1 with white text. That token already existed
            // in SERVICE_META and was never referenced.
            style={on && tone === 'accent' ? selectedBg : undefined}
          >
            {/* Only tint the unselected icon when the option actually has a
                service/platform accent. The `|| '#6366f1'` fallback painted
                indigo icons next to slate labels inside the two `tone='neutral'`
                strips (the compare-mode selector and the DevOps tabs), where
                there is no service accent to inherit. */}
            {o.icon && <o.icon className='size-4' style={!on && (o.accent || accent) ? { color: o.accent || accent } : undefined} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Segmented toggle ---------------- */
// A multi-select strip: unlike SegmentedControl, several options can be on at
// once (service checkboxes, platform pickers). Replaces two more hand-rolled
// strips that both put white text on SERVICE_META[s].accent, which is 2.1:1 for
// Social's amber and 3.1:1 for Instagram's pink — below the 4.5:1 AA threshold.
export function SegmentedToggle({ options, values, onToggle, className = '', ariaLabel }) {
  return (
    <div role='group' aria-label={ariaLabel} className={`flex flex-wrap gap-2 ${className}`}>
      {options.map((o) => {
        const on = values.includes(o.key);
        return (
          <button
            key={o.key} type='button' aria-pressed={on}
            onClick={() => onToggle(o.key)}
            className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold border transition ${
              on
                ? 'text-white border-transparent'
                : 'text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
            style={on ? { backgroundColor: o.accentText || o.accent || '#6366f1', borderColor: o.accentText || o.accent || '#6366f1' } : undefined}
          >
            {o.dot && <span className='w-2 h-2 rounded-full' style={{ background: on ? '#fff' : (o.accent || '#6366f1') }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Inline empty state ---------------- */
// The most-repeated pattern in the app was a bare
// `<p className='text-sm text-slate-400 dark:text-slate-500'>` used as an empty
// state — 18 of them, two missing the dark: variant entirely. This gives them
// one name while keeping the compact inline look.
export function InlineEmpty({ children, className = '' }) {
  return <p className={`text-sm text-slate-400 dark:text-slate-500 text-center py-4 ${className}`}>{children}</p>;
}

/* ---------------- Icon button ---------------- */
// The delete-row control existed in four shapes across 12 sites (p-2 vs p-1.5,
// rounded-lg vs rounded, slate-400 vs slate-300, one missing its dark: hover).
// One shape now. `label` is required so no icon-only control ships unnamed.
export function IconButton({ label, tone = 'neutral', size = 'md', padding, className = '', children, ...props }) {
  // `padding` exists because CSS resolves conflicting padding utilities by
  // stylesheet order, not class-attribute order — so a caller passing
  // className="p-0.5" would NOT reliably beat the internal p-1.5. Callers that
  // need a different padding pass it here instead.
  const pad = padding ?? (size === 'sm' ? 'p-1.5' : 'p-2');
  const tones = {
    neutral: 'text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-700',
    danger: 'text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-500 dark:hover:bg-rose-900/20',
    amber: 'text-slate-400 hover:bg-amber-50 hover:text-amber-600 dark:text-slate-500 dark:hover:bg-amber-900/20',
  };
  return (
    <button
      // Spread first so the required `label` stays authoritative — a caller
      // cannot accidentally shadow it with a title/aria-label of its own.
      {...props}
      type='button' title={label} aria-label={label}
      className={`${pad} rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone] || tones.neutral} ${className}`}
    >
      {children}
    </button>
  );
}

/* ---------------- Confirm dialog ---------------- */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmText = 'Confirm', danger }) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<>
        <Button variant='outline' onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmText}</Button>
      </>}>
      <p className='text-sm text-slate-600 dark:text-slate-300'>{message}</p>
    </Modal>
  );
}
