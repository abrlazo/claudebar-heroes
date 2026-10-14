/**
 * The workflow pipeline: the running work of the active project as stages (the Quest run, agents, the steps of a
 * chain waiting their turn, queued messages). Plain text only, never takes focus, no key handling (Esc keeps its
 * order: popup, drawer, panel) and no way to stop or approve anything here (answers stay on the permission card).
 * Clicking a stage only selects that chat. In a side mode the window is widened by the main process; `inline`
 * sits at the top of the panel.
 */
import { memo, useEffect, useState } from 'react';
import { elapsedLabel, isActiveState } from '../../lib/pipeline';
import type { PipelineModel, PipelineNode } from '../../lib/pipeline';
import type { PipelineMode } from '../../types';

export interface PipelinePaneProps {
  model: PipelineModel;
  mode: PipelineMode;
  onClose: () => void;
  /** A stage was clicked: its node id ('quest' or 'agent:<id>'). */
  onSelect: (nodeId: string) => void;
}

const ICONS: Record<PipelineNode['state'], string> = { waiting: '○', running: '●', asking: '!', done: '✓', failed: '✕', cancelled: '■' };
const STATE_TEXT: Record<PipelineNode['state'], string> = {
  waiting: 'waiting', running: 'running', asking: 'waiting for your OK', done: 'done', failed: 'failed', cancelled: 'stopped',
};

// Test hooks (renderer JS only, off unless a test sets the flag): count renders and live elapsed timers.
type TestFlags = { __cbhCountRenders?: boolean; __cbhPipelineTimers?: number };
const flags = globalThis as TestFlags;
let renders = 0;

/** The stage list. Owns the one-second clock, so only this re-renders each second, and only while something runs. */
function Stages({ model, onSelect }: { model: PipelineModel; onSelect: (id: string) => void }) {
  const ticking = model.nodes.some((n) => n.startedAt !== null && isActiveState(n.state));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    if (flags.__cbhCountRenders) flags.__cbhPipelineTimers = (flags.__cbhPipelineTimers ?? 0) + 1;
    return () => {
      clearInterval(timer);
      if (flags.__cbhCountRenders) flags.__cbhPipelineTimers = (flags.__cbhPipelineTimers ?? 1) - 1;
    };
  }, [ticking]);
  return (
    <ol className="pipeline-list">
      {model.nodes.map((n) => {
        const clickable = n.kind === 'quest' || n.kind === 'agent';
        const time = n.startedAt === null ? '' : elapsedLabel((n.endedAt ?? now) - n.startedAt);
        const body = (
          <>
            <span className="pipeline-icon" aria-hidden="true">{ICONS[n.state]}</span>
            <span className="pipeline-text">
              <span className="pipeline-label">{n.label}</span>
              {n.detail && <span className="pipeline-detail">{n.detail}</span>}
            </span>
            <span className="pipeline-time">{time}</span>
            <span className="sr-only">{STATE_TEXT[n.state]}</span>
          </>
        );
        return (
          <li key={n.id} className={`pipeline-node ${n.state} ${n.kind}`} data-node={n.id} data-state={n.state}>
            {clickable
              ? <button type="button" className="pipeline-hit" tabIndex={-1} onClick={() => onSelect(n.id)} title={`Open ${n.label}`}>{body}</button>
              : <div className="pipeline-hit">{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

export const PipelinePane = memo(function PipelinePane({ model, mode, onClose, onSelect }: PipelinePaneProps) {
  if (flags.__cbhCountRenders) renders += 1;
  return (
    <aside
      id="pipeline-pane"
      className={`pipeline-pane interactive ${mode}`}
      role="status"
      aria-live="off"
      aria-label="Workflow pipeline"
      data-renders={flags.__cbhCountRenders ? renders : undefined}
    >
      <div className="pipeline-head">
        <span className="pipeline-title">Workflow</span>
        <span className="pipeline-headline">{model.headline}</span>
        <button type="button" className="pipeline-close" tabIndex={-1} onClick={onClose} title="Close for this run" aria-label="Close the workflow pane">×</button>
      </div>
      <Stages model={model} onSelect={onSelect} />
      {model.notes.map((t) => <div key={t} className="pipeline-note">{t}</div>)}
    </aside>
  );
});
