import { BACKGROUNDS } from '../../engine/heroes.js';
import { heroFor } from '../../lib/heroCache';
import { contextPct, levelFor, totalTokens, xpFor, xpForLevel } from '../../lib/leveling';
import { formatTokens } from '../../lib/format';
import type { GameApi } from '../../hooks/useGameEngine';
import type { DragProps } from '../../hooks/useWindowDrag';
import type { Workspace } from '../../types';

export interface HudProps {
  ws: Workspace | null;
  game: GameApi;
  status: string;
  dragProps: DragProps;
}

/** Hero name, level, XP bar, project, map progress and status line. */
export function Hud({ ws, game, status, dragProps }: HudProps) {
  if (!ws) {
    return (
      <div id="hud" {...dragProps}>
        <div className="hud-top"><strong id="hero-name">No hero yet</strong><span id="level" /></div>
        <div className="xp"><div id="xp-fill" style={{ width: 0 }} /></div>
        <div id="project" className="muted" />
        <div id="map-info" />
        <div id="status" className="muted">{status}</div>
      </div>
    );
  }

  const hero = heroFor(ws);
  const xp = xpFor(ws);
  const lvl = levelFor(xp);
  const from = xpForLevel(lvl);
  const to = xpForLevel(lvl + 1);
  const map = BACKGROUNDS.find((b) => b.id === ws.map) || BACKGROUNDS[0];
  const mapInfo = game.clearing
    ? `${map.name} Clear!`
    : `${map.name} ${ws.kills % game.killsPerMap}/${game.killsPerMap} · ctx ${contextPct(ws)}%`;

  return (
    <div id="hud" {...dragProps}>
      <div className="hud-top">
        <strong id="hero-name" title={`${hero.name} the ${hero.cls}`}>{hero.name}</strong>
        <span id="level">{`Lv ${lvl}`}</span>
      </div>
      <div className="xp" title={`${xp} / ${to} XP · ${formatTokens(totalTokens(ws.usage))} tokens used`}>
        <div id="xp-fill" style={{ width: `${((xp - from) / (to - from)) * 100}%` }} />
      </div>
      <div id="project" className="muted" title={ws.path}>{`📁 ${ws.name}`}</div>
      <div
        id="map-info"
        title={`Last context: ${formatTokens(ws.lastContext)} of ${formatTokens(ws.contextWindow)} tokens`}
      >
        {mapInfo}
      </div>
      <div id="status" className="muted">{status}</div>
    </div>
  );
}
