import { Stage } from './Stage';
import type { StageProps } from './Stage';
import { Hud } from './Hud';
import type { HudProps } from './Hud';

/** The hero strip that lives above the taskbar: battle stage + HUD + chat button. */
export function Strip({ stageProps, hudProps, onTogglePanel, hide }: {
  stageProps: StageProps; hudProps: HudProps; onTogglePanel: () => void;
  /** Hiding the app needs a way back (the bubble or the tray icon, decided by main); without one the button is not shown. */
  hide?: { canHide: boolean; onHide: () => void; to?: 'bubble' | 'tray' };
}) {
  const way = hide?.to === 'tray' ? 'the tray icon' : 'the floating bubble';
  const hideTip = `Hide the app (bring it back from ${way}, or with Ctrl/Cmd+Shift+Space)`;
  return (
    <section id="strip" className="interactive">
      <Stage {...stageProps} />
      <Hud {...hudProps} />
      <div className="strip-buttons">
        {hide?.canHide && (
          <button
            id="hide-app"
            type="button"
            title={hideTip}
            aria-label={hideTip}
            onClick={hide.onHide}
          >–</button>
        )}
        <button id="toggle-panel" title="Chat (Ctrl/Cmd+Shift+Space)" onClick={onTogglePanel}>💬</button>
      </div>
    </section>
  );
}
