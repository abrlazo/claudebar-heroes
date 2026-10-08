import { useCallback, useEffect, useRef } from 'react';
import { bar } from '../lib/bridge';
import { useSettings } from '../context/SettingsContext';
import { ACHIEVEMENTS, EMPTY_STATS, unlocked } from '../lib/achievements';
import type { AchievementSnapshot } from '../lib/achievements';
import { levelFor, totalTokens, xpFor } from '../lib/leveling';
import type { Workspace, WorkspaceStats } from '../types';

const FLUSH_MS = 10_000;

const snapshotOf = (ws: Workspace): AchievementSnapshot => ({
  kills: ws.kills || 0,
  level: levelFor(xpFor(ws)),
  tokens: totalTokens(ws.usage),
  trophies: ws.trophies || {},
  stats: ws.stats || EMPTY_STATS,
});

interface Pending { wsId: string; bestCombo: number; crits: number; agents: number; mapsSeen: string[] }

/**
 * Achievements: counts combo / crit / agent / map events, evaluates the table when progress changes
 * and toasts new unlocks. Counters show up locally at once and reach main in batches (every 10 s, on
 * `flush()` and on unload), never per hit. On the very first run with this feature, what existing
 * heroes already earned is unlocked silently.
 */
export function useAchievements(say: (text: string, ms?: number) => void, activeWs: Workspace | null) {
  const { settings, getSettings, patchWorkspaceLocal, addAchievement, updateSettingsLocal } = useSettings();
  const pending = useRef<Pending | null>(null);

  const flush = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    bar.addStats(p.wsId, { bestCombo: p.bestCombo, crits: p.crits, agents: p.agents, mapsSeen: p.mapsSeen });
  }, []);

  // Applies a change to the active workspace's stats locally and queues it for the next flush.
  const note = useCallback((change: (s: WorkspaceStats) => WorkspaceStats, queue: (p: Pending) => void) => {
    const id = getSettings().activeId;
    const ws = getSettings().workspaces.find((w) => w.id === id);
    if (!id || !ws) return;
    if (pending.current && pending.current.wsId !== id) flush();
    pending.current ||= { wsId: id, bestCombo: 0, crits: 0, agents: 0, mapsSeen: [] };
    queue(pending.current);
    patchWorkspaceLocal(id, { stats: change(ws.stats || EMPTY_STATS) });
  }, [flush, getSettings, patchWorkspaceLocal]);

  const noteCombo = useCallback((n: number) => note(
    (s) => (n > s.bestCombo ? { ...s, bestCombo: n } : s),
    (p) => { p.bestCombo = Math.max(p.bestCombo, n); },
  ), [note]);
  const noteCrit = useCallback(() => note((s) => ({ ...s, crits: s.crits + 1 }), (p) => { p.crits += 1; }), [note]);
  const noteAgent = useCallback(() => note((s) => ({ ...s, agents: s.agents + 1 }), (p) => { p.agents += 1; }), [note]);
  const noteMap = useCallback((map: string) => note(
    (s) => (s.mapsSeen.includes(map) ? s : { ...s, mapsSeen: [...s.mapsSeen, map] }),
    (p) => { if (!p.mapsSeen.includes(map)) p.mapsSeen.push(map); },
  ), [note]);

  useEffect(() => {
    const timer = setInterval(flush, FLUSH_MS);
    window.addEventListener('beforeunload', flush);
    return () => { clearInterval(timer); window.removeEventListener('beforeunload', flush); flush(); };
  }, [flush]);

  // One-time silent backfill for every project, then tell main so it is not repeated.
  const backfilled = settings.migrations?.achievementsBackfillV1 === true;
  const backfilling = useRef(false);
  useEffect(() => {
    if (backfilled || backfilling.current) return;
    backfilling.current = true;
    for (const w of getSettings().workspaces) {
      for (const achId of unlocked(snapshotOf(w), w.achievements)) addAchievement(w.id, achId);
    }
    bar.achievementsBackfilled().then((next) => {
      if (next?.migrations?.achievementsBackfillV1) updateSettingsLocal({ migrations: { ...getSettings().migrations, achievementsBackfillV1: true } });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per launch until main confirms
  }, [backfilled]);

  // Evaluate the active workspace when its progress changes (after the backfill, so old unlocks stay silent).
  const snap = activeWs ? snapshotOf(activeWs) : null;
  const key = activeWs && snap
    ? `${activeWs.id}|${snap.kills}|${snap.level}|${Object.keys(snap.trophies).length}|${Object.values(snap.trophies).reduce((a, t) => Math.max(a, t.count), 0)}|${snap.stats.bestCombo}|${snap.stats.crits}|${snap.stats.agents}|${snap.stats.mapsSeen.length}|${snap.tokens >= 10_000_000}`
    : '';
  useEffect(() => {
    if (!activeWs || !snap || !backfilled) return;
    const fresh = unlocked(snap, activeWs.achievements);
    if (!fresh.length) return;
    for (const achId of fresh) addAchievement(activeWs.id, achId);
    const first = ACHIEVEMENTS.find((a) => a.id === fresh[0]);
    say(`Achievement: ${first?.name}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ''}`, 2200);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the progress key changes
  }, [key, backfilled]);

  return { noteCombo, noteCrit, noteAgent, noteMap, flush };
}
