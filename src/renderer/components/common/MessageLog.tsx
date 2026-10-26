import { memo, useEffect, useRef } from 'react';
import type { ChatMessage } from '../../types';
import { Markdown, StreamingMarkdown } from './Markdown';
import { rowKey } from '../../lib/messages';
import { imageLabel } from '../../lib/images';
import { PixelArt } from './PixelArt';

/**
 * One chat message. `tool` messages render as "⚔ Name summary". `live` (the last row) parses Markdown
 * incrementally, because an agent's answer grows in that row while it streams.
 */
const Message = memo(function Message({ msg, live }: { msg: ChatMessage; live: boolean }) {
  if (msg.kind === 'tool') {
    return (
      <div className="msg tool">
        <b>{`⚔ ${msg.name}`}</b>
        {msg.summary ? ` ${msg.summary}` : ''}
      </div>
    );
  }
  if (msg.kind === 'thinking') {
    return (
      <details className="msg thinking">
        <summary>🧘 Meditating</summary>
        {msg.text}
      </details>
    );
  }
  if (msg.kind === 'assistant') {
    return <div className="msg assistant md">{live ? <StreamingMarkdown text={msg.text} /> : <Markdown text={msg.text} />}</div>;
  }
  if (msg.kind === 'art') {
    return msg.art
      ? <div className="msg art"><PixelArt art={msg.art} caption={msg.text} /><div className="art-caption">{`Sample: ${msg.text}`}</div></div>
      : <div className="msg meta">{`[drawing: ${msg.text}]`}</div>;
  }
  if (msg.kind === 'user' && (msg.images?.length || msg.imageCount)) {
    return (
      <div className="msg user">
        {msg.images?.length
          ? <div className="msg-thumbs">{msg.images.map((im, i) => <img key={i} className="msg-thumb" src={im.thumb} alt={`Attached image ${i + 1}`} />)}</div>
          : <div className="msg-images-gone">{imageLabel(msg.imageCount ?? 0)}</div>}
        {msg.text}
      </div>
    );
  }
  return <div className={`msg ${msg.kind}`}>{msg.text}</div>;
});


/**
 * Scrolling chat log pinned to the newest message. `visible` matters because
 * a hidden element has no scroll height: the log re-pins when it appears.
 */
interface MessageLogProps {
  messages: ChatMessage[];
  /** Assistant text still streaming in. */
  streaming?: string;
  /** Thinking text still streaming in (shown open). */
  streamingThinking?: string;
  /** Show an animated "Meditating…" line (a run is in progress but nothing has streamed yet). */
  working?: boolean;
  visible: boolean;
  /** A `/draw` in progress for this chat: shown as a pending row with a Cancel button. */
  drawing?: { caption: string; onCancel: () => void } | null;
}

export function MessageLog({ messages, streaming = '', streamingThinking = '', working = false, visible, drawing = null }: MessageLogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return undefined;
    const frame = requestAnimationFrame(() => {
      if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, streaming, streamingThinking, working, visible, drawing]);

  return (
    <div className="msg-log" ref={ref}>
      {messages.map((msg, i) => <Message key={rowKey(msg)} msg={msg} live={i === messages.length - 1} />)}
      {streamingThinking && (
        <details className="msg thinking" open>
          <summary>🧘 Meditating…</summary>
          {streamingThinking}
        </details>
      )}
      {streaming && <div className="msg assistant md"><StreamingMarkdown text={streaming} /></div>}
      {drawing && (
        <div className="msg draw-pending" role="status">
          <span className="draw-pixels" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="draw-pending-text">{`Drawing ${drawing.caption}…`}</span>
          <button type="button" className="queue-btn draw-cancel" onClick={drawing.onCancel}>Cancel</button>
        </div>
      )}
      {working && <div className="msg thinking working">🧘 Meditating<span className="dots" /></div>}
    </div>
  );
}
