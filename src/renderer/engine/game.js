// The battle strip. While a Claude session runs, the hero runs right
// non-stop: the world scrolls left, enemies approach, the hero stops to
// fight each one, and after enough kills it moves on to the next map.
// With no session running the hero falls asleep where it stands.

import { BACKGROUNDS } from './heroes.js';
import { createScene } from './scene.js';
import { createSprite } from './sprite.js';
import { ENEMY_TYPES, BOSSES, createMonster } from './enemies.js';
import { prestigeFor } from './prestige.js';
import { createAura } from './aura.js';
import { rollBoss, stageKey } from './boss.js';

const HERO_X = 40;            // hero's fixed screen position
const HERO_REACH = 46;        // how far in front of HERO_X the hero can hit
export const KILLS_PER_MAP = 8;
const SCENE_PX = 2;           // screen pixels per scene-canvas pixel (see scene.js)
const MAX_QUEUED = 5;         // cap on tool-call enemies waiting to spawn

// Kill combo: kills within COMBO_MS of each other stack, each step adds COMBO_STEP damage (up to COMBO_MAX steps).
const COMBO_MS = 6000;
const COMBO_STEP = 0.05;
const COMBO_MAX = 5;
const CRIT_MULT = 2;
const critChance = (spd) => Math.max(0.08, Math.min(0.3, 0.08 + spd / 1000));
const BOSS_ATK_MULT = 2;      // a boss hits the hero twice as hard (the swing is only visual)

/**
 * Creates the battle engine. React owns the elements; the engine only draws
 * into them and appends transient enemy / damage nodes to `stage`.
 *
 * @param {{stage: HTMLElement, heroEl: HTMLElement, sceneCanvas: HTMLCanvasElement,
 *          heroCanvas: HTMLCanvasElement, auraCanvas: HTMLCanvasElement, fadeEl: HTMLElement}} els
 * @param {{onKill?: (kills: number) => void,
 *          onMapChange?: (mapId: string, kills: number) => void,
 *          onBossDefeated?: (bossId: string) => void,
 *          say?: (text: string, ms?: number) => void}} hooks
 */
export function createGame({ stage, heroEl, sceneCanvas, heroCanvas, auraCanvas, fadeEl: fade }, hooks) {
  const state = {
    hero: null,
    mapId: BACKGROUNDS[0].id,
    kills: 0,
    awake: false,
    transitioning: false,
    enemies: [],
    queue: [],
    nextSpawnIn: 0,
    attackCooldown: 0,
    lastTime: performance.now(),
    allies: [],      // minions fighting alongside hero
    projectiles: [], // magic balls, arrows, etc
    combo: 0,
    comboLeft: 0,
    bossRoll: null,  // { key, boss }: this stage's boss roll (not persisted)
  };
  // Damage already dealt to the boss of a map (fraction of its HP left), so a boss
  // interrupted by sleep() comes back wounded instead of at full health.
  const bossHpFrac = {};

  // Kill combo label (top-right of the stage); text changes only when the combo does.
  const comboEl = document.createElement('div');
  comboEl.className = 'combo';
  stage.appendChild(comboEl);
  function setCombo(n, ms = 0) {
    state.combo = n;
    state.comboLeft = ms;
    comboEl.textContent = n >= 2 ? `x${n} COMBO` : '';
  }

  const scene = createScene(sceneCanvas);
  const resizeObserver = new ResizeObserver(() => scene.resize());
  resizeObserver.observe(sceneCanvas);
  const sprite = createSprite(heroCanvas);
  const aura = createAura(auraCanvas);
  let frameId = 0;
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
  };

  const runSpeed = () => 50 + state.hero.stats.spd * 0.4;                       // px/s
  const attackInterval = () => Math.max(320, 900 - state.hero.stats.spd * 4);    // ms
  const mapIndex = () => BACKGROUNDS.findIndex((b) => b.id === state.mapId);

  // Poses: run, fight, attack, victory, sleep (see sprite.js).
  function setPose(pose) {
    heroEl.classList.toggle('sleeping', pose === 'sleep');
    aura.setLying(pose === 'sleep'); // the aura lies down exactly when the sprite does
    if (pose === 'attack') sprite.attack();
    else sprite.setPose(pose);
  }

  // Level prestige: weapon glow (sprite) and the power-up aura behind the hero.
  // The aura bursts only when the *same* hero reaches a new tier, not when you
  // switch to a different hero or the app starts.
  let auraTier = 0;
  let prestigeHero = null;
  function applyPrestige(level) {
    const p = prestigeFor(level);
    // A hero with a signature glow (Darth Vader's red blade) keeps it at every level.
    sprite.setPrestige({ glow: state.hero?.signatureGlow || p.weaponColor });
    aura.setColor(p.auraColor);
    aura.setLightning(p.lightning);
    heroEl.classList.toggle('has-aura', !!p.auraColor);
    if (p.auraTier > auraTier && prestigeHero === state.hero) {
      aura.burst();
      hooks.say?.('Power up!', 2200);
    }
    auraTier = p.auraTier;
    prestigeHero = state.hero;
  }

  function applyMap() {
    scene.setTheme(state.mapId);
    stage.dataset.map = state.mapId;
  }

  // ----- Enemies -----

  // `bossLook` (from BOSSES) spawns the map boss instead of a tool-call monster.
  function spawnEnemy(label, bossLook) {
    const types = ENEMY_TYPES[state.mapId] || ENEMY_TYPES.forest;
    const enemyData = bossLook || types[Math.floor(Math.random() * types.length)];
    const loops = Math.floor(state.kills / KILLS_PER_MAP);
    const baseHp = 250 + mapIndex() * 60 + loops * 40;
    const maxHp = Math.round(baseHp * enemyData.hp);
    if (bossLook) label = bossLook.name;

    const el = document.createElement('div');
    el.className = bossLook ? 'enemy boss' : 'enemy';

    const canvas = document.createElement('canvas');
    const monster = createMonster(canvas, enemyData);

    const hp = document.createElement('div');
    hp.className = 'hp';
    const hpFill = document.createElement('div');
    hpFill.className = 'hp-fill';
    hp.appendChild(hpFill);

    el.appendChild(hp);
    el.appendChild(canvas);

    if (label) {
      const tag = document.createElement('span');
      tag.className = 'enemy-name';
      tag.textContent = label;
      el.appendChild(tag);
    }
    stage.appendChild(el);

    const enemy = {
      el, x: stage.clientWidth + 10, hp: maxHp, maxHp, monster, hpFill, look: enemyData, boss: !!bossLook,
      atk: (6 + mapIndex() * 2 + loops) * (bossLook ? BOSS_ATK_MULT : 1),
    };
    if (bossLook) enemy.hp = Math.max(1, Math.round(maxHp * (bossHpFrac[state.mapId] ?? 1)));
    state.enemies.push(enemy);
    place(enemy);
  }

  function place(enemy) {
    enemy.el.style.transform = `translateX(${enemy.x}px)`;
    enemy.hpFill.style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;
  }

  // ----- Allies (Minions) -----

  function spawnAlly(hero, index, total) {
    const ally = {
      hero,
      index,
      x: HERO_X - 30 - index * 20,
      attackType: hero.cls === 'Mage' ? 'magic' : hero.cls === 'Ranger' ? 'ranged' : 'melee',
      projectileCooldown: 0,
      projectileInterval: hero.cls === 'Mage' ? 800 : 600, // ms between projectiles
      minion: null, // will be set by renderer
    };
    state.allies.push(ally);
    return ally;
  }

  function drawProjectile(ctx, x, y, projectileType) {
    ctx.fillStyle = projectileType === 'magic' ? '#667eea' : '#fbbf24';
    switch (projectileType) {
      case 'magic':
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#764ba2';
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      case 'arrow':
        ctx.fillRect(x - 1, y - 3, 2, 6);
        ctx.beginPath();
        ctx.moveTo(x + 1, y - 3);
        ctx.lineTo(x + 4, y - 1);
        ctx.lineTo(x + 1, y + 1);
        ctx.closePath();
        ctx.fill();
        break;
    }
  }

  function fireProjectile(ally, targetX) {
    // Shots start where the ally's wisp is right now (one rect read per shot).
    let x = ally.x + 12;
    let y = stage.clientHeight - (ally.bottom ?? 34) - 12;
    const wisp = ally.minion?.querySelector('canvas');
    if (wisp) {
      const r = wisp.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      x = r.left - s.left + r.width / 2;
      y = r.top - s.top + r.height / 2;
    }
    const projectile = {
      x,
      y,
      targetX,
      type: ally.attackType === 'magic' ? 'magic' : 'arrow',
      speed: ally.attackType === 'magic' ? 150 : 200,
      damage: Math.round(ally.hero.stats.atk * 0.6),
    };
    state.projectiles.push(projectile);
  }

  function floatText(text, x, cls = '') {
    const el = document.createElement('div');
    el.className = `damage ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.bottom = '48px';
    stage.appendChild(el);
    later(() => el.remove(), 900);
  }

  // Applies the kill combo and a possible critical hit to a base damage.
  function rollDamage(base) {
    const crit = Math.random() < critChance(state.hero.stats.spd);
    const mult = (1 + Math.min(state.combo, COMBO_MAX) * COMBO_STEP) * (crit ? CRIT_MULT : 1);
    return { dmg: Math.round(base * mult), crit };
  }

  function showHit(enemy, dmg, crit, x) {
    enemy.el.classList.add('hit');
    later(() => enemy.el.classList.remove('hit'), 120);
    if (crit) {
      enemy.el.classList.add('crit-hit');
      later(() => enemy.el.classList.remove('crit-hit'), 150);
    }
    floatText(crit ? `${dmg}!` : String(dmg), x, crit ? 'crit' : '');
    if (enemy.boss) bossHpFrac[state.mapId] = enemy.hp / enemy.maxHp;
    place(enemy);
    if (enemy.hp === 0) kill(enemy);
  }

  function hit(enemy) {
    let dmg = Math.round(state.hero.stats.atk * (0.8 + Math.random() * 0.4));

    // Add minion damage
    for (const ally of state.allies) {
      if (ally.attackType === 'melee') {
        dmg += Math.round(ally.hero.stats.atk * 0.4);
      }
    }

    const rolled = rollDamage(dmg);
    enemy.hp = Math.max(0, enemy.hp - rolled.dmg);
    setPose('attack');
    showHit(enemy, rolled.dmg, rolled.crit, enemy.x + 4);
  }

  function hitProjectile(projectile, enemy) {
    const rolled = rollDamage(projectile.damage + Math.floor(Math.random() * 10));
    enemy.hp = Math.max(0, enemy.hp - rolled.dmg);
    showHit(enemy, rolled.dmg, rolled.crit, projectile.x);
  }

  function kill(enemy) {
    state.enemies = state.enemies.filter((e) => e !== enemy);
    enemy.el.classList.add('dying');
    later(() => enemy.el.remove(), 400);
    state.kills += 1;
    setCombo(state.combo + 1, COMBO_MS);
    hooks.onKill?.(state.kills);
    if (enemy.boss) {
      delete bossHpFrac[state.mapId];
      aura.burst();
      hooks.say?.('Boss down!', 900);
      hooks.onBossDefeated?.(enemy.look.id);
    }
    if (state.kills % KILLS_PER_MAP === 0) nextMap(enemy.boss);
  }

  function clearEnemies() {
    for (const e of state.enemies) {
      e.el.classList.add('fleeing');
      later(() => e.el.remove(), 500);
    }
    state.enemies = [];
    state.queue = [];
    state.projectiles = [];
  }

  // The roll is kept per stage key, so sleep/wake and configure() with the same stage never re-roll.
  function bossThisStage() {
    const key = stageKey(state.mapId, state.kills, KILLS_PER_MAP);
    if (!state.bossRoll || state.bossRoll.key !== key) state.bossRoll = { key, boss: rollBoss() };
    return state.bossRoll.boss;
  }

  // ----- Map progression -----

  function nextMap(afterBoss = false) {
    state.transitioning = true;
    state.bossRoll = null;
    if (afterBoss) later(() => hooks.say?.('Stage clear!', 1600), 900);
    else hooks.say?.('Stage clear!', 1600);
    setPose('victory');
    later(() => fade.classList.add('on'), 900);
    later(() => {
      clearEnemies();
      state.mapId = BACKGROUNDS[(mapIndex() + 1) % BACKGROUNDS.length].id;
      applyMap();
      hooks.onMapChange?.(state.mapId, state.kills);
      fade.classList.remove('on');
      const name = BACKGROUNDS[mapIndex()].name;
      hooks.say?.(`→ ${name}`, 1500);
    }, 1500);
    later(() => {
      state.transitioning = false;
      state.nextSpawnIn = 1200;
      setPose(state.awake ? 'run' : 'sleep');
    }, 2000);
  }

  // ----- Main loop -----

  // Monsters animate every frame: the front one fights the hero once it is in
  // reach (its swing hurts the hero), the rest march or wait in line.
  function animateEnemies(dt) {
    const front = state.enemies[0];
    const engaged = !!front && front.x <= HERO_X + HERO_REACH && state.awake && !state.transitioning;
    for (const e of state.enemies) {
      const mode = e === front && engaged ? 'fight' : state.worldMoving ? 'walk' : 'idle';
      if (e.monster.update(dt, mode) && state.hero) {
        sprite.hurt();
        floatText(`-${e.atk}`, HERO_X + 6, 'hurt');
      }
    }
  }

  function tick(now) {
    const dt = Math.min(now - state.lastTime, 100); // ms; clamp after tab sleeps
    state.lastTime = now;
    state.worldMoving = false;
    if (state.awake && !state.transitioning && state.hero) step(dt);
    animateEnemies(dt);
    scene.render(dt);
    sprite.update(dt);
    aura.update(dt);

    // Render projectiles on the scene canvas
    if (state.projectiles.length > 0 && scene.ctx) {
      const ctx = scene.ctx;
      for (const p of state.projectiles) {
        drawProjectile(ctx, p.x / SCENE_PX, p.y / SCENE_PX, p.type); // scene canvas is half resolution
      }
    }

    frameId = requestAnimationFrame(tick);
  }

  function step(dt) {
    state.attackCooldown -= dt;
    if (state.combo > 0) {
      state.comboLeft -= dt;
      if (state.comboLeft <= 0) setCombo(0);
    }

    // Update projectiles
    state.projectiles = state.projectiles.filter(p => {
      p.x += (p.speed * dt) / 1000;
      const front = state.enemies[0];
      if (front && Math.abs(front.x - p.x) < 20) {
        hitProjectile(p, front);
        return false;
      }
      return p.x < stage.clientWidth;
    });

    const front = state.enemies[0];
    const engaged = front && front.x <= HERO_X + HERO_REACH;

    // Minions fire projectiles with cooldown, capped at 12 live projectiles
    for (const ally of state.allies) {
      if (!front || ally.attackType === 'melee') continue;
      ally.projectileCooldown -= dt;
      if (ally.projectileCooldown <= 0 && state.projectiles.length < 12) {
        fireProjectile(ally, front.x);
        ally.projectileCooldown = ally.projectileInterval;
      }
    }

    if (engaged) {
      if (sprite.pose === 'run') setPose('fight');
      if (state.attackCooldown <= 0) {
        hit(front);
        state.attackCooldown = attackInterval();
      }
      return;
    }

    if (sprite.pose === 'attack') return; // finish the swing first
    if (sprite.pose !== 'run') setPose('run');
    state.worldMoving = true;

    // World scrolls left; enemies are part of the world so they scroll too.
    const dx = (runSpeed() * dt / 1000);
    scene.advance(dx);
    for (const e of state.enemies) {
      e.x -= dx;
      place(e);
    }

    state.nextSpawnIn -= dt;
    const last = state.enemies[state.enemies.length - 1];
    const roomToSpawn = !last || last.x < stage.clientWidth - 90;
    if (state.nextSpawnIn <= 0 && roomToSpawn) {
      // Bosses are rare: each stage rolls once (BOSS_CHANCE) when the line (kills so far + monsters
      // alive) first reaches 7. On a hit only the boss spawns, so it is the stage-clearing kill and
      // never buried in a queue. On a miss normal monsters keep spawning and the stage clears at 8 kills.
      const inLine = (state.kills % KILLS_PER_MAP) + state.enemies.length;
      if (inLine >= KILLS_PER_MAP - 1 && bossThisStage()) {
        if (!state.enemies.some((e) => e.boss)) {
          spawnEnemy(null, BOSSES[state.mapId] || BOSSES.forest);
          state.nextSpawnIn = 1500;
        }
      } else {
        spawnEnemy(state.queue.shift());
        state.nextSpawnIn = state.queue.length ? 600 : 1500 + Math.random() * 2500;
      }
    }
  }

  frameId = requestAnimationFrame(tick);

  return {
    /** Stops the loop and removes every node the engine added to the stage. */
    destroy() {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      timers.forEach(clearTimeout);
      timers.clear();
      for (const e of state.enemies) e.el.remove();
      state.enemies = [];
      comboEl.remove();
    },

    configure({ hero, mapId, kills, allies, level }) {
      if (hero !== undefined) {
        state.hero = hero;
        sprite.setHero(hero);
        heroEl.classList.toggle('hidden', !hero);
      }
      if (mapId && mapId !== state.mapId) {
        state.mapId = mapId;
        clearEnemies();
        applyMap();
      }
      if (level !== undefined) applyPrestige(level);
      if (kills != null) state.kills = kills;
      if (allies !== undefined) {
        state.allies = allies.map((allyHero, i) => spawnAlly(allyHero, i, allies.length));
      }
    },

    wake() {
      if (state.awake || !state.hero) return;
      state.awake = true;
      aura.setActive(true);
      state.lastTime = performance.now();
      state.nextSpawnIn = 800;
      hooks.say?.('!', 800);
      setPose('run');
    },

    sleep() {
      if (!state.awake) return;
      state.awake = false;
      aura.setActive(false);
      clearEnemies();
      setCombo(0);
      setPose('victory');
      later(() => { if (!state.awake) setPose('sleep'); }, 1600);
    },

    // A tool call sends a named enemy down the lane.
    toolEnemy(name) {
      if (!state.awake) return;
      if (state.queue.length < MAX_QUEUED) state.queue.push(name);
      state.nextSpawnIn = Math.min(state.nextSpawnIn, 300);
    },

    hurt() {
      sprite.hurt();
    },

    setAllies(allyHeroes) {
      state.allies = allyHeroes.map((h, i) => spawnAlly(h, i, allyHeroes.length));
    },

    /** Links each ally to the DOM node React rendered for it (by index) and reads its anchor (hero's body). */
    setMinionElements(minionElements) {
      state.allies.forEach((ally, i) => {
        ally.minion = minionElements[i] ?? null;
        if (ally.minion) {
          ally.x = parseFloat(ally.minion.style.left) || 0;
          ally.bottom = parseFloat(ally.minion.style.bottom) || 34;
        }
      });
    },

    clearAllies() {
      state.allies = [];
      state.projectiles = [];
    },

    get mapId() { return state.mapId; },
    get kills() { return state.kills; },
    get clearing() { return state.transitioning; },
    killsPerMap: KILLS_PER_MAP,
    start() { applyMap(); setPose('sleep'); },
  };
}
