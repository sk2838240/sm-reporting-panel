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
export function DraggableSection({ id, order, onReorder, children }) {
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
      {/* Drag handle — visible on hover */}
      <div className='absolute -left-5 top-5 z-10 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition hidden lg:flex' title='Drag to reorder'>
        <svg width='8' height='18' viewBox='0 0 8 18' fill='none'>
          <circle cx='2' cy='3' r='1.5' fill='#94a3b8' />
          <circle cx='6' cy='3' r='1.5' fill='#94a3b8' />
          <circle cx='2' cy='9' r='1.5' fill='#94a3b8' />
          <circle cx='6' cy='9' r='1.5' fill='#94a3b8' />
          <circle cx='2' cy='15' r='1.5' fill='#94a3b8' />
          <circle cx='6' cy='15' r='1.5' fill='#94a3b8' />
        </svg>
      </div>
      {children}
    </div>
  );
}
