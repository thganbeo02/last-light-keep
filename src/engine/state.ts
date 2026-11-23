// The whole battle as plain data. The engine mutates it in place, tick by tick; the renderer only reads it and
// plays the events.
import { LIQ, MAPS } from '../content/maps.ts';
import { buildMap, H, W, type MapGeo } from './map.ts';
import { makeRng, type Rng } from './rng.ts';
import { UNLOCKS } from '../content/campaign.ts';
import type { Enemy } from './enemies.ts';
import type { FirePatch, IcePatch, Projectile } from './projectiles.ts';
import type { Soldier } from './soldiers.ts';
import type { Gate, Spot, Tower } from './towers.ts';

export type Mode = 'play' | 'watch';

export type GameEvent =
  | { t: 'spawn'; e: Enemy }
  | { t: 'kill'; e: Enemy; reward: number }
  | { t: 'gate'; e: Enemy; dmg: number }
  | { t: 'castleFalls' }
  | { t: 'lastStand' }
  | { t: 'heal'; e: Enemy; n: number }
  | { t: 'roar'; e: Enemy }
  | { t: 'shrug'; e: Enemy }
  | { t: 'planting'; e: Enemy; tower: Tower }
  | { t: 'planted'; e: Enemy; tower: Tower }
  | { t: 'staticCharge'; e: Enemy }
  | { t: 'shatter'; e: Enemy }
  | { t: 'shield'; e: Enemy }
  | { t: 'build' | 'upgrade' | 'specialise'; tower: Tower }
  | { t: 'sell'; tower: Tower; refund: number }
  | { t: 'fire'; tower: Tower; target: Enemy }
  | { t: 'blast'; at: { x: number; y: number; z: number }; r: number }
  | { t: 'soldierDown'; s: Soldier }
  | { t: 'holy'; s: Soldier; e: Enemy }
  | { t: 'enemyHit'; e: Enemy; s: Soldier };

export interface Game {
  rng: Rng; time: number;
  map: MapGeo; def: (typeof MAPS)[number]; liquidGround: number | null;
  mode: Mode;
  /** enemy health multiplier: the difficulty's in play, a random .65–.96 in Watch mode */
  diff: number;
  /** damage enemies deal to the castle and soldiers: the difficulty's in play, 1 in Watch mode */
  dmgMul: number;
  dotMul: number;
  skills: Set<string>;
  state: 'play' | 'victory' | 'fallen';
  /** which towers, levels and specialisations the campaign has opened (UNLOCKS) */
  gate: Gate;
  wave: number; gold: number; earned: number; defeated: number; built: number;
  hp: number; maxHp: number; soulHeal: number; standUsed: boolean; standT: number;
  nextId: number;
  enemies: Enemy[];
  spots: Spot[];
  towers: Tower[]; soldiers: Soldier[];
  projs: Projectile[]; firePatches: FirePatch[]; icePatches: IcePatch[];
  events: GameEvent[];
}

export interface GameOptions { map: number; mode?: Mode; seed?: number; diff?: number; dmgMul?: number; skills?: Iterable<string>; gate?: number }

export function makeGame(o: GameOptions): Game {
  const def = MAPS[o.map], liq = def.liquid as { kind: keyof typeof LIQ } | null, map = buildMap(o.map);
  return {
    rng: makeRng(o.seed ?? 1), time: 0,
    map, def, liquidGround: liq ? LIQ[liq.kind].ground : null,
    mode: o.mode ?? 'play', diff: o.diff ?? 1, dmgMul: o.dmgMul ?? 1, dotMul: 1,
    skills: new Set(o.mode === 'watch' ? [] : o.skills ?? []), // Watch mode plays without the War Council
    gate: UNLOCKS[o.mode === 'watch' ? UNLOCKS.length - 1 : o.gate ?? UNLOCKS.length - 1], // Watch mode has everything open
    state: 'play', wave: 0, gold: 0, earned: 0, defeated: 0, built: 0,
    hp: 100, maxHp: 100, soulHeal: 0, standUsed: false, standT: 0,
    nextId: 1, enemies: [],
    spots: map.plots.map(p => ({ ...p, used: false, block: 0 })), towers: [], soldiers: [],
    projs: [], firePatches: [], icePatches: [], events: [],
  };
}

/** War Council pick check, like main.js skH. */
export const has = (g: Game, id: string) => g.skills.has(id);

/** Ground height under a world point, like main.js groundY (roads .92, bridges 1.05, liquid its kind's ground). */
export function groundY(g: Game, x: number, z: number): number {
  const gx = Math.floor(x + W / 2), gz = Math.floor(z + H / 2);
  if (gx < 0 || gz < 0 || gx >= W || gz >= H) return -6;
  const i = gz * W + gx, t = g.map.tiles[i];
  if (t === 3) return 1.05;
  if (t === 2) return g.liquidGround ?? 0.7;
  if (t === 1) return 0.92;
  return g.map.heights[i];
}
