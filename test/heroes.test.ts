import { describe, expect, it } from 'vitest';
import { HERO_ABILITIES as AB, HEROES, type HeroAbility, HERO_RECOVERY, HERO_REGEN, HERO_SPEED } from '../src/content/heroes.ts';
import { hurt, killReward, place, spawnEnemy } from '../src/engine/enemies.ts';
import { DT, tick, type Input } from '../src/engine/game.ts';
import { castHero, heroMoveSpot, heroRoadSpot, isBurning } from '../src/engine/heroes.ts';
import type { Vec2 } from '../src/engine/math.ts';
import { gx2w, gz2w, TILE, W } from '../src/engine/map.ts';
import { fireArrow } from '../src/engine/projectiles.ts';
import { hurtSoldier } from '../src/engine/soldiers.ts';
import { groundY, makeGame, type Game } from '../src/engine/state.ts';
import { buildTower } from '../src/engine/towers.ts';

const battle = (hero: keyof typeof HEROES) => makeGame({ map: 0, hero, seed: 12 });
// Skills cast themselves in battle; these tests cast them directly to check each rule.
const cast = (g: Game, k: HeroAbility, { at, targetTower }: { at?: Vec2; targetTower?: number } = {}) => castHero(g, k, at, targetTower);

describe('battle heroes', () => {
  it('walks diagonally across clear ground at full speed', () => {
    const g = battle('aldric'), h = g.hero!, s = h.unit;
    g.map.tiles.fill(TILE.grass);
    Object.assign(s, { x: -.5, z: -.5 });
    const to = { x: -6.5, z: -4.5 };
    tick(g, [{ do: 'heroMove', ...to }]);
    expect(h.route).toEqual([to]);
    expect(Math.hypot(s.x + .5, s.z + .5)).toBeCloseTo(HERO_SPEED * DT);
    expect((s.x + .5) / (s.z + .5)).toBeCloseTo(6 / 4);
  });

  it('keeps the full step at a turn without cutting through a blocked corner', () => {
    const g = battle('aldric'), h = g.hero!, s = h.unit;
    g.map.tiles.fill(TILE.liquid);
    const from = { x: gx2w(12), z: gz2w(10) }, to = { x: gx2w(13), z: gz2w(11) };
    Object.assign(s, from);
    g.map.tiles[10 * W + 12] = TILE.road;
    g.map.tiles[11 * W + 12] = TILE.bridge;
    g.map.tiles[11 * W + 13] = TILE.road;
    tick(g, [{ do: 'heroMove', ...to }]);
    expect(h.route).toEqual([{ x: from.x, z: to.z }, to]);
    for (let i = 0; i < 7; i++) tick(g);
    expect(s.z).toBe(to.z);
    expect(s.x - from.x).toBeCloseTo(8 * HERO_SPEED * DT - 1);
    expect(h.route).toEqual([to]);
  });

  it('moves the selected hero, recovers at the Keep and keeps Watch mode hero-free', () => {
    const g = battle('corwin'), h = g.hero!, s = h.unit;
    expect(makeGame({ map: 0, hero: 'corwin', mode: 'watch' }).hero).toBeNull();
    expect(s.name).toBe('Corwin Ashguard');
    const p = g.map.samples.find(p => Math.hypot(p.x - s.x, p.z - s.z) > 3)!;
    tick(g, [{ do: 'heroMove', x: NaN, z: 0 }]);
    expect(h.route).toHaveLength(0);
    tick(g, [{ do: 'heroMove', x: p.x, z: p.z }]);
    expect(h.route.length).toBeGreaterThan(0);
    for (let i = 0; i < 600 && h.route.length; i++) tick(g);
    expect(s.x).toBeCloseTo(p.x); expect(s.z).toBeCloseTo(p.z); expect(s.y).toBe(groundY(g, p.x, p.z));
    hurtSoldier(g, s, 1000, 'true');
    expect(cast(g, 'kindle', { at: p })).toBe(false);
    for (let i = 0; i <= HERO_RECOVERY / DT; i++) tick(g);
    expect(h.unit).not.toBe(s);
    expect(h.unit.hp).toBe(HEROES.corwin.hp);
    expect(h.unit.x).toBe(h.spawn.x);
    expect(h.unit.z).toBe(h.spawn.z);
  });

  it('Hold Fast blocks three ground enemies and protects nearby soldiers', () => {
    const g = battle('aldric'), h = g.hero!, p = heroRoadSpot(g, h.unit, 2)!;
    const foes = Array.from({ length: 5 }, () => spawnEnemy(g, 'soldier', p.d));
    const bat = spawnEnemy(g, 'flyer', p.d);
    h.recharge['shield-wall'] = Infinity; // it would brace and hold all five
    tick(g);
    expect(foes.filter(e => e.blocker === h.unit)).toHaveLength(3);
    expect(bat.blocker).toBeNull();
    g.gold = 1000;
    const t = buildTower(g, 'barracks', 0, { instant: true })!;
    const ally = t.soldiers[0];
    ally.x = h.unit.x; ally.z = h.unit.z;
    hurtSoldier(g, ally, 10, 'true');
    expect(ally.maxHp - ally.hp).toBeCloseTo(8.5);
  });

  it('Hold Fast swings also hit every other held enemy for half damage', () => {
    const g = battle('aldric'), h = g.hero!, p = heroRoadSpot(g, h.unit, 2)!;
    h.recharge['shield-wall'] = h.recharge['rally-the-line'] = Infinity;
    const foes = Array.from({ length: 3 }, () => { const e = spawnEnemy(g, 'soldier', p.d); e.stun = 30; return e; });
    for (let i = 0; i < 30 && foes.every(e => e.hp === e.maxHp); i++) tick(g);
    const hit = foes.map(e => e.maxHp - e.hp).sort((a, b) => b - a);
    expect(hit[0]).toBeGreaterThan(0);
    expect(hit[1]).toBeCloseTo(hit[0] / 2); expect(hit[2]).toBeCloseTo(hit[0] / 2);
  });

  it('Rally the Line casts itself when 2 ground enemies close in, and speeds Aldric and nearby towers by 20%', () => {
    const g = battle('aldric'), h = g.hero!, s = h.unit, p = heroRoadSpot(g, s, 2)!;
    h.recharge['shield-wall'] = Infinity;
    const t = buildTower(g, 'arrow', 0, { instant: true, free: true })!;
    t.x = s.x; t.z = s.z;
    for (let k = 0; k < 2; k++) spawnEnemy(g, 'soldier', p.d).stun = 30;
    expect(tick(g)).toContainEqual(expect.objectContaining({ t: 'heroCast', k: 'rally-the-line' }));
    t.cool = s.cd = 1;
    tick(g);
    expect(t.cool).toBeCloseTo(1 - DT * 1.2); expect(s.cd).toBeCloseTo(1 - DT * 1.2);
  });

  it('Rally the Line revives nearby Barracks soldiers and hastens attacks around a fixed banner', () => {
    const g = battle('aldric'), h = g.hero!, s = h.unit;
    g.gold = 1000;
    const t = buildTower(g, 'barracks', 0, { instant: true })!;
    t.rally = { x: s.x, z: s.z };
    const fallen = t.soldiers[0], ally = t.soldiers[1];
    for (const so of t.soldiers) { so.x = s.x; so.z = s.z; }
    hurtSoldier(g, fallen, 1e3, 'true');
    const p = heroRoadSpot(g, s, 2)!;
    const e = spawnEnemy(g, 'soldier', p.d); e.lat = 0; place(g, e, 0); e.stun = 10;
    ally.cd = 1;
    expect(cast(g, 'rally-the-line')).toBe(true);
    expect(t.soldiers[0]).not.toBe(fallen);
    expect(t.soldiers[0].hp).toBe(t.soldiers[0].maxHp);
    tick(g);
    expect(ally.cd).toBeCloseTo(1 - DT * 1.3);
    expect(cast(g, 'rally-the-line')).toBe(false);
    const banner = h.banner!;
    g.time = banner.until;
    tick(g);
    expect(h.banner).toBeNull();
  });

  it('Shield Wall braces Aldric on its own when 3 ground enemies close in, takes over nearby fights and releases extra enemies when it expires', () => {
    const g = battle('aldric'), h = g.hero!, s = h.unit;
    const p = heroRoadSpot(g, s, 2)!;
    const foes = Array.from({ length: 5 }, () => spawnEnemy(g, 'soldier', p.d));
    expect(tick(g)).toContainEqual(expect.objectContaining({ t: 'heroCast', k: 'shield-wall' }));
    expect(cast(g, 'shield-wall')).toBe(false);
    expect(foes.every(e => e.blocker === s)).toBe(true);
    hurtSoldier(g, s, 100, 'true');
    expect(s.hp).toBeCloseTo(s.maxHp - 30);
    expect(tick(g, [{ do: 'heroMove', x: p.x, z: p.z }])).toContainEqual({ t: 'heroMoveBlocked', why: 'shield' });
    expect(h.route).toHaveLength(0);
    g.time = h.shieldUntil;
    tick(g);
    expect(foes.filter(e => e.blocker === s)).toHaveLength(3);
  });

  it('The Gate Holds charges from hits, stops and reflects ground enemies, and saves nearby soldiers', () => {
    const g = battle('aldric'), h = g.hero!, s = h.unit;
    const a = AB['the-gate-holds'];
    expect(cast(g, 'the-gate-holds')).toBe(false);
    for (let i = 0; i < a.hits; i++) hurtSoldier(g, s, 1, 'true');
    expect(cast(g, 'the-gate-holds')).toBe(true);
    expect(h.hits).toBe(0);
    const gate = h.gate!, e = spawnEnemy(g, 'soldier', gate.d - .001, gate.path);
    const bat = spawnEnemy(g, 'flyer', gate.d - .001, gate.path);
    const before = e.hp;
    tick(g);
    expect(e.d).toBe(gate.d);
    expect(bat.d).toBeGreaterThan(gate.d);
    expect(e.hp).toBe(before - 3);
    hurtSoldier(g, s, 10000, 'true');
    expect(s.hp).toBe(1);
    g.time = gate.until;
    hurtSoldier(g, s, 10, 'true');
    expect(s.alive).toBe(false);
  });

  it('Lantern Light blocks Shaman healing and reduces magic resistance in range', () => {
    const g = battle('corwin'), h = g.hero!, p = heroRoadSpot(g, h.unit, 2)!;
    const shaman = spawnEnemy(g, 'shaman', p.d), e = spawnEnemy(g, 'shaman', p.d - .7);
    e.healT = 100; shaman.healT = .001;
    hurt(g, e, 10, 'magic');
    expect(e.maxHp - e.hp).toBeCloseTo(6);
    const before = e.hp;
    tick(g);
    expect(e.hp).toBe(before);
    h.unit.x += 10;
    shaman.healT = .001;
    tick(g);
    expect(e.hp).toBeGreaterThan(before);
  });

  it('Kindle validates the road, applies stacking burns, and respects cooldown', () => {
    const g = battle('corwin'), p = g.map.samples[4];
    const e = spawnEnemy(g, 'soldier', p.d), bat = spawnEnemy(g, 'flyer', p.d);
    e.stun = bat.stun = 20;
    expect(cast(g, 'kindle', { at: { x: 100, z: 100 } })).toBe(false);
    expect(cast(g, 'kindle', { at: p })).toBe(true);
    expect(cast(g, 'kindle', { at: p })).toBe(false);
    for (let i = 0; i < 20; i++) tick(g);
    expect(e.heroBurns?.length).toBeGreaterThan(1);
    expect(e.hp).toBeLessThan(e.maxHp);
    expect(isBurning(g, bat)).toBe(false);
    for (let i = 0; i < 6 / DT; i++) tick(g);
    expect(g.hero!.kindle).toBeNull();
    expect(isBurning(g, e)).toBe(false);
  });

  it('Kindle casts itself under 2 ground enemies within Corwin’s range, and not under 1', () => {
    const g = battle('corwin'), h = g.hero!, p = heroRoadSpot(g, h.unit, 2)!;
    const one = spawnEnemy(g, 'soldier', p.d); one.stun = 30;
    tick(g);
    expect(h.kindle).toBeNull();
    const two = spawnEnemy(g, 'soldier', p.d); two.stun = 30;
    expect(tick(g)).toContainEqual(expect.objectContaining({ t: 'heroCast', k: 'kindle' }));
    expect(Math.hypot(h.kindle!.x - p.x, h.kindle!.z - p.z)).toBeLessThan(1);
  });

  it('Ashen Ward burns targets of the warded tower and pushes each nearby attacker back once', () => {
    const g = battle('corwin'), h = g.hero!;
    const t = buildTower(g, 'arrow', 0, { instant: true, free: true })!;
    const e = spawnEnemy(g, 'soldier', 4);
    e.stun = 30;
    expect(cast(g, 'ashen-ward', { targetTower: -1 })).toBe(false);
    expect(cast(g, 'ashen-ward', { targetTower: t.id })).toBe(true);
    const d = e.d;
    // Put the ward next to the target so both its attack and pushback are exercised.
    t.x = e.x; t.z = e.z;
    fireArrow(g, t, e, 1, false, {});
    tick(g);
    expect(e.d).toBe(d - 1);
    place(g, e, 0);
    t.x = e.x; t.z = e.z;
    for (let i = 0; i < 20; i++) tick(g);
    expect(e.d).toBe(d - 1);
    expect(isBurning(g, e)).toBe(true);
    expect(h.ward!.pushed.size).toBe(1);
  });

  it('Undying Coal erupts burning enemies once and grants bonus gold for later burning kills', () => {
    const g = battle('corwin'), a = AB['undying-coal'];
    const e = spawnEnemy(g, 'soldier', 2), clean = spawnEnemy(g, 'soldier', 4);
    expect(cast(g, 'undying-coal')).toBe(false);
    e.burn = 2;
    const before = g.gold;
    expect(cast(g, 'undying-coal')).toBe(true);
    expect(e.alive).toBe(false);
    expect(clean.hp).toBe(clean.maxHp);
    expect(g.gold - before).toBe(killReward(g, e) + a.gold);
    clean.burn = 2;
    expect(cast(g, 'undying-coal')).toBe(false);
    hurt(g, clean, 1e3, 'true');
    expect(g.gold - before).toBe(killReward(g, e) + killReward(g, clean) + 2 * a.gold);
  });

  it('heals 10% of max health a second after 2 s out of combat, and not while fighting', () => {
    const g = battle('aldric'), s = g.hero!.unit;
    hurtSoldier(g, s, s.maxHp / 2, 'true');
    for (let i = 0; i < 2 / DT; i++) tick(g);
    const before = s.hp;
    for (let i = 0; i < 1 / DT; i++) tick(g);
    expect(s.hp - before).toBeCloseTo(s.maxHp * HERO_REGEN, 0);
    const p = heroRoadSpot(g, s, 2)!;
    const foe = spawnEnemy(g, 'soldier', p.d); foe.stun = 30;
    tick(g, [{ do: 'heroMove', x: p.x, z: p.z }]);
    for (let i = 0; i < 60 && !s.fighting; i++) tick(g);
    expect(s.fighting).toBe(true);
    hurtSoldier(g, s, s.maxHp / 4, 'true');
    const held = s.hp;
    for (let i = 0; i < 3 / DT && foe.alive; i++) { tick(g); expect(s.hp).toBeLessThanOrEqual(held); }
  });

  it('Ashen Ward never pushes bosses', () => {
    const g = battle('corwin');
    const t = buildTower(g, 'arrow', 0, { instant: true, free: true })!;
    const boss = spawnEnemy(g, 'gruk', 4); boss.stun = 30;
    t.x = boss.x; t.z = boss.z;
    expect(cast(g, 'ashen-ward', { targetTower: t.id })).toBe(true);
    const d = boss.d;
    tick(g);
    expect(boss.d).toBe(d);
  });

  it('a move order on blocked ground walks to the nearest walkable tile', () => {
    const g = battle('aldric'), h = g.hero!;
    const i = g.map.tiles.findIndex((t, k) => t !== TILE.grass && t !== TILE.road && t !== TILE.bridge && !!heroMoveSpot(g, { x: gx2w(k % W), z: gz2w(Math.floor(k / W)) }));
    expect(i).toBeGreaterThanOrEqual(0);
    const at = { x: gx2w(i % W), z: gz2w(Math.floor(i / W)) }, to = heroMoveSpot(g, at)!;
    expect(Math.hypot(to.x - at.x, to.z - at.z)).toBeLessThanOrEqual(2.5);
    tick(g, [{ do: 'heroMove', x: at.x, z: at.z }]);
    for (let k = 0; k < 900 && h.route.length; k++) tick(g);
    expect(h.unit.x).toBeCloseTo(to.x); expect(h.unit.z).toBeCloseTo(to.z);
  });
});
