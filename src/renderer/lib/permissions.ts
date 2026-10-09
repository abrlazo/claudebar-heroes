// Pure rules for the permission cards the UI shows ("Ask me each time"). Every function returns new arrays
// (React state) and never mutates its input. Main owns the truth: a card is only a view of a request main holds.

import type { PermissionRequest, PermissionOwner } from '../types';

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
