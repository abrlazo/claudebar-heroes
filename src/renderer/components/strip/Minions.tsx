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
function Minion({ agent, slot, total, register }: {
  agent: Agent; slot: number; total: number; register: (id: string, el: HTMLDivElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The orb is painted once; floating and glow are CSS animations.
  useEffect(() => {
    if (canvasRef.current) drawMinionSprite(canvasRef.current, agent.hero, agent.index);
  }, [agent.hero, agent.index]);
  const glow = orbPalette(agent.hero, agent.index).bright;

  return (
    <div
      ref={(el) => register(agent.id, el)}
      className={`minion${agent.dying ? ' dying' : ''}`}
      title={`${agent.name} (${agent.hero.name} the ${agent.hero.cls})`}
      style={getMinionsLayout(slot, total)}
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
 * One orb per agent. Agents arrive one at a time ("/<agent> <task>"), so slots are
 * re-spread over everyone currently shown whenever one starts or is closed; the CSS
 * transition slides the orbs into place. After each change the engine is told which
 * agents are working and where their orbs are, so it can fire projectiles from them.
 */
export function Minions({ agents, game }: { agents: Agent[]; game: GameApi }) {
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

  return agents.map((agent, slot) => (
    <Minion key={agent.id} agent={agent} slot={slot} total={agents.length} register={register} />
  ));
}
