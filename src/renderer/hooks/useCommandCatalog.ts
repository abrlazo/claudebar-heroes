import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bar } from '../lib/bridge';
import { toSuggestions } from '../lib/commands';
import type { CommandSuggestion } from '../lib/commands';
import type { CommandEntry } from '../types';

/**
 * The commands the "/" popup offers for a project: agents, skills and custom commands
 * found on disk (via the main process) plus the app's own `summon`. Loaded when the popup
 * opens (`refresh`, which re-reads the folders so new files show up without a restart), not before.
 */
export function useCommandCatalog(wsId: string | null): { suggestions: CommandSuggestion[]; refresh: () => void } {
  const [entries, setEntries] = useState<CommandEntry[]>([]);
  const latest = useRef(wsId);
  latest.current = wsId;

  const refresh = useCallback(() => {
    if (!wsId) {
      setEntries([]);
      return;
    }
    bar.commandCatalog(wsId)
      .then((list) => { if (latest.current === wsId) setEntries(list); })
      .catch(() => { /* keep the previous list */ });
  }, [wsId]);

  // Nothing is loaded until the popup first opens (the caller calls `refresh`); a project change drops the old list.
  useEffect(() => { setEntries([]); }, [wsId]);

  const suggestions = useMemo(() => toSuggestions(entries), [entries]);
  return { suggestions, refresh };
}
