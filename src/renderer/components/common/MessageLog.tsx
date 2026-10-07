import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../types';

/** One chat message. `tool` messages render as "⚔ Name summary". */
function Message({ msg }: { msg: ChatMessage }) {
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
  return <div className={`msg ${msg.kind}`}>{msg.text}</div>;
}

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
}

export function MessageLog({ messages, streaming = '', streamingThinking = '', working = false, visible }: MessageLogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return undefined;
    const frame = requestAnimationFrame(() => {
      if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, streaming, streamingThinking, working, visible]);

  return (
    <div className="msg-log" ref={ref}>
      {messages.map((msg, i) => <Message key={i} msg={msg} />)}
      {streamingThinking && (
        <details className="msg thinking" open>
          <summary>🧘 Meditating…</summary>
          {streamingThinking}
        </details>
      )}
      {streaming && <div className="msg assistant">{streaming}</div>}
      {working && <div className="msg thinking working">🧘 Meditating<span className="dots" /></div>}
    </div>
  );
}
