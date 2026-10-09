import { useEffect, useMemo, useRef, useState } from 'react';
import { CommandPopup } from './CommandPopup';
import { filterSuggestions, slashQuery } from '../../lib/commands';
import type { CommandSuggestion } from '../../lib/commands';

/**
 * Prompt box with Send / Stop. Enter sends, Shift+Enter inserts a new line.
 *
 * With `suggestions`, typing "/" opens a popup of matching commands: Up/Down moves,
 * Enter or Tab picks, Esc closes it, and Enter does not send while it is open
 * (unless the text already is exactly a listed command name).
 */
interface ComposerProps {
  onSend: (text: string) => void;
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
}

export function Composer({
  onSend, onStop, busy, disabled = false, queueable = false, placeholder, focused, suggestions, onSuggestionsOpen,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

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
    if (!value || (busy && !queueable) || disabled) return;
    setText('');
    onSend(value);
  };

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {popupOpen && <CommandPopup items={matches} active={active} onPick={pick} onHover={setActive} />}
      <textarea
        ref={ref}
        rows={2}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
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
      {busy
        ? <button type="button" className="stop" onClick={onStop}>Stop</button>
        : <button type="submit" className="send">Send</button>}
    </form>
  );
}
