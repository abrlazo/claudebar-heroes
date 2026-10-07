import { Stage } from './Stage';
import type { StageProps } from './Stage';
import { Hud } from './Hud';
import type { HudProps } from './Hud';

/** The hero strip that lives above the taskbar: battle stage + HUD + chat button. */
export function Strip({ stageProps, hudProps, onTogglePanel }: { stageProps: StageProps; hudProps: HudProps; onTogglePanel: () => void }) {
  return (
    <section id="strip" className="interactive">
      <Stage {...stageProps} />
      <Hud {...hudProps} />
      <button id="toggle-panel" title="Chat (Ctrl/Cmd+Shift+Space)" onClick={onTogglePanel}>💬</button>
    </section>
  );
}
