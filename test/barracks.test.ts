import { describe, expect, it } from 'vitest';
import { BARR } from '../src/content/barracks.ts';
import { ATK } from '../src/content/enemies.ts';
import { spawnEnemy, updateEnemy, type Enemy } from '../src/engine/enemies.ts';
import { updateProjectiles } from '../src/engine/projectiles.ts';
import { barrStat, rallyPick, setRally, updateSoldier } from '../src/engine/soldiers.ts';
import { makeGame, type Game, type GameOptions } from '../src/engine/state.ts';
import { buildTower, sellTower, specialise, updateTower, upgradeTower, type Tower } from '../src/engine/towers.ts';
import type { EnemyType } from '../src/engine/waves.ts';

const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const DT = 1 / 30;
const game = (o: Partial<GameOptions> = {}) => { const g = makeGame({ map: 0, ...o }); g.wave = 1; g.gold = 10000; return g; };
/** One tick in main.js updateGame order: enemies, soldiers, towers, projectiles. */
const tick = (g: Game) => {
  g.time += DT;
  for (const e of g.enemies) if (e.alive) updateEnemy(g, e, DT);
  for (const s of g.soldiers) if (s.alive) updateSoldier(g, s, DT);
  g.soldiers = g.soldiers.filter(s => s.alive);
  for (const t of g.towers) updateTower(g, t, DT);
  g.enemies = g.enemies.filter(e => e.alive);
  updateProjectiles(g, DT);
};
const run = (g: Game, secs: number) => { for (let i = 0; i < secs * 30; i++) tick(g); };
const barracks = (g: Game, plot = 0) => buildTower(g, 'barracks', plot, { instant: true })!;
/** An enemy on the road just short of the rally point, walking into it. */
const walker = (g: Game, t: Tower, type: EnemyType, before = 2) => {
  const s = g.map.samples.reduce((a, b) => ((b.x - t.rally.x) ** 2 + (b.z - t.rally.z) ** 2 < (a.x - t.rally.x) ** 2 + (a.z - t.rally.z) ** 2 ? b : a));
  return spawnEnemy(g, type, s.d - before, s.path);
};

describe('soldier stats match the recorded snapshot', () => { // 3.x numbers, then 3.3's healing buff (Paladins 10%, Field Medic 8%)
  const ids = ['barracks.root', 'barracks.pala', 'barracks.gamb', 'barracks.drill', 'barracks.medic', 'barracks.horn', 'barracks.fourth', 'barracks.rang', 'barracks.right'];
  const snap = (list: string[]) => { const g = makeGame({ map: 0, skills: list }), out: Record<string, unknown> = {}; for (const k of [1, 2, 3] as const) out[k] = barrStat(g, k); for (const k of ['a', 'b'] as const) for (const R of [1, 2, 3]) out[k + R] = barrStat(g, k, R); return JSON.stringify(out); };
  it('with no picks', () => expect(fnv(snap([]))).toBe(238757196)); // 2026-11-25, after the healing buff
  it('with every Barracks stat pick', () => expect(fnv(snap(ids))).toBe(2632130205));
});

describe('the Barracks', () => {
  it('puts its soldiers on the road nearest to it', () => {
    const g = game(), t = barracks(g);
    expect(t.soldiers.length).toBe(BARR[1].n);
    expect(g.map.samples.some(s => s.x === t.rally.x && s.z === t.rally.z)).toBe(true);
    for (const s of t.soldiers) expect(Math.hypot(s.x - t.rally.x, s.z - t.rally.z)).toBeCloseTo(0.55);
  });
  it('soldiers stop an enemy and cut it down', () => {
    const g = game(), t = barracks(g), e = walker(g, t, 'runner');
    run(g, 1.5);
    expect(e.fighting || !e.alive).toBe(true);
    const d = e.d; run(g, 0.5);
    if (e.alive) expect(e.d).toBeCloseTo(d, 1);
    run(g, 10); expect(e.alive).toBe(false);
  });
  it('an enemy fought by two soldiers doesn’t spin (the 3.1 fix)', () => {
    // two soldiers, as Militia Call always sends: in 3.x before the fix they circled the enemy and it turned to follow
    const g = game(), t = barracks(g); t.soldiers[2].alive = false; t.resp[2] = 99;
    const e = walker(g, t, 'golem'); e.hp = e.maxHp = 1e6;
    run(g, 3);
    let turned = 0, prev = e.heading;
    for (let i = 0; i < 90; i++) { tick(g); turned += Math.abs(e.heading - prev); prev = e.heading; }
    expect(e.fighting).toBe(true);
    expect(turned).toBeLessThan(0.5); // radians in 3 s; the old bug turned it several full circles
  });
  it('a fallen soldier comes back after the respawn time', () => {
    const g = game(), t = barracks(g), s = t.soldiers[0], id = s.id;
    s.hp = 0.1; walker(g, t, 'boss', 1).hp = 1e9; // the Warlord hits hard enough
    for (let i = 0; i < 30 * 20 && t.soldiers[0].id === id; i++) tick(g);
    expect(t.soldiers[0].id).not.toBe(id);
  });
  it('soldiers regain 5% health a second after 2 s out of combat', () => {
    const g = game(), t = barracks(g), s = t.soldiers[0]; s.hp = s.maxHp / 4;
    run(g, 2); const h = s.hp; run(g, 1);
    expect(s.hp - h).toBeCloseTo(s.maxHp * 0.05, 0);
  });
  it('upgrading replaces the soldiers with the next kind; selling sends them home', () => {
    const g = game(), t = barracks(g); upgradeTower(g, t);
    expect(t.soldiers.every(s => s.type === BARR[2].unit)).toBe(true);
    sellTower(g, t); expect(t.soldiers.every(s => !s.alive)).toBe(true);
  });
});

describe('enemies fight back', () => {
  it('each hit follows the attack table, scaled by difficulty', () => {
    const g = game({ dmgMul: 1.25 }), t = barracks(g), e = walker(g, t, 'soldier'); e.hp = e.maxHp = 1e6;
    run(g, 4);
    const lost = t.soldiers.reduce((a, s) => a + (s.maxHp - s.hp), 0);
    expect(lost).toBeGreaterThan(0);
    expect(lost % (ATK.soldier[0] as number * 1.25)).toBeCloseTo(0, 5); // whole hits of 6 × 1.25
  });
  it('a Boar Rider charges through its first block for 12', () => {
    const g = game(), t = barracks(g), e = walker(g, t, 'rider'); e.hp = e.maxHp = 1e6;
    run(g, 2);
    expect(e.charged).toBe(true);
    expect(t.soldiers.some(s => s.maxHp - s.hp >= 12)).toBe(true);
  });
  it('a Shaman shoots soldiers from 3 tiles away without stopping (3.1 stopped, and could stall a battle)', () => {
    const g = game(), t = barracks(g), e: Enemy = walker(g, t, 'shaman', 3.5); e.hp = e.maxHp = 1e6;
    for (const s of t.soldiers) s.st = { ...s.st, rad: 0 }; // soldiers won't step out to fight it
    let shotWalking = 0, shotStill = 0;
    for (let i = 0; i < 120; i++) { const d = e.d, shooting = e.shooting; tick(g); if (shooting && e.shooting && !e.blocker && !e.stun && !e.freeze) e.d > d ? shotWalking++ : shotStill++; }
    expect(shotWalking).toBeGreaterThan(10); expect(shotStill).toBe(0);
    expect(t.soldiers.some(s => s.hp < s.maxHp)).toBe(true);
  });
});

describe('Rangers', () => {
  const rangers = () => { const g = game(), t = barracks(g); upgradeTower(g, t); upgradeTower(g, t); specialise(g, t, 'b'); return { g, t }; };
  it('shoot from their spots', () => {
    const { g, t } = rangers(), e = walker(g, t, 'runner', 3); e.hp = e.maxHp = 1e6;
    run(g, 2); expect(e.hp).toBeLessThan(1e6);
  });
  it('can stand off the road (Overwatch), where they shoot and never block', () => {
    const { g, t } = rangers();
    let spot = null; // find open ground near the Barracks, away from the road
    for (let dx = -3; dx <= 3 && !spot; dx += 0.5) for (let dz = -3; dz <= 3 && !spot; dz += 0.5) { const r = rallyPick(g, t, t.x + dx, t.z + dz); if (r?.over) spot = r; }
    expect(spot).not.toBeNull();
    setRally(t, spot!);
    const e = walker(g, t, 'runner', 4); e.hp = e.maxHp = 1e6;
    run(g, 4);
    expect(e.blocker).toBeNull(); expect(e.hp).toBeLessThan(1e6);
  });
  it('other soldiers can only rally on the road near the Barracks', () => {
    const g = game(), t = barracks(g);
    expect(rallyPick(g, t, t.x + 30, t.z)).toBeNull();
  });
});
