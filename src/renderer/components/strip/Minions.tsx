import { useEffect, useLayoutEffect, useRef } from 'react';
import { drawMinionSprite, orbPalette } from '../../engine/minionSprite.js';
import type { Agent } from '../../hooks/useAgents';
import type { GameApi } from '../../hooks/useGameEngine';

// Orbs hover in a tight formation around the hero (hero sprite: x 40-104, up to
// 68px high). Slots are one orb apart (32px, so boxes never overlap) and stay
// inside the stage (92px high) so none is clipped.
const HERO_CENTER = 72;
const ORB = 32;
const SPACING = 34;
const LOW = 36;   // chest height, beside the hero
const HIGH = 56;  // just above the hero's head

function getMinionsLayout(index: number, total: number): { left: string; bottom: string } {
  if (total === 1) return { left: `${HERO_CENTER + 20}px`, bottom: '44px' };
  if (total === 2) return { left: `${HERO_CENTER - ORB / 2 + (index ? 32 : -32)}px`, bottom: '44px' };
  const t = index / (total - 1);
  const x = HERO_CENTER - ORB / 2 + (index - (total - 1) / 2) * SPACING;
  const y = LOW + Math.sin(t * Math.PI) * (HIGH - LOW); // middle ones hover higher
  return { left: `${Math.round(x)}px`, bottom: `${Math.round(y)}px` };
}

/** One spirit orb per agent, hovering in its formation slot. */
function Minion({ agent, total, register }: { agent: Agent; total: number; register: (id: string, el: HTMLDivElement | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The orb is painted once; floating and glow are CSS animations.
  useEffect(() => {
    if (canvasRef.current) drawMinionSprite(canvasRef.current, agent.hero, agent.index);
  }, [agent.hero, agent.index]);
  const glow = orbPalette(agent.hero, agent.index).bright;

  const style = useRef(getMinionsLayout(agent.index, total)).current;

  return (
    <div
      ref={(el) => register(agent.id, el)}
      className={`minion${agent.dying ? ' dying' : ''}`}
      title={`${agent.hero.name} the ${agent.hero.cls}`}
      style={style}
    >
      <canvas
        ref={canvasRef}
        width={32}
        height={32}
        style={{
          ['--orb-glow' as string]: glow,
          animationDelay: `${-agent.index * 1.7}s, ${-agent.index * 0.9}s`,
        }}
      />
    </div>
  );
}

/**
 * One orb per agent. After each render the DOM nodes of the newest batch are
 * handed to the engine so it can fire projectiles from their slots.
 */
export function Minions({ agents, batch, game }: { agents: Agent[]; batch: number; game: GameApi }) {
  const els = useRef(new Map<string, HTMLDivElement>());
  const register = (id: string, el: HTMLDivElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };

  useLayoutEffect(() => {
    const ordered: (HTMLElement | undefined)[] = [];
    for (const a of agents) if (a.batch === batch && !a.dying) ordered[a.index] = els.current.get(a.id);
    game.setMinionElements(ordered);
  }, [agents, batch, game]);

  return agents.map((agent) => (
    <Minion
      key={agent.id}
      agent={agent}
      total={agents.filter((a) => a.batch === agent.batch).length}
      register={register}
    />
  ));
}
