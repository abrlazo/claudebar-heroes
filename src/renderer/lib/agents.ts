// Agent spawning rules (for slash-command-based invocation).

export const MAX_AGENTS = 3;

/** One agent per ~100 characters of prompt, between 1 and MAX_AGENTS. */
export function agentCountFor(prompt: string): number {
  return Math.min(MAX_AGENTS, Math.max(1, Math.floor(prompt.length / 100)));
}
