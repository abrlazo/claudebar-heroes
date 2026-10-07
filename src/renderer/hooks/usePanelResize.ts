import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { bar } from '../lib/bridge';
import { useSettings } from '../context/SettingsContext';

const MIN_HEIGHT = 300;
const MAX_HEIGHT = 1000;

/**
 * Drag the panel's bottom handle to resize it. Uses screenY: the window
 * itself moves while resizing (it grows upward when the panel is above the
 * strip), so clientY would feed back on itself.
 */
export function usePanelResize(): { onMouseDown: (e: ReactMouseEvent) => void } {
  const { settings, updateSettingsLocal } = useSettings();
  const heightRef = useRef(settings.panelHeight || 500);
  heightRef.current = settings.panelHeight || 500;
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!drag.current) return;
    const above = !document.body.classList.contains('panel-below');
    const delta = (e.screenY - drag.current.startY) * (above ? -1 : 1);
    const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, drag.current.startHeight + delta));
    // Update local state for immediate visual feedback, but don't persist until mouseup
    updateSettingsLocal({ panelHeight: next });
  }, [updateSettingsLocal]);

  const end = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    document.body.classList.remove('resizing');
    // Persist the final height on mouseup, not during drag
    bar.updateSettings({ panelHeight: heightRef.current });
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', end);
      window.removeEventListener('blur', end);
    };
  }, [onMouseMove, end]);

  const onMouseDown = useCallback((e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { startY: e.screenY, startHeight: heightRef.current };
    document.body.classList.add('resizing');
  }, []);

  return { onMouseDown };
}
