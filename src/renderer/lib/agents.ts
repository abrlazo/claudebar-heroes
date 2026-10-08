import type { AgentDefinition } from '../types';

// Agents are started with "/<agent-name> <task>". Only names that exist as files
// under a .claude/agents/ folder count (the main process lists them). Skills,
// other slash commands and built-in agents are not agents here: a message
// starting with "/something-else" is an ordinary message to Claude.

/** Most agents that may work at the same time. */
export const MAX_AGENTS = 4;

export interface AgentInvocation {
  definition: AgentDefinition;
  /** Everything after the agent's name; empty when the user gave no task. */
  task: string;
}

/**
 * "/gitama commit these changes" -> { definition: gitama, task: "commit these changes" }.
 * Returns null unless the message starts with "/" followed by a known agent name
 * (case-insensitive), so "/run", "/review" or a file path like "/Users/me/x" are never agents.
 */
export function parseAgentInvocation(text: string, definitions: AgentDefinition[]): AgentInvocation | null {
  const match = text.match(/^\s*\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const definition = definitions.find((d) => d.name.toLowerCase() === match[1].toLowerCase());
  if (!definition) return null;
  return { definition, task: (match[2] ?? '').trim() };
}

/** Most steps in a chain: "/a task && /b && /c". */
export const MAX_CHAIN_STEPS = 3;

/** The agent whose findings land in .claude/review.md, for the hand-off to the next step. */
export const REVIEW_AGENT = 'feature-planner';
export const REVIEW_FILE = '.claude/review.md';

export interface AgentChain {
  steps: AgentInvocation[];
  /** More than MAX_CHAIN_STEPS steps were written; nothing should start. */
  tooLong: boolean;
}

/**
 * "/a do x && /b" -> two steps. A chain needs 2 or more parts and EVERY part must be
 * "/<known agent> [task]"; otherwise null and the text is handled as a single message.
 */
export function parseAgentChain(text: string, definitions: AgentDefinition[]): AgentChain | null {
  if (!text.includes('&&')) return null;
  const parts = text.split('&&');
  const steps: AgentInvocation[] = [];
  for (const part of parts) {
    const step = parseAgentInvocation(part, definitions);
    if (!step) return null;
    steps.push(step);
  }
  return { steps, tooLong: steps.length > MAX_CHAIN_STEPS };
}

/**
 * The task for the next step of a chain, or a reason to stop. A step with its own text keeps it;
 * otherwise it gets the findings file (after the review agent, when it exists) or the previous
 * agent's final message under a one-line header.
 */
export function handoffTask(opts: {
  prevDefinition: string; prevName: string; prevText: string; task: string; hasReview: boolean;
}): { task: string } | { stop: string } {
  if (opts.task) return { task: opts.task };
  if (opts.prevDefinition === REVIEW_AGENT) {
    return opts.hasReview
      ? { task: `Implement the findings in ${REVIEW_FILE}` }
      : { stop: 'no findings to implement' };
  }
  const text = opts.prevText.trim();
  if (!text) return { stop: `${opts.prevName} left no message to hand on` };
  return { task: `Handed on by the previous agent (${opts.prevName}):\n\n${text}` };
}

/** Tab name for a new agent: "gitama", then "gitama 2", "gitama 3", ... while others use the name. */
export function uniqueAgentName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/** A finished agent is retired to the project's archive after this long without activity. Running agents never are. */
export const IDLE_RETIRE_MS = 2 * 60 * 1000;

/**
 * The idle time in use. `globalThis.__cbhIdleMs` is a test seam (renderer only, never settings or IPC),
 * like `__cbhBossChance`; it must be a finite number of at least 500 ms.
 */
export function idleLimitMs(): number {
  const seam = (globalThis as { __cbhIdleMs?: unknown }).__cbhIdleMs;
  return typeof seam === 'number' && Number.isFinite(seam) && seam >= 500 ? seam : IDLE_RETIRE_MS;
}
