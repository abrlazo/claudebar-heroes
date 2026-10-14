import { useEffect, useMemo, useRef, useState } from 'react';
import { CommandPopup } from './CommandPopup';
import { filterSuggestions, slashQuery } from '../../lib/commands';
import type { CommandSuggestion } from '../../lib/commands';
import { ACCEPT, MAX_IMAGES, canSend } from '../../lib/images';
import type { AttachedImage } from '../../lib/queue';
import type { ImageAttachments } from '../../hooks/useImageAttachments';

/**
 * Prompt box with Send / Stop. Enter sends, Shift+Enter inserts a new line.
 *
 * With `suggestions`, typing "/" opens a popup of matching commands: Up/Down moves,
 * Enter or Tab picks, Esc closes it, and Enter does not send while it is open
 * (unless the text already is exactly a listed command name).
 *
 * With `images`, a paperclip, pasting and dropping attach images (chips above the box); a message can be sent with
 * no text when at least one image is attached. `onSend` may return false to keep the draft and the chips.
 */
interface ComposerProps {
  onSend: (text: string, images: AttachedImage[]) => boolean | void;
  onStop: () => void;
  /** Swaps Send for Stop. */
  busy: boolean;
  disabled?: boolean;
  /** While busy, Enter still calls onSend (the caller queues it) and Stop stays the only button. */
  queueable?: boolean;
  placeholder: string;
  /** Focuses the textarea when it becomes true. */
  focused: boolean;
  /** Commands to suggest after a "/" (omit for no popup). */
  suggestions?: CommandSuggestion[];
  /** Called each time the popup is about to open, so the list can be refreshed. */
  onSuggestionsOpen?: () => void;
  /** Image attachments (omit for a text-only box, as in the Ask chat). */
  images?: ImageAttachments;
}

export function Composer({
  onSend, onStop, busy, disabled = false, queueable = false, placeholder, focused, suggestions, onSuggestionsOpen, images,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attached = images?.items ?? [];

  const query = suggestions ? slashQuery(text) : null;
  const matches = useMemo(() => (query === null || !suggestions ? [] : filterSuggestions(query, suggestions)), [query, suggestions]);
  const popupOpen = query !== null && matches.length > 0 && !dismissed;

  // A new query starts at the top again and re-opens a popup closed with Esc.
  useEffect(() => { setActive(0); setDismissed(false); }, [query]);
  // Re-read the folders each time the popup starts, so new agents and commands show up.
  const slashing = query !== null;
  useEffect(() => { if (slashing) onSuggestionsOpen?.(); }, [slashing]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (item: CommandSuggestion) => {
    setText(item.insert);
    ref.current?.focus();
  };

  useEffect(() => {
    if (focused) ref.current?.focus();
  }, [focused]);

  const submit = () => {
    const value = text.trim();
    if (!canSend(value, attached.length, images?.pending ?? 0) || (busy && !queueable) || disabled) return;
    if (onSend(value, attached) === false) return; // refused: the draft and the chips stay
    setText('');
    images?.release();
  };

  const hasFiles = (e: React.DragEvent) => !!images && !disabled && e.dataTransfer.types.includes('Files');

  return (
    <form
      className={`composer${dragging ? ' drop-target' : ''}`}
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => {
        setDragging(false);
        if (!hasFiles(e)) return;
        e.preventDefault();
        images?.add(Array.from(e.dataTransfer.files));
      }}
    >
      {images && (images.items.length > 0 || images.pending > 0 || images.error) && (
        <div className="attach-chips">
          {images.items.map((item, i) => (
            <span key={item.id} className="attach-chip">
              <img src={item.thumb} alt={`Attached image ${i + 1}`} />
              <button type="button" className="attach-x" aria-label={`Remove image ${i + 1}`} onClick={() => images.remove(item.id)}>×</button>
            </span>
          ))}
          {images.pending > 0 && <span className="attach-chip attach-loading" aria-label="Adding image">…</span>}
          {(images.items.length > 0 || images.pending > 0) && <span className="attach-count">{`${images.items.length + images.pending}/${MAX_IMAGES}`}</span>}
          <span className="attach-error" role="status">{images.error ?? ''}</span>
        </div>
      )}
      {popupOpen && <CommandPopup items={matches} active={active} onPick={pick} onHover={setActive} />}
      <textarea
        ref={ref}
        rows={2}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          if (!images || disabled) return;
          const files = Array.from(e.clipboardData.items)
            .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
            .flatMap((it) => { const f = it.getAsFile(); return f ? [f] : []; });
          if (!files.length) return;
          // Pasted text still pastes; a copied image has no text, so there is nothing else to insert.
          if (!e.clipboardData.types.includes('text/plain')) e.preventDefault();
          images.add(files);
        }}
        onKeyDown={(e) => {
          if (popupOpen) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            // Enter on a name that is already complete (no space) sends it instead of re-picking it.
            const complete = text.trim() === matches[Math.min(active, matches.length - 1)].insert.trim();
            const pickKey = e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !complete);
            if (pickKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              pick(matches[Math.min(active, matches.length - 1)]);
              return;
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation(); // Esc closes the popup, not the whole panel
              setDismissed(true);
              return;
            }
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {images && (
        <>
          <input
            ref={fileInput}
            type="file"
            className="attach-input"
            accept={ACCEPT}
            multiple
            hidden
            tabIndex={-1}
            onChange={(e) => { images.add(Array.from(e.target.files ?? [])); e.target.value = ''; }}
          />
          <button
            type="button"
            className="attach-btn"
            aria-label="Attach image"
            title="Attach images (PNG, JPEG, GIF, WebP; up to 5). Also paste or drop them here. Messages starting with / cannot carry images."
            disabled={disabled}
            onClick={() => fileInput.current?.click()}
          >
            📎
          </button>
        </>
      )}
      {busy
        ? <button type="button" className="stop" onClick={onStop}>Stop</button>
        : <button type="submit" className="send" disabled={(images?.pending ?? 0) > 0}>Send</button>}
    </form>
  );
}
