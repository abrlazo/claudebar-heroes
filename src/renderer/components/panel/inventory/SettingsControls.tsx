import { useState } from 'react';
import { bar } from '../../../lib/bridge';
import { useSettings } from '../../../context/SettingsContext';
import type { Theme } from '../../../types';

/** Theme, panel-height and notification preferences. */
export function SettingsControls() {
  const { settings, updateSettings, updateSettingsLocal } = useSettings();
  const height = settings.panelHeight || 500;
  const [testNote, setTestNote] = useState('');
  const testNotify = async () => {
    setTestNote('');
    try {
      const { native } = await bar.testNotify();
      setTestNote(native ? 'Sent.' : 'No system notification was shown (not available here, blocked by your system, or too many tests in a minute). In-app cues still work.');
    } catch {
      setTestNote('Could not send a test.');
    }
  };
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
      <label className="notify-option" htmlFor="notify-done">
        <input id="notify-done" type="checkbox" checked={settings.notifyDone !== false} onChange={(e) => updateSettings({ notifyDone: e.target.checked })} />
        Tell me when work finishes
      </label>
      <label className="notify-option" htmlFor="notify-fail">
        <input id="notify-fail" type="checkbox" checked={settings.notifyFail !== false} onChange={(e) => updateSettings({ notifyFail: e.target.checked })} />
        Tell me when something fails
      </label>
      <button id="notify-test" type="button" onClick={testNotify}>Test notification</button>
      {testNote && <p id="notify-test-note" className="muted" role="status">{testNote}</p>}
    </div>
  );
}
