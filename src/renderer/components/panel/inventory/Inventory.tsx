import { useEffect, useState } from 'react';
import { bar } from '../../../lib/bridge';
import { Roster } from './Roster';
import { HeroDetail } from './HeroDetail';
import { MapPicker } from './MapPicker';
import { Trophies } from './Trophies';
import { Achievements } from './Achievements';
import { Spend } from './Spend';
import { SettingsControls } from './SettingsControls';
import { useSettings } from '../../../context/SettingsContext';
import type { WorkspaceActions } from '../../../hooks/useWorkspaceActions';
import type { MapId, Workspace } from '../../../types';

export interface InventoryProps {
  ws: Workspace | null;
  busy: boolean;
  actions: WorkspaceActions;
  onPickMap: (id: MapId) => void;
  /** Hiding the app needs a way back (the bubble or the tray icon, decided by main); without one the button is not shown. */
  hide?: { canHide: boolean; onHide: () => void; to?: 'bubble' | 'tray'; tray?: boolean };
}

/** Heroes, maps, preferences and app controls. */
export function Inventory({ visible, ws, busy, actions, onPickMap, hide }: InventoryProps & { visible: boolean }) {
  const { settings, updateSettings } = useSettings();
  const [bin, setBin] = useState<string>('');
  useEffect(() => { bar.info().then((info) => setBin(info.bin)); }, []);

  return (
    <div id="tab-settings" className={`tab-body${visible ? '' : ' hidden'}`}>
      <h3>Your heroes</h3>
      <Roster workspaces={settings.workspaces} activeId={settings.activeId} busy={busy} actions={actions} />
      <HeroDetail ws={ws} busy={busy} actions={actions} />
      <h3>Trophies</h3>
      <Trophies ws={ws} />
      <h3>Achievements</h3>
      <Achievements ws={ws} />
      <h3>Current map</h3>
      <MapPicker ws={ws} onPick={onPickMap} />
      <h3>Spend</h3>
      <Spend ws={ws} />
      <h3>About</h3>
      <SettingsControls />
      <p id="about" className="muted">{`Claude binary: ${bin}`}</p>
      <div className="hide-app-row">
        <label htmlFor="minimize-to">Minimize to:</label>
        <select id="minimize-to" value={settings.minimizeTo === 'tray' ? 'tray' : 'bubble'} onChange={(e) => updateSettings({ minimizeTo: e.target.value === 'tray' ? 'tray' : 'bubble' })}>
          <option value="bubble">Floating bubble</option>
          <option value="tray" disabled={hide?.tray === false}>Tray only</option>
        </select>
        {hide?.canHide && <button id="hide-app-settings" type="button" onClick={hide.onHide}>Hide the app</button>}
        {hide?.canHide && (
          <p className="muted">
            {hide.to === 'tray'
              ? 'Everything keeps running while it is hidden. Bring it back from the tray icon (menu bar on macOS), with Ctrl/Cmd+Shift+Space, or by opening the app again.'
              : 'Everything keeps running while it is hidden. A little round button floats on your screen: click it to bring the bar back, drag it anywhere, right-click for a menu. A coloured dot says when Claude needs your OK, finished or failed. Ctrl/Cmd+Shift+Space and the tray icon also work.'}
          </p>
        )}
      </div>
      <div className="button-group">
        <button id="restart-app" onClick={() => bar.restartApp()}>Restart App</button>
        <button id="quit" onClick={() => bar.quit()}>Quit Claudebar Heroes</button>
      </div>
    </div>
  );
}
