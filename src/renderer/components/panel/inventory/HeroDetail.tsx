import { heroFor } from '../../../lib/heroCache';
import { prestigeFor, LIGHTNING_START } from '../../../engine/prestige.js';
import { contextPct, levelFor, totalTokens, vigorPct, xpFor, xpForLevel } from '../../../lib/leveling';
import { formatTokens } from '../../../lib/format';
import type { WorkspaceActions } from '../../../hooks/useWorkspaceActions';
import type { Workspace } from '../../../types';

const STATS = [
  { key: 'hp', label: 'HP', icon: '❤', color: '#ef4444' },
  { key: 'atk', label: 'ATK', icon: '⚔', color: '#f59e0b' },
  { key: 'def', label: 'DEF', icon: '🛡', color: '#3b82f6' },
  { key: 'spd', label: 'SPD', icon: '⚡', color: '#22c55e' },
] as const;

// Below this vigor the bars warn in red.
const LOW_VIGOR = 25;

/** Stats, XP and context usage of the selected hero, plus reroll / remove. */
export function HeroDetail({ ws, busy, actions }: { ws: Workspace | null; busy: boolean; actions: WorkspaceActions }) {
  if (!ws) {
    return (
      <div id="hero-detail">
        <p className="muted">
          Import a project and a random hero will be summoned to guard it. It levels up as Claude works in that project.
        </p>
      </div>
    );
  }
  const hero = heroFor(ws);
  const u = ws.usage;
  const xp = xpFor(ws);
  const lvl = levelFor(xp);
  // Stats are full on a fresh context, drain as it fills, and refill when it resets.
  const vigor = vigorPct(ws);
  const prestige = prestigeFor(lvl);
  return (
    <div id="hero-detail">
      <p className="hero-title">{`${hero.name} the ${hero.cls}`}</p>
      <p className="muted">{ws.path}</p>
      <div className="stat-grid">
        {STATS.map(({ key, label, icon, color }) => {
          const base = hero.stats[key];
          const current = Math.round((base * vigor) / 100);
          return (
            <div className="stat" key={key} title={`${label} ${current} / ${base} (${vigor}%)`}>
              <span className="stat-label">{`${icon} ${label}`}</span>
              <span className="stat-value" style={{ color }}>
                {current}
                <span className="stat-base">{` / ${base}`}</span>
              </span>
              <div className="stat-bar">
                <div className="stat-fill" style={{ width: `${vigor}%`, background: vigor < LOW_VIGOR ? '#ef4444' : color }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className={`muted vigor${vigor < LOW_VIGOR ? ' low' : ''}`}>
        {`Vigor ${vigor}% · stats drain as the context fills and return to 100% when it resets`}
      </p>
      <p className="muted">{`Lv ${lvl} · ${xp} XP (next level at ${xpForLevel(lvl + 1)})`}</p>
      <p className="muted prestige">
        {prestige.weaponColor
          ? <><span className="swatch" style={{ background: prestige.weaponColor }} />{`Weapon glow ${prestige.weaponTier} · next colour at Lv ${prestige.nextWeaponLevel}`}</>
          : `Weapon glow unlocks at Lv ${prestige.nextWeaponLevel}`}
      </p>
      <p className="muted prestige">
        {prestige.auraColor
          ? <><span className="swatch" style={{ background: prestige.auraColor }} />{`Aura ${prestige.auraTier} · next colour at Lv ${prestige.nextAuraLevel} · ${prestige.lightning ? '⚡ lightning' : `lightning at Lv ${LIGHTNING_START}`}`}</>
          : `Aura unlocks at Lv ${prestige.nextAuraLevel}`}
      </p>
      <p className="muted">
        {`Context used: ${formatTokens(totalTokens(u))} tokens (in ${formatTokens(u.input + u.cacheCreate)} · out ${formatTokens(u.output)} · cached ${formatTokens(u.cacheRead)})`}
      </p>
      <p className="muted">{`Last context: ${formatTokens(ws.lastContext)} / ${formatTokens(ws.contextWindow)} (${contextPct(ws)}%)`}</p>
      <div className="row">
        <button disabled={busy} onClick={() => actions.rerollHero(ws)}>🎲 Summon a different hero</button>
        <button className="danger" onClick={() => actions.removeProject(ws)}>Remove project</button>
      </div>
    </div>
  );
}
