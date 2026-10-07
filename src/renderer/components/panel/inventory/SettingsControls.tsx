import { useSettings } from '../../../context/SettingsContext';
import type { Theme } from '../../../types';

/** Theme and panel-height preferences. */
export function SettingsControls() {
  const { settings, updateSettings, updateSettingsLocal } = useSettings();
  const height = settings.panelHeight || 500;
  return (
    <div className="settings-controls">
      <label htmlFor="theme-select">Theme:</label>
      <select id="theme-select" value={settings.theme || 'dark'} onChange={(e) => updateSettings({ theme: e.target.value as Theme })}>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
      <label htmlFor="panel-height">{`Panel Height: ${height}px`}</label>
      <input
        id="panel-height"
        type="range"
        min="300"
        max="1000"
        value={height}
        onChange={(e) => updateSettingsLocal({ panelHeight: parseInt(e.target.value, 10) })}
        onMouseUp={(e) => updateSettings({ panelHeight: parseInt(e.currentTarget.value, 10) })}
        onKeyUp={(e) => updateSettings({ panelHeight: parseInt(e.currentTarget.value, 10) })}
      />
    </div>
  );
}
