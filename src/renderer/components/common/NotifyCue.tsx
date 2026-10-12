import type { NotifyCueState } from '../../hooks/useNotifications';
import type { NotifyTarget } from '../../types';

export interface NotifyCueProps {
  cue: NotifyCueState | null;
  onShow: (target: NotifyTarget | null) => void;
  onDismiss: () => void;
}

/** A small toast inside the open panel for work that finished or failed somewhere you are not looking. Plain text, never takes focus. */
export function NotifyCue({ cue, onShow, onDismiss }: NotifyCueProps) {
  if (!cue) return null;
  const bad = cue.kind === 'failed' || cue.kind === 'mixed';
  return (
    <div className={`notify-cue ${bad ? 'bad' : 'good'}`} role="status" aria-live="polite">
      <span className="notify-text">{cue.text}</span>
      {cue.target && <button type="button" className="notify-show" onClick={() => onShow(cue.target)}>Show</button>}
      <button type="button" className="notify-x" aria-label="Dismiss" onClick={onDismiss}>{'×'}</button>
    </div>
  );
}
