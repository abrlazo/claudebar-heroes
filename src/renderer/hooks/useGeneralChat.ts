import { useCallback, useRef, useState } from 'react';
import { bar } from '../lib/bridge';
import { useBridgeEvent } from './useBridgeEvent';
import type { ChatMessage, ClaudeEvent, ModelAlias } from '../types';

export interface GeneralChat {
  messages: ChatMessage[];
  busy: boolean;
  send: (prompt: string, model: ModelAlias) => void;
  stop: () => void;
}

/** Appends text to the last message when it is a text message. */
function appendToLast(messages: ChatMessage[], extra: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.kind === 'tool') return messages;
  return [...messages.slice(0, -1), { ...last, text: last.text + extra }];
}

/**
 * The "Ask" chat: a project-less conversation (runs in the home folder, no
 * tools). History lives only in memory; the main process keeps the Claude
 * session so follow-ups have context.
 */
export function useGeneralChat(): GeneralChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const assistantOpen = useRef(false);

  const push = (msg: ChatMessage) => setMessages((m) => [...m, msg]);

  useBridgeEvent<ClaudeEvent>(bar.onGeneralChatEvent, (ev) => {
    switch (ev.type) {
      case 'start':
        setBusy(true);
        assistantOpen.current = false;
        break;

      case 'text':
        if (!assistantOpen.current) {
          assistantOpen.current = true;
          push({ kind: 'assistant', text: ev.text ?? '' });
        } else {
          setMessages((m) => appendToLast(m, ev.text ?? ''));
        }
        break;

      case 'tool':
        // Keep text from separate turns in separate bubbles.
        assistantOpen.current = false;
        break;

      case 'result':
        if (ev.isError && !assistantOpen.current) push({ kind: 'error', text: 'Claude could not answer that.' });
        break;

      case 'error':
        assistantOpen.current = false;
        push({ kind: 'error', text: ev.message ?? 'Unknown error' });
        break;

      case 'end':
        setBusy(false);
        assistantOpen.current = false;
        break;

      default:
        break;
    }
  });

  const send = useCallback((prompt: string, model: ModelAlias) => {
    setMessages((m) => [...m, { kind: 'user', text: prompt }]);
    setBusy(true);
    bar.sendGeneralChat(prompt, model);
  }, []);

  return { messages, busy, send, stop: () => bar.cancelGeneralChat() };
}
