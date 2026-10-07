import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { bar } from '../lib/bridge';

/**
 * Drag the whole window by grabbing the scene, HUD or tab bar. Dragging is
 * driven by the main process polling the cursor (see main.js). Spread the
 * returned `onMouseDown` on any draggable surface.
 */
export interface DragProps {
  onMouseDown: (e: ReactMouseEvent) => void;
}

export function useWindowDrag(): DragProps {
  const dragging = useRef<boolean>(false);

  const end = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.classList.remove('dragging');
    bar.dragEnd();
  }, []);

  useEffect(() => {
    window.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('mouseup', end);
      window.removeEventListener('blur', end);
    };
  }, [end]);

  const onMouseDown = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0 || (e.target as Element).closest('button, select, textarea, input')) return;
    e.preventDefault();
    dragging.current = true;
    document.body.classList.add('dragging');
    bar.dragStart();
  }, []);

  return { onMouseDown };
}
