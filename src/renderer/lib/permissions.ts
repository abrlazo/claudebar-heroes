// Pure rules for the permission cards the UI shows ("Ask me each time"). Every function returns new arrays
// (React state) and never mutates its input. Main owns the truth: a card is only a view of a request main holds.

import type { PermissionRequest, PermissionOwner, PermissionMode } from '../types';

export const MAX_REQUESTS = 20;

const sameOwner = (a: PermissionOwner, b: PermissionOwner): boolean => (
  a.kind === 'quest' ? b.kind === 'quest' && a.wsId === b.wsId : b.kind === 'agent' && a.agentId === b.agentId
);

/** Appends a request (first in, first shown). A repeated id or a full list changes nothing. */
export function addRequest(list: PermissionRequest[], req: PermissionRequest): PermissionRequest[] {
  if (list.length >= MAX_REQUESTS || list.some((r) => r.requestId === req.requestId)) return list;
  return [...list, req];
}

export function resolveRequest(list: PermissionRequest[], requestId: string): PermissionRequest[] {
  return list.some((r) => r.requestId === requestId) ? list.filter((r) => r.requestId !== requestId) : list;
}

export function forOwner(list: PermissionRequest[], owner: PermissionOwner): PermissionRequest[] {
  return list.filter((r) => sameOwner(r.owner, owner));
}

/** Drops every request of one owner (its process ended). */
export function clearOwner(list: PermissionRequest[], owner: PermissionOwner): PermissionRequest[] {
  return list.some((r) => sameOwner(r.owner, owner)) ? list.filter((r) => !sameOwner(r.owner, owner)) : list;
}

/** "4:32": time left until main denies the request on its own. */
export function countdownLabel(expiresAt: number, now: number): string {
  const total = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The footer's permission modes and their labels (one table for the footer select and the chat lines). */
export const PERMISSION_MODE_OPTIONS: [PermissionMode, string][] = [
  ['default', 'Ask me each time'],
  ['acceptEdits', 'Accept edits'],
  ['plan', 'Plan only'],
  ['bypassPermissions', 'Bypass perms'],
];

export const modeLabel = (mode: PermissionMode | undefined): string => PERMISSION_MODE_OPTIONS.find(([m]) => m === mode)?.[1] ?? 'the new mode';

/** The meta line after the footer mode was applied to a running chat (`ok`), or could not be. */
export function modeChangeLine(mode: PermissionMode | undefined, ok: boolean): string {
  return ok
    ? `Permission mode changed to ${modeLabel(mode)} for this run.`
    : `Could not switch this run to ${modeLabel(mode)}; it applies to your next message.`;
}

/** The meta line for a reply to a permission card. `text` was cleaned and capped by main. */
export function replyLine(tool: string, text: string): string {
  return `You replied to ${tool}: ${text.trim().slice(0, 2000)}`;
}
