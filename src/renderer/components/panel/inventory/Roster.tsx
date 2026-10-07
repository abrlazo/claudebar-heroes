import { heroFor, portraitFor } from '../../../lib/heroCache';
import { levelFor, totalTokens, xpFor } from '../../../lib/leveling';
import { formatTokens } from '../../../lib/format';
import type { WorkspaceActions } from '../../../hooks/useWorkspaceActions';
import type { Workspace } from '../../../types';

/** One card per project's hero, plus an "Import project" card. */
export function Roster({ workspaces, activeId, busy, actions }: { workspaces: Workspace[]; activeId: string | null; busy: boolean; actions: WorkspaceActions }) {
  return (
    <div id="roster" className={busy ? 'locked' : ''}>
      {workspaces.map((w) => {
        const hero = heroFor(w);
        return (
          <div className="hero-card-wrap" key={w.id}>
            <button
              className={`hero-card${w.id === activeId ? ' selected' : ''}`}
              title={w.path}
              onClick={() => actions.selectProject(w.id)}
            >
              <img src={portraitFor(w)} alt="" />
              <strong>{hero.name}</strong>
              <small>{`Lv ${levelFor(xpFor(w))} ${hero.cls}`}</small>
              <span className="muted">{w.name}</span>
              <span className="tokens">{`${formatTokens(totalTokens(w.usage))} tokens`}</span>
            </button>
            <button className="remove-x" title={`Remove ${w.name}`} onClick={() => actions.removeProject(w)}>✕</button>
          </div>
        );
      })}
      <button className="hero-card add" onClick={actions.importProject}>
        <span className="plus">＋</span>
        <small>Import project</small>
      </button>
    </div>
  );
}
