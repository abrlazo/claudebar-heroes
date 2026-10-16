import type { Workspace, WorkspaceSpend } from '../types';

/** Micro-dollars as dollars: 4 decimals under $1, 2 from $1 up, thousands separated ("$1,000,000.00"). */
export function formatUsd(micro: number): string {
  const usd = Number.isFinite(micro) && micro > 0 ? micro / 1e6 : 0;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  const [whole, cents] = usd.toFixed(2).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

/** Milliseconds of Claude time: "0s", "59s", "1m 30s", "1h 20m". */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

/** One line: "$0.1234 · 3 runs · 5m 2s of Claude time". */
export function spendLine(s: WorkspaceSpend | undefined): string {
  const x = s || { runs: 0, costMicro: 0, durationMs: 0, turns: 0 };
  return `${formatUsd(x.costMicro)} · ${x.runs} ${x.runs === 1 ? 'run' : 'runs'} · ${formatDuration(x.durationMs)} of Claude time`;
}

/** Sum over every project. */
export function totalSpend(workspaces: Pick<Workspace, 'spend'>[]): WorkspaceSpend {
  const t: WorkspaceSpend = { runs: 0, costMicro: 0, durationMs: 0, turns: 0 };
  for (const w of workspaces) {
    t.runs += w.spend?.runs || 0;
    t.costMicro += w.spend?.costMicro || 0;
    t.durationMs += w.spend?.durationMs || 0;
    t.turns += w.spend?.turns || 0;
  }
  return t;
}
