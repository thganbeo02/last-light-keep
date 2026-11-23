import { describe, expect, it } from 'vitest';
import { MILITIA, SPELLS } from '../src/content/spells.ts';
import { spawnEnemy, updateEnemy } from '../src/engine/enemies.ts';
import { updateProjectiles } from '../src/engine/projectiles.ts';
import { updateSoldier } from '../src/engine/soldiers.ts';
import { cantCast, castSpell, spellsFor, spellSpot, spellsTick } from '../src/engine/spells.ts';
import { makeGame, type Game, type GameOptions } from '../src/engine/state.ts';

const DT = 1 / 30;
const game = (o: Partial<GameOptions> = {}) => { const g = makeGame({ map: 0, spells: ['militia', 'catapult', 'nova'], ...o }); g.wave = 1; return g; };
const tick = (g: Game) => {
  g.time += DT;
  for (const e of g.enemies) if (e.alive) updateEnemy(g, e, DT);
  for (const s of g.soldiers) if (s.alive) updateSoldier(g, s, DT);
  spellsTick(g, DT);
  g.soldiers = g.soldiers.filter(s => s.alive); g.enemies = g.enemies.filter(e => e.alive);
  updateProjectiles(g, DT);
};
const run = (g: Game, secs: number) => { for (let i = 0; i < Math.round(secs * 30); i++) tick(g); };
const roadAt = (g: Game, d: number) => { const s = g.map.samples.find(x => x.d >= d)!; return { x: s.x, z: s.z, d: s.d }; };

describe('availability', () => {
  it('Militia and Catapult open at 1-2, Frost Nova at 3-1; testing mode opens all', () => {
    expect(spellsFor(0)).toEqual([]);
    expect(spellsFor(1)).toEqual(['militia', 'catapult']);
    expect(spellsFor(7)).toEqual(['militia', 'catapult', 'nova']);
    expect(spellsFor(0, true)).toEqual(['militia', 'catapult', 'nova']);
  });
  it('waits for the first wave, then for its cooldown; Watch mode has none', () => {
    const g = game(); g.wave = 0;
    expect(cantCast(g, 'nova')).toBe('ready once the first wave is called');
    g.wave = 1; expect(castSpell(g, 'nova', roadAt(g, 10))).toBe(true);
    expect(cantCast(g, 'nova')).toBe('cooling down');
    run(g, SPELLS.nova.cd - 0.5); expect(cantCast(g, 'nova')).toBe('cooling down');
    run(g, 1); expect(cantCast(g, 'nova')).toBeNull();
    expect(cantCast(game({ mode: 'watch' }), 'nova')).toBe('not available');
  });
  it('Militia snap to the road within 2; other spells hit any ground on the map', () => {
    const g = game(), r = roadAt(g, 10);
    const snapped = spellSpot(g, 'militia', r.x + 1, r.z)!; // the nearest road sample to the tap
    expect(g.map.samples.some(s => s.x === snapped.x && s.z === snapped.z)).toBe(true);
    expect(Math.hypot(snapped.x - r.x - 1, snapped.z - r.z)).toBeLessThanOrEqual(1);
    expect(spellSpot(g, 'militia', r.x + 9, r.z + 9)).toBeNull();
    expect(spellSpot(g, 'nova', r.x + 3, r.z)).toEqual({ x: r.x + 3, z: r.z });
    expect(spellSpot(g, 'nova', 99, 99)).toBeNull();
  });
});

describe('the spells', () => {
  it('Militia Call: two militiamen hold the road, then leave after 12 s', () => {
    const g = game(), r = roadAt(g, 12);
    castSpell(g, 'militia', r);
    expect(g.soldiers.length).toBe(MILITIA.n);
    expect(g.soldiers.every(s => s.type === 'militia' && s.maxHp === MILITIA.hp)).toBe(true);
    const e = spawnEnemy(g, 'soldier', r.d - 2); e.hp = e.maxHp = 1e6;
    run(g, 2); expect(e.fighting).toBe(true);
    run(g, 10.5); expect(g.soldiers.length).toBe(0); expect(e.blocker).toBeNull();
  });
  it('Catapult Barrage: five boulders land around 3 s, 60 damage each and a .5 s stun', () => {
    const g = game(), r = roadAt(g, 20), e = spawnEnemy(g, 'soldier', r.d); e.hp = e.maxHp = 1e6; e.def = { ...e.def, speed: 0 };
    castSpell(g, 'catapult', { x: e.x, z: e.z });
    run(g, 2.9); expect(e.hp).toBe(1e6);
    run(g, 0.6);
    const dealt = 1e6 - e.hp, per = 60 * (1 - e.def.armor);
    expect(dealt / per).toBeCloseTo(Math.round(dealt / per)); // whole boulders
    expect(Math.round(dealt / per)).toBeGreaterThanOrEqual(1); expect(Math.round(dealt / per)).toBeLessThanOrEqual(5);
    expect(g.projs.length).toBe(0); expect(g.spellFx.length).toBe(0);
  });
  it('Frost Nova freezes ground enemies within 2.5 for 2.5 s; bosses are slowed to half instead', () => {
    const g = game(), r = roadAt(g, 20);
    const near = spawnEnemy(g, 'soldier', r.d), far = spawnEnemy(g, 'soldier', r.d + 6), boss = spawnEnemy(g, 'boss', r.d), bat = spawnEnemy(g, 'flyer', r.d);
    castSpell(g, 'nova', { x: near.x, z: near.z });
    expect(near.freeze).toBe(2.5); expect(far.freeze).toBe(0); expect(bat.freeze).toBe(0);
    expect(boss.freeze).toBe(0); expect(boss.slow).toBe(2.5); expect(boss.slowF).toBe(0.5);
  });
});
