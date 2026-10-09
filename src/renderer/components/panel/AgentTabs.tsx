/**
 * Tabs for the project chat and each agent, plus the Archive pill (always shown; it opens the archive
 * drawer beside the panel). A finished agent's tab counts down to its retirement (the archive);
 * the X closes it now (a running agent is stopped first).
 */
import { useEffect, useState } from 'react';
import type { Agent } from '../../hooks/useAgents';
import { idleLimitMs } from '../../lib/agents';
import { clock } from '../../lib/format';
import { idleState } from '../../lib/idle';

interface AgentTabsProps {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  /** Chats in the project's archive. */
  archiveCount: number;
  archiveOpen: boolean;
  onToggleArchive: () => void;
  /** The panel tab is on screen; no clock runs while it is hidden. */
  visible: boolean;
  /** Agents with a permission request waiting, and whether the Quest chat has one. */
  asking: ReadonlySet<string>;
  questAsking: boolean;
}

const NONE: ReadonlySet<string> = new Set();

/** Re-renders only the caller once a second while `enabled`. */
function useClock(enabled: boolean): void {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
}

export function AgentTabs({ agents, selectedId, onSelect, onRemove, archiveCount, archiveOpen, onToggleArchive, visible, asking, questAsking }: AgentTabsProps) {
  const ticking = visible && agents.some((a) => !a.dying && a.id !== selectedId);
  useClock(ticking); // only to re-render once a second; the time itself is read below so it is never older than the agent's last activity
  const now = Date.now();
  const limit = idleLimitMs();
  return (
    <div id="agent-tabs" className="agent-tabs">
      <button type="button" className={`agent-tab${selectedId === null ? ' active' : ''}`} onClick={() => onSelect(null)}>
        Quest
        {questAsking && selectedId !== null && <span className="asking" title="Quest is waiting for your permission" aria-label="waiting for your permission">!</span>}
      </button>
      {agents.map((agent) => {
        const idle = idleState(agent, now, limit, selectedId, NONE);
        return (
          <button
            type="button"
            key={agent.id}
            className={`agent-tab${agent.id === selectedId ? ' active' : ''}`}
            onClick={() => onSelect(agent.id)}
          >
            <span>{agent.name}</span>
            <span className="status">{agent.status}</span>
            {asking.has(agent.id) && <span className="asking" title="Waiting for your permission" aria-label="waiting for your permission">!</span>}
            {idle.kind === 'counting' && (
              <span className="idle" title={`Retires to the archive in ${clock(idle.leftMs)} unless you open it or message it`}>{clock(idle.leftMs)}</span>
            )}
            {idle.kind === 'quiet' && (
              <span className="idle quiet" title="Still running, but it has sent nothing for a while. It is never stopped automatically.">{`quiet ${clock(idle.quietMs)}`}</span>
            )}
            <span
              className="close"
              title={agent.status === 'running' ? 'Stop this agent and move its chat to the archive' : 'Move this chat to the archive'}
              onClick={(e) => { e.stopPropagation(); onRemove(agent.id); }}
            >
              ✕
            </span>
          </button>
        );
      })}
      <button
        type="button"
        id="archive-open"
        className={`archive-pill${archiveOpen ? ' active' : ''}`}
        title={archiveCount > 0
          ? 'Chats of agents that finished or were closed (read-only)'
          : 'Chats of agents that finished or were closed (read-only). None yet.'}
        aria-pressed={archiveOpen}
        onClick={onToggleArchive}
      >
        {`Archive (${archiveCount})`}
      </button>
    </div>
  );
}
