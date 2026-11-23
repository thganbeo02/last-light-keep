import { describe, expect, it } from 'vitest';
import { SK_STAT } from '../src/content/skills.ts';
import { TT, UPC } from '../src/content/towers.ts';
import { spawnEnemy, type Enemy } from '../src/engine/enemies.ts';
import { updateProjectiles } from '../src/engine/projectiles.ts';
import { makeGame, type Game, type GameOptions } from '../src/engine/state.ts';
import {
  buildTower, cantBuild, cycleAim, findTarget, mortarDead, rankCost, sellRate, sellTower, specialise, specStat, stats, tStat,
  towerActs, updateTower, upgradeTower, type AttackType, type Tower, type TowerType,
} from '../src/engine/towers.ts';

const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const DT = 1 / 30;
const game = (o: Partial<GameOptions> = {}) => { const g = makeGame({ map: 0, ...o }); g.wave = 1; g.gold = 10000; return g; };

describe('stats match the 3.x game exactly', () => {
  // the same structure window.__towerStats(ids) returns in 3.x; hashes recorded from it on 2026-11-24
  const snapshot = (ids: string[]) => {
    const g = makeGame({ map: 0, skills: ids }), out: Record<string, unknown> = {};
    for (const type of ['arrow', 'cannon', 'frost', 'tesla', 'flame'] as AttackType[]) {
      const r: Record<string, unknown> = out[type] = { up: UPC[type], rank: {} };
      for (const L of [1, 2, 3]) r[L] = tStat(g, type, L);
      for (const k of ['a', 'b'] as const) for (const R of [1, 2, 3]) { r[k + R] = specStat(g, type, k, R); if (R > 1) (r.rank as Record<string, number>)[k + R] = rankCost(type, k, R); }
    }
    out.sell = sellRate(g); out.mortarDead = mortarDead(g);
    return JSON.stringify(out);
  };
  it('with no War Council picks', () => expect(fnv(snapshot([]))).toBe(2913524451));
  it('with every stat pick, Treasury and Mortar Crews', () => expect(fnv(snapshot([...Object.keys(SK_STAT), 'kingdom.treasury', 'cannon.mortar']))).toBe(3608278869));
});

describe('building, upgrading and selling', () => {
  it('building pays the cost and blocks the plots around it', () => {
    const g = game(), t = buildTower(g, 'arrow', 0)!;
    expect(g.gold).toBe(10000 - TT.arrow.cost);
    expect(g.spots[0].used).toBe(true);
    const near = g.spots.filter((s, i) => i !== 0 && Math.abs(s.gx - g.spots[0].gx) <= 1 && Math.abs(s.gz - g.spots[0].gz) <= 1);
    near.forEach(s => expect(s.block).toBeGreaterThan(0));
    expect(cantBuild(g, 'cannon', 0)).toBe('plot taken');
    expect(t.mode).toBe('first');
  });
  it('needs the gold and an unlocked tower', () => {
    const g = game({ gate: 0 }); g.gold = 50;
    expect(cantBuild(g, 'arrow', 0)).toBe('not enough gold');
    g.gold = 999; expect(cantBuild(g, 'tesla', 0)).toBe('not unlocked');
    expect(buildTower(g, 'tesla', 0)).toBeNull();
  });
  it('upgrades to level 3, then offers the specialisation choice, then ranks to 3', () => {
    const g = game(), t = buildTower(g, 'cannon', 0)!;
    expect(upgradeTower(g, t)).toBe(true); expect(upgradeTower(g, t)).toBe(true);
    expect(t.lvl).toBe(3); expect(towerActs(g, t).choose).toBe(true);
    expect(upgradeTower(g, t)).toBe(false);
    expect(specialise(g, t, 'a')).toBe(true); expect(t.spec).toBe('a'); expect(t.rank).toBe(1); expect(t.lvl).toBe(4);
    expect(upgradeTower(g, t)).toBe(true); expect(upgradeTower(g, t)).toBe(true); expect(t.rank).toBe(3);
    expect(towerActs(g, t).max).toBe(true);
    expect(t.spend).toBe(TT.cannon.cost + UPC.cannon[0] + UPC.cannon[1] + 300 + rankCost('cannon', 'a', 2) + rankCost('cannon', 'a', 3));
  });
  it('an early gate caps levels and hides specialisations', () => {
    const g = game({ gate: 0 }), t = buildTower(g, 'arrow', 0)!;
    upgradeTower(g, t); expect(t.lvl).toBe(2); expect(towerActs(g, t).max).toBe(true); expect(upgradeTower(g, t)).toBe(false);
  });
  it('Longbow, Deep Freeze and Inferno switch to aiming at the strongest', () => {
    for (const [type, k] of [['arrow', 'a'], ['frost', 'a'], ['flame', 'b']] as [TowerType, 'a' | 'b'][]) {
      const g = game(), t = buildTower(g, type, 0)!; upgradeTower(g, t); upgradeTower(g, t); specialise(g, t, k); expect(t.mode).toBe('strong');
    }
  });
  it('selling refunds 70% of everything spent and frees the plots', () => {
    const g = game(), t = buildTower(g, 'arrow', 0)!; upgradeTower(g, t);
    const before = g.gold; sellTower(g, t);
    expect(g.gold - before).toBe(Math.round((TT.arrow.cost + UPC.arrow[0]) * 0.7));
    expect(g.spots.every(s => !s.used && s.block === 0)).toBe(true);
  });
});

describe('targeting', () => {
  const setup = () => { const g = game(), t = buildTower(g, 'arrow', 0, { instant: true })!; return { g, t }; };
  const near = (g: Game, t: Tower, type: Parameters<typeof spawnEnemy>[1], hp: number) => {
    // place the enemy at the sample closest to the tower so it's in range
    const s = g.map.samples.reduce((a, b) => ((b.x - t.x) ** 2 + (b.z - t.z) ** 2 < (a.x - t.x) ** 2 + (a.z - t.z) ** 2 ? b : a));
    const e = spawnEnemy(g, type, s.d, s.path); e.hp = hp; return e;
  };
  it('first = furthest along (bosses count 3 more), last, strongest and closest', () => {
    const { g, t } = setup(), a = near(g, t, 'runner', 10), b = near(g, t, 'runner', 50);
    a.d += 1; b.d -= 1;
    expect(findTarget(g, t, 99)).toBe(a);
    cycleAim(t); expect(t.mode).toBe('last'); expect(findTarget(g, t, 99)).toBe(b);
    cycleAim(t); expect(findTarget(g, t, 99)).toBe(b); // strongest
  });
  it('archers hit flyers; cannons and flames never target them', () => {
    const { g, t } = setup(), bat = near(g, t, 'flyer', 10);
    expect(findTarget(g, t, 99)).toBe(bat);
    const c = buildTower(g, 'cannon', 5, { instant: true })!; expect(findTarget(g, c, 99)).toBeNull();
  });
  it('the Siege Mortar can’t fire inside its dead zone', () => {
    const g = game(), c = buildTower(g, 'cannon', 0, { instant: true })!; upgradeTower(g, c); upgradeTower(g, c); specialise(g, c, 'a');
    const e = spawnEnemy(g, 'soldier', 5); e.x = c.x + 1; e.z = c.z;
    expect(findTarget(g, c, 99)).toBeNull();
    e.x = c.x + 4; expect(findTarget(g, c, 99)).toBe(e);
  });
});

describe('firing', () => {
  /** Fires one tower at one enemy standing still, until it has been hit at least once. */
  const duel = (type: TowerType, prep: (g: Game, t: Tower) => void = () => {}, enemy: Parameters<typeof spawnEnemy>[1] = 'knight') => {
    const g = game(), t = buildTower(g, type, 0, { instant: true })!; prep(g, t);
    const s = g.map.samples.reduce((a, b) => ((b.x - t.x) ** 2 + (b.z - t.z) ** 2 < (a.x - t.x) ** 2 + (a.z - t.z) ** 2 ? b : a));
    const e = spawnEnemy(g, enemy, s.d, s.path); e.hp = e.maxHp = 1e6; t.cool = 0;
    for (let i = 0; i < 90 && e.hp === 1e6; i++) { g.time += DT; updateTower(g, t, DT); updateProjectiles(g, DT); }
    return { g, t, e };
  };
  it('an arrow lands as physical damage against armour', () => {
    const { g, t, e } = duel('arrow');
    expect(1e6 - e.hp).toBeCloseTo(stats(g, t).dmg * (1 - e.def.armor));
  });
  it('a cannonball splashes, full damage at the centre falling to half at the edge', () => {
    const { g, t, e } = duel('cannon');
    const dealt = 1e6 - e.hp, full = stats(g, t).dmg * (1 - e.def.armor);
    expect(dealt).toBeLessThanOrEqual(full + 1e-6); expect(dealt).toBeGreaterThanOrEqual(full * 0.5);
  });
  it('a frost shard deals magic damage and slows to 55% − 7% per level', () => {
    const { e } = duel('frost');
    expect(e.slow).toBeCloseTo(2.5); expect(e.slowF).toBeCloseTo(0.48);
  });
  it('Tesla chains to 2 + level enemies, losing 28% per jump', () => {
    const g = game(), t = buildTower(g, 'tesla', 0, { instant: true })!;
    const s = g.map.samples.reduce((a, b) => ((b.x - t.x) ** 2 + (b.z - t.z) ** 2 < (a.x - t.x) ** 2 + (a.z - t.z) ** 2 ? b : a));
    const es = [0, 0.5, 1, 1.5, 2].map(k => { const e = spawnEnemy(g, 'runner', s.d + k, s.path); e.hp = e.maxHp = 1e6; return e; });
    t.cool = 0; updateTower(g, t, DT);
    const hits = es.filter(e => e.hp < 1e6).map(e => 1e6 - e.hp).sort((a, b) => b - a);
    expect(hits.length).toBe(TT.tesla.chain);
    expect(hits[1] / hits[0]).toBeCloseTo(0.72);
  });
  it('Flame sets everything in its cone burning', () => {
    const { e } = duel('flame', () => {}, 'soldier');
    expect(e.burn).toBeGreaterThan(1.5);
  });
  it('a tower rising from the ground waits until it is 75% built', () => {
    const g = game(), t = buildTower(g, 'arrow', 0)!;
    const e = spawnEnemy(g, 'runner', g.map.samples[0].d); e.x = t.x + 1; e.z = t.z; t.cool = 0;
    for (let i = 0; i < 20; i++) updateTower(g, t, DT);
    expect(t.shots).toBe(0);
    for (let i = 0; i < 10; i++) updateTower(g, t, DT);
    expect(t.shots).toBe(1);
  });
  it('a tower knocked out by a Sapper holds fire', () => {
    const g = game(), t = buildTower(g, 'arrow', 0, { instant: true })!; t.stunT = 1;
    const e: Enemy = spawnEnemy(g, 'runner', 1); e.x = t.x + 1; e.z = t.z; t.cool = 0;
    for (let i = 0; i < 25; i++) updateTower(g, t, DT);
    expect(t.shots).toBe(0);
  });
});
