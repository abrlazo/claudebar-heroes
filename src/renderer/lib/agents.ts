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

/** Tab name for a new agent: "gitama", then "gitama 2", "gitama 3", ... while others use the name. */
export function uniqueAgentName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}
