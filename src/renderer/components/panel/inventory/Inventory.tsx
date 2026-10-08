import { useEffect, useState } from 'react';
import { bar } from '../../../lib/bridge';
import { Roster } from './Roster';
import { HeroDetail } from './HeroDetail';
import { MapPicker } from './MapPicker';
import { Trophies } from './Trophies';
import { Achievements } from './Achievements';
import { SettingsControls } from './SettingsControls';
import { useSettings } from '../../../context/SettingsContext';
import type { WorkspaceActions } from '../../../hooks/useWorkspaceActions';
import type { MapId, Workspace } from '../../../types';

export interface InventoryProps {
  ws: Workspace | null;
  busy: boolean;
  actions: WorkspaceActions;
  onPickMap: (id: MapId) => void;
}

/** Heroes, maps, preferences and app controls. */
export function Inventory({ visible, ws, busy, actions, onPickMap }: InventoryProps & { visible: boolean }) {
  const { settings } = useSettings();
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
      <h3>About</h3>
      <SettingsControls />
      <p id="about" className="muted">{`Claude binary: ${bin}`}</p>
      <div className="button-group">
        <button id="restart-app" onClick={() => bar.restartApp()}>Restart App</button>
        <button id="quit" onClick={() => bar.quit()}>Quit Claudebar Heroes</button>
      </div>
    </div>
  );
}
