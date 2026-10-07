import { useState } from 'react';

/*
 * DraggableSection — wraps a SectionCard to make it draggable for reordering.
 * Uses native HTML5 drag-and-drop + CSS flexbox order for visual repositioning.
 *
 * Props:
 *   id: unique section id (used in sectionOrder array)
 *   order: numeric CSS order value
 *   onReorder: (fromId, toId) => void
 *   accent: color for drag-over highlight
 *   children: the SectionCard
 */
export function DraggableSection({ id, order, onReorder, accent = '#6366f1', label = 'section', children }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const handleDragStart = (e) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setIsOver(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsOver(true);
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsOver(false);
    const fromId = e.dataTransfer.getData('text/plain');
    if (fromId === id) return;
    onReorder(fromId, id);
  };

  // HTML5 drag-and-drop does not fire on iOS/Android, and a <div> handle is not
  // focusable — so reordering was unusable on any phone or by keyboard. The
  // handle is a real button: ArrowUp / ArrowDown swap with the neighbouring
  // section (one slot per press, not a jump to the end), and it stays visible on
  // touch where there is no hover to reveal it.
  const handleKeyDown = (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    // 'prev' / 'next' are resolved by the parent against its own section list.
    onReorder(id, e.key === 'ArrowUp' ? '@prev' : '@next');
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ order, marginBottom: '1.5rem' }}
      className={`group relative transition ${isDragging ? 'opacity-40' : ''} ${isOver ? 'ring-2 ring-offset-2' : ''}`}
    >
      <button
        type='button'
        onKeyDown={handleKeyDown}
        title={`Reorder ${label} — drag, or focus and use the arrow keys`}
        aria-label={`Reorder ${label}. Use arrow up or arrow down to move it.`}
        // focus-visible, not focus: a mouse click on the handle focuses the
        // button, and `focus:opacity-100` would leave it permanently visible on
        // desktop after the first interaction.
        className='absolute -left-4 sm:-left-5 top-5 z-10 cursor-grab active:cursor-grabbing opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 focus-visible:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition flex rounded p-0.5'
        style={isOver ? { boxShadow: `0 0 0 2px ${accent}` } : undefined}
      >
        <svg width='8' height='18' viewBox='0 0 8 18' fill='none' aria-hidden='true'>
          <circle cx='2' cy='3' r='1.5' fill='#94a3b8' />
          <circle cx='6' cy='3' r='1.5' fill='#94a3b8' />
          <circle cx='2' cy='9' r='1.5' fill='#94a3b8' />
          <circle cx='6' cy='9' r='1.5' fill='#94a3b8' />
          <circle cx='2' cy='15' r='1.5' fill='#94a3b8' />
          <circle cx='6' cy='15' r='1.5' fill='#94a3b8' />
        </svg>
      </button>
      {children}
    </div>
  );
}
