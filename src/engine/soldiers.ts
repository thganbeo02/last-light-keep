// Barracks soldiers: stats, spawning and respawning, targeting, blocking, the fan-out around an enemy, sword strikes,
// Paladins' holy strikes and Rangers' arrows (with Overwatch). Ported from main.js (barrStat, class Soldier,
// refreshSoldiers, barracksTick, defaultRally, rallyPick). Militia Call (spells step) uses the same soldiers.
import { BARR, SOL_FIRST, SOL_LAST, SOL_REGEN } from '../content/barracks.ts';
import { ATK } from '../content/enemies.ts';
import { hurt, type Enemy } from './enemies.ts';
import { bannerHaste, heroBlocks, heroFell, protectSoldier } from './heroes.ts';
import { lerpAngle } from './math.ts';
import { W, H } from './map.ts';
import { int, next, range } from './rng.ts';
import { fireArrow } from './projectiles.ts';
import { groundY, has, type Game } from './state.ts';
import type { SpecKey, Stat, Tower } from './towers.ts';

export type BarrKey = 1 | 2 | 3 | SpecKey;
export interface BarrStat {
  n: number; unit: string; hp: number; dmg: number; rate: number; armor: number; mr: number; resp: number; rad: number;
  heal?: number; holy?: number; holyN?: number; ranged?: number; regen?: number;
}
export interface Rally { x: number; z: number; over?: boolean }
/** What soldiers belong to: a Barracks tower, or a Militia Call (which has no tower and doesn't respawn). */
export interface SoldierHost { x: number; z: number; bs: BarrStat; rally: Rally; soldiers: Soldier[]; resp: (number | undefined)[] }

export interface Soldier {
  id: number; host: SoldierHost; i: number; type: string; name: string; st: BarrStat;
  hp: number; maxHp: number; alive: boolean; x: number; y: number; z: number; heading: number; want: number | null;
  target: Enemy | null; extra: Enemy | null; engaged: Enemy | null; scan: number;
  cd: number; calm: number; inv: number; saved: boolean; hits: number; swings: number;
  atk: { t: number; hit: boolean; e: Enemy; bash: boolean } | null; fighting: boolean; aiming: boolean;
  hawkT: number; ttl: number | null; cheer: number;
}

/** Soldier stats for a Barracks level (1–3) or specialisation (a Paladins, b Rangers) at a rank, with War Council picks. */
export function barrStat(g: Pick<Game, 'skills'>, k: BarrKey, rank = 1): BarrStat {
  const b: BarrStat = { ...(BARR as Record<BarrKey, BarrStat>)[k] }, r = rank - 1;
  b.hp = Math.round(b.hp * Math.pow(1.2, r)); b.dmg = +(b.dmg * Math.pow(1.25, r)).toFixed(1); b.rad = +(b.rad + 0.2 * r).toFixed(1);
  if (b.holy) b.holy = Math.round(b.holy * Math.pow(1.25, r));
  if (k === 'b') b.rate = [0.9, 0.8, 0.7][r] ?? 0.7;
  const h = (id: string) => has(g, id);
  if (h('barracks.root')) b.hp = Math.round(b.hp * 1.1);
  if (h('barracks.pala') && k === 'a') { b.hp = Math.round(b.hp * 1.1); b.mr = +(b.mr + 0.1).toFixed(2); }
  if (h('barracks.gamb')) b.armor = +(b.armor + 0.1).toFixed(2);
  if (h('barracks.drill')) b.dmg = +(b.dmg * 1.1).toFixed(1);
  if (h('barracks.medic') && !b.heal) b.regen = 0.03;
  if (h('barracks.horn')) b.resp = +(b.resp * 0.8).toFixed(1);
  if (h('barracks.fourth')) b.n += 1;
  if (h('barracks.rang') && b.ranged) b.ranged += 0.5;
  if (h('barracks.right') && b.holy) b.holyN = 3;
  return b;
}
/** A Barracks shown as tower stats: its soldiers' damage and rate, and its radius as range. */
export const barrAsStat = (b: BarrStat): Stat & { hp: number } => ({ dmg: b.dmg, range: b.rad, rate: b.rate, dps: b.n * b.dmg / b.rate, hp: b.hp });

/** Within a War Drum's radius (optionally only War Horn 'a' or Hex Totem 'b' drums). */
export const inDrum = (g: Game, p: { x: number; z: number }, spec?: SpecKey) =>
  g.towers.some(t => t.type === 'drum' && t.ds && (!spec || t.spec === spec) && (t.x - p.x) ** 2 + (t.z - p.z) ** 2 <= t.ds.rad * t.ds.rad);

/** A new Barracks rallies on the road sample nearest to it. */
export function defaultRally(g: Game, t: { x: number; z: number }): Rally {
  let best = null, bd = 1e9;
  for (const s of g.map.samples) { const d = (s.x - t.x) ** 2 + (s.z - t.z) ** 2; if (d < bd) { bd = d; best = s; } }
  return best ? { x: best.x, z: best.z } : { x: t.x, z: t.z };
}

/**
 * Where a tap at (x, z) would put the rally point, or null: a road sample within 1.5 of the tap (.8 for Rangers) and
 * 3.3 of the Barracks; or, for Rangers only, any open ground within 3.6 (Overwatch: they shoot and never block).
 */
export function rallyPick(g: Game, t: Tower, x: number, z: number): Rally | null {
  let best: Rally | null = null, bd = t.spec === 'b' ? 0.64 : 2.25;
  for (const s of g.map.samples) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd && (s.x - t.x) ** 2 + (s.z - t.z) ** 2 < 3.3 * 3.3) { bd = d; best = { x: s.x, z: s.z }; } }
  if (!best && t.spec === 'b' && (x - t.x) ** 2 + (z - t.z) ** 2 < 3.6 * 3.6) {
    const gx = Math.floor(x + W / 2), gz = Math.floor(z + H / 2);
    const ok = gx >= 0 && gz >= 0 && gx < W && gz < H && ![2, 3, 4].includes(g.map.tiles[gz * W + gx]) && groundY(g, x, z) <= 2.1;
    if (ok) best = { x, z, over: true };
  }
  return best;
}

/** Moves a Barracks' rally point; its soldiers drop their fights and walk there. */
export function setRally(t: Tower, r: Rally) {
  t.rally = r;
  for (const so of t.soldiers) { for (const o of [so.target, so.extra]) if (o && o.blocker === so) o.blocker = null; so.target = so.extra = null; }
}

const ATK_TYPES = new Set(Object.keys(ATK)); // enemies that fight soldiers (flyers don't)

const soldierName = (g: Game) => {
  for (let k = 0; k < 8; k++) { const n = SOL_FIRST[int(g.rng, 0, SOL_FIRST.length - 1)] + ' ' + SOL_LAST[int(g.rng, 0, SOL_LAST.length - 1)]; if (!g.soldiers.some(s => s.alive && s.name === n)) return n; }
  return SOL_FIRST[int(g.rng, 0, SOL_FIRST.length - 1)] + ' ' + SOL_LAST[int(g.rng, 0, SOL_LAST.length - 1)];
};

/** Soldier i's place around the rally point: n soldiers on a ring of .55. */
export const slot = (s: Soldier) => { const r = s.host.rally, n = s.host.bs.n, a = s.i / n * Math.PI * 2 + 0.6, d = n > 1 ? 0.55 : 0; return { x: r.x + Math.cos(a) * d, z: r.z + Math.sin(a) * d }; };

export function makeSoldier(g: Game, host: SoldierHost, i: number, atRally: boolean, name = soldierName(g)): Soldier {
  const st = host.bs;
  const s: Soldier = {
    id: g.nextId++, host, i, type: st.unit, name, st, hp: st.hp, maxHp: st.hp, alive: true, x: host.x, y: 0, z: host.z, heading: 0, want: null,
    target: null, extra: null, engaged: null, scan: 0, cd: range(g.rng, 0, 0.4), calm: 0, inv: 0, saved: false, hits: 0, swings: 0,
    atk: null, fighting: false, aiming: false, hawkT: 1, ttl: null, cheer: 0,
  };
  if (atRally) { const p = slot(s); s.x = p.x; s.z = p.z; }
  s.y = groundY(g, s.x, s.z);
  g.soldiers.push(s);
  return s;
}

/** Barracks level, specialisation or rank changed: all soldiers are replaced at the rally point (and cheer). */
export function refreshSoldiers(g: Game, t: Tower) {
  t.bs = barrStat(g, (t.spec || Math.min(t.lvl, 3)) as BarrKey, t.spec ? t.rank : 1);
  if (!t.rally) t.rally = defaultRally(g, t);
  const had = t.soldiers.some(s => s.alive);
  for (const s of t.soldiers) s.alive = false;
  t.soldiers = []; t.resp = [];
  for (let i = 0; i < t.bs.n; i++) { const s = makeSoldier(g, t as SoldierHost, i, true); if (had) s.cheer = 1.3; t.soldiers.push(s); }
}

/** Fallen soldiers come back after the respawn time, walking out from the Barracks. */
export function barracksTick(g: Game, t: Tower, dt: number) {
  for (let i = 0; i < t.bs!.n; i++) {
    const so = t.soldiers[i]; if (so && so.alive) continue;
    t.resp[i] = (t.resp[i] ?? t.bs!.resp) - dt;
    if (t.resp[i]! <= 0) respawnSoldier(g, t, i, false);
  }
}

export function respawnSoldier(g: Game, t: Tower, i: number, atRally: boolean) {
  t.resp[i] = undefined;
  t.soldiers[i] = makeSoldier(g, t as SoldierHost, i, atRally);
}

/** Damage to a soldier after its armour or magic resist; Paladins with Divine Shield survive one killing blow. */
export function hurtSoldier(g: Game, s: Soldier, amt: number, kind: 'phys' | 'magic' | 'true') {
  if (!s.alive || s.inv > 0) return;
  s.calm = 0;
  if (s.type === 'ranger' && kind === 'phys' && has(g, 'barracks.nimble') && next(g.rng) < 0.2) return; // Nimble: dodges
  const red = kind === 'magic' ? s.st.mr || 0 : kind === 'phys' ? s.st.armor : 0;
  s.hp -= protectSoldier(g, s, amt * (1 - red));
  if (s.hp <= 0 && s.type === 'paladin' && has(g, 'barracks.shield') && !s.saved) { s.saved = true; s.hp = s.maxHp * 0.5; s.inv = 3; return; }
  if (s.hp <= 0) killSoldier(g, s);
}

function killSoldier(g: Game, s: Soldier) {
  s.alive = false; s.atk = null;
  for (const o of [s.target, s.extra]) if (o && o.blocker === s) o.blocker = null;
  const tw = s.host as Partial<Tower>;
  if (tw.resp) tw.resp[s.i] = s.host.bs.resp;
  heroFell(g, s);
  g.events.push({ t: 'soldierDown', s });
}

/** Spot around enemy e for this soldier, fanned out from a direction fixed when the fight starts (the 3.1 fix). */
function fanSpot(g: Game, s: Soldier, e: Enemy) {
  const mates = g.soldiers.filter(o => o.alive && o.target === e && !(o.st.ranged && o.host.rally.over)), n = mates.length, k = Math.max(0, mates.indexOf(s));
  if (!e.fan || g.time - e.fan.t > 0.5) { const ax = s.x - e.x, az = s.z - e.z, l = Math.hypot(ax, az) || 1; e.fan = { x: ax / l, z: az / l, t: 0 }; }
  e.fan.t = g.time; const ax = e.fan.x, az = e.fan.z;
  const a = (k - (n - 1) / 2) * 0.85, c = Math.cos(a), s2 = Math.sin(a);
  return { x: e.x + (ax * c - az * s2) * 0.7, z: e.z + (ax * s2 + az * c) * 0.7 };
}

/** The moment the blade lands. Every third swing is a shield bash (60%, knocks the enemy back) unless holy or a Ranger. */
function strike(g: Game, s: Soldier, a: NonNullable<Soldier['atk']>) {
  const e = a.e, st = s.st; if (!e.alive) return;
  s.hits++; const was = e.alive;
  const tower = 'type' in s.host ? s.host as Tower : undefined;
  hurt(g, e, st.dmg * (a.bash ? 0.6 : 1) * (has(g, 'drum.rally') && inDrum(g, s, 'a') ? 1.2 : 1), 'phys', 0, tower);
  if (a.bash && e.alive && e.type !== 'boss' && e.type !== 'gruk') e.d = Math.max(0, e.d - 0.15);
  if (was && !e.alive && s.type === 'paladin' && has(g, 'barracks.wind') && next(g.rng) < 0.2) s.hp = s.maxHp; // Second Wind
  if (st.holy && s.hits % (st.holyN || 4) === 0 && e.alive) { hurt(g, e, st.holy, 'true'); g.events.push({ t: 'holy', s, e }); }
}

const face = (s: Soldier, dx: number, dz: number) => { if (dx || dz) s.want = Math.atan2(dx, dz); };

export function updateSoldier(g: Game, s: Soldier, dt: number) {
  const st = s.st, r = s.host.rally;
  const attackDt = dt * bannerHaste(g, s);
  if (s.ttl != null) { s.ttl -= dt; if (s.ttl <= 0) { for (const o of [s.target, s.extra]) if (o && o.blocker === s) o.blocker = null; s.alive = false; return; } } // militia go home
  s.calm += dt; if (s.inv > 0) s.inv -= dt;
  if (s.cheer > 0) s.cheer -= dt;
  if (s.type === 'ranger' && has(g, 'barracks.hawk')) { // Hawk: every second, 6 damage to a flyer within 4
    s.hawkT -= dt;
    if (s.hawkT <= 0) { s.hawkT = 1; const f = g.enemies.find(o => o.alive && o.def.air && (o.x - s.x) ** 2 + (o.z - s.z) ** 2 < 16); if (f) hurt(g, f, 6, 'phys'); }
  }
  if (s.extra && (!s.extra.alive || s.extra.blocker !== s)) s.extra = null;
  const ow = !!(r.over && st.ranged);
  const inR = (e: Enemy, pad: number) => (e.shooting && e.shooting.alive && e.shooting.host === s.host) || (e.x - r.x) ** 2 + (e.z - r.z) ** 2 < (st.rad + pad) ** 2;
  if (s.target && (!s.target.alive || !inR(s.target, 0.8))) { if (s.target.blocker === s) s.target.blocker = null; s.target = null; }
  if (!s.target && s.extra) { s.target = s.extra; s.extra = null; } // the second enemy it was holding becomes its main fight
  const takenBy = (e: Enemy) => g.soldiers.some(o => o !== s && o.alive && o.target === e);
  s.scan -= dt;
  if (!s.target || (s.scan <= 0 && takenBy(s.target))) {
    s.scan = 0.2;
    let free: Enemy | null = null, fd = 1e9, any: Enemy | null = null, ad = 1e9;
    for (const e of g.enemies) {
      if (!e.alive || (e.def.air && !st.ranged) || !inR(e, 0)) continue;
      const d = (e.x - s.x) ** 2 + (e.z - s.z) ** 2;
      if (d < ad) { ad = d; any = e; }
      if (d < fd && !takenBy(e)) { fd = d; free = e; }
    }
    const pickE = free || (s.target ? null : any); // a soldier sharing a target only moves when someone is unclaimed
    if (pickE && pickE !== s.target) { if (s.target && s.target.blocker === s) s.target.blocker = null; s.target = pickE; }
  }
  let goal: { x: number; z: number } | null = null;
  const e = s.target;
  if (e) {
    const dx = e.x - s.x, dz = e.z - s.z, d = Math.hypot(dx, dz);
    if (st.ranged && (ow || e.def.air || d > 1)) { // Rangers shoot from their slot
      goal = slot(s); face(s, dx, dz); s.aiming = d < st.ranged + 0.5;
      s.cd -= attackDt;
      if (s.cd <= 0 && s.aiming) { s.cd = st.rate; fireArrow(g, { x: s.x, y: s.y + 1.1, z: s.z }, e, st.dmg * (has(g, 'drum.rally') && inDrum(g, s, 'a') ? 1.2 : 1), false, { pierce2: has(g, 'barracks.broad') }, undefined, 'type' in s.host ? s.host as Tower : undefined); }
    } else if (d > 0.85) { goal = fanSpot(g, s, e); face(s, dx, dz); }
    else {
      if (!e.blocker || !e.blocker.alive || (e.blocker.target !== e && !heroBlocks(g, e.blocker, e))) { if (e.blocker && e.blocker.extra === e) e.blocker.extra = null; e.blocker = s; }
      if (!s.extra) for (const o of g.enemies) { // hold one more enemy that walks into it, if nobody else has it
        if (o === e || !o.alive || o.def.air || !ATK_TYPES.has(o.type) || (o.blocker && o.blocker.alive && (o.blocker.target === o || o.blocker.extra === o || heroBlocks(g, o.blocker, o)))) continue;
        if ((o.x - s.x) ** 2 + (o.z - s.z) ** 2 < 0.81) { s.extra = o; o.blocker = s; break; }
      }
      face(s, dx, dz);
      if (s.engaged !== e) { s.engaged = e; if (has(g, 'barracks.spear')) s.cd = 0; } // First Strike
      s.cd -= attackDt; s.fighting = true;
      if (s.cd <= 0 && !s.atk) { s.cd = st.rate; s.atk = { t: 0, hit: false, e, bash: !st.holy && s.type !== 'ranger' && s.swings % 3 === 2 }; s.swings++; }
      const f = fanSpot(g, s, e); if ((f.x - s.x) ** 2 + (f.z - s.z) ** 2 > 0.03) goal = f;
    }
  } else {
    goal = slot(s);
    if (s.calm > 2) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * (st.heal || st.regen || SOL_REGEN) * (has(g, 'drum.hymn') && inDrum(g, s) ? 2 : 1) * dt);
  }
  if (goal) {
    const dx = goal.x - s.x, dz = goal.z - s.z, d = Math.hypot(dx, dz);
    if (d > 0.06) { const sp = Math.min(d, 3.2 * (has(g, 'drum.march') && inDrum(g, s) ? 1.3 : 1) * dt); s.x += dx / d * sp; s.z += dz / d * sp; if (!e) face(s, dx, dz); }
  }
  s.y = groundY(g, s.x, s.z);
  if (s.want != null) s.heading = lerpAngle(s.heading, s.want, 1 - Math.exp(-10 * dt));
  if (s.atk) { const a = s.atk; a.t += dt; if (!a.hit && a.t >= 0.15) { a.hit = true; strike(g, s, a); } if (a.t >= 0.36) s.atk = null; } // wind-up, blade lands at .15 s
  if (!e) s.fighting = false;
}
