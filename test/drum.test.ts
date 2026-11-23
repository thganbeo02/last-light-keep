import { describe, expect, it } from 'vitest';
import { DRUM } from '../src/content/barracks.ts';
import { drumPass, drumStat } from '../src/engine/drum.ts';
import { hurt, spawnEnemy } from '../src/engine/enemies.ts';
import { makeGame, type Game, type GameOptions } from '../src/engine/state.ts';
import { buildTower, specialise, stats, updateTower, upgradeTower, type Tower, type TowerType } from '../src/engine/towers.ts';
import { updateProjectiles } from '../src/engine/projectiles.ts';

const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const DT = 1 / 30;
const game = (o: Partial<GameOptions> = {}) => { const g = makeGame({ map: 0, ...o }); g.wave = 1; g.gold = 1e5; return g; };
const build = (g: Game, type: TowerType, plot: number) => buildTower(g, type, plot, { instant: true })!;
/** Two plots within reach of each other (the drum's level-1 radius is 5). */
const pair = (g: Game) => { for (let a = 0; a < g.spots.length; a++) for (let b = 0; b < g.spots.length; b++) if (a !== b && Math.hypot(g.spots[a].x - g.spots[b].x, g.spots[a].z - g.spots[b].z) < 4.5) return [a, b]; throw new Error('no pair'); };
const maxUp = (g: Game, t: Tower, k: 'a' | 'b') => { upgradeTower(g, t); upgradeTower(g, t); specialise(g, t, k); };

describe('drum stats match the 3.x game exactly', () => {
  const snap = (ids: string[]) => { const g = makeGame({ map: 0, skills: ids }), out: Record<string, unknown> = {}; for (const k of [1, 2, 3] as const) out[k] = drumStat(g, k); for (const k of ['a', 'b'] as const) for (const R of [1, 2, 3]) out[k + R] = drumStat(g, k, R); return JSON.stringify(out); };
  it('with no picks', () => expect(fnv(snap([]))).toBe(599133723)); // window.__drumStats([]), 2026-11-24
  it('with every drum stat pick', () => expect(fnv(snap(['drum.root', 'drum.beat', 'drum.hide', 'drum.hornm', 'drum.totem']))).toBe(2512283667));
});

describe('the boost pass', () => {
  it('a tower in a drum’s radius gets its haste; one outside gets nothing', () => {
    const g = game(), [a, b] = pair(g), d = build(g, 'drum', a), t = build(g, 'arrow', b);
    const far = g.spots.findIndex(s => Math.hypot(s.x - d.x, s.z - d.z) > 8), f = build(g, 'arrow', far);
    drumPass(g, DT);
    expect(t.haste).toBe(DRUM[1].haste); expect(f.haste).toBe(0); expect(d.haste).toBe(0);
  });
  it('a War Horn adds range; Barracks get haste but never range', () => {
    const g = game(), [a, b] = pair(g), d = build(g, 'drum', a); maxUp(g, d, 'a');
    const t = build(g, 'arrow', b); drumPass(g, DT);
    expect(t.rngB).toBe(drumStat(g, 'a').rngB);
    expect(stats(g, t).range).toBeCloseTo(6.6 * (1 + t.rngB));
  });
  it('a stunned or unfinished drum boosts nothing', () => {
    const g = game(), [a, b] = pair(g), d = build(g, 'drum', a), t = build(g, 'arrow', b);
    d.stunT = 1; drumPass(g, DT); expect(t.haste).toBe(0);
    d.stunT = 0; d.buildT = 0.5; drumPass(g, DT); expect(t.haste).toBe(0);
  });
  it('only the strongest drum counts, unless Twin Drums adds half the second', () => {
    for (const twin of [false, true]) {
      const g = game({ skills: twin ? ['drum.twin'] : [] }), [a, b] = pair(g), t = build(g, 'arrow', b), d1 = build(g, 'drum', a);
      upgradeTower(g, d1); upgradeTower(g, d1); // level 3: .30
      const c = g.spots.findIndex((s, i) => i !== a && i !== b && !s.used && !s.block && Math.hypot(s.x - t.x, s.z - t.z) < 4.5);
      if (c < 0) continue;
      build(g, 'drum', c); drumPass(g, DT);
      expect(t.haste).toBeCloseTo(twin ? 0.3 + 0.15 * 0.5 : 0.3);
    }
  });
  it('a Hex Totem makes enemies in its radius take more damage', () => {
    const g = game(), d = build(g, 'drum', 0); maxUp(g, d, 'b');
    const e = spawnEnemy(g, 'runner', 5); e.x = d.x + 1; e.z = d.z; e.hp = e.maxHp = 1000;
    drumPass(g, DT); expect(e.hex).toBe(drumStat(g, 'b').hex);
    hurt(g, e, 100, 'true'); expect(e.hp).toBeCloseTo(1000 - 100 * (1 + e.hex));
  });
  it('Last Stand gives every tower at least 30% haste while it lasts', () => {
    const g = game(), t = build(g, 'arrow', 0); g.standT = 5;
    drumPass(g, DT); expect(t.haste).toBe(0.3);
  });
});

describe('drum abilities and timed War Council effects', () => {
  it('Thunder stuns ground enemies in the radius every 12 s', () => {
    const g = game({ skills: ['drum.thund'] }), d = build(g, 'drum', 0), e = spawnEnemy(g, 'soldier', 5); e.x = d.x + 1; e.z = d.z;
    for (let i = 0; i < 12 * 30 - 2; i++) updateTower(g, d, DT);
    expect(e.stun).toBe(0); // not yet
    for (let i = 0; i < 4; i++) updateTower(g, d, DT);
    expect(e.stun).toBe(0.5);
  });
  it('a War Horn with Charge pushes enemies back 1 every 20 s', () => {
    const g = game({ skills: ['drum.charge'] }), d = build(g, 'drum', 0); maxUp(g, d, 'a');
    const e = spawnEnemy(g, 'soldier', 5); e.x = d.x + 1; e.z = d.z;
    for (let i = 0; i < 20 * 30 + 2; i++) updateTower(g, d, DT);
    expect(e.d).toBe(4);
  });
  it('Bleed (4/s), Frost Bite (2/s while slowed) and the mark wear off', () => {
    const g = game({ skills: ['frost.bite'] }), e = spawnEnemy(g, 'runner', 5); e.hp = e.maxHp = 1000;
    e.bleedT = 3; e.slow = 5; e.markT = 2;
    for (let i = 0; i < 30; i++) drumPass(g, DT);
    expect(1000 - e.hp).toBeCloseTo(6 * 1.1, 1); expect(e.markT).toBeCloseTo(1); // marked enemies take 10% more
  });
  it('Arrow Slits shoot the nearest enemy near the castle once a second for 8', () => {
    const g = game({ skills: ['kingdom.slits'] }), P = g.map.paths[0], e = spawnEnemy(g, 'runner', P.len - 2); e.hp = e.maxHp = 1000;
    for (let i = 0; i < 25; i++) { drumPass(g, DT); updateProjectiles(g, DT); } // the first arrow, fired at once
    expect(1000 - e.hp).toBe(8);
    for (let i = 0; i < 20; i++) { drumPass(g, DT); updateProjectiles(g, DT); } // the next, a second later
    expect(1000 - e.hp).toBe(16);
  });
});
