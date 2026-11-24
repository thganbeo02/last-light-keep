// Enemies: spawning, walking the road, status effects, damage, death and the castle hit.
// Ported from main.js (class Enemy, hurt, killEnemy, reachCastle) without the models, animation and particles:
// what the renderer needs is in the events and in each enemy's position, heading and status timers.
import { ED } from '../content/enemies.ts';
import { ENEMY_CY } from '../content/enemy-dims.ts';
import { lerpAngle } from './math.ts';
import { enemyCombat } from './combat.ts';
import { smoothPath } from './map.ts';
import { range } from './rng.ts';
import { groundY, has, type Game } from './state.ts';
import type { Soldier } from './soldiers.ts';
import type { Tower } from './towers.ts';
import { hpMul, type EnemyType } from './waves.ts';

export type DamageKind = 'phys' | 'magic' | 'true';

export interface Enemy {
  id: number; type: EnemyType; def: (typeof ED)[EnemyType];
  path: number; d: number; lat: number; seed: number;
  x: number; y: number; z: number; cy: number; heading: number;
  hp: number; maxHp: number; alive: boolean;
  // status timers, in seconds unless noted
  slow: number; slowF: number; freeze: number; stun: number; burn: number;
  sunder: number; brittle: number; iceBrittle: boolean; shockT: number; shockDmg: number;
  hex: number; markT: number; bleedT: number;
  // specials
  healT: number; roared: boolean; shrug: boolean; lastSlow: number;
  planted: boolean; plantT: number; plantOn: Tower | null;
  stompT: number; stompW: number; // Gruk's Mire Stomp: time to the next one, and the wind-up left
  // melee with soldiers (src/engine/combat.ts, src/engine/soldiers.ts)
  fighting: boolean; faceT: number | null; blocker: Soldier | null; shooting: Soldier | null;
  atkT: number | undefined; charged: boolean; fan: { x: number; z: number; t: number } | null;
}

const _p = { x: 0, z: 0 }, _dir = { x: 0, z: 0 };

/** Puts an enemy at its distance along its road, spread sideways across it, and turns it (snap: no easing). */
export function place(g: Game, e: Enemy, dt: number, snap = false) {
  smoothPath(g.map.paths[e.path], e.d, _p, _dir);
  e.x = _p.x + _dir.z * e.lat; e.z = _p.z - _dir.x * e.lat;
  e.y = e.def.air ? (e.type === 'wraith' ? 2.4 : 2.7) + Math.sin(g.time * 2.2 + e.seed) * 0.3 : groundY(g, e.x, e.z);
  const hd = e.fighting && e.faceT != null ? e.faceT : Math.atan2(_dir.x, _dir.z); // face the soldier while fighting, else the road
  e.heading = snap ? hd : lerpAngle(e.heading, hd, 1 - Math.exp(-7 * dt));
}

/** Squared 3D distance between two enemies' centres (centre = feet + the type's centre height). */
export const centreDist2 = (a: Enemy, b: Enemy) => (a.x - b.x) ** 2 + (a.y + a.cy - (b.y + b.cy)) ** 2 + (a.z - b.z) ** 2;

export function spawnEnemy(g: Game, type: EnemyType, d = 0, path = 0): Enemy {
  const def = ED[type], big = type === 'boss' || type === 'gruk';
  const hp = def.hp * hpMul(g.def, g.wave, g.diff, g.mode === 'watch');
  const e: Enemy = {
    id: g.nextId++, type, def, path, d, lat: range(g.rng, -0.55, 0.55) * (big ? 0.2 : 1), seed: range(g.rng, 0, 100),
    x: 0, y: 0, z: 0, cy: ENEMY_CY[type], heading: 0,
    hp, maxHp: hp, alive: true,
    slow: 0, slowF: 1, freeze: 0, stun: 0, burn: 0, sunder: 0, brittle: 0, iceBrittle: false, shockT: 0, shockDmg: 0, hex: 0, markT: 0, bleedT: 0,
    healT: range(g.rng, 0.5, 2), roared: false, shrug: false, lastSlow: 0,
    planted: false, plantT: 0, plantOn: null, stompT: 8, stompW: 0,
    fighting: false, faceT: null, blocker: null, shooting: null, atkT: undefined, charged: false, fan: null,
  };
  place(g, e, 0, true);
  g.enemies.push(e); g.events.push({ t: 'spawn', e });
  return e;
}

/** Damage after armour (phys) or magic resist (magic); true damage ignores both. pierce: share of the block ignored. */
export function hurt(g: Game, e: Enemy, amt: number, kind: DamageKind = 'true', pierce = 0) {
  if (!e.alive) return;
  if (kind === 'phys' && e.iceBrittle && e.freeze > 0) { pierce = Math.max(pierce, 0.5); e.iceBrittle = false; g.events.push({ t: 'shield', e }); }
  let block = (kind === 'phys' ? e.def.armor : kind === 'magic' ? e.def.mr : 0) * (e.sunder > 0 ? 0.5 : 1) * (1 - pierce);
  if (block > 0 && e.burn > 0 && has(g, 'flame.scorch')) block *= 0.85;
  if (block > 0 && e.hex > 0 && has(g, 'drum.wither')) block = Math.max(0, block - 0.1);
  e.hp -= amt * (1 - block) * (e.brittle > 0 && e.slow > 0 ? 2 : 1) * (1 + (e.hex || 0)) * (e.markT > 0 ? 1.1 : 1);
  if (e.hp <= 0) killEnemy(g, e);
}

/** Gold for a kill: base reward × 1.6, +5% per wave after the first, +6% with the Tax skill. */
export const killReward = (g: Game, e: Enemy) => Math.round(e.def.reward * 1.6 * (1 + 0.05 * (g.wave - 1)) * (has(g, 'kingdom.tax') ? 1.06 : 1));

export function killEnemy(g: Game, e: Enemy) {
  e.alive = false;
  if (e.shockT > 0 && e.shockDmg) { // Static Charge: the stored shock jumps to everything within 1.8
    const dmg = e.shockDmg; e.shockDmg = 0; g.events.push({ t: 'staticCharge', e });
    for (const o of g.enemies) if (o.alive && o !== e && centreDist2(o, e) < 3.24) hurt(g, o, dmg, 'magic');
  }
  if (e.freeze > 0 && has(g, 'frost.shatter') && e.type !== 'boss' && e.type !== 'gruk') { // Shatter
    g.events.push({ t: 'shatter', e });
    for (const o of g.enemies) if (o.alive && o !== e && centreDist2(o, e) < 2.25) hurt(g, o, e.maxHp * 0.3, 'magic');
  }
  if (e.burn > 0 && has(g, 'flame.wild')) for (const o of g.enemies) if (o.alive && o !== e && !o.def.air && centreDist2(o, e) < 2.25) { o.burn = Math.max(o.burn, 2); hurt(g, o, 5, 'true'); }
  let reward = killReward(g, e);
  if (e.burn > 0 && has(g, 'flame.ash')) reward += 1;
  if (e.hex > 0 && has(g, 'drum.soul')) { reward += 2; if (g.soulHeal < 10 && g.hp > 0) { g.soulHeal++; g.hp = Math.min(g.maxHp, g.hp + 1); } }
  g.gold += reward; g.earned += reward; g.defeated++;
  g.events.push({ t: 'kill', e, reward });
}

export function reachCastle(g: Game, e: Enemy) {
  e.alive = false;
  if (g.state !== 'play') return;
  const dmg = Math.round(e.def.dmg * g.dmgMul);
  g.hp = Math.max(0, g.hp - dmg); g.events.push({ t: 'gate', e, dmg });
  if (has(g, 'kingdom.stand') && !g.standUsed && g.hp > 0 && g.hp <= 25) { g.standUsed = true; g.standT = 10; g.events.push({ t: 'lastStand' }); }
  if (g.hp <= 0) { g.state = 'fallen'; g.events.push({ t: 'castleFalls' }); }
}

export function updateEnemy(g: Game, e: Enemy, dt: number) {
  const P = g.map.paths[e.path];
  if (e.type === 'gruk') {
    if (e.slow > e.lastSlow + 1e-6) e.slow = e.lastSlow + (e.slow - e.lastSlow) * 0.5; // slows wear off twice as fast
    if (!e.roared && e.hp < e.maxHp * 0.5) { e.roared = true; g.events.push({ t: 'roar', e }); for (const k of [1.6, 3.2]) spawnEnemy(g, 'rider', Math.min(e.d + k, P.len - 2), e.path); }
  }
  if (e.type === 'rider' && !e.shrug && (e.slow > 0 || e.freeze > 0)) { e.shrug = true; e.slow = 0; e.freeze = 0; g.events.push({ t: 'shrug', e }); }
  if (e.slow > 0) e.slow -= dt;
  if (e.type === 'gruk') e.lastSlow = Math.max(0, e.slow);
  if (e.sunder > 0) e.sunder -= dt;
  if (e.brittle > 0) e.brittle -= dt;
  if (e.freeze > 0) e.freeze -= dt;
  if (e.stun > 0) e.stun -= dt;
  if (e.shockT > 0) e.shockT -= dt;
  if (e.type === 'sapper' && !e.planted) {
    if (e.plantT > 0) {
      e.plantT -= dt;
      if (e.plantT <= 0) { e.planted = true; const t = e.plantOn!; if (g.towers.includes(t)) { t.stunT = 5; g.events.push({ t: 'planted', e, tower: t }); } }
    } else for (const t of g.towers) if ((t.x - e.x) ** 2 + (t.z - e.z) ** 2 < 5) { e.plantT = 0.9; e.plantOn = t; g.events.push({ t: 'planting', e, tower: t }); break; }
  }
  if (e.type === 'gruk' && !(e.freeze > 0) && !(e.stun > 0)) { // Mire Stomp: every 12 s, a 0.7 s wind-up, then towers within 2.5 tiles are stunned 2 s
    const near = () => g.towers.filter(t => (t.x - e.x) ** 2 + (t.z - e.z) ** 2 < 6.25);
    if (e.stompW > 0) {
      e.stompW -= dt;
      if (e.stompW <= 0) { e.stompW = 0; e.stompT = 12; const hit = near(); for (const t of hit) t.stunT = Math.max(t.stunT, 2); g.events.push({ t: 'stomp', e, towers: hit }); }
    } else if ((e.stompT -= dt) <= 0 && near().length) { e.stompW = 0.7; g.events.push({ t: 'stomping', e }); }
  }
  const fighting = e.fighting = enemyCombat(g, e, dt);
  const held = e.freeze > 0 || e.stun > 0 || e.plantT > 0 || e.stompW > 0 || fighting;
  const bogs = (g.def as { bog?: number[][] }).bog;
  const bog = bogs && !e.def.air && bogs.some(([a, b]) => e.d > a * P.len && e.d < b * P.len) ? 0.7 : 1;
  e.d += (held ? 0 : e.def.speed * (e.slow > 0 ? e.slowF : 1) * bog) * dt;
  if (e.d >= P.len - 0.3) { reachCastle(g, e); return; }
  place(g, e, dt);
  if (e.type === 'shaman') {
    e.healT -= dt;
    if (e.healT <= 0) {
      e.healT = 2; let n = 0;
      for (const o of g.enemies) if (o.alive && o !== e && o.hp < o.maxHp && !(o.burn > 0 && has(g, 'flame.ever')) && centreDist2(o, e) < 6.8) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.08); n++; }
      if (n) g.events.push({ t: 'heal', e, n });
    }
  }
  if (e.burn > 0) { e.burn -= dt; hurt(g, e, 7 * dt * g.dotMul, 'true'); }
}
