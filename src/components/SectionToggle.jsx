import { Eye, EyeOff } from 'lucide-react';

/*
 * SectionToggle — a small on/off switch for report sections.
 * When off, the section is hidden from the client dashboard.
 * Renders in the SectionCard's actions area.
 */
export function SectionToggle({ visible, onChange, accent = '#6366f1' }) {
  const on = visible !== false; // default true if undefined
  return (
    <button
      onClick={() => onChange(!on)}
      className='inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold transition shrink-0'
      style={on ? { backgroundColor: accent + '15', color: accent } : { backgroundColor: '#f1f5f9', color: '#94a3b8' }}
      title={on ? 'Visible to client — click to hide' : 'Hidden from client — click to show'}
    >
      {on ? <Eye className='w-3.5 h-3.5' /> : <EyeOff className='w-3.5 h-3.5' />}
      <span className='hidden sm:inline'>{on ? 'Visible' : 'Hidden'}</span>
    </button>
  );
}
