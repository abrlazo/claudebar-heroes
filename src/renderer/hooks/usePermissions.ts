import { useCallback, useRef, useState } from 'react';
import { bar } from '../lib/bridge';
import { addRequest, clearOwner as dropOwner, resolveRequest } from '../lib/permissions';
import type { ClaudeEvent, PermissionOwner, PermissionRequest } from '../types';

type How = NonNullable<ClaudeEvent['how']>;

export interface PermissionsApi {
  /** Requests waiting for the user, oldest first (every project, Quest and agents). */
  requests: PermissionRequest[];
  /** A 'permission' event of Claude's run or of an agent's process: shows a card. */
  add: (owner: PermissionOwner, ev: ClaudeEvent) => void;
  /** A 'permission-resolved' event (or the user's own answer): removes the card and logs what happened once. */
  resolve: (requestId: string, how: How) => void;
  /** The process of `owner` is over: its cards can never be answered. */
  clearOwner: (owner: PermissionOwner) => void;
  /** The user's choice. The card goes away when main confirms; main only accepts requests it recorded as pending. */
  answer: (requestId: string, decision: 'allow' | 'deny') => Promise<void>;
}

/** What a card was about, for the chat log: "Bash: mkdir x". */
const describe = (r: PermissionRequest) => `${r.tool}${r.summary ? `: ${r.summary}` : ''}`.slice(0, 160);

/**
 * The permission cards ("Ask me each time"). Main holds the pending requests and decides what an answer
 * means; this hook only mirrors them for the UI and writes the decision as a meta line in the owner's log
 * (never as a user message). `log` is called with the owner and the text.
 */
export function usePermissions(log: (owner: PermissionOwner, text: string) => void): PermissionsApi {
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  const ref = useRef<PermissionRequest[]>([]);
  const logRef = useRef(log);
  logRef.current = log;

  const commit = useCallback((next: PermissionRequest[]) => {
    ref.current = next;
    setRequests(next);
  }, []);

  const add = useCallback((owner: PermissionOwner, ev: ClaudeEvent) => {
    if (typeof ev.requestId !== 'string' || !ev.requestId) return;
    commit(addRequest(ref.current, {
      requestId: ev.requestId, owner,
      tool: ev.tool ?? 'tool', summary: ev.summary ?? '', detail: ev.detail ?? '',
      truncatedLines: ev.truncatedLines ?? 0, truncated: !!ev.truncated, path: ev.path ?? '',
      viaSubagent: !!ev.viaSubagent, expiresAt: ev.expiresAt ?? Date.now() + 300000,
    }));
  }, [commit]);

  const resolve = useCallback((requestId: string, how: How) => {
    const req = ref.current.find((r) => r.requestId === requestId);
    if (!req) return; // already gone: whoever removed it logged it
    commit(resolveRequest(ref.current, requestId));
    if (how === 'allowed') logRef.current(req.owner, `Allowed: ${describe(req)}`);
    else if (how === 'denied') logRef.current(req.owner, `Denied: ${describe(req)}`);
    else if (how === 'timeout') logRef.current(req.owner, `Denied (no answer in time): ${describe(req)}`);
  }, [commit]);

  const clearOwner = useCallback((owner: PermissionOwner) => {
    commit(dropOwner(ref.current, owner));
  }, [commit]);

  const answer = useCallback(async (requestId: string, decision: 'allow' | 'deny') => {
    const req = ref.current.find((r) => r.requestId === requestId);
    if (!req) return;
    const target = req.owner.kind;
    const agentId = req.owner.kind === 'agent' ? req.owner.agentId : null;
    let ok = false;
    try {
      ok = (await bar.answerPermission(target, agentId, requestId, decision)).ok;
    } catch { /* treated as not accepted */ }
    // ok: main sent it. Not ok: main no longer holds the request (it ended or was answered), so the card is stale.
    resolve(requestId, ok ? (decision === 'allow' ? 'allowed' : 'denied') : 'ended');
  }, [resolve]);

  return { requests, add, resolve, clearOwner, answer };
}
