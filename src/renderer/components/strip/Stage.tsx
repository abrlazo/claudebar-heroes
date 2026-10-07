import { Minions } from './Minions';
import type { Agent } from '../../hooks/useAgents';
import type { GameApi, StageRefs } from '../../hooks/useGameEngine';
import type { DragProps } from '../../hooks/useWindowDrag';

export interface StageProps {
  refs: StageRefs;
  bubble: string;
  hasWorkspace: boolean;
  onImport: () => void;
  agents: Agent[];
  agentBatch: number;
  game: GameApi;
  dragProps: DragProps;
}

/**
 * The battle viewport. React owns the fixed nodes (scene canvas, hero, fade,
 * minions); the engine appends enemies and damage numbers to the stage itself.
 */
export function Stage({ refs, bubble, hasWorkspace, onImport, agents, agentBatch, game, dragProps }: StageProps) {
  return (
    <div id="stage" ref={refs.stageRef} {...dragProps}>
      <canvas id="scene" ref={refs.sceneCanvasRef} />
      <div id="hero" ref={refs.heroRef}>
        <canvas id="aura-canvas" ref={refs.auraCanvasRef} />
        <canvas id="hero-canvas" ref={refs.heroCanvasRef} />
        {bubble && <div id="bubble">{bubble}</div>}
      </div>
      <Minions agents={agents} batch={agentBatch} game={game} />
      {!hasWorkspace && <button id="empty" onClick={onImport}>＋ Import a project to summon a hero</button>}
      <div id="fade" ref={refs.fadeRef} />
    </div>
  );
}
