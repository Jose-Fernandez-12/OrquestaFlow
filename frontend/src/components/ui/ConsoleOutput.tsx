import React, { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';

export type ConsoleStream = 'stdout' | 'stderr' | 'stdin' | 'system';
export interface ConsoleChunk { stream: ConsoleStream; text: string; ts?: number }

const STREAM_STYLES: Record<ConsoleStream, string> = {
  stdout: 'text-surface/90',
  stderr: 'text-red-400',
  stdin: 'text-sky-300',
  system: 'text-surface/50 italic',
};

interface ConsoleOutputProps {
  chunks: ConsoleChunk[];
  emptyText: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

/** Terminal-like output: stderr in red, typed input in blue, follows new output unless scrolled up */
export function ConsoleOutput({ chunks, emptyText, className, onClick }: ConsoleOutputProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (chunks.length === 0) stickToBottom.current = true;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [chunks]);

  return (
    <div
      ref={ref}
      onScroll={e => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      onClick={onClick}
      className={cn('overflow-auto bg-fg p-3 font-mono text-xs leading-relaxed', className)}
    >
      {chunks.length === 0 ? (
        <div className="text-surface/40">{emptyText}</div>
      ) : (
        <pre className="whitespace-pre-wrap break-words">
          {chunks.map((c, i) => (
            <span key={i} className={STREAM_STYLES[c.stream]}>{c.stream === 'stdin' ? `› ${c.text}` : c.text}</span>
          ))}
        </pre>
      )}
    </div>
  );
}
