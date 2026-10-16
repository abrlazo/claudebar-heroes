import { useCallback, useEffect, useRef } from 'react';
import { bar } from '../lib/bridge';
import { useSettings } from '../context/SettingsContext';
import { ACHIEVEMENTS, EMPTY_STATS, unlocked } from '../lib/achievements';
import type { AchievementSnapshot } from '../lib/achievements';
import { levelFor, totalTokens, xpFor } from '../lib/leveling';
import type { Workspace, WorkspaceStats } from '../types';

const FLUSH_MS = 10_000;
const CRIT_LOCAL_MS = 1000; // crits after the first show up locally in one batch per second

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
  const localCrits = useRef<{ wsId: string; n: number } | null>(null);
  const critTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shows the buffered crits in the local stats (read fresh at that moment, so nothing else is overwritten).
  const applyLocalCrits = useCallback(() => {
    if (critTimer.current) { clearTimeout(critTimer.current); critTimer.current = null; }
    const buffered = localCrits.current;
    localCrits.current = null;
    if (!buffered) return;
    const ws = getSettings().workspaces.find((w) => w.id === buffered.wsId);
    if (!ws) return;
    const stats = ws.stats || EMPTY_STATS;
    patchWorkspaceLocal(ws.id, { stats: { ...stats, crits: stats.crits + buffered.n } });
  }, [getSettings, patchWorkspaceLocal]);

  const flush = useCallback(() => {
    applyLocalCrits();
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    bar.addStats(p.wsId, { bestCombo: p.bestCombo, crits: p.crits, agents: p.agents, mapsSeen: p.mapsSeen });
  }, [applyLocalCrits]);

  // Applies a change to the active workspace's stats locally and queues it for the next flush.
  const note = useCallback((change: (s: WorkspaceStats) => WorkspaceStats, queue: (p: Pending) => void) => {
    const id = getSettings().activeId;
    const ws = getSettings().workspaces.find((w) => w.id === id);
    if (!id || !ws) return;
    if (pending.current && pending.current.wsId !== id) flush();
    pending.current ||= { wsId: id, bestCombo: 0, crits: 0, agents: 0, mapsSeen: [] };
    const before = ws.stats || EMPTY_STATS;
    const after = change(before);
    if (after === before) return; // nothing new (e.g. a combo step that is not a record): no queue, no render
    queue(pending.current);
    patchWorkspaceLocal(id, { stats: after });
  }, [flush, getSettings, patchWorkspaceLocal]);

  const noteCombo = useCallback((n: number) => note(
    (s) => (n > s.bestCombo ? { ...s, bestCombo: n } : s),
    (p) => { p.bestCombo = Math.max(p.bestCombo, n); },
  ), [note]);
  const noteCrit = useCallback(() => {
    const id = getSettings().activeId;
    const ws = getSettings().workspaces.find((w) => w.id === id);
    if (!id || !ws) return;
    // The first crit shows at once (it unlocks Lucky Strike); later ones are queued for main now but shown in batches.
    if ((ws.stats?.crits ?? 0) === 0 && !localCrits.current) {
      note((s) => ({ ...s, crits: s.crits + 1 }), (p) => { p.crits += 1; });
      return;
    }
    if (pending.current && pending.current.wsId !== id) flush();
    pending.current ||= { wsId: id, bestCombo: 0, crits: 0, agents: 0, mapsSeen: [] };
    pending.current.crits += 1;
    if (localCrits.current && localCrits.current.wsId !== id) applyLocalCrits();
    localCrits.current = { wsId: id, n: (localCrits.current?.n ?? 0) + 1 };
    if (!critTimer.current) critTimer.current = setTimeout(applyLocalCrits, CRIT_LOCAL_MS);
  }, [applyLocalCrits, flush, getSettings, note]);
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

  // One-time bubble after main re-synced the boss badges (flag set only if something was removed). The wait keeps it
  // clear of an "Achievement:" toast; main clears the flag after it was shown, so it is not repeated on the next launch.
  const syncNotice = settings.migrations?.achievementSyncNotice === true;
  const noticeShown = useRef(false);
  useEffect(() => {
    if (!syncNotice || noticeShown.current) return;
    const t = setTimeout(() => {
      noticeShown.current = true;
      say('Boss trophies and boss badges were reset: bosses are much rarer now', 7000);
      bar.achievementSyncNoticeSeen().then((next) => {
        if (next && !next.migrations?.achievementSyncNotice) {
          const { achievementSyncNotice, ...rest } = getSettings().migrations || {};
          updateSettingsLocal({ migrations: rest });
        }
      });
    }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the flag changes
  }, [syncNotice]);

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
