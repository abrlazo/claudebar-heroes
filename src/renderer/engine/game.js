// The battle strip. While a Claude session runs, the hero runs right
// non-stop: the world scrolls left, enemies approach, the hero stops to
// fight each one, and after enough kills it moves on to the next map.
// With no session running the hero falls asleep where it stands.

import { BACKGROUNDS } from './heroes.js';
import { createScene } from './scene.js';
import { createSprite } from './sprite.js';
import { ENEMY_TYPES, createMonster } from './enemies.js';
import { prestigeFor } from './prestige.js';
import { createAura } from './aura.js';

const HERO_X = 40;            // hero's fixed screen position
const HERO_REACH = 46;        // how far in front of HERO_X the hero can hit
export const KILLS_PER_MAP = 8;
const SCENE_PX = 2;           // screen pixels per scene-canvas pixel (see scene.js)
const MAX_QUEUED = 5;         // cap on tool-call enemies waiting to spawn

/**
 * Creates the battle engine. React owns the elements; the engine only draws
 * into them and appends transient enemy / damage nodes to `stage`.
 *
 * @param {{stage: HTMLElement, heroEl: HTMLElement, sceneCanvas: HTMLCanvasElement,
 *          heroCanvas: HTMLCanvasElement, auraCanvas: HTMLCanvasElement, fadeEl: HTMLElement}} els
 * @param {{onKill?: (kills: number) => void,
 *          onMapChange?: (mapId: string, kills: number) => void,
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
  };

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

  function spawnEnemy(label) {
    const types = ENEMY_TYPES[state.mapId] || ENEMY_TYPES.forest;
    const enemyData = types[Math.floor(Math.random() * types.length)];
    const loops = Math.floor(state.kills / KILLS_PER_MAP);
    const baseHp = 250 + mapIndex() * 60 + loops * 40;
    const maxHp = Math.round(baseHp * enemyData.hp);

    const el = document.createElement('div');
    el.className = 'enemy';

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

    const enemy = { el, x: stage.clientWidth + 10, hp: maxHp, maxHp, monster, atk: 6 + mapIndex() * 2 + loops, hpFill };
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
    // Shots start at the ally's orb (its formation slot, set by the renderer).
    const bottom = ally.bottom ?? 40;
    const projectile = {
      x: ally.x + 16,
      y: stage.clientHeight - bottom - 16,
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

  function hit(enemy) {
    let dmg = Math.round(state.hero.stats.atk * (0.8 + Math.random() * 0.4));

    // Add minion damage
    for (const ally of state.allies) {
      if (ally.attackType === 'melee') {
        dmg += Math.round(ally.hero.stats.atk * 0.4);
      }
    }

    enemy.hp = Math.max(0, enemy.hp - dmg);
    setPose('attack');
    enemy.el.classList.add('hit');
    later(() => enemy.el.classList.remove('hit'), 120);
    floatText(String(dmg), enemy.x + 4);
    place(enemy);
    if (enemy.hp === 0) kill(enemy);
  }

  function hitProjectile(projectile, enemy) {
    const dmg = projectile.damage + Math.floor(Math.random() * 10);
    enemy.hp = Math.max(0, enemy.hp - dmg);
    enemy.el.classList.add('hit');
    later(() => enemy.el.classList.remove('hit'), 120);
    floatText(String(dmg), projectile.x);
    place(enemy);
    if (enemy.hp === 0) kill(enemy);
  }

  function kill(enemy) {
    state.enemies = state.enemies.filter((e) => e !== enemy);
    enemy.el.classList.add('dying');
    later(() => enemy.el.remove(), 400);
    state.kills += 1;
    hooks.onKill?.(state.kills);
    if (state.kills % KILLS_PER_MAP === 0) nextMap();
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

  // ----- Map progression -----

  function nextMap() {
    state.transitioning = true;
    hooks.say?.('Stage clear!', 1600);
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
      spawnEnemy(state.queue.shift());
      state.nextSpawnIn = state.queue.length ? 600 : 1500 + Math.random() * 2500;
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

    /** Links each ally to the DOM node React rendered for it (by index) and reads its formation slot. */
    setMinionElements(minionElements) {
      state.allies.forEach((ally, i) => {
        ally.minion = minionElements[i] ?? null;
        if (ally.minion) {
          ally.x = parseFloat(ally.minion.style.left) || 0;
          ally.bottom = parseFloat(ally.minion.style.bottom) || 40;
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
