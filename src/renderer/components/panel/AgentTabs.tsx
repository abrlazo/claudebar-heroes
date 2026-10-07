/**
 * Tabs for the project chat and each running agent. Shown only while agents
 * exist. Each agent tab has a close button to manually remove it.
 */
import type { Agent } from '../../hooks/useAgents';

interface AgentTabsProps {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
}

export function AgentTabs({ agents, selectedId, onSelect, onRemove }: AgentTabsProps) {
  if (agents.length === 0) return null;
  return (
    <div id="agent-tabs" className="agent-tabs">
      <button type="button" className={`agent-tab${selectedId === null ? ' active' : ''}`} onClick={() => onSelect(null)}>
        Expedition
      </button>
      {agents.map((agent) => (
        <button
          type="button"
          key={agent.id}
          className={`agent-tab${agent.id === selectedId ? ' active' : ''}`}
          onClick={() => onSelect(agent.id)}
        >
          <span>{agent.name}</span>
          <span className="status">{agent.status}</span>
          <span
            className="close"
            onClick={(e) => { e.stopPropagation(); onRemove(agent.id); }}
          >
            ✕
          </span>
        </button>
      ))}
    </div>
  );
}
