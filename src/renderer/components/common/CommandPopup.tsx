import { useEffect, useRef } from 'react';
import type { CommandSuggestion } from '../../lib/commands';

const KIND_LABEL: Record<CommandSuggestion['kind'], string> = {
  agent: 'agent',
  skill: 'skill',
  command: 'command',
  builtin: 'built-in',
  app: 'app',
};

/** The list shown above the composer while the user types "/". Mouse picks keep the textarea focused. */
export function CommandPopup({ items, active, onPick, onHover }: {
  items: CommandSuggestion[];
  active: number;
  onPick: (item: CommandSuggestion) => void;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className="command-popup" role="listbox" aria-label="Commands" ref={listRef}>
      {items.map((item, i) => (
        <div
          key={item.key}
          role="option"
          aria-selected={i === active}
          className={`command-item${i === active ? ' active' : ''}`}
          title={item.source ? `${item.kind} · ${item.source}` : item.kind}
          onMouseDown={(e) => { e.preventDefault(); onPick(item); }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="command-name">{item.label}</span>
          {item.argumentHint && <span className="command-hint">{item.argumentHint}</span>}
          <span className={`command-kind kind-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
          {item.description && <span className="command-desc">{item.description}</span>}
        </div>
      ))}
    </div>
  );
}
