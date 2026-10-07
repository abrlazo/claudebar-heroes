import { useMemo } from 'react';
import { BACKGROUNDS } from '../../../engine/heroes.js';
import { sceneThumb } from '../../../engine/scene.js';
import type { MapId, Workspace } from '../../../types';

/** Choose the battlefield for the selected project. */
export function MapPicker({ ws, onPick }: { ws: Workspace | null; onPick: (id: MapId) => void }) {
  const thumbs = useMemo<Record<string, string>>(() => Object.fromEntries(BACKGROUNDS.map((b) => [b.id, sceneThumb(b.id)])), []);
  return (
    <div id="bg-picker" className="picker">
      {BACKGROUNDS.map((b) => (
        <button
          key={b.id}
          className={`pick${ws && b.id === ws.map ? ' selected' : ''}`}
          disabled={!ws}
          onClick={() => onPick(b.id as MapId)}
        >
          <div className="thumb" style={{ backgroundImage: `url("${thumbs[b.id]}")` }} />
          <span>{b.name}</span>
        </button>
      ))}
    </div>
  );
}
