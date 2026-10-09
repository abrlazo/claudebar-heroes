import type React from 'react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { drawMinionSprite, orbPalette } from '../../engine/minionSprite.js';
import type { Agent } from '../../hooks/useAgents';
import type { GameApi } from '../../hooks/useGameEngine';

// Each agent is a wisp that orbits the hero's body (hero sprite: x 40-104, up to 68px
// high) on its own period and phase. Every wrapper sits at the chest centre; the motion is
// a CSS animation on the inner element (styles.css), so the wrapper never moves. The
// orbit stays inside the stage (92px high): ry + WISP/2 + CHEST <= 92.
const HERO_CENTER = 72;
const WISP = 24;
const CHEST = 34;  // bottom of the wrapper
const RX = 34;
const RY = [26, 20, 30, 23, 28];

function orbitStyle(index: number): React.CSSProperties {
  return {
    left: `${HERO_CENTER - WISP / 2}px`,
    bottom: `${CHEST}px`,
    ['--orbit-delay' as string]: `${-index * 1.3}s`,
    ['--orbit-dur' as string]: `${5 + index * 0.7}s`,
    ['--orbit-rx' as string]: `${RX}px`,
    ['--orbit-ry' as string]: `${RY[index % RY.length]}px`,
  };
}

/** One wisp per agent, orbiting the hero's body. */
function Minion({ agent, asking, register }: {
  agent: Agent; asking: boolean; register: (id: string, el: HTMLDivElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The wisp is painted once; orbit, wobble and glow are CSS animations.
  useEffect(() => {
    if (canvasRef.current) drawMinionSprite(canvasRef.current, agent.hero, agent.index);
  }, [agent.hero, agent.index]);
  const { bright: glow, dim: rim } = orbPalette(agent.hero, agent.index);
  const calm = agent.status !== 'running';

  return (
    <div
      ref={(el) => register(agent.id, el)}
      className={`minion${agent.dying ? ' dying' : ''}${calm ? ' calm' : ''}${asking ? ' asking' : ''}`}
      title={`${agent.name} (${agent.hero.name} the ${agent.hero.cls})${asking ? ' - waiting for your permission' : ''}`}
      style={orbitStyle(agent.index)}
    >
      <div className="wisp">
        <canvas
          ref={canvasRef}
          width={24}
          height={24}
          style={{ ['--orb-glow' as string]: glow, ['--orb-rim' as string]: rim }}
        />
      </div>
    </div>
  );
}

/**
 * One wisp per agent, each orbiting the hero on its own period and phase. After each
 * change the engine is told which agents are working and which element is theirs, so it
 * can fire projectiles from the wisp.
 */
export function Minions({ agents, asking, game }: { agents: Agent[]; asking: ReadonlySet<string>; game: GameApi }) {
  const els = useRef(new Map<string, HTMLDivElement>());
  const register = (id: string, el: HTMLDivElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };

  // Re-sync only when the set of agents or their working state changes, not on every log line:
  // setAllies resets the allies' firing cooldowns.
  const working = agents.filter((a) => a.status === 'running' && !a.dying);
  const layoutKey = `${agents.map((a) => `${a.id}:${a.dying ? 'x' : 'o'}`).join(',')}|${working.map((a) => a.id).join(',')}`;
  useLayoutEffect(() => {
    game.setAllies(working.map((a) => a.hero));
    game.setMinionElements(working.map((a) => els.current.get(a.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutKey captures everything that matters
  }, [layoutKey, game]);

  return agents.map((agent) => (
    <Minion key={agent.id} agent={agent} asking={asking.has(agent.id)} register={register} />
  ));
}
