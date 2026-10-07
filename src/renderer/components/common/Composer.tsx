import { useEffect, useRef, useState } from 'react';

/**
 * Prompt box with Send / Stop. Enter sends, Shift+Enter inserts a new line.
 */
interface ComposerProps {
  onSend: (text: string) => void;
  onStop: () => void;
  /** Swaps Send for Stop. */
  busy: boolean;
  disabled?: boolean;
  placeholder: string;
  /** Focuses the textarea when it becomes true. */
  focused: boolean;
}

export function Composer({ onSend, onStop, busy, disabled = false, placeholder, focused }: ComposerProps) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focused) ref.current?.focus();
  }, [focused]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy || disabled) return;
    setText('');
    onSend(value);
  };

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea
        ref={ref}
        rows={2}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
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
