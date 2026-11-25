import { ATK } from '../content/enemies.ts';
import { HERO_ABILITIES as AB, HERO_BURN_DPS, HEROES, HERO_RECOVERY, HERO_SPEED, type HeroAbility, type HeroKey } from '../content/heroes.ts';
import { hurt, type Enemy } from './enemies.ts';
import { lerpAngle, type Vec2 } from './math.ts';
import { gx2w, gz2w, H, smoothPath, TILE, W, type Sample } from './map.ts';
import { makeSoldier, respawnSoldier, type Soldier, type SoldierHost } from './soldiers.ts';
import { groundY, type Game } from './state.ts';
import type { Tower } from './towers.ts';

interface Area extends Vec2 { until: number }
interface Gate extends Area { path: number; d: number; heading: number; attacks: Map<number, number> }

export interface Hero {
  key: HeroKey;
  unit: Soldier;
  spawn: Vec2;
  route: Vec2[];
  blocked: Enemy[];
  recharge: Partial<Record<HeroAbility, number>>;
  respawnAt: number;
  hits: number;
  shieldUntil: number;
  banner: Area | null;
  gate: Gate | null;
  kindle: (Area & { next: number }) | null;
  ward: { tower: Tower; until: number; pushed: Set<number> } | null;
  coalUsed: boolean;
}

const RALLY = AB['rally-the-line'], SHIELD = AB['shield-wall'], GATE = AB['the-gate-holds'];
const KINDLE = AB.kindle, WARD = AB['ashen-ward'], COAL = AB['undying-coal'];
const dist2 = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const within = (a: Vec2, b: Vec2, r: number) => dist2(a, b) <= r * r;

export function heroRoadSpot(g: Game, at: Vec2, reach: number): Sample | null {
  let best: Sample | null = null, distance = reach * reach;
  for (const p of g.map.samples) {
    const d = dist2(at, p);
    if (d < distance) { best = p; distance = d; }
  }
  return best;
}

export function addHero(g: Game, key: HeroKey) {
  const path = g.map.paths[0], spawn = smoothPath(path, path.len - 3);
  const def = HEROES[key];
  const host: SoldierHost = { ...spawn, rally: spawn, soldiers: [], resp: [], bs: {
    n: 1, unit: key, hp: def.hp, dmg: def.dmg, rate: def.rate, armor: def.armor, mr: def.mr, resp: HERO_RECOVERY, rad: def.reach,
  } };
  const unit = makeSoldier(g, host, 0, true, def.name);
  g.hero = { key, unit, spawn, route: [], blocked: [], recharge: {}, respawnAt: 0, hits: 0, shieldUntil: 0, banner: null, gate: null, kindle: null, ward: null, coalUsed: false };
}

const tileAt = (p: Vec2) => {
  const x = Math.floor(p.x + W / 2), z = Math.floor(p.z + H / 2);
  return x >= 0 && x < W && z >= 0 && z < H ? z * W + x : -1;
};

/** Walk each tile a straight segment crosses. At a corner, both side tiles must be clear. */
function clearSegment(from: Vec2, to: Vec2, walkable: (tile: number) => boolean) {
  let tile = tileAt(from);
  const end = tileAt(to);
  const dx = to.x - from.x, dz = to.z - from.z;
  const sx = Math.sign(dx), sz = Math.sign(dz), row = sz * W;
  const tx = from.x + W / 2, tz = from.z + H / 2;
  const stepX = 1 / Math.abs(dx), stepZ = 1 / Math.abs(dz);
  let nextX = sx ? (sx > 0 ? 1 - (tx % 1) : tx % 1) * stepX : Infinity;
  let nextZ = sz ? (sz > 0 ? 1 - (tz % 1) : tz % 1) * stepZ : Infinity;
  while (tile !== end) {
    // An endpoint exactly on a boundary can already be in the final column or row.
    const crossX = tile % W !== end % W ? nextX : Infinity;
    const crossZ = Math.floor(tile / W) !== Math.floor(end / W) ? nextZ : Infinity;
    if (Math.abs(crossX - crossZ) < 1e-9) {
      if (!walkable(tile + sx) || !walkable(tile + row)) return false;
      tile += sx + row; nextX += stepX; nextZ += stepZ;
    } else if (crossX < crossZ) {
      tile += sx; nextX += stepX;
    } else {
      tile += row; nextZ += stepZ;
    }
    if (!walkable(tile)) return false;
  }
  return true;
}

/** Find a walkable route once, when the player gives a movement order. */
function routeTo(g: Game, from: Vec2, to: Vec2): Vec2[] | null {
  const start = tileAt(from), end = tileAt(to);
  const walkable = (i: number) => i >= 0 && i < W * H && (g.map.tiles[i] === TILE.grass || g.map.tiles[i] === TILE.road || g.map.tiles[i] === TILE.bridge);
  if (start < 0 || !walkable(end)) return null;
  if (clearSegment(from, to, walkable)) return [to];
  const prev = new Int16Array(W * H).fill(-1), queue = [start];
  prev[start] = start;
  for (let i = 0; i < queue.length && prev[end] < 0; i++) {
    const n = queue[i], x = n % W;
    for (const j of [x > 0 ? n - 1 : -1, x + 1 < W ? n + 1 : -1, n - W, n + W]) {
      if (walkable(j) && prev[j] < 0) { prev[j] = n; queue.push(j); }
    }
  }
  if (prev[end] < 0) return null;
  const route = [to];
  for (let n = end; ; n = prev[n]) {
    route.push({ x: gx2w(n % W), z: gz2w(Math.floor(n / W)) });
    if (n === start) break;
  }
  // Work backwards from the goal to skip as many tile centers as visibility allows.
  const path: Vec2[] = [];
  let at = from;
  while (route.length) {
    const i = route.findIndex(p => clearSegment(at, p, walkable));
    if (i < 0) return null;
    at = route[i];
    path.push(at);
    route.length = i;
  }
  return path;
}

function release(h: Hero) {
  for (const e of h.blocked) if (e.blocker === h.unit) e.blocker = null;
  h.blocked.length = 0;
}

export function moveHero(g: Game, { x, z }: Vec2) {
  const h = g.hero;
  if (!h?.unit.alive || h.shieldUntil > g.time) return false;
  const route = routeTo(g, h.unit, { x, z });
  if (!route) return false;
  h.route = route;
  release(h);
  h.unit.target = h.unit.atk = null;
  return true;
}

export function castHero(g: Game, k: HeroAbility, at?: Vec2, towerId?: number) {
  const h = g.hero, a = AB[k];
  if (!h?.unit.alive || !a || a.hero !== h.key || (h.recharge[k] ?? 0) > g.time) return false;
  let point: Vec2 = h.unit;
  let eruptions: Enemy[] | undefined;
  switch (k) {
    case 'rally-the-line':
      h.banner = { x: point.x, z: point.z, until: g.time + RALLY.duration };
      for (const t of g.towers) {
        if (!t.bs) continue;
        t.soldiers.forEach((s, i) => {
          if (!s.alive && within(s, point, RALLY.radius)) respawnSoldier(g, t, i, true);
        });
      }
      break;
    case 'shield-wall':
      h.shieldUntil = g.time + SHIELD.duration;
      h.route = [];
      break;
    case 'the-gate-holds': {
      const p = heroRoadSpot(g, h.unit, 1.5);
      if (h.hits < GATE.hits || h.gate || !p) return false;
      const dir = { x: 0, z: 0 };
      smoothPath(g.map.paths[p.path], p.d, undefined, dir);
      h.gate = { ...p, until: g.time + GATE.duration, heading: Math.atan2(dir.x, dir.z), attacks: new Map() };
      h.hits = 0;
      point = p;
      break;
    }
    case 'kindle': {
      const p = at && heroRoadSpot(g, at, 2);
      if (!p) return false;
      h.kindle = { x: p.x, z: p.z, until: g.time + KINDLE.duration, next: g.time };
      point = p;
      break;
    }
    case 'ashen-ward': {
      const tower = g.towers.find(t => t.id === towerId);
      if (!tower) return false;
      h.ward = { tower, until: g.time + WARD.duration, pushed: new Set() };
      point = tower;
      break;
    }
    case 'undying-coal':
      if (h.coalUsed) return false;
      eruptions = g.enemies.filter(e => e.alive && isBurning(g, e));
      if (!eruptions.length) return false;
      h.coalUsed = true;
      break;
  }
  if ('cd' in a) h.recharge[k] = g.time + a.cd;
  g.events.push({ t: 'heroCast', k, at: { x: point.x, z: point.z }, eruptions });
  if (eruptions) for (const e of eruptions) hurt(g, e, COAL.dmg, 'magic');
  return true;
}

export const isBurning = (g: Game, e: Enemy) => e.burn > 0 || (e.wardBurnUntil ?? 0) > g.time || !!e.heroBurns?.some(until => until > g.time);
const ignite = (g: Game, e: Enemy, duration: number) => (e.heroBurns ??= []).push(g.time + duration);

export function burnFromWard(g: Game, e: Enemy, tower?: Tower | null) {
  const w = g.hero?.ward;
  if (w && tower === w.tower && w.until > g.time) e.wardBurnUntil = g.time + WARD.burn;
}

export function heroBurnDamage(g: Game, e: Enemy) {
  if (e.heroBurns) e.heroBurns = e.heroBurns.filter(until => until > g.time);
  return ((e.heroBurns?.length ?? 0) + Number((e.wardBurnUntil ?? 0) > g.time)) * HERO_BURN_DPS;
}

export const lanternLight = (g: Game, e: Enemy) =>
  g.hero?.key === 'corwin' && g.hero.unit.alive && within(g.hero.unit, e, HEROES.corwin.aura);

export const coalReward = (g: Game, e: Enemy) => g.hero?.coalUsed && isBurning(g, e) ? COAL.gold : 0;

export function protectSoldier(g: Game, s: Soldier, damage: number) {
  const h = g.hero;
  if (h?.key !== 'aldric') return damage;
  if (s === h.unit) {
    h.hits = Math.min(GATE.hits, h.hits + 1);
    if (h.shieldUntil > g.time) damage *= 1 - SHIELD.protection;
  } else if (h.unit.alive && within(h.unit, s, HEROES.aldric.aura)) {
    damage *= 1 - HEROES.aldric.protection;
  }
  if (h.gate && h.gate.until > g.time && within(h.gate, s, GATE.radius)) damage = Math.min(damage, Math.max(0, s.hp - 1));
  return damage;
}

export function heroFell(g: Game, s: Soldier) {
  const h = g.hero;
  if (h?.unit !== s) return;
  release(h);
  h.route = [];
  h.shieldUntil = 0;
  h.respawnAt = g.time + HERO_RECOVERY;
}

export const bannerHaste = (g: Game, s: Soldier) => {
  const banner = g.hero?.banner;
  return banner && banner.until > g.time && within(banner, s, RALLY.radius) ? 1 + RALLY.haste : 1;
};

export const heroBlocks = (g: Game, s: Soldier, e: Enemy) => g.hero?.unit === s && g.hero.blocked.includes(e);

export function riderBreaksBlock(g: Game, s: Soldier, e: Enemy) {
  const h = g.hero;
  if (h?.unit !== s) return true;
  if (h.shieldUntil > g.time) return false;
  h.blocked = h.blocked.filter(o => o !== e);
  return true;
}

/** Stop advancing enemies at the spectral gate and reflect their attacks using their own attack rates. */
export function holdAtGate(g: Game, e: Enemy, step: number, disabled: boolean) {
  const gate = g.hero?.gate;
  if (!gate || gate.until <= g.time || e.def.air || e.path !== gate.path || e.d > gate.d || e.d + step < gate.d) return false;
  e.d = gate.d;
  const attack = e.type in ATK ? ATK[e.type as keyof typeof ATK] : undefined;
  if (!disabled && attack && (gate.attacks.get(e.id) ?? 0) <= g.time) {
    gate.attacks.set(e.id, g.time + Number(attack[1]));
    hurt(g, e, Number(attack[0]) * g.dmgMul * GATE.reflect, 'true');
  }
  return true;
}

export function updateHero(g: Game, dt: number) {
  const h = g.hero;
  if (!h) return;
  if (h.gate && h.gate.until <= g.time) h.gate = null;
  if (h.banner && h.banner.until <= g.time) h.banner = null;
  if (h.kindle) {
    const p = h.kindle;
    if (p.until <= g.time) h.kindle = null;
    else if (p.next <= g.time) {
      p.next += KINDLE.interval;
      for (const e of g.enemies) if (e.alive && !e.def.air && within(e, p, KINDLE.radius)) ignite(g, e, KINDLE.burn);
    }
  }
  if (h.ward) {
    const w = h.ward;
    if (w.until <= g.time || !g.towers.includes(w.tower)) h.ward = null;
    else for (const e of g.enemies) {
      if (!e.alive || e.def.air || w.pushed.has(e.id) || !within(e, w.tower, WARD.radius)) continue;
      w.pushed.add(e.id);
      e.d = Math.max(0, e.d - WARD.push);
      e.blocker = null;
      g.events.push({ t: 'heroPush', e });
    }
  }
  let s = h.unit;
  if (!s.alive) {
    if (h.respawnAt > g.time) return;
    h.unit = s = makeSoldier(g, s.host, 0, true, HEROES[h.key].name);
  }
  const def = HEROES[h.key];
  const walking = h.route.length > 0;
  let step = HERO_SPEED * dt;
  while (step > 0 && h.route.length) {
    const next = h.route[0], dx = next.x - s.x, dz = next.z - s.z, d = Math.hypot(dx, dz);
    if (d) s.want = Math.atan2(dx, dz);
    if (d <= step) {
      s.x = next.x; s.z = next.z;
      h.route.shift(); step -= d;
    } else {
      s.x += dx * step / d; s.z += dz * step / d;
      break;
    }
  }
  if (walking) s.y = groundY(g, s.x, s.z);
  const shield = h.shieldUntil > g.time;
  const inReach = (e: Enemy) => e.alive && (h.key === 'corwin' || !e.def.air) && within(e, s, def.reach);
  if (h.key === 'aldric' && !walking) {
    h.blocked = h.blocked.filter(e => e.alive && e.blocker === s);
    for (const e of g.enemies) {
      if (!shield && h.blocked.length >= def.blocks) break;
      if (!inReach(e) || e.blocker === s || (e.blocker?.alive && !shield)) continue;
      e.blocker = s;
      h.blocked.push(e);
    }
    if (!shield && h.blocked.length > def.blocks) {
      for (const e of h.blocked.splice(def.blocks)) if (e.blocker === s) e.blocker = null;
    }
  }
  s.target = walking ? null : h.blocked[0] ?? g.enemies.find(inReach) ?? null;
  s.fighting = !!s.target;
  s.cd = Math.max(0, s.cd - dt);
  if (s.target) {
    const e = s.target;
    s.want = Math.atan2(e.x - s.x, e.z - s.z);
    if (s.cd <= 0 && !s.atk) {
      s.cd = def.rate;
      s.atk = { t: 0, hit: false, e, bash: false };
    }
  }
  if (s.want != null) s.heading = lerpAngle(s.heading, s.want, 1 - Math.exp(-10 * dt));
  if (s.atk) {
    s.atk.t += dt;
    if (!s.atk.hit && s.atk.t >= 0.15) {
      s.atk.hit = true;
      const e = s.atk.e;
      if (inReach(e)) {
        g.events.push({ t: 'heroHit', s, e });
        hurt(g, e, def.dmg, h.key === 'corwin' ? 'magic' : 'phys');
      }
    }
    if (s.atk.t >= 0.36) s.atk = null;
  }
}
