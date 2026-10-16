import { useEffect, useRef, useState } from 'react';
import { bar } from '../../../lib/bridge';
import { useSettings } from '../../../context/SettingsContext';
import { spendLine, totalSpend } from '../../../lib/spend';
import type { Workspace } from '../../../types';

/** Lifetime estimated spend of the active project and of all projects. Numbers come from main only. */
export function Spend({ ws }: { ws: Workspace | null }) {
  const { settings, patchWorkspaceLocal } = useSettings();
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { setConfirm(false); }, [ws?.id]);

  const reset = async () => {
    if (!ws) return;
    if (!confirm) {
      setConfirm(true);
      timer.current = setTimeout(() => setConfirm(false), 3000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setConfirm(false);
    try {
      const spend = await bar.resetSpend(ws.id);
      if (spend) patchWorkspaceLocal(ws.id, { spend });
    } catch { /* keep the numbers shown */ }
  };

  return (
    <div id="spend" className="spend">
      <p id="spend-project">{ws ? `This project: ${spendLine(ws.spend)}` : 'No project selected.'}</p>
      <p id="spend-all" className="muted">{`All projects: ${spendLine(totalSpend(settings.workspaces))}`}</p>
      <p className="muted">Estimated from what Claude Code reports; a subscription plan may not be billed per run.</p>
      {ws && (
        <button id="spend-reset" type="button" className={`spend-reset${confirm ? ' confirm' : ''}`} onClick={reset}>
          {confirm ? 'Reset spend?' : 'Reset spend'}
        </button>
      )}
    </div>
  );
}
