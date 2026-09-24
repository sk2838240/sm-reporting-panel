import { createContext, useContext, useState, useEffect } from 'react';
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
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  };
  const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
  const colors = { success: 'text-emerald-600', error: 'text-rose-600', info: 'text-indigo-600' };
  return (
    <ToastCtx.Provider value={{ push }}>
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
export const useToast = () => useContext(ToastCtx);

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
export function Card({ children, className = '', accent }) {
  return (
    <div className={`rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-sm ${className}`} style={accent ? { borderColor: accent + '55' } : undefined}>
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
            <h3 className='text-[15px] font-semibold text-slate-900 leading-tight'>{title}</h3>
            {subtitle && <p className='text-xs text-slate-500 mt-0.5'>{subtitle}</p>}
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
  const map = {
    slate: 'bg-slate-100 text-slate-600',
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    sky: 'bg-sky-50 text-sky-700',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[color] || map.slate} ${className}`}>{children}</span>;
}
export function DeltaBadge({ delta }) {
  if (!delta || delta.abs === null || delta.abs === undefined) return <span className='text-xs text-slate-400 font-medium'>—</span>;
  const up = delta.abs > 0;
  const flat = delta.abs === 0;
  let good = delta.good;
  if (flat) good = null;
  const color = good === null ? 'slate' : good ? 'emerald' : 'rose';
  const sign = up ? '+' : '';
  const pct = delta.pct !== null ? ` · ${sign}${delta.pct.toFixed(1)}%` : '';
  return <Badge color={color}>{sign}{Math.abs(delta.abs) >= 1000 ? Math.round(delta.abs).toLocaleString() : delta.abs.toFixed(delta.abs % 1 ? 1 : 0)}{pct}</Badge>;
}

/* ---------------- Button ---------------- */
export function Button({ children, variant = 'primary', size = 'md', className = '', accent, ...props }) {
  const variants = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300',
    accent: 'text-white hover:brightness-110 disabled:opacity-50',
    outline: 'border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50',
    ghost: 'text-slate-600 hover:bg-slate-100 disabled:opacity-50',
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
      {label && <span className='block text-xs font-semibold text-slate-600 mb-1.5'>{label}</span>}
      {children}
      {hint && <span className='block text-[11px] text-slate-400 mt-1'>{hint}</span>}
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
      <ChevronDown className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400' />
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
            <div className='flex items-center justify-between px-5 py-4 border-b border-slate-100'>
              <h3 className='text-base font-semibold text-slate-900'>{title}</h3>
              <button onClick={onClose} className='text-slate-400 hover:text-slate-700 p-1 -m-1'><X className='w-5 h-5' /></button>
            </div>
            <div className='px-5 py-4 overflow-y-auto'>{children}</div>
            {footer && <div className='flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl'>{footer}</div>}
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
      <h3 className='text-base font-semibold text-slate-800'>{title}</h3>
      {message && <p className='text-sm text-slate-500 mt-1 max-w-sm'>{message}</p>}
      {action && <div className='mt-5'>{action}</div>}
    </div>
  );
}

/* ---------------- Tabs ---------------- */
export function Tabs({ tabs, active, onChange, layout = 'row' }) {
  return (
    <div className={`flex ${layout === 'row' ? 'flex-row gap-1 overflow-x-auto' : 'flex-col gap-1'}`}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button key={t.key} onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition ${on ? 'text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
            style={on ? { backgroundColor: t.accent || '#6366f1' } : undefined}>
            {t.icon && <t.icon className='w-4 h-4' style={on ? undefined : { color: t.accent || '#6366f1' }} />}
            {t.label}
          </button>
        );
      })}
    </div>
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
      <p className='text-sm text-slate-600'>{message}</p>
    </Modal>
  );
}
