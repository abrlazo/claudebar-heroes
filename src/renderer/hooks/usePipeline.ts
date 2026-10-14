import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LINGER_MS, buildPipeline, sameModel, shouldShow } from '../lib/pipeline';
import type { PipelineModel } from '../lib/pipeline';
import type { Agent, ChainSteps } from './useAgents';
import type { RunActivity } from './useClaudeRun';
import type { PermissionRequest } from '../types';

export interface PipelineApi {
  model: PipelineModel;
  /** Work is going (or just ended) in the active project and the user has not closed the pane for this burst. */
  visible: boolean;
  /** The user closed the pane while work still runs: the tab row offers a "Pipeline" pill to bring it back. */
  canReopen: boolean;
  close: () => void;
  reopen: () => void;
}

interface Deps {
  wsId: string | null;
  run: { running: boolean; starting: boolean; activity: RunActivity | null };
  agents: Agent[];
  chainSteps: ChainSteps;
  permissions: PermissionRequest[];
  /** Texts waiting in the active project's message queue. */
  queued: string[];
}

/**
 * The workflow pipeline pane's model and visibility. The model is derived (memoised) from small, already
 * reactive inputs, never from an agent's log, and the previous reference is kept when nothing visible changed,
 * so `PipelinePane` does not render while text streams. One timer (cleared on unmount) ends the 4 s linger.
 * Nothing is persisted. The window side (main) is `usePanel`'s job; this only says whether the pane is wanted.
 */
export function usePipeline({ wsId, run, agents, chainSteps, permissions, queued }: Deps): PipelineApi {
  const quest = run.activity;
  const questLive = (run.running || run.starting) && (!quest || quest.wsId === null || quest.wsId === wsId);
  const agentsLive = agents.some((a) => a.status === 'running' && a.wsId === wsId);
  const chainLive = Object.values(chainSteps).some((c) => c.wsId === wsId);
  const working = !!wsId && (questLive || agentsLive || chainLive);

  // The start of the current burst of work: finished agents of earlier bursts are not shown.
  const since = useRef(0);
  const wasWorking = useRef(false);
  if (working && !wasWorking.current) since.current = Date.now();
  wasWorking.current = working;
  const lastWorkAt = useRef<number | null>(null);
  if (working) lastWorkAt.current = Date.now();

  const previous = useRef<PipelineModel | null>(null);
  const model = useMemo(() => {
    const next = buildPipeline({
      wsId,
      quest: {
        wsId: quest?.wsId ?? wsId, running: run.running, starting: run.starting, startedAt: quest?.startedAt ?? null,
        endedAt: quest?.endedAt, outcome: quest?.outcome, lastTool: quest?.lastTool, toolCount: quest?.toolCount,
      },
      agents, chainSteps, permissions, queued, since: since.current,
    });
    const old = previous.current;
    if (old && sameModel(old, next)) return old;
    previous.current = next;
    return next;
  // `since` only changes together with `working`, which is part of the inputs below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, quest, run.running, run.starting, agents, chainSteps, permissions, queued, working]);

  // One timer: when the work ends, re-render once the linger is over so the pane closes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (working) { setNow(Date.now()); return undefined; }
    const timer = setTimeout(() => setNow(Date.now()), LINGER_MS + 50);
    return () => clearTimeout(timer);
  }, [working]);

  // Closed by the user for this burst (the burst is identified by its start).
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const dismissed = dismissedAt !== null && dismissedAt === since.current;
  const shown = shouldShow({ working, lastWorkAt: lastWorkAt.current, now, hasNodes: model.nodes.length > 0 });
  const close = useCallback(() => setDismissedAt(since.current), []);
  const reopen = useCallback(() => setDismissedAt(null), []);
  return { model, visible: shown && !dismissed, canReopen: dismissed && working, close, reopen };
}
