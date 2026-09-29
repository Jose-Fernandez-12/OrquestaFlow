import React, { useEffect, useRef, useState } from 'react';
import { NodeResizer, useReactFlow } from '@xyflow/react';
import { StickyNote } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { NOTE_COLORS } from './noteColors';

interface NoteNodeProps {
  id: string;
  data: { text?: string; color?: string; label?: string };
  selected?: boolean;
}

/** Free-text note to document the flow. It has no connections and the engine ignores it. */
function NoteNodeComponent({ id, data, selected }: NoteNodeProps) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.text || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const tone = NOTE_COLORS[data.color || 'amarillo'] || NOTE_COLORS.amarillo;

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== (data.text || '')) updateNodeData(id, { text: draft });
  };

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={160}
        minHeight={80}
        lineClassName="!border-accent/40"
        handleClassName="!w-2 !h-2 !bg-surface !border-accent"
      />
      <div
        className={cn(
          'w-full h-full min-w-[160px] min-h-[80px] rounded-md border shadow-sm flex flex-col overflow-hidden',
          tone.card,
          tone.border,
          selected && 'ring-2 ring-accent/30'
        )}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(data.text || '');
          setEditing(true);
        }}
      >
        <div className={cn('flex items-center gap-1.5 px-2.5 pt-2 text-[10px] font-semibold uppercase tracking-wide opacity-70', tone.text)}>
          <StickyNote size={11} />
          Nota
        </div>
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft(data.text || '');
                setEditing(false);
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
            }}
            className={cn('nodrag nowheel flex-1 w-full resize-none bg-transparent px-2.5 py-1.5 text-xs leading-relaxed focus:outline-none', tone.text)}
            placeholder="Escribe una nota…"
          />
        ) : (
          <div className={cn('flex-1 px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-words overflow-hidden', tone.text)}>
            {data.text?.trim() ? data.text : <span className="italic opacity-60">Doble clic para escribir una nota</span>}
          </div>
        )}
      </div>
    </>
  );
}

export const NoteNode = React.memo(NoteNodeComponent);
