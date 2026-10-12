/**
 * The Allow / Deny card for one pending permission request ("Ask me each time"). Everything it shows
 * came from a model or a file, so it is rendered only as plain React text (never HTML or markdown) in a block
 * that scrolls; main already stripped control characters and capped the sizes. The card itself listens for no key and
 * takes no focus: a request is answered only by clicking or tabbing to a button. "Reply..." opens a text box inside
 * the card (focused only because the user clicked it): Enter there sends the text as a DENY with the user's words,
 * Esc just closes the box. Neither key can ever allow anything.
 */
import { useEffect, useRef, useState } from 'react';
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
  /** `message` only comes with 'deny' (a reply); main cleans and caps it. */
  onAnswer: (requestId: string, decision: 'allow' | 'deny', message?: string) => void;
}

const MAX_REPLY = 2000;

export function PermissionCard({ request, who, index, total, visible, onAnswer }: PermissionCardProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const replyRef = useRef<HTMLTextAreaElement>(null);
  // Focus moves into the box only because the user clicked "Reply...".
  useEffect(() => { if (replying) replyRef.current?.focus(); }, [replying]);
  const canSend = reply.trim().length > 0;
  const sendReply = () => { if (canSend) onAnswer(request.requestId, 'deny', reply.trim()); };

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
      {replying && (
        <div className="perm-reply">
          <textarea
            ref={replyRef}
            className="perm-reply-text"
            rows={3}
            maxLength={MAX_REPLY}
            value={reply}
            placeholder="Tell Claude what to do instead"
            aria-label={`Reply to ${who}: tell Claude what to do instead`}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                // Closes the box only: never answers, and does not reach the panel's own Esc handler.
                e.preventDefault();
                e.stopPropagation();
                setReplying(false);
              } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                sendReply();
              }
            }}
          />
          <div className="perm-reply-actions">
            <button type="button" className="perm-btn perm-send" disabled={!canSend} onClick={sendReply}>Send reply</button>
            <button type="button" className="perm-btn perm-back" onClick={() => setReplying(false)}>Back</button>
            <span className="perm-reply-hint">Denies this call and sends your text</span>
            {reply.length > MAX_REPLY - 200 && <span className="perm-reply-count">{`${reply.length}/${MAX_REPLY}`}</span>}
          </div>
        </div>
      )}
      <div className="perm-actions">
        <button type="button" className="perm-btn perm-deny" onClick={() => onAnswer(request.requestId, 'deny')}>Deny</button>
        <button
          type="button"
          className="perm-btn perm-replybtn"
          aria-expanded={replying}
          onClick={() => setReplying(true)}
        >Reply...</button>
        <button type="button" className="perm-btn perm-allow" onClick={() => onAnswer(request.requestId, 'allow')}>Allow once</button>
        <span className="perm-timer" title="Main denies the request on its own when this reaches zero">{`auto-deny in ${countdownLabel(request.expiresAt, now)}`}</span>
      </div>
    </div>
  );
}
