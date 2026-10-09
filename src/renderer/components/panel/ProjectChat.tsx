import { AgentTabs } from './AgentTabs';
import { PermissionCard } from './PermissionCard';
import { MessageLog } from '../common/MessageLog';
import { Composer } from '../common/Composer';
import { ModelSelect } from '../common/ModelSelect';
import { useCommandCatalog } from '../../hooks/useCommandCatalog';
import { useSettings } from '../../context/SettingsContext';
import type { AgentsApi } from '../../hooks/useAgents';
import type { ClaudeRun } from '../../hooks/useClaudeRun';
import { usageLine } from '../../hooks/useClaudeRun';
import type { PermissionsApi } from '../../hooks/usePermissions';
import type { WorkspaceActions } from '../../hooks/useWorkspaceActions';
import type { QueuedMessage } from '../../lib/queue';
import { forOwner } from '../../lib/permissions';
import type { ModelAlias, PermissionMode, Workspace } from '../../types';

const IMPORT = '__import__';
const PERMISSION_MODES: [PermissionMode, string][] = [
  ['default', 'Ask me each time'],
  ['acceptEdits', 'Accept edits'],
  ['plan', 'Plan only'],
  ['bypassPermissions', 'Bypass perms'],
];

/**
 * Chat with Claude Code inside the selected project, plus the project /
 * model / permission controls. While agents are running, the log can show an
 * agent's output instead of the project conversation.
 */
export interface QueueView {
  items: QueuedMessage[];
  paused: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
  onResume: () => void;
}

export interface ProjectChatProps {
  ws: Workspace | null;
  run: ClaudeRun;
  agents: AgentsApi;
  busy: boolean;
  projectBusy?: boolean;
  /** Messages waiting for Claude's run to end (Expedition tab only). */
  queue?: QueueView;
  model: ModelAlias;
  onModelChange: (model: ModelAlias) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  workspaceActions: WorkspaceActions;
  /** The archive drawer beside the panel. */
  archive: { count: number; open: boolean; toggle: () => void };
  /** Pending permission requests ("Ask me each time") and the way to answer them. */
  permissions: Pick<PermissionsApi, 'requests' | 'answer'>;
}

export function ProjectChat({
  visible, ws, run, agents, busy, projectBusy, queue, model, onModelChange, onSend, onStop, workspaceActions, archive, permissions,
}: ProjectChatProps & { visible: boolean }) {
  const { settings, updateSettings } = useSettings();
  const { suggestions, refresh: refreshCommands } = useCommandCatalog(ws?.id ?? null);
  const agent = agents.agents.find((a) => a.id === agents.selectedId);
  const messages = agent ? agent.log : ws?.messages || [];
  const showsRun = !agent && !!ws && run.streaming.wsId === ws.id;
  const streaming = showsRun ? run.streaming.text : '';
  const streamingThinking = showsRun ? run.streaming.thinking : '';
  const liveUsage = !agent && run.running ? run.liveUsage : null;
  const working = !agent && !!ws && run.running && run.runWsId === ws.id && !streaming && !streamingThinking;

  // Cards of the tab being looked at. Requests of an observed (delegated) agent come from the Quest process,
  // so they show in the Quest tab, and the other tabs only carry a badge.
  const asking = new Set(permissions.requests.flatMap((r) => (r.owner.kind === 'agent' ? [r.owner.agentId] : [])));
  const questAsking = !!ws && forOwner(permissions.requests, { kind: 'quest', wsId: ws.id }).length > 0;
  const cards = agent
    ? (agent.observed ? [] : forOwner(permissions.requests, { kind: 'agent', agentId: agent.id }))
    : (ws ? forOwner(permissions.requests, { kind: 'quest', wsId: ws.id }) : []);

  const onWorkspaceChange = (value: string) => {
    if (value === IMPORT) workspaceActions.importProject();
    else workspaceActions.selectProject(value);
  };

  return (
    <div id="tab-project-chat" className={`tab-body${visible ? '' : ' hidden'}`}>
      <AgentTabs
        agents={agents.agents}
        selectedId={agents.selectedId}
        onSelect={agents.select}
        onRemove={agents.remove}
        archiveCount={archive.count}
        archiveOpen={archive.open}
        onToggleArchive={archive.toggle}
        visible={visible}
        asking={asking}
        questAsking={questAsking}
      />
      <MessageLog messages={messages} streaming={streaming} streamingThinking={streamingThinking} working={working} visible={visible} />
      {cards.length > 0 && (
        <div className="perm-stack">
          <PermissionCard
            key={cards[0].requestId}
            request={cards[0]}
            who={agent ? agent.name : 'Quest'}
            index={1}
            total={cards.length}
            visible={visible}
            onAnswer={(id, decision) => { void permissions.answer(id, decision); }}
          />
        </div>
      )}
      {liveUsage && <div className="run-usage">{`Tokens this run: ${usageLine(liveUsage)}`}</div>}
      {!agent && queue && queue.items.length > 0 && (
        <div className="queue-bar" role="region" aria-label="Queued messages">
          <div className="queue-head">
            <span>{queue.paused ? `Queue paused: ${queue.items.length}` : `Queued: ${queue.items.length}`}</span>
            {queue.paused && <button type="button" className="queue-btn queue-resume" onClick={queue.onResume}>Resume</button>}
            <button type="button" className="queue-btn queue-clear" onClick={queue.onClear}>Clear</button>
          </div>
          {queue.items.map((item) => (
            <div key={item.id} className="queue-item" title={item.text}>
              <span className="queue-text">{item.text}</span>
              <span className="queue-badge">queued</span>
              <button type="button" className="queue-x" aria-label="Remove queued message" onClick={() => queue.onRemove(item.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      <Composer
        focused={visible}
        busy={agent ? agent.status === 'running' : (projectBusy ?? busy)}
        disabled={!ws || !!agent?.observed}
        queueable={!agent}
        onSend={onSend}
        suggestions={suggestions}
        onSuggestionsOpen={refreshCommands}
        onStop={agent && !agent.observed && ws ? () => agents.stop(ws.id, agent.id) : onStop}
        placeholder={agent?.observed
          ? "Claude is running this agent; it can't be messaged. Stop ends the whole run."
          : agent
          ? `Message ${agent.name}… (Enter to send, Shift+Enter for a new line)`
          : ws && projectBusy
            ? 'Claude is busy: Enter queues your message (Shift+Enter for a new line)'
          : ws
            ? `Ask Claude about ${ws.name}… (Enter to send, Shift+Enter for a new line)`
            : 'Import a project to start'}
      />
      <footer className="panel-footer panel-footer-multi">
        <div className="footer-row">
          <select
            id="workspace"
            className="flex-2"
            title="Project — each one has its own hero"
            value={settings.activeId || ''}
            disabled={busy}
            onChange={(e) => onWorkspaceChange(e.target.value)}
          >
            {settings.workspaces.length === 0 && <option value="">No projects yet</option>}
            {settings.workspaces.map((w) => (
              <option key={w.id} value={w.id} title={w.path}>{`📁 ${w.name}`}</option>
            ))}
            <option value={IMPORT}>＋ Import project…</option>
          </select>
          <ModelSelect id="project-model" className="flex-1" value={model} onChange={onModelChange} />
        </div>
        <div className="footer-row">
          <select
            id="permission-mode"
            className="flex-1"
            title="Permission mode. Ask me each time: Claude asks you here (Allow once / Deny) before a risky tool runs. Accept edits and Bypass perms skip the questions. Ask chat is unaffected."
            value={settings.permissionMode}
            onChange={(e) => updateSettings({ permissionMode: e.target.value as PermissionMode })}
          >
            {PERMISSION_MODES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button id="new-session" className="flex-1" title="Start a fresh conversation" onClick={workspaceActions.newSession}>
            New session
          </button>
        </div>
      </footer>
    </div>
  );
}
