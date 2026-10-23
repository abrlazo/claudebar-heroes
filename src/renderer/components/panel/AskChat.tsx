import { MessageLog } from '../common/MessageLog';
import { Composer } from '../common/Composer';
import { ModelSelect } from '../common/ModelSelect';
import type { GeneralChat } from '../../hooks/useGeneralChat';
import type { ModelAlias } from '../../types';

export interface AskChatProps {
  chat: GeneralChat;
  model: ModelAlias;
  onModelChange: (model: ModelAlias) => void;
}

/** Project-less chat ("Ask"): ask Claude anything, like a search box. */
export function AskChat({ visible, chat, model, onModelChange }: AskChatProps & { visible: boolean }) {
  // Busy and no answer text yet (the last row is still the user's): show the "working" line like the Quest chat.
  const last = chat.messages[chat.messages.length - 1];
  const working = chat.busy && (!last || last.kind === 'user');
  return (
    <div id="tab-general-chat" className={`tab-body${visible ? '' : ' hidden'}`}>
      <MessageLog messages={chat.messages} working={working} visible={visible} />
      <Composer
        focused={visible}
        busy={chat.busy}
        onSend={(text) => chat.send(text, model)}
        onStop={chat.stop}
        placeholder="Ask Claude anything… (Enter to send, Shift+Enter for a new line)"
      />
      <footer className="panel-footer">
        <ModelSelect id="general-model" className="flex-1" value={model} onChange={onModelChange} />
      </footer>
    </div>
  );
}
