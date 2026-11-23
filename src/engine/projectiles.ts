// Projectiles and lingering ground effects: arrows, cannonballs, bomblets, frost shards, fire patches and ice.
// Ported from main.js (class Arrow, Cannonball, Bomblet, Shard, freezeEnemy, and the patch loops in updateGame).
// Each projectile is a timer or a homing point, so its hit lands on the same tick as in 3.x; the renderer draws it
// from the fields kept here (start, aim, progress).
import { centreDist2, hurt, type Enemy } from './enemies.ts';
import { smoothPath } from './map.ts';
import { next, range } from './rng.ts';
import { groundY, has, type Game } from './state.ts';
import { muzzleY, type SpecKey, type Tower } from './towers.ts';

interface P3 { x: number; y: number; z: number }
export interface ArrowOpts { pierce?: number; sky?: boolean; mark?: boolean; bleed?: boolean; dead?: boolean; pierce2?: boolean; gold?: boolean }
export interface BallOpts { shock?: boolean; pierce?: number; conc?: boolean; iron?: boolean; boss?: boolean }

export type Projectile =
  | { k: 'arrow'; s: P3; e: Enemy; last: P3; dmg: number; big: boolean; o: ArrowOpts; T: number; t: number; arc: number }
  | { k: 'ball'; s: P3; aim: P3; dmg: number; splash: number; cluster: boolean; o: BallOpts; T: number; t: number; arc: number }
  | { k: 'bomblet'; s: P3; aim: P3; dmg: number; T: number; t: number }
  | { k: 'boulder'; s: P3; aim: P3; dmg: number; T: number; t: number }
  | { k: 'shard'; p: P3; e: Enemy; last: P3; dmg: number; lvl: number; spec: SpecKey | null; tw: Tower | null };

export interface FirePatch { x: number; z: number; t: number; tick: number }
export interface IcePatch { x: number; z: number; t: number; tw: Tower }

const centre = (e: Enemy): P3 => ({ x: e.x, y: e.y + e.cy, z: e.z });
const muzzle = (t: Tower, off?: { dx: number; dy: number; dz: number }): P3 => ({ x: t.x + (off?.dx ?? 0), y: muzzleY(t) + (off?.dy ?? 0), z: t.z + (off?.dz ?? 0) });
const dist3 = (a: P3, b: P3) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

export function freezeEnemy(g: Game, o: Enemy, dur: number, tw: Tower | null) {
  if (!o.alive) return;
  o.freeze = Math.max(o.freeze, dur);
  if (tw && tw.ab.brittleice) o.iceBrittle = true;
}

/** An arrow homes on its target and lands after distance / speed (26 for a Longbow's, 17 otherwise) + .05 s. */
export function fireArrow(g: Game, t: Tower | { x: number; z: number; y: number }, e: Enemy, dmg: number, big: boolean, o: ArrowOpts, off?: { dx: number; dy: number; dz: number }) {
  const s = 'type' in t ? muzzle(t, off) : { x: t.x, y: t.y, z: t.z }, last = centre(e), d = dist3(s, last);
  g.projs.push({ k: 'arrow', s, e, last, dmg, big, o, T: d / (big ? 26 : 17) + 0.05, t: 0, arc: d * (big ? 0.03 : 0.07) });
}

/** A cannonball flies at where the target will be when it lands (its speed and slow at firing), then splashes. */
export function fireBall(g: Game, t: Tower, e: Enemy, dmg: number, splash: number, cluster: boolean, arcMul: number, o: BallOpts) {
  const s = muzzle(t), d = Math.hypot(e.x - s.x, e.z - s.z), P = g.map.paths[e.path];
  let T = 0.75 + d * 0.06;
  const fd = e.d + e.def.speed * (e.slow > 0 ? e.slowF : 1) * T, on = smoothPath(P, e.d), ahead = smoothPath(P, Math.min(fd, P.len - 0.5));
  const aim = { x: ahead.x + (e.x - on.x), y: 0, z: ahead.z + (e.z - on.z) }; // keep its place across the road
  aim.y = groundY(g, aim.x, aim.z) + 0.2;
  if (arcMul > 1) T *= 1.25;
  g.projs.push({ k: 'ball', s, aim, dmg, splash, cluster, o, T, t: 0, arc: (1.6 + d * 0.35) * arcMul });
}

export function fireShard(g: Game, t: Tower, e: Enemy, dmg: number) {
  g.projs.push({ k: 'shard', p: muzzle(t), e, last: centre(e), dmg, lvl: Math.min(t.lvl, 3), spec: t.spec, tw: t });
}

const SHARD_SPEED = 11;

/** Advances one projectile; false once it has landed. */
function step(g: Game, p: Projectile, dt: number): boolean {
  if (p.k === 'arrow') {
    p.t += dt; if (p.e.alive) p.last = centre(p.e);
    if (p.t < p.T) return true;
    const e = p.e, o = p.o;
    if (!e.alive) return false;
    let dm = p.dmg * (o.sky && e.def.air ? 1.2 : 1);
    if (o.dead && next(g.rng) < 0.12) { if (e.type === 'boss' || e.type === 'gruk') dm *= 3; else { dm = 0; hurt(g, e, e.hp * 50 + 999, 'true'); } } // Deadeye
    if (dm) hurt(g, e, dm, 'phys', o.pierce || 0);
    if (e.alive && o.mark) e.markT = 2;
    if (e.alive && o.bleed) e.bleedT = 3;
    if (o.pierce2 && next(g.rng) < 0.25) { const o2 = g.enemies.find(q => q.alive && q !== e && centreDist2(q, e) < 2.25); if (o2) hurt(g, o2, p.dmg, 'phys'); }
    return false;
  }
  if (p.k === 'ball') {
    p.t += dt; if (p.t < p.T) return true;
    const r2 = p.splash * p.splash, o = p.o;
    for (const e of g.enemies) {
      if (!e.alive || e.def.air) continue;
      const d2 = (e.x - p.aim.x) ** 2 + (e.z - p.aim.z) ** 2;
      if (d2 < r2) { // full damage at the centre, half at the edge
        hurt(g, e, p.dmg * (1 - 0.5 * Math.sqrt(d2 / r2)) * (o.iron && e.def.armor > 0 ? 1.15 : 1) * (o.boss && (e.type === 'boss' || e.type === 'gruk') ? 1.25 : 1), 'phys', o.pierce || 0);
        if (o.conc && e.alive) { e.slowF = Math.min(e.slow > 0 ? e.slowF : 1, 0.8); e.slow = Math.max(e.slow, 1); }
      }
    }
    if (p.cluster) for (let k = 0; k < 5; k++) { // Cluster Bomb
      const a = range(g.rng, 0, 6.28), r = range(g.rng, 0.8, 2), aim = { x: p.aim.x + Math.cos(a) * r, y: 0, z: p.aim.z + Math.sin(a) * r };
      aim.y = groundY(g, aim.x, aim.z) + 0.1;
      g.projs.push({ k: 'bomblet', s: { ...p.aim }, aim, dmg: p.dmg * 0.4, T: range(g.rng, 0.35, 0.6), t: 0 });
    }
    if (o.shock) for (const e of g.enemies) if (e.alive && !e.def.air && (e.x - p.aim.x) ** 2 + (e.z - p.aim.z) ** 2 < 1.44) e.stun = Math.max(e.stun, 1); // Shaker
    g.events.push({ t: 'blast', at: p.aim, r: p.splash });
    return false;
  }
  if (p.k === 'boulder') { // Catapult Barrage: 60 and a .5 s stun to ground enemies within 1.1
    p.t += dt; if (p.t < p.T) return true;
    for (const e of g.enemies) if (e.alive && !e.def.air && (e.x - p.aim.x) ** 2 + (e.z - p.aim.z) ** 2 < 1.2) { hurt(g, e, p.dmg, 'phys'); if (e.alive) e.stun = Math.max(e.stun, 0.5); }
    g.events.push({ t: 'blast', at: p.aim, r: 1.1 });
    return false;
  }
  if (p.k === 'bomblet') {
    p.t += dt; if (p.t < p.T) return true;
    for (const e of g.enemies) if (e.alive && !e.def.air && (e.x - p.aim.x) ** 2 + (e.z - p.aim.z) ** 2 < 1.1) hurt(g, e, p.dmg, 'phys');
    return false;
  }
  // shard: flies at 11 straight for its target's centre
  if (p.e.alive) p.last = centre(p.e);
  const vx = p.last.x - p.p.x, vy = p.last.y - p.p.y, vz = p.last.z - p.p.z, d = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (d >= SHARD_SPEED * dt + 0.1) { const k = SHARD_SPEED * dt / d; p.p.x += vx * k; p.p.y += vy * k; p.p.z += vz * k; return true; }
  shardHit(g, p);
  return false;
}

function shardHit(g: Game, p: Extract<Projectile, { k: 'shard' }>) {
  const cold = has(g, 'frost.root') ? 0.03 : 0, ling = has(g, 'frost.linger') ? 0.5 : 0, tw = p.tw!, ab = tw.ab;
  const zero = (o: Enemy) => { if (o.alive && has(g, 'frost.zero') && next(g.rng) < 0.1) freezeEnemy(g, o, 1, tw); }; // Absolute Zero
  const apply = (o: Enemy) => { o.slowF = Math.min(o.slow > 0 ? o.slowF : 1, 0.55 - 0.07 * p.lvl - cold); o.slow = 2 + 0.5 * p.lvl + ling; };
  const dTo = (o: Enemy) => dist3(centre(o), p.last);
  if (p.spec === 'a') { // Deep Freeze: a hard slow on one enemy; Permafrost freezes it on every third hit
    const e = p.e; if (!e.alive) return;
    hurt(g, e, p.dmg, 'magic'); zero(e);
    if (!e.alive) return;
    e.slow = 2 + tw.rank + ling + (has(g, 'frost.deep') ? 0.5 : 0); e.slowF = 0.25 - cold;
    if (tw.lastHit === e) tw.hitN++; else { tw.lastHit = e; tw.hitN = 1; }
    if (ab.flash && tw.hitN >= 3) { tw.hitN = 0; freezeEnemy(g, e, 1.2, tw); }
    return;
  }
  if (p.spec === 'b') { // Glacier Field: slows everything around the hit, ground enemies a little further out
    if (p.e.alive) { hurt(g, p.e, p.dmg, 'magic'); zero(p.e); }
    for (const o of g.enemies) if (o.alive && dTo(o) < (1.3 + 0.3 * tw.rank + (o.def.air ? 0 : 0.3)) * (has(g, 'frost.glacier') ? 1.25 : 1)) { o.slowF = Math.min(o.slow > 0 ? o.slowF : 1, 0.45 - cold); o.slow = Math.max(o.slow, 2.5 + ling); }
    if (ab.trail && groundY(g, p.last.x, p.last.z) > 0) g.icePatches.push({ x: p.last.x, z: p.last.z, t: 5, tw }); // Black Ice
    return;
  }
  if (p.e.alive) { hurt(g, p.e, p.dmg, 'magic'); if (p.e.alive) apply(p.e); zero(p.e); }
  if (p.lvl >= 2) for (const o of g.enemies) if (o.alive && o !== p.e && dTo(o) < 0.9 + 0.4 * p.lvl) apply(o);
}

/** Projectiles, then ice patches (slow), then fire patches (burn every .25 s), in main.js order. */
export function updateProjectiles(g: Game, dt: number) {
  g.projs = g.projs.filter(p => step(g, p, dt));
  g.icePatches = g.icePatches.filter(p => {
    p.t -= dt;
    for (const o of g.enemies) if (o.alive && !o.def.air && (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < 1.2) { o.slow = Math.max(o.slow, 0.4); o.slowF = Math.min(o.slow > 0 ? o.slowF : 1, 0.5); }
    return p.t > 0;
  });
  g.firePatches = g.firePatches.filter(p => {
    p.t -= dt; p.tick -= dt;
    if (p.tick <= 0) { p.tick = 0.25; for (const o of g.enemies) if (o.alive && !o.def.air && (o.x - p.x) ** 2 + (o.z - p.z) ** 2 < 0.9) { hurt(g, o, 6 * (has(g, 'flame.napalm') ? 1.3 : 1), 'true'); o.burn = Math.max(o.burn, 0.6); } }
    return p.t > 0;
  });
}
