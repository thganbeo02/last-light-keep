// The whole battle as plain data. The engine mutates it in place, tick by tick; the renderer only reads it and
// plays the events.
import { LIQ, MAPS } from '../content/maps.ts';
import { buildMap, H, W, type MapGeo } from './map.ts';
import { makeRng, range, type Rng } from './rng.ts';
import type { Spawn } from './waves.ts';
import { DIFFS, UNLOCKS } from '../content/campaign.ts';
import type { Enemy } from './enemies.ts';
import type { HeroAbility, HeroKey } from '../content/heroes.ts';
import { addHero, type Hero } from './heroes.ts';
import type { FirePatch, IcePatch, Projectile } from './projectiles.ts';
import type { Soldier } from './soldiers.ts';
import type { CatapultFx, SpellKey } from './spells.ts';
import type { Gate, Spot, Tower } from './towers.ts';

export type Mode = 'play' | 'watch';

export type GameEvent =
  | { t: 'spawn'; e: Enemy }
  | { t: 'kill'; e: Enemy; reward: number; embers?: number }
  | { t: 'gate'; e: Enemy; dmg: number }
  | { t: 'castleFalls' }
  | { t: 'lastStand' }
  | { t: 'heal'; e: Enemy; healed: Enemy[] }
  | { t: 'drumThunder'; tower: Tower }
  | { t: 'drumCharge'; tower: Tower; pushed: Enemy[] }
  | { t: 'heroCast'; k: HeroAbility; at: { x: number; z: number }; eruptions?: Enemy[] }
  | { t: 'heroHit'; s: Soldier; e: Enemy }
  | { t: 'heroPush'; e: Enemy }
  | { t: 'heroMoveBlocked'; why: 'shield' | 'route' }
  | { t: 'roar'; e: Enemy }
  | { t: 'stomping'; e: Enemy }
  | { t: 'stomp'; e: Enemy; towers: Tower[] }
  | { t: 'shrug'; e: Enemy }
  | { t: 'planting'; e: Enemy; tower: Tower }
  | { t: 'planted'; e: Enemy; tower: Tower }
  | { t: 'staticCharge'; e: Enemy }
  | { t: 'shatter'; e: Enemy }
  | { t: 'shield'; e: Enemy }
  | { t: 'build' | 'upgrade' | 'specialise'; tower: Tower }
  | { t: 'sell'; tower: Tower; refund: number }
  | { t: 'fire'; tower: Tower; target: Enemy; chains?: Enemy[][] } // chains: a Tesla's jumps, for drawing
  | { t: 'surge'; tower: Tower; e: Enemy }
  | { t: 'flashover'; tower: Tower; from: Enemy; e: Enemy }
  | { t: 'blast'; at: { x: number; y: number; z: number }; r: number }
  | { t: 'soldierDown'; s: Soldier }
  | { t: 'holy'; s: Soldier; e: Enemy }
  | { t: 'enemyHit'; e: Enemy; s: Soldier }
  | { t: 'cast'; k: SpellKey; at: { x: number; z: number } }
  | { t: 'wave'; n: number; bosses: number }
  | { t: 'cleared'; n: number; bonus: number }
  | { t: 'victory'; stars: number };

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
  /** the wave queue, the time to the next spawn, the countdown to the next wave (play), Watch mode's pacing and AI timer */
  spawnQ: Spawn[]; spawnT: number; sinceSpawn: number; countdown: number; clearPaid: boolean; waveGap: number; aiT: number;
  /** Watch mode's player (src/engine/ai.ts aiThink) */
  ai?: (g: Game) => void;
  hp: number; maxHp: number; soulHeal: number; standUsed: boolean; standT: number; slitT: number;
  nextId: number;
  enemies: Enemy[];
  spots: Spot[];
  towers: Tower[]; soldiers: Soldier[];
  hero: Hero | null;
  projs: Projectile[]; firePatches: FirePatch[]; icePatches: IcePatch[];
  /** spells open in this battle, cooldowns left, catapults in flight, and whether any spell was cast (3.x records it but never reads it) */
  spells: SpellKey[]; scd: Record<string, number>; spellFx: CatapultFx[]; spellUsed: boolean;
  events: GameEvent[];
}

export interface GameOptions { map: number; mode?: Mode; seed?: number; diff?: number; dmgMul?: number; skills?: Iterable<string>; gate?: number; spells?: SpellKey[]; hero?: HeroKey;
  /** a played battle's difficulty: sets diff and dmgMul from DIFFS (casual 1×, normal 1.25×, impossible 1.5×) */
  difficulty?: 'casual' | 'normal' | 'impossible' }

export function makeGame(o: GameOptions): Game {
  const def = MAPS[o.map], liq = def.liquid as { kind: keyof typeof LIQ } | null, map = buildMap(o.map);
  const g: Game = {
    rng: makeRng(o.seed ?? 1), time: 0,
    map, def, liquidGround: liq ? LIQ[liq.kind].ground : null,
    mode: o.mode ?? 'play', diff: o.diff ?? DIFFS.find(d => d.k === o.difficulty)?.mul ?? 1, dmgMul: o.dmgMul ?? DIFFS.find(d => d.k === o.difficulty)?.dmg ?? 1, dotMul: 1,
    skills: new Set(o.mode === 'watch' ? [] : o.skills ?? []), // Watch mode plays without the War Council
    gate: UNLOCKS[o.mode === 'watch' ? UNLOCKS.length - 1 : o.gate ?? UNLOCKS.length - 1], // Watch mode has everything open
    state: 'play', wave: 0, gold: 0, earned: 0, defeated: 0, built: 0,
    spawnQ: [], spawnT: 0, sinceSpawn: 0, countdown: 25, clearPaid: true, waveGap: 0, aiT: 0,
    hp: 100, maxHp: 100, soulHeal: 0, standUsed: false, standT: 0, slitT: 0,
    nextId: 1, enemies: [],
    spots: map.plots.map(p => ({ ...p, used: false, block: 0 })), towers: [], soldiers: [], hero: null,
    projs: [], firePatches: [], icePatches: [],
    spells: o.mode === 'watch' ? [] : o.spells ?? [], scd: {}, spellFx: [], spellUsed: false,
    events: [],
  };
  // starting gold and castle health; Watch mode instead picks a random toughness and builds its own opening (src/engine/ai.ts)
  if (g.mode === 'play') g.gold = def.gold + (has(g, 'kingdom.root') ? 10 : 0) + (has(g, 'kingdom.chest') ? 20 : 0) + (has(g, 'kingdom.treasury') ? 50 : 0);
  else if (o.diff == null) g.diff = range(g.rng, 0.85, 1.25) / 1.3;
  g.maxHp = g.hp = 100 + (has(g, 'kingdom.walls') ? 10 : 0);
  if (g.mode === 'play' && o.hero) addHero(g, o.hero);
  return g;
}

/** War Council pick check, like main.js skH. */
export const has = (g: Pick<Game, 'skills'>, id: string) => g.skills.has(id);

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
