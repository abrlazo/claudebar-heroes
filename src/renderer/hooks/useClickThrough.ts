import { useEffect } from 'react';
import { bar } from '../lib/bridge';

/**
 * The window is transparent and ignores the mouse except over elements
 * marked .interactive, so the desktop under empty space stays usable.
 */
export function useClickThrough() {
  useEffect(() => {
    let ignoring = true;
    const update = (target: EventTarget | null) => {
      const shouldIgnore = !(target instanceof Element && target.closest('.interactive'));
      if (shouldIgnore !== ignoring) {
        ignoring = shouldIgnore;
        bar.setClickThrough(shouldIgnore);
      }
    };
    const onMove = (e: MouseEvent) => update(e.target);
    const onLeave = () => update(null);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);
}
