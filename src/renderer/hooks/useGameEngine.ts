import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { createGame, KILLS_PER_MAP } from '../engine/game.js';
import type { Hero, MapId } from '../types';

/** Callbacks the engine invokes; always the latest ones are used. */
export interface GameHooks {
  onKill?: (kills: number) => void;
  onMapChange?: (mapId: MapId, kills: number) => void;
  onBossDefeated?: (bossId: string) => void;
  onCombo?: (steps: number) => void;
  onCrit?: () => void;
  say?: (text: string, ms?: number) => void;
}

/** Stable facade over the engine; safe to call before it exists. */
export interface GameApi {
  configure: (opts: { hero?: Hero | null; mapId?: string; kills?: number; level?: number }) => void;
  wake: () => void;
  sleep: () => void;
  toolEnemy: (name: string) => void;
  hurt: () => void;
  setAllies: (heroes: Hero[]) => void;
  setMinionElements: (els: (HTMLElement | undefined | null)[]) => void;
  clearAllies: () => void;
  readonly clearing: boolean;
  readonly killsPerMap: number;
}

export interface StageRefs {
  stageRef: RefObject<HTMLDivElement | null>;
  heroRef: RefObject<HTMLDivElement | null>;
  sceneCanvasRef: RefObject<HTMLCanvasElement | null>;
  heroCanvasRef: RefObject<HTMLCanvasElement | null>;
  auraCanvasRef: RefObject<HTMLCanvasElement | null>;
  fadeRef: RefObject<HTMLDivElement | null>;
}

/**
 * Owns the imperative battle engine. Returns the refs the <Stage> must attach
 * and a stable `game` facade that is safe to call before the engine exists.
 *
 * `hooks` (onKill, onMapChange, say) may change every render; the engine
 * always calls the latest ones.
 */
export function useGameEngine(hooks: GameHooks): { game: GameApi; refs: StageRefs } {
  const stageRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const sceneCanvasRef = useRef<HTMLCanvasElement>(null);
  const heroCanvasRef = useRef<HTMLCanvasElement>(null);
  const auraCanvasRef = useRef<HTMLCanvasElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<ReturnType<typeof createGame> | null>(null);
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  useEffect(() => {
    const game = createGame(
      {
        stage: stageRef.current!,
        heroEl: heroRef.current!,
        sceneCanvas: sceneCanvasRef.current!,
        heroCanvas: heroCanvasRef.current!,
        auraCanvas: auraCanvasRef.current!,
        fadeEl: fadeRef.current!,
      },
      {
        onKill: (kills: number) => hooksRef.current.onKill?.(kills),
        onMapChange: (mapId: string, kills: number) => hooksRef.current.onMapChange?.(mapId as MapId, kills),
        onBossDefeated: (bossId: string) => hooksRef.current.onBossDefeated?.(bossId),
        onCombo: (n: number) => hooksRef.current.onCombo?.(n),
        onCrit: () => hooksRef.current.onCrit?.(),
        say: (text: string, ms?: number) => hooksRef.current.say?.(text, ms),
      },
    );
    gameRef.current = game;
    game.start();
    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  const game = useMemo<GameApi>(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engine is untyped JS
    const call = (name: string) => (...args: any[]) => (gameRef.current as any)?.[name](...args);
    return {
      configure: call('configure'),
      wake: call('wake'),
      sleep: call('sleep'),
      toolEnemy: call('toolEnemy'),
      hurt: call('hurt'),
      setAllies: call('setAllies'),
      setMinionElements: call('setMinionElements'),
      clearAllies: call('clearAllies'),
      get clearing() { return gameRef.current?.clearing ?? false; },
      killsPerMap: KILLS_PER_MAP,
    };
  }, []);

  return { game, refs: { stageRef, heroRef, sceneCanvasRef, heroCanvasRef, auraCanvasRef, fadeRef } };
}
