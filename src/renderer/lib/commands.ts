import type { CommandEntry } from '../types';

// The "/" suggestion popup: what it offers and how typing narrows it.

export interface CommandSuggestion {
  /** Unique key for React. */
  key: string;
  /** What the popup shows: "/gitama", or "summon" for the app's own command. */
  label: string;
  /** What replaces the composer text when picked (always ends with a space, ready for arguments). */
  insert: string;
  kind: CommandEntry['kind'] | 'app';
  description: string;
  source?: string;
  argumentHint?: string;
}

/** `/plan` is not a headless Claude command; in this app plan mode is the "Plan only" permission mode. */
const PLAN: CommandSuggestion = {
  key: 'app:plan',
  label: '/plan',
  insert: '/plan ',
  kind: 'app',
  description: 'Switch to Plan mode (Claude plans, changes nothing). Add a task to send it, e.g. /plan add dark mode',
  argumentHint: '[task]',
};

/** The app's own command. It is typed without a slash, so the popup inserts plain "summon ". */
const SUMMON: CommandSuggestion = {
  key: 'app:summon',
  label: 'summon',
  insert: 'summon ',
  kind: 'app',
  description: 'Swap your hero: "summon <character>", e.g. summon Yoda (no slash)',
  argumentHint: '<character>',
};

/** Popup entries for the commands Claude and the project offer, plus the app's own `/plan` and `summon`. */
export function toSuggestions(entries: CommandEntry[]): CommandSuggestion[] {
  return [
    ...entries.map((e): CommandSuggestion => ({
      key: `${e.kind}:${e.name}`,
      label: `/${e.name}`,
      insert: `/${e.name} `,
      kind: e.kind,
      description: e.description,
      source: e.source,
      argumentHint: e.argumentHint || undefined,
    })),
    PLAN,
    SUMMON,
  ];
}

/** The text after the "/" while the user is still typing the command name; null otherwise (no popup). */
export function slashQuery(text: string): string | null {
  const match = text.match(/^\s*\/(\S*)$/);
  return match ? match[1] : null;
}

/** Suggestions for `query`: names that start with it first, then names that merely contain it. */
export function filterSuggestions(query: string, suggestions: CommandSuggestion[]): CommandSuggestion[] {
  const q = query.toLowerCase();
  const nameOf = (s: CommandSuggestion) => s.label.replace(/^\//, '').toLowerCase();
  const starts = suggestions.filter((s) => nameOf(s).startsWith(q));
  const contains = q ? suggestions.filter((s) => !nameOf(s).startsWith(q) && nameOf(s).includes(q)) : [];
  return [...starts, ...contains];
}
