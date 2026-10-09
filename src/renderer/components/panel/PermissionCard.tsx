/**
 * The Allow / Deny card for one pending permission request ("Ask me each time"). Everything it shows
 * came from a model or a file, so it is rendered only as plain React text (never HTML or markdown) in a block
 * that scrolls; main already stripped control characters and capped the sizes. Nothing here listens for Enter or
 * Esc and nothing takes focus: a request is answered only by clicking or tabbing to a button.
 */
import { useEffect, useState } from 'react';
import { countdownLabel } from '../../lib/permissions';
import type { PermissionRequest } from '../../types';

interface PermissionCardProps {
  request: PermissionRequest;
  /** Who asks: "Quest" or an agent's name. */
  who: string;
  /** Position among this tab's pending requests (1-based) and how many there are. */
  index: number;
  total: number;
  /** The panel is on screen; the countdown only ticks while it is. */
  visible: boolean;
  onAnswer: (requestId: string, decision: 'allow' | 'deny') => void;
}

export function PermissionCard({ request, who, index, total, visible, onAnswer }: PermissionCardProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  const { tool, summary, detail, path, truncatedLines, truncated, viaSubagent } = request;
  const more = truncatedLines > 0
    ? `+ ${truncatedLines} more line${truncatedLines === 1 ? '' : 's'} not shown`
    : truncated ? '+ more text not shown' : '';

  return (
    <div className="perm-card" role="group" aria-label={`${who} asks permission to use ${tool}`} aria-live="assertive" tabIndex={-1}>
      <div className="perm-head">
        <span className="perm-title">
          <strong>{viaSubagent ? `${who} (via a delegated agent)` : who}</strong>
          {' wants to use '}
          <strong className="perm-tool">{tool}</strong>
        </span>
        {total > 1 && <span className="perm-count">{`${index} of ${total}`}</span>}
      </div>
      {path && <div className="perm-path" title={path}>{path}</div>}
      {!path && !detail && summary && <div className="perm-summary">{summary}</div>}
      {detail && <pre className="perm-detail">{detail}</pre>}
      {more && <div className="perm-more">{more}</div>}
      <div className="perm-actions">
        <button type="button" className="perm-btn perm-deny" onClick={() => onAnswer(request.requestId, 'deny')}>Deny</button>
        <button type="button" className="perm-btn perm-allow" onClick={() => onAnswer(request.requestId, 'allow')}>Allow once</button>
        <span className="perm-timer" title="Main denies the request on its own when this reaches zero">{`auto-deny in ${countdownLabel(request.expiresAt, now)}`}</span>
      </div>
    </div>
  );
}
