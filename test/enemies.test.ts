import { describe, expect, it } from 'vitest';
import { ED } from '../src/content/enemies.ts';
import { centreDist2, hurt, killReward, spawnEnemy, updateEnemy, type Enemy } from '../src/engine/enemies.ts';
import { smoothPath } from '../src/engine/map.ts';
import { makeGame, type Game, type GameOptions } from '../src/engine/state.ts';
import { buildTower } from '../src/engine/towers.ts';
import type { EnemyType } from '../src/engine/waves.ts';

const DT = 1 / 30;
const game = (o: Partial<GameOptions> = {}) => { const g = makeGame({ map: 0, ...o }); g.wave = 1; return g; };
/** Runs only this enemy until it leaves the field or `secs` pass; returns the seconds it took. */
const run = (g: Game, e: Enemy, secs: number) => { let t = 0; while (e.alive && t < secs) { g.time += DT; updateEnemy(g, e, DT); t += DT; } return t; };
const one = (g: Game, type: EnemyType, d = 0, path = 0) => spawnEnemy(g, type, d, path);

describe('walking the road', () => {
  it('moves at its speed, spread across the road but never off it', () => {
    const g = game(), e = one(g, 'soldier', 10);
    const c = smoothPath(g.map.paths[0], 10);
    expect(Math.hypot(e.x - c.x, e.z - c.z)).toBeCloseTo(Math.abs(e.lat));
    expect(Math.abs(e.lat)).toBeLessThanOrEqual(0.55);
    run(g, e, 2);
    expect(e.d).toBeCloseTo(10 + ED.soldier.speed * 2, 1);
  });
  it('reaches the gate .3 before the road ends and hits the castle for its damage × difficulty', () => {
    const g = game({ dmgMul: 1.25 }), e = one(g, 'brute');
    const t = run(g, e, 999), len = g.map.paths[0].len;
    expect(t).toBeCloseTo((len - 0.3) / ED.brute.speed, 0);
    expect(e.alive).toBe(false);
    expect(g.hp).toBe(100 - Math.round(ED.brute.dmg * 1.25));
    expect(g.events.some(ev => ev.t === 'gate')).toBe(true);
  });
  it('the castle falls at 0, and Last Stand fires once at 25 or below', () => {
    const g = game({ skills: ['kingdom.stand'] }); g.hp = 30;
    run(g, one(g, 'brute'), 999);
    expect(g.hp).toBe(18); expect(g.standUsed).toBe(true); expect(g.standT).toBe(10);
    g.hp = 5; run(g, one(g, 'brute'), 999);
    expect(g.hp).toBe(0); expect(g.state).toBe('fallen');
  });
  it('bosses keep close to the middle of the road', () => {
    const g = game(); for (let i = 0; i < 50; i++) expect(Math.abs(one(g, 'boss').lat)).toBeLessThanOrEqual(0.11);
  });
  it('flyers fly, at their own height', () => {
    const g = game(), bat = one(g, 'flyer', 5), wraith = one(g, 'wraith', 5);
    expect(bat.y).toBeGreaterThan(2.3); expect(wraith.y).toBeLessThan(bat.y + 0.7);
  });
  it('the bog on Mire’s Edge slows ground enemies to 70%', () => {
    const g = game({ map: 3 }), P = g.map.paths[0], [a] = (g.def as { bog: number[][] }).bog[0];
    const e = one(g, 'soldier', a * P.len + 1); run(g, e, 1);
    expect(e.d - (a * P.len + 1)).toBeCloseTo(ED.soldier.speed * 0.7, 1);
  });
  it('freeze and stun hold it still; a slow multiplies its speed', () => {
    const g = game(), e = one(g, 'soldier', 5);
    e.freeze = 1; run(g, e, 0.5); expect(e.d).toBe(5);
    e.freeze = 0; e.stun = 0.5; run(g, e, 0.4); expect(e.d).toBe(5);
    e.stun = 0; e.slow = 5; e.slowF = 0.5; const d0 = e.d; run(g, e, 1);
    expect(e.d - d0).toBeCloseTo(ED.soldier.speed * 0.5, 1);
  });
});

describe('damage', () => {
  const fresh = (type: EnemyType, o: Partial<GameOptions> = {}) => { const g = game(o); const e = one(g, type, 5); e.hp = e.maxHp = 1000; return { g, e }; };
  it('armour blocks physical, magic resist blocks magic, true ignores both', () => {
    const { g, e } = fresh('knight'); // armor .7
    hurt(g, e, 100, 'phys'); expect(e.hp).toBeCloseTo(1000 - 30);
    hurt(g, e, 100, 'magic'); expect(e.hp).toBeCloseTo(970 - 100);
    const s = fresh('shaman'); hurt(s.g, s.e, 100, 'magic'); expect(s.e.hp).toBeCloseTo(1000 - 40); // mr .6
    hurt(s.g, s.e, 100, 'true'); expect(s.e.hp).toBeCloseTo(960 - 100);
  });
  it('sunder halves the block, pierce removes part of it, Ice Brittle pierces half once', () => {
    const { g, e } = fresh('knight');
    e.sunder = 1; hurt(g, e, 100, 'phys'); expect(e.hp).toBeCloseTo(1000 - 65);
    e.sunder = 0; hurt(g, e, 100, 'phys', 0.5); expect(e.hp).toBeCloseTo(935 - 65);
    e.iceBrittle = true; e.freeze = 1; hurt(g, e, 100, 'phys'); expect(e.hp).toBeCloseTo(870 - 65);
    expect(e.iceBrittle).toBe(false);
  });
  it('brittle doubles damage while slowed; hex and the hunter’s mark add on', () => {
    const { g, e } = fresh('runner');
    e.brittle = 1; e.slow = 1; hurt(g, e, 10); expect(e.hp).toBeCloseTo(980);
    e.brittle = 0; e.hex = 0.2; e.markT = 1; hurt(g, e, 10); expect(e.hp).toBeCloseTo(980 - 10 * 1.2 * 1.1);
  });
  it('Scorched Earth and Wither shave armour off burning and hexed enemies', () => {
    const a = fresh('knight', { skills: ['flame.scorch'] }); a.e.burn = 1; hurt(a.g, a.e, 100, 'phys'); expect(a.e.hp).toBeCloseTo(1000 - 100 * (1 - 0.7 * 0.85));
    const b = fresh('knight', { skills: ['drum.wither'] }); b.e.hex = 0.1; hurt(b.g, b.e, 100, 'phys'); expect(b.e.hp).toBeCloseTo(1000 - 100 * 0.4 * 1.1);
  });
  it('burning deals 7 true damage per second', () => {
    const { g, e } = fresh('knight'); e.burn = 1; run(g, e, 1);
    expect(1000 - e.hp).toBeCloseTo(7, 0);
  });
  it('a kill pays reward × 1.6, +5% per wave after the first, +6% with Tax', () => {
    const g = game(); g.wave = 5; const e = one(g, 'brute');
    expect(killReward(g, e)).toBe(Math.round(15 * 1.6 * 1.2));
    const gold = g.gold; hurt(g, e, 1e6); expect(g.gold - gold).toBe(Math.round(15 * 1.6 * 1.2)); expect(g.defeated).toBe(1);
    const t = game({ skills: ['kingdom.tax'] }); t.wave = 5; expect(killReward(t, one(t, 'brute'))).toBe(Math.round(15 * 1.6 * 1.2 * 1.06));
  });
  it('Static Charge, Shatter and Wildfire hit neighbours when an enemy dies', () => {
    const g = game({ skills: ['frost.shatter'] }), a = one(g, 'runner', 10), b = one(g, 'runner', 10.3);
    a.lat = b.lat = 0; a.freeze = 1; b.hp = b.maxHp = 1000;
    hurt(g, a, 1e6);
    expect(b.hp).toBeCloseTo(1000 - a.maxHp * 0.3);
  });
});

describe('specials', () => {
  it('a Shaman heals hurt neighbours 8% every 2 s, measured centre to centre in 3D', () => {
    const g = game(), s = one(g, 'shaman', 10), near = one(g, 'soldier', 11), far = one(g, 'soldier', 14);
    near.hp = far.hp = near.maxHp / 2; s.healT = 0.01;
    updateEnemy(g, s, DT);
    expect(centreDist2(near, s)).toBeLessThan(6.8); expect(centreDist2(far, s)).toBeGreaterThan(6.8);
    expect(near.hp).toBeCloseTo(near.maxHp * 0.58); expect(far.hp).toBe(far.maxHp / 2);
    expect(s.healT).toBe(2);
  });
  it('Gruk roars once below half health, sending two Boar Riders ahead', () => {
    const g = game({ map: 3 }), gr = one(g, 'gruk', 20); gr.hp = gr.maxHp * 0.49;
    updateEnemy(g, gr, DT); updateEnemy(g, gr, DT);
    const riders = g.enemies.filter(e => e.type === 'rider'); // two, spawned once, 1.6 and 3.2 ahead of where Gruk roared
    expect(riders.length).toBe(2);
    expect(riders[1].d - riders[0].d).toBeCloseTo(1.6);
    expect(riders[0].d).toBeGreaterThan(gr.d);
  });
  it('Gruk stomps every 12 s once a tower is in reach: stands still 0.7 s, then stuns towers within 2.5 tiles for 2 s', () => {
    const g = game({ map: 3 }), gr = one(g, 'gruk', 20);
    const near = buildTower(g, 'arrow', 0, { free: true, instant: true })!, far = buildTower(g, 'arrow', 1, { free: true, instant: true })!;
    updateEnemy(g, gr, DT); near.x = gr.x + 2; near.z = gr.z; far.x = gr.x + 3; far.z = gr.z;
    gr.stompT = DT / 2; updateEnemy(g, gr, DT); expect(gr.stompW).toBe(0.7);
    const d = gr.d; for (let i = 0; i < 20; i++) updateEnemy(g, gr, DT); expect(gr.d).toBe(d); // held during the wind-up
    for (let i = 0; i < 2; i++) updateEnemy(g, gr, DT);
    expect(gr.stompW).toBe(0); expect(gr.stompT).toBe(12);
    expect(near.stunT).toBe(2); expect(far.stunT).toBe(0);
  });
  it('Gruk holds the stomp until a tower is in reach', () => {
    const g = game({ map: 3 }), gr = one(g, 'gruk', 20); gr.stompT = 0;
    for (let i = 0; i < 30; i++) updateEnemy(g, gr, DT);
    expect(gr.stompW).toBe(0); expect(gr.d).toBeGreaterThan(20);
  });
  it('slows wear off Gruk twice as fast', () => {
    const g = game({ map: 3 }), gr = one(g, 'gruk', 20); gr.slow = 2; gr.lastSlow = 0; gr.slowF = 0.5;
    updateEnemy(g, gr, DT);
    expect(gr.slow).toBeCloseTo(1 - DT);
  });
  it('a Boar Rider shrugs off the first slow or freeze', () => {
    const g = game(), r = one(g, 'rider', 5); r.slow = 3; r.slowF = 0.5;
    updateEnemy(g, r, DT); expect(r.slow).toBe(0); expect(r.shrug).toBe(true);
    r.slow = 3; updateEnemy(g, r, DT); expect(r.slow).toBeCloseTo(3 - DT);
  });
  it('a Sapper stops by the first tower in reach and knocks it out for 5 s', () => {
    const g = game(), s = one(g, 'sapper', 10), tower = buildTower(g, 'arrow', 0, { free: true, instant: true })!;
    tower.x = s.x + 1; tower.z = s.z + 1; // put it right by the sapper
    updateEnemy(g, s, DT); expect(s.plantT).toBe(0.9);
    const d0 = s.d; run(g, s, 0.85);
    expect(s.d).toBe(d0); expect(tower.stunT).toBe(0); // still planting, standing still
    run(g, s, 0.1);
    expect(tower.stunT).toBe(5); expect(s.planted).toBe(true);
    const d1 = s.d; run(g, s, 0.5); expect(s.d).toBeGreaterThan(d1); // then walks on
  });
});
