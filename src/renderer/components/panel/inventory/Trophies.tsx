import { useEffect, useRef } from 'react';
import { BOSSES, LEGENDARY_BOSS, createMonster } from '../../../engine/enemies.js';
import { BOSS_CHANCE } from '../../../engine/boss.js';
import type { Workspace } from '../../../types';

type BossLook = (typeof BOSSES)[string];

/** One boss portrait: the real sprite, drawn once (no update calls, so no per-frame cost). */
function Portrait({ look }: { look: BossLook }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) createMonster(ref.current, look); }, [look]);
  return <canvas ref={ref} />;
}

/** The workspace's boss trophies: one slot per map boss plus the legendary one, dim and "???" until it has fallen. */
export function Trophies({ ws }: { ws: Workspace | null }) {
  return (
    <>
    <div id="trophies">
      {([...Object.entries(BOSSES), ['legendary', LEGENDARY_BOSS]] as [string, BossLook][]).map(([mapId, look]) => {
        const count = ws?.trophies?.[look.id as string]?.count ?? 0;
        return (
          <div
            key={mapId}
            className={`trophy${look.legendary ? ' legendary' : ''}${count ? '' : ' locked'}`}
            title={count ? `${look.name} (defeated ${count}x)` : 'Not defeated yet'}
          >
            <Portrait look={look} />
            <span className="trophy-name">{count ? look.name : '???'}</span>
            {count > 0 && <span className="trophy-count">{`x${count}`}</span>}
          </div>
        );
      })}
    </div>
    <p className="trophy-hint">{`Bosses appear rarely (about 1 in ${Math.round(1 / BOSS_CHANCE)} stages), a legendary one even more rarely.`}</p>
    </>
  );
}
