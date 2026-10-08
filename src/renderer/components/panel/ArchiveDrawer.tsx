/**
 * The project's archive of retired and closed agent chats, in a drawer beside the chat panel:
 * the list (newest first) on the left, the read-only chat of the selected one on the right.
 * Nothing here can talk to an agent. The window is widened by the main process while it is open.
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { MessageLog } from '../common/MessageLog';
import { formatTokens } from '../../lib/format';
import type { ArchivedAgent } from '../../types';

interface ArchiveDrawerProps {
  open: boolean;
  /** The active project's id; the selection starts over when it changes. */
  wsId: string | null;
  archive: ArchivedAgent[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

const totalTokens = (a: ArchivedAgent) => a.usage.input + a.usage.output + a.usage.cacheRead + a.usage.cacheCreate;
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const timeOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function duration(a: ArchivedAgent): string {
  if (!a.endedAt || a.endedAt < a.startedAt) return '';
  const s = Math.round((a.endedAt - a.startedAt) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
const REASONS = { idle: 'retired after being idle', closed: 'tab closed' } as const;
const EMPTY = 'No archived chats yet. Finished agents land here after 2 minutes idle or when you close their tab.';

export function ArchiveDrawer({ open, wsId, archive, onClose, onDelete, onClear }: ArchiveDrawerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { setSelectedId(null); }, [wsId]);
  useEffect(() => { if (!open) { setConfirmClear(false); if (timer.current) clearTimeout(timer.current); } }, [open]);

  const newestFirst = [...archive].reverse();
  // The default is the newest; a chat that disappeared (deleted, cleared) falls back to it too.
  const selected = newestFirst.find((a) => a.id === selectedId) ?? newestFirst[0] ?? null;

  const clear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      timer.current = setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setConfirmClear(false);
    onClear();
  };

  const onListKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = newestFirst.findIndex((a) => a.id === selected?.id);
    const next = newestFirst[Math.min(newestFirst.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    setSelectedId(next.id);
    requestAnimationFrame(() => document.getElementById(`archive-item-${next.id}`)?.focus());
  };

  return (
    <aside id="archive-drawer" className="interactive" role="complementary" aria-label="Archive" hidden={!open}>
      {open && (
        <>
          <div className="archive-side">
            <div className="archive-head">
              <strong className="archive-title">{`Archive (${archive.length})`}</strong>
              {archive.length > 0 && (
                <button type="button" className={`archive-clear${confirmClear ? ' confirm' : ''}`} onClick={clear}>
                  {confirmClear ? 'Clear all?' : 'Clear all'}
                </button>
              )}
            </div>
            {archive.length === 0 ? (
              <div className="archive-empty">{EMPTY}</div>
            ) : (
              <div className="archive-list" role="listbox" aria-label="Archived chats" onKeyDown={onListKey}>
                {newestFirst.map((a) => (
                  <div key={a.id} id={`archive-item-${a.id}`} role="option" aria-selected={a.id === selected?.id} tabIndex={0}
                    className={`archive-item${a.id === selected?.id ? ' selected' : ''}`}
                    onClick={() => setSelectedId(a.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(a.id); } }}>
                    <div className="archive-row">
                      <span className="archive-name">{a.name}</span>
                      <span className={`archive-badge ${a.status}`}>{a.status}</span>
                      <button type="button" className="archive-delete" title="Delete this chat" aria-label={`Delete ${a.name}`}
                        onClick={(e) => { e.stopPropagation(); onDelete(a.id); }}>✕</button>
                    </div>
                    <div className="archive-task">{a.task || '(no task)'}</div>
                    <div className="archive-when">{when(a.startedAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="archive-chat">
            <div className="archive-head">
              <strong className="archive-title">{selected ? selected.name : 'No chat selected'}</strong>
              {selected && <span className={`archive-badge ${selected.status}`}>{selected.status}</span>}
              {selected?.observed && <span className="archive-badge observed">delegated</span>}
              <span className="archive-readonly">read-only</span>
              {selected && (
                <button type="button" className="archive-delete" title="Delete this chat" onClick={() => onDelete(selected.id)}>Delete</button>
              )}
              <button type="button" id="archive-close" className="archive-close" aria-label="Close archive" title="Close archive (Esc)" onClick={onClose}>✕</button>
            </div>
            {selected ? (
              <>
                <div className="archive-meta">
                  {[
                    selected.definition,
                    REASONS[selected.reason],
                    selected.endedAt && selected.endedAt > selected.startedAt ? `${when(selected.startedAt)} - ${timeOf(selected.endedAt)}` : when(selected.startedAt),
                    duration(selected),
                    totalTokens(selected) ? `${formatTokens(totalTokens(selected))} tokens` : '',
                  ].filter(Boolean).join(' · ')}
                </div>
                <MessageLog messages={selected.messages} visible={open} />
              </>
            ) : (
              <div className="archive-empty">{EMPTY}</div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
