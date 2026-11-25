// Attacking towers (Archer, Cannon, Frost, Tesla, Flame): stats, costs, building and upgrades, targeting and firing.
// Ported from main.js (tStat, specStat, rankCost, upCost, sellRate, class Tower, buildHere, ringAct, sellTower).
// The Barracks and War Drum share this tower record; their own behaviour arrives in their steps of docs/M1.md.
import { UNLOCKS } from '../content/campaign.ts';
import { SK_STAT } from '../content/skills.ts';
import { MUZZLE_Y } from '../content/tower-dims.ts';
import { MORTAR_DEAD, SPEC, TT, UPC } from '../content/towers.ts';
import { centreDist2, hurt, type Enemy } from './enemies.ts';
import { isBurning } from './heroes.ts';
import { pathAt } from './map.ts';
import { int, range } from './rng.ts';
import { fireArrow, fireBall, fireShard, freezeEnemy } from './projectiles.ts';
import { drumAsStat, drumTick, refreshDrum, type DrumStat } from './drum.ts';
import { barracksTick, barrAsStat, refreshSoldiers, type BarrKey, type BarrStat, type Rally, type Soldier } from './soldiers.ts';
import { has, type Game } from './state.ts';

export type TowerType = keyof typeof TT;
export type AttackType = 'arrow' | 'cannon' | 'frost' | 'tesla' | 'flame';
export type SpecKey = 'a' | 'b';
export type AimMode = 'first' | 'last' | 'strong' | 'close';
export interface Stat { dmg: number; range: number; rate: number; dps: number }
export type Gate = (typeof UNLOCKS)[number];

const ATTACK: readonly string[] = ['arrow', 'cannon', 'frost', 'tesla', 'flame'];
export const isAttack = (type: string): type is AttackType => ATTACK.includes(type);

// ---------------------------------------------------------------- stats and costs

/** Total War Council bonus to one stat of one tower type (and specialisation). */
export function skMod(g: Pick<Game, 'skills'>, type: string, stat: 'dmg' | 'rng' | 'rate', spec: SpecKey | null) {
  let v = 0;
  for (const [id, row] of Object.entries(SK_STAT) as [string, (string | number)[]][]) {
    const [t, st, val, sp] = row;
    if (t === type && st === stat && (!sp || sp === spec) && has(g, id)) v += val as number;
  }
  return v;
}
function skApply(g: Pick<Game, 'skills'>, type: string, s: Stat, spec: SpecKey | null): Stat {
  const d = skMod(g, type, 'dmg', spec), r = skMod(g, type, 'rng', spec), q = skMod(g, type, 'rate', spec);
  if (d || r || q) { s.dmg *= 1 + d; s.range *= 1 + r; s.rate /= 1 + q; s.dps *= (1 + d) * (1 + q); }
  return s;
}

/** Level 1–3 stats: ×1.7 damage, +.7 range and ×.86 reload per level, then the War Council's bonuses. */
export function tStat(g: Pick<Game, 'skills'>, type: AttackType, lvl: number, sk = true): Stat {
  const d = TT[type];
  const s = { dmg: d.dmg * Math.pow(1.7, lvl - 1), range: d.range + 0.7 * (lvl - 1), rate: d.rate * Math.pow(0.86, lvl - 1), dps: d.dps * Math.pow(1.7, lvl - 1) / Math.pow(0.86, lvl - 1) };
  return sk ? skApply(g, type, s, null) : s;
}
/** Specialisation stats: its formula applied to level 3, then ×1.3 damage, +.4 range and ×.92 reload per rank. */
export function specStat(g: Pick<Game, 'skills'>, type: AttackType, k: SpecKey, rank = 1): Stat {
  const s = tStat(g, type, 3, false); Object.assign(s, SPEC[type][k].st(s));
  const r = rank - 1; s.dmg *= Math.pow(1.3, r); s.range += 0.4 * r; s.rate *= Math.pow(0.92, r); s.dps *= Math.pow(1.3 / 0.92, r);
  return skApply(g, type, s, k);
}
/** Cost to reach rank 2 (80% of the specialisation) or rank 3 (110%), rounded to 10. */
export const rankCost = (type: TowerType, k: SpecKey, rank: number) => Math.round(SPEC[type][k].cost * (rank === 2 ? 0.8 : 1.1) / 10) * 10;
export const upCost = (t: Tower) => UPC[t.type][t.lvl - 1];
export const sellRate = (g: Pick<Game, 'skills'>) => (has(g, 'kingdom.treasury') ? 0.9 : has(g, 'kingdom.qm') ? 0.8 : 0.7);
export const mortarDead = (g: Pick<Game, 'skills'>) => (has(g, 'cannon.mortar') ? 2 : MORTAR_DEAD);
/** Share of armour the Siege Mortar ignores: 40% / 50% / 60% by rank. */
export const mortarPierce = (r: number) => 0.3 + 0.1 * r;
/** Overload's beam build-up limit by rank: 3× / 4× / 5×. */
export const overloadCap = (r: number) => 2 + r;

// ---------------------------------------------------------------- the tower record

/** Abilities the War Council switches on for a tower, by type and specialisation (main.js Tower.build `ab`). */
export interface Abilities { finish: boolean; shock: boolean; wide: boolean; brittleice: boolean; flash: boolean; trail: boolean; snap: boolean; static: boolean; fork: boolean; surge: boolean; flashover: boolean; brand: boolean; ember: boolean }

export interface Tower {
  id: number; type: TowerType; x: number; z: number; stunT: number; plot: number; lvl: number; spec: SpecKey | null; rank: number; mode: AimMode; spend: number;
  buildT: number; cool: number; target: Enemy | null; retarget: number; held: Enemy | null; holdT: number; shots: number;
  charge: number; lastBeam: Enemy | null; napT: number; rainAt: number;
  cd: { finish: number; snap: number; ember: number; flashover: number; surge: number };
  lastHit: Enemy | null; hitN: number;
  /** War Drum boosts, set every tick by the drum pass: fire-rate haste and range bonus */
  haste: number; rngB: number;
  ab: Abilities;
  /** Barracks: soldier stats, rally point, soldiers and per-slot respawn timers */
  bs: BarrStat | null; rally: Rally; soldiers: Soldier[]; resp: (number | undefined)[];
  /** War Drum: its stats, and its Thunder and Charge timers */
  ds: DrumStat | null; thT?: number; chT?: number;
}

export interface Spot { gx: number; gz: number; x: number; z: number; used: boolean; block: number }

function abilities(g: Game, t: Tower): Abilities {
  const sp = t.spec, ty = t.type, h = (id: string) => has(g, id);
  return {
    finish: ty === 'arrow' && sp === 'a' && h('arrow.head'), shock: ty === 'cannon' && sp !== 'b' && h('cannon.shaker'), wide: ty === 'cannon' && sp === 'b' && h('cannon.scatter'),
    brittleice: ty === 'frost' && h('frost.brittle'), flash: ty === 'frost' && sp === 'a' && h('frost.perma'), trail: ty === 'frost' && sp === 'b' && h('frost.black'), snap: ty === 'frost' && sp === 'b' && h('frost.aval'),
    static: ty === 'tesla' && sp !== 'b' && h('tesla.static'), fork: ty === 'tesla' && sp !== 'b' && h('tesla.ball'), surge: ty === 'tesla' && sp === 'b' && h('tesla.melt'),
    flashover: ty === 'flame' && sp === 'b' && h('flame.inf'), brand: ty === 'flame' && sp === 'b' && h('flame.hungry'), ember: ty === 'flame' && sp === 'a' && h('flame.wall'),
  };
}

/** The tower's current stats, with a War Drum's range bonus. */
export function stats(g: Game, t: Tower): Stat {
  if (t.type === 'barracks') { const s = barrAsStat(t.bs!); if (t.rngB) s.range *= 1 + t.rngB; return s; }
  if (t.type === 'drum') return drumAsStat(t.ds!);
  if (!isAttack(t.type)) throw new Error(`unknown tower type ${t.type}`);
  const s = t.spec ? specStat(g, t.type, t.spec, t.rank) : tStat(g, t.type, t.lvl);
  if (t.rngB) s.range *= 1 + t.rngB;
  return s;
}

export const muzzleY = (t: Tower) => MUZZLE_Y[t.type as AttackType][t.spec ?? (Math.min(t.lvl, 3) as 1 | 2 | 3)];

// ---------------------------------------------------------------- player actions

/** Why a tower can't be built there, or null if it can. */
export function cantBuild(g: Game, type: TowerType, plot: number): string | null {
  const s = g.spots[plot];
  if (!s) return 'no such plot';
  if (s.used || s.block) return 'plot taken';
  if (!g.gate.towers.includes(type)) return 'not unlocked';
  if (g.gold < TT[type].cost) return 'not enough gold';
  return null;
}

/** Builds a tower: pays for it (unless free, as Watch mode's opening towers are) and blocks the plots next to it. */
export function buildTower(g: Game, type: TowerType, plot: number, o: { instant?: boolean; free?: boolean } = {}): Tower | null {
  if (!o.free && cantBuild(g, type, plot)) return null;
  const s = g.spots[plot], cost = TT[type].cost;
  if (!o.free) g.gold -= cost;
  s.used = true;
  for (const n of g.spots) if (Math.abs(n.gx - s.gx) <= 1 && Math.abs(n.gz - s.gz) <= 1) n.block++;
  const t: Tower = {
    id: g.nextId++, type, plot, x: s.x, z: s.z, stunT: 0, lvl: 1, spec: null, rank: 0, mode: type === 'flame' ? 'close' : 'first', spend: cost,
    buildT: o.instant ? 1 : 0, cool: range(g.rng, 0, TT[type].rate), target: null, retarget: 0, held: null, holdT: 0, shots: 0,
    charge: 1, lastBeam: null, napT: 0, rainAt: -99, cd: { finish: 0, snap: 0, ember: 0, flashover: 0, surge: 0 }, lastHit: null, hitN: 0,
    haste: 0, rngB: 0, ab: undefined as unknown as Abilities, bs: null, rally: undefined as unknown as Rally, soldiers: [], resp: [], ds: null,
  };
  t.ab = abilities(g, t);
  if (type === 'barracks') refreshSoldiers(g, t);
  if (type === 'drum') refreshDrum(g, t);
  g.towers.push(t); g.built++; g.events.push({ t: 'build', tower: t });
  return t;
}

/** What the tower ring offers: a specialisation choice, a max-level tower, or an upgrade at a price; and the refund. */
export function towerActs(g: Game, t: Tower) {
  const choose = t.lvl === 3 && !t.spec && g.gate.spec, max = !choose && (t.spec ? t.rank >= 3 : t.lvl >= g.gate.max);
  const upCostNow = choose || max ? 0 : t.spec ? rankCost(t.type, t.spec, t.rank + 1) : upCost(t);
  return { choose, max, upCostNow, refund: Math.round(t.spend * sellRate(g)) };
}

/** Upgrade to the next level, or the next rank of its specialisation. */
export function upgradeTower(g: Game, t: Tower): boolean {
  const A = towerActs(g, t);
  if (A.choose || A.max || g.gold < A.upCostNow) return false;
  g.gold -= A.upCostNow; t.spend += A.upCostNow;
  if (t.spec) t.rank++; else t.lvl++;
  t.ab = abilities(g, t); if (t.type === 'barracks') refreshSoldiers(g, t); if (t.type === 'drum') refreshDrum(g, t); g.events.push({ t: 'upgrade', tower: t });
  return true;
}

export function specialise(g: Game, t: Tower, k: SpecKey): boolean {
  const cost = SPEC[t.type][k].cost;
  if (!towerActs(g, t).choose || g.gold < cost) return false;
  g.gold -= cost; t.spend += cost;
  t.spec = k; t.lvl = 4; t.rank = 1; t.target = null;
  if ((t.type === 'arrow' && k === 'a') || (t.type === 'frost' && k === 'a') || (t.type === 'flame' && k === 'b')) t.mode = 'strong';
  t.ab = abilities(g, t); if (t.type === 'barracks') refreshSoldiers(g, t); if (t.type === 'drum') refreshDrum(g, t);
  g.events.push({ t: 'specialise', tower: t });
  return true;
}

export function sellTower(g: Game, t: Tower) {
  const refund = Math.round(t.spend * sellRate(g)), s = g.spots[t.plot];
  g.gold += refund; g.towers.splice(g.towers.indexOf(t), 1);
  for (const so of t.soldiers) so.alive = false;
  s.used = false;
  for (const n of g.spots) if (Math.abs(n.gx - s.gx) <= 1 && Math.abs(n.gz - s.gz) <= 1) n.block--;
  g.events.push({ t: 'sell', tower: t, refund });
}

const MODES: AimMode[] = ['first', 'last', 'strong', 'close'];
/** The aim button cycles first → last → strongest → closest. */
export function cycleAim(t: Tower) { t.mode = MODES[(MODES.indexOf(t.mode) + 1) % MODES.length]; t.target = null; }

// ---------------------------------------------------------------- targeting

const flat2 = (t: { x: number; z: number }, e: Enemy) => (e.x - t.x) ** 2 + (e.z - t.z) ** 2;
export const canHit = (t: Tower, e: Enemy) => e.alive && (TT[t.type].air || !e.def.air);
export const inRange = (t: Tower, e: Enemy, r: number) => flat2(t, e) <= r * r;
/** The Siege Mortar can't hit enemies inside its dead zone. */
export const tooClose = (g: Game, t: Tower, e: Enemy) => { const md = mortarDead(g); return t.type === 'cannon' && t.spec === 'a' && flat2(t, e) < md * md; };

export function findTarget(g: Game, t: Tower, r: number): Enemy | null {
  let best: Enemy | null = null, bd = -1; const r2 = r * r;
  for (const e of g.enemies) {
    if (!canHit(t, e) || tooClose(g, t, e)) continue;
    const d2 = flat2(t, e); if (d2 > r2) continue;
    const m = t.mode, score = m === 'close' ? -d2 : m === 'last' ? -e.d : m === 'strong' ? e.hp : e.d + (e.type === 'boss' ? 3 : 0);
    if (score > bd || best === null) { bd = score; best = e; }
  }
  return best;
}

// ---------------------------------------------------------------- firing

export function updateTower(g: Game, t: Tower, dt: number) {
  if (t.buildT < 1) { t.buildT = Math.min(1, t.buildT + dt * 0.9); if (t.buildT < 0.75) return; } // still rising
  if (t.stunT > 0) { t.stunT -= dt; return; } // knocked out by a Sapper
  if (t.type === 'barracks') { barracksTick(g, t, dt); return; }
  if (t.type === 'drum') { drumTick(g, t, dt); return; }
  if (!isAttack(t.type)) return;
  const st = stats(g, t), ab = t.ab, rng = g.rng;
  for (const k in t.cd) t.cd[k as keyof Tower['cd']] -= dt;
  // timed abilities that don't need the current target
  if (ab.finish && t.cd.finish <= 0) { // Headshot: a golden arrow at the weakest enemy below 40%
    let w: Enemy | null = null;
    for (const o of g.enemies) if (canHit(t, o) && inRange(t, o, st.range) && o.hp / o.maxHp < 0.4 && (!w || o.hp < w.hp)) w = o;
    if (w) { t.cd.finish = 4; fireArrow(g, t, w, st.dmg * 2, true, {}); }
  }
  if (ab.snap && t.cd.snap <= 0) { // Avalanche: freeze up to 3 enemies on this tower's ice
    t.cd.snap = 6; let n = 0;
    for (const o of g.enemies) { if (n >= 3 || !o.alive || o.def.air) continue; if (g.icePatches.some(p => p.tw === t && (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < 1.6)) { freezeEnemy(g, o, 1.2, t); n++; } }
  }
  if (ab.ember && t.cd.ember <= 0) { // Wall of Fire: three fire patches along the road in range
    const cand = g.map.samples.filter(p => (p.x - t.x) ** 2 + (p.z - t.z) ** 2 < st.range * st.range);
    if (cand.length) { t.cd.ember = 6; const c = cand[int(rng, 0, cand.length - 1)]; for (let k = 0; k < 3; k++) { const q = pathAt(g.map.paths[c.path], c.d + k); g.firePatches.push({ x: q.x, z: q.z, t: 4, tick: 0, sourceTower: t }); } }
  }
  if (ab.flashover && t.cd.flashover <= 0) { // Flashover: fire leaps from a burning enemy to its nearest unburnt neighbour
    const src = g.enemies.find(o => o.alive && isBurning(g, o) && inRange(t, o, st.range + 1));
    if (src) {
      let nb: Enemy | null = null, nd = 4;
      for (const o of g.enemies) { if (!o.alive || o === src || o.def.air || isBurning(g, o)) continue; const d2 = centreDist2(o, src); if (d2 < nd) { nd = d2; nb = o; } }
      if (nb) { t.cd.flashover = 1.5; g.events.push({ t: 'flashover', tower: t, from: src, e: nb }); nb.burn = ab.brand ? 4 : 1.6; hurt(g, nb, st.dmg * 3, 'true', 0, t); }
    }
  }
  t.retarget -= dt;
  if (!t.target || !canHit(t, t.target) || !inRange(t, t.target, st.range) || tooClose(g, t, t.target) || t.retarget <= 0) { t.target = findTarget(g, t, st.range); t.retarget = 0.25; }
  const e = t.target;
  if (e && e === t.held) t.holdT += dt; else { t.held = e; t.holdT = 0; }
  t.cool -= dt;
  if (!e || t.cool > 0) return;
  t.cool = st.rate; t.shots++;
  const fire: { t: 'fire'; tower: Tower; target: Enemy; chains?: Enemy[][] } = { t: 'fire', tower: t, target: e }; g.events.push(fire);
  const sp = t.spec, time = g.time;
  if (t.type === 'arrow') {
    const opts = { pierce: sp === 'a' && has(g, 'arrow.long') ? 0.25 : 0, sky: has(g, 'arrow.sky'), mark: has(g, 'arrow.mark'), bleed: sp === 'b' && has(g, 'arrow.bleed'), dead: sp === 'a' && has(g, 'arrow.dead') };
    fireArrow(g, t, e, st.dmg * (has(g, 'arrow.barb') && t.shots % 5 === 0 ? 2 : 1), sp === 'a', opts);
    if (sp === 'b' && has(g, 'arrow.storm') && time - t.rainAt >= 8) { // Arrow Storm: 12 arrows rain on the target's crowd
      t.rainAt = time; const near = g.enemies.filter(o => o.alive && centreDist2(o, e) < 4);
      for (let k = 0; k < 12 && near.length; k++) fireArrow(g, t, near[int(rng, 0, near.length - 1)], st.dmg * 0.5, false, opts, { dx: range(rng, -0.6, 0.6), dy: 2.5, dz: range(rng, -0.6, 0.6) });
    }
    if (sp === 'b') { // Volley: extra archers at the enemies furthest along
      const more = g.enemies.filter(o => o !== e && canHit(t, o) && inRange(t, o, st.range)).sort((a, b) => b.d - a.d).slice(0, 1 + t.rank + (has(g, 'arrow.vol') ? 1 : 0));
      for (const o of more) fireArrow(g, t, o, st.dmg, false, opts, { dx: range(rng, -0.3, 0.3), dy: 0, dz: range(rng, -0.3, 0.3) });
    }
    if (t.lvl === 3) { const e2 = g.enemies.find(o => o !== e && canHit(t, o) && inRange(t, o, st.range)); if (e2) fireArrow(g, t, e2, st.dmg, false, {}, { dx: range(rng, -0.2, 0.2), dy: 0, dz: range(rng, -0.2, 0.2) }); }
  } else if (t.type === 'cannon') {
    if (sp === 'b') { // Scattergun: an instant cone blast
      const dx0 = e.x - t.x, dz0 = e.z - t.z, k0 = 1 / (Math.sqrt(dx0 * dx0 + dz0 * dz0) || 1), dir = { x: dx0 * k0, z: dz0 * k0 }, cosA = ab.wide ? 0.57 : 0.82;
      for (const o of g.enemies) {
        if (!o.alive || o.def.air) continue;
        const dx = o.x - t.x, dz = o.z - t.z, dd = Math.hypot(dx, dz);
        if (dd > st.range + 0.3 || (dx * dir.x + dz * dir.z) / (dd || 1) < cosA) continue;
        hurt(g, o, st.dmg, 'phys', 0, t);
        if (o.alive && has(g, 'cannon.knock') && o.type !== 'boss' && o.type !== 'gruk') o.d = Math.max(0, o.d - 0.6);
      }
      if (has(g, 'cannon.breath')) g.firePatches.push({ x: e.x, z: e.z, t: 3, tick: 0, sourceTower: t });
      return;
    }
    const spl = (sp === 'a' ? 2.8 + 0.2 * t.rank : TT.cannon.splash + 0.25 * (Math.min(t.lvl, 3) - 1)) * (has(g, 'cannon.powder') ? 1.12 : 1);
    fireBall(g, t, e, st.dmg, spl, sp === 'a' && has(g, 'cannon.cluster'), sp === 'a' ? 1.8 : 1, {
      shock: ab.shock && t.shots % 3 === 0, pierce: sp === 'a' ? mortarPierce(t.rank) + (has(g, 'cannon.sapper') ? 0.1 : 0) : 0,
      conc: has(g, 'cannon.conc'), iron: has(g, 'cannon.iron'), boss: sp === 'a' && has(g, 'cannon.bunker'),
    });
  } else if (t.type === 'frost') {
    fireShard(g, t, e, st.dmg);
    if (has(g, 'frost.mirror')) { const e2 = g.enemies.find(o => o !== e && canHit(t, o) && inRange(t, o, st.range)); if (e2) fireShard(g, t, e2, st.dmg * 0.4); }
  } else if (t.type === 'tesla') {
    if (sp === 'b') { // Overload: a beam that builds up while it stays on one enemy
      if (e !== t.lastBeam) t.charge = 1;
      else t.charge = Math.min(overloadCap(t.rank), t.charge + (overloadCap(t.rank) - 1) * st.rate / (has(g, 'tesla.over') ? 2 : 3));
      t.lastBeam = e;
      hurt(g, e, st.dmg * t.charge, 'magic', 0, t);
      if (has(g, 'tesla.spill')) { let nb: Enemy | null = null, nd = 2.2 * 2.2; for (const o of g.enemies) { if (!o.alive || o === e) continue; const d2 = centreDist2(o, e); if (d2 < nd) { nd = d2; nb = o; } } if (nb) hurt(g, nb, st.dmg * t.charge * 0.35, 'magic', 0, t); }
      if (ab.surge && t.charge >= 3.99 && t.cd.surge <= 0 && e.alive) { // Meltdown
        t.cd.surge = 6; g.events.push({ t: 'surge', tower: t, e }); hurt(g, e, st.dmg * 12, 'magic', 0, t);
        for (const o of g.enemies) if (o.alive && o !== e && centreDist2(o, e) < 2.25) hurt(g, o, st.dmg * 6, 'magic', 0, t);
      }
      return;
    }
    const hit = new Set<Enemy>();
    const chain = (cur: Enemy | null, n: number, falloff: number) => { // jumps to the nearest unhit enemy, losing damage each time
      let dmg = st.dmg; const path: Enemy[] = []; (fire.chains ??= []).push(path);
      for (let k = 0; k < n && cur; k++) {
        hit.add(cur); path.push(cur); if (ab.static) { cur.shockT = 2; cur.shockDmg = st.dmg * 0.3; }
        hurt(g, cur, dmg * (cur.def.air && has(g, 'tesla.rod') ? 1.25 : 1), 'magic', 0, t); dmg *= falloff;
        const from = cur, jr = sp === 'a' && has(g, 'tesla.super') ? 4.5 : 3.2; let nb: Enemy | null = null, nd = jr * jr;
        for (const o of g.enemies) { if (!o.alive || hit.has(o)) continue; const d2 = centreDist2(o, from); if (d2 < nd) { nd = d2; nb = o; } }
        cur = nb;
      }
    };
    const n = (sp === 'a' ? 7 + t.rank + (has(g, 'tesla.storm') ? 2 : 0) : TT.tesla.chain + t.lvl - 1) + (has(g, 'tesla.cond') ? 1 : 0), fo = sp === 'a' ? (has(g, 'tesla.thunder') ? 0.92 : 0.85) : 0.72;
    chain(e, n, fo);
    if (ab.fork && t.shots % 3 === 0) { const e2 = g.enemies.find(o => o.alive && !hit.has(o) && inRange(t, o, st.range)); if (e2) chain(e2, n, fo); }
  } else if (t.type === 'flame') {
    if (sp === 'a') { t.napT -= st.rate; if (t.napT <= 0) { t.napT = 0.6; g.firePatches.push({ x: e.x + range(rng, -0.3, 0.3), z: e.z + range(rng, -0.3, 0.3), t: 3 + t.rank + (has(g, 'flame.line') ? 2 : 0), tick: 0, sourceTower: t }); } }
    const burnT = (ab.brand ? 4 : 1.6) + (has(g, 'flame.fuel') ? 1 : 0);
    const oil = (o: Enemy) => { if (o.alive && has(g, 'flame.oil')) { o.slowF = Math.min(o.slow > 0 ? o.slowF : 1, 0.85); o.slow = Math.max(o.slow, 0.6); } };
    if (sp === 'b') { hurt(g, e, st.dmg, 'true', 0, t); e.burn = Math.max(e.burn, burnT); oil(e); return; } // Inferno: one focused stream
    const fx = e.x - t.x, fz = e.z - t.z, fl = Math.hypot(fx, fz) || 1; // the cone points from the tower at the target
    for (const o of g.enemies) {
      if (!o.alive || o.def.air) continue;
      const dx = o.x - t.x, dz = o.z - t.z, dd = Math.hypot(dx, dz);
      if (dd > st.range + 0.3) continue;
      if ((dx * fx + dz * fz) / (fl * (dd || 1)) > (has(g, 'flame.nozzle') ? 0.77 : 0.82) || o === e) { hurt(g, o, st.dmg, 'true', 0, t); o.burn = Math.max(o.burn, burnT); oil(o); }
    }
  }
}
