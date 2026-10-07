import { Eye, EyeOff } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

/*
 * SectionToggle — a small on/off switch for report sections.
 * When off, the section is hidden from the client dashboard.
 * Renders in the SectionCard's actions area.
 */
export function SectionToggle({ visible, onChange, accent = '#6366f1' }) {
  const on = visible !== false; // default true if undefined
  // The off state was hard-coded to #f1f5f9 / #94a3b8 — slate-100 and
  // slate-400 — with no dark branch, so a hidden section's toggle was a
  // near-white chip on the dark card, right beside the now dark-aware Badge.
  // Theme-aware classes replace the literal hex values.
  const { dark } = useTheme();
  const off = dark
    ? { backgroundColor: '#334155', color: '#94a3b8' }   // slate-700 / slate-400
    : { backgroundColor: '#f1f5f9', color: '#64748b' };   // slate-100 / slate-500
  return (
    <button
      type='button' aria-pressed={on}
      onClick={() => onChange(!on)}
      className='inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold transition shrink-0'
      style={on ? { backgroundColor: accent + '15', color: accent } : off}
      title={on ? 'Visible to client — click to hide' : 'Hidden from client — click to show'}
    >
      {on ? <Eye className='w-3.5 h-3.5' /> : <EyeOff className='w-3.5 h-3.5' />}
      <span className='hidden sm:inline'>{on ? 'Visible' : 'Hidden'}</span>
    </button>
  );
}
