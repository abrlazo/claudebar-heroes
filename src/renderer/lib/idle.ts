// When does a finished agent retire to the archive? Pure rules, no React, no clock of their own
// (the caller passes `now`), so they can be unit tested (tools/check-archive.mjs).

/** The part of an agent the idle rules look at. */
export interface IdleAgent {
  id: string;
  status: 'running' | 'done';
  dying: boolean;
  /** Last event from the agent, a message to it, or the user opening its tab (ms since epoch). */
  lastActivityAt: number;
}

export type IdleState =
  /** Nothing to show (selected, dying, or running and not quiet yet). */
  | { kind: 'none' }
  /** Finished and about to retire in `leftMs`. */
  | { kind: 'counting'; leftMs: number }
  /** Running but silent for `quietMs`. A hint only: running agents are never retired. */
  | { kind: 'quiet'; quietMs: number };

/** A finished agent the timer may retire: not dying, not the open tab, not held (hand-off to a chain's next step). */
export function retirable(a: IdleAgent, selectedId: string | null, held: ReadonlySet<string>): boolean {
  return a.status === 'done' && !a.dying && a.id !== selectedId && !held.has(a.id);
}

/** What a tab shows for this agent. The open tab never shows (or counts) anything. */
export function idleState(a: IdleAgent, now: number, limit: number, selectedId: string | null, held: ReadonlySet<string> = new Set()): IdleState {
  if (a.dying || a.id === selectedId) return { kind: 'none' };
  if (a.status === 'running') {
    const quietMs = now - a.lastActivityAt;
    return quietMs >= limit ? { kind: 'quiet', quietMs } : { kind: 'none' };
  }
  if (!retirable(a, selectedId, held)) return { kind: 'none' };
  return { kind: 'counting', leftMs: Math.min(limit, Math.max(0, a.lastActivityAt + limit - now)) };
}

/** The earliest moment (ms since epoch) a finished agent becomes due, or null when none is waiting. */
export function nextDeadline(agents: readonly IdleAgent[], limit: number, selectedId: string | null, held: ReadonlySet<string> = new Set()): number | null {
  let at: number | null = null;
  for (const a of agents) {
    if (!retirable(a, selectedId, held)) continue;
    const due = a.lastActivityAt + limit;
    if (at === null || due < at) at = due;
  }
  return at;
}

/** The finished agents whose time is up at `now`. */
export function dueAgents<T extends IdleAgent>(agents: readonly T[], now: number, limit: number, selectedId: string | null, held: ReadonlySet<string> = new Set()): T[] {
  return agents.filter((a) => retirable(a, selectedId, held) && now >= a.lastActivityAt + limit);
}
