import { ACHIEVEMENTS } from '../../../lib/achievements';
import type { AchievementTier } from '../../../lib/achievements';
import type { Workspace } from '../../../types';

const TIERS: { tier: AchievementTier; label: string }[] = [
  { tier: 'short', label: 'Short term' },
  { tier: 'medium', label: 'Medium term' },
  { tier: 'long', label: 'Long term' },
];

/** The workspace's achievements in three tiers: locked ones are dim, with their goal shown as a hint. A plain list. */
export function Achievements({ ws }: { ws: Workspace | null }) {
  const earned = ws?.achievements || {};
  const has = (id: string) => Object.prototype.hasOwnProperty.call(earned, id);
  const total = ACHIEVEMENTS.filter((a) => has(a.id)).length;
  return (
    <div id="achievements">
      <p className="achievement-count">{`${total}/${ACHIEVEMENTS.length} earned`}</p>
      {TIERS.map(({ tier, label }) => {
        const list = ACHIEVEMENTS.filter((a) => a.tier === tier);
        return (
          <section key={tier} className="achievement-tier">
            <h4>{`${label} ${list.filter((a) => has(a.id)).length}/${list.length}`}</h4>
            <div className="achievement-grid">
              {list.map((a) => (
                <div key={a.id} className={`achievement${has(a.id) ? '' : ' locked'}`} title={a.desc}>
                  <span className="achievement-name">{a.name}</span>
                  <span className="achievement-desc">{a.desc}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
