import { useCallback, useEffect, useRef, useState } from 'react';

/** HUD status line and the hero's speech bubble. */
export function useStageStatus() {
  const [status, setStatus] = useState<string>('Sleeping');
  const [bubble, setBubble] = useState<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Show `text` above the hero; hide after `ms` (stays if omitted). */
  const say = useCallback((text: string, ms?: number) => {
    clearTimeout(timer.current);
    setBubble(text || '');
    if (ms) timer.current = setTimeout(() => setBubble(''), ms);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { status, setStatus, bubble, say };
}
