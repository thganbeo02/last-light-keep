import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/content/maps.ts';
import { DT, sendWave, stars, tick, type Input } from '../src/engine/game.ts';
import { makeGame, type Game, type GameOptions } from '../src/engine/state.ts';

const game = (o: Partial<GameOptions> = {}) => makeGame({ map: 0, ...o });
const run = (g: Game, secs: number, inputs: Input[] = []) => { tick(g, inputs); for (let i = 1; i < Math.round(secs / DT); i++) tick(g); };
/**
 * Plays a whole battle with simple habits: once a second, spend gold on an archer on the next free plot (up to
 * `plots` of them), or else upgrade the lowest-level archer; call wave 1, then let each countdown run out.
 */
function playOut(g: Game, plots: number) {
  tick(g, [{ do: 'callWave' }]);
  for (let i = 0; i < 30 * 60 * 20 && g.state === 'play'; i++) {
    const inputs: Input[] = [];
    if (i % 30 === 0 && plots) {
      const free = g.spots.findIndex((s, k) => k < plots && !s.used && !s.block);
      if (free >= 0) inputs.push({ do: 'build', type: 'arrow', plot: free });
      else { const t = [...g.towers].sort((a, b) => a.lvl - b.lvl)[0]; if (t && t.lvl < 3) inputs.push({ do: 'upgrade', tower: t.id }); }
    }
    tick(g, inputs);
  }
}

describe('starting a battle', () => {
  it('starts with the map’s gold, plus the Kingdom picks', () => {
    expect(game().gold).toBe(MAPS[0].gold);
    expect(game({ skills: ['kingdom.root', 'kingdom.chest', 'kingdom.treasury'] }).gold).toBe(MAPS[0].gold + 80);
  });
  it('the castle has 100 health, 110 with Stone Walls', () => {
    expect(game().maxHp).toBe(100);
    expect(game({ skills: ['kingdom.walls'] }).hp).toBe(110);
  });
  it('difficulty sets enemy health and damage', () => {
    const g = game({ difficulty: 'impossible' }); expect(g.diff).toBe(1.5); expect(g.dmgMul).toBe(1.5);
    expect(game({ difficulty: 'normal' }).diff).toBe(1.25);
  });
  it('Watch mode picks a random toughness between .65 and .96, and the War Council doesn’t apply', () => {
    const g = game({ mode: 'watch', skills: ['kingdom.root'] });
    expect(g.diff).toBeGreaterThanOrEqual(0.85 / 1.3); expect(g.diff).toBeLessThan(1.25 / 1.3);
    expect(g.skills.size).toBe(0);
  });
});

describe('waves', () => {
  it('wave 1 waits for the player', () => {
    const g = game(); run(g, 60);
    expect(g.wave).toBe(0); expect(g.enemies.length).toBe(0);
  });
  it('calling a wave spawns it one enemy at a time, then the next comes 20 s after the last spawn', () => {
    const g = game(); run(g, 0.1, [{ do: 'callWave' }]);
    expect(g.wave).toBe(1); expect(g.spawnQ.length).toBeGreaterThan(0);
    for (let i = 0; i < 30 * 60 && g.spawnQ.length; i++) tick(g);
    expect(g.countdown).toBeCloseTo(20, 0);
    run(g, 20.2); expect(g.wave).toBe(2);
  });
  it('calling the next wave early pays 2 gold per second left on the countdown', () => {
    const g = game(); run(g, 0.1, [{ do: 'callWave' }]);
    for (let i = 0; i < 30 * 60 && g.spawnQ.length; i++) tick(g);
    run(g, 5); const left = g.countdown, gold = g.gold;
    sendWave(g, true);
    expect(g.gold - gold).toBe(Math.round(left * 2)); expect(g.wave).toBe(2);
  });
  it('calling a wave early takes the seconds skipped off every spell cooldown', () => {
    const g = game(); run(g, 0.1, [{ do: 'callWave' }]);
    for (let i = 0; i < 30 * 60 && g.spawnQ.length; i++) tick(g);
    g.scd = { militia: 30, catapult: 5 }; const left = g.countdown;
    sendWave(g, true);
    expect(g.scd.militia).toBeCloseTo(30 - left, 5); expect(g.scd.catapult).toBe(0);
  });
  it('calling a wave early also takes the seconds skipped off hero skill recharges and recovery', () => {
    const g = game({ hero: 'corwin' }); run(g, 0.1, [{ do: 'callWave' }]);
    for (let i = 0; i < 30 * 60 && g.spawnQ.length; i++) tick(g);
    const h = g.hero!, left = g.countdown;
    h.recharge.kindle = g.time + 30; h.respawnAt = g.time + 12;
    sendWave(g, true);
    expect(h.recharge.kindle).toBeCloseTo(g.time + 30 - left, 5); expect(h.respawnAt).toBeCloseTo(g.time + 12 - left, 5);
  });
  it('clearing a wave pays 20 + 5 per wave; Muster, Interest and Repair add to it', () => {
    const g = game({ skills: ['kingdom.muster', 'kingdom.interest', 'kingdom.repair'] });
    for (let p = 0; p < 6; p++) tick(g, [{ do: 'build', type: 'arrow', plot: p }]);
    g.hp = 90; run(g, 0.1, [{ do: 'callWave' }]);
    let ev: ReturnType<typeof tick> = [];
    for (let i = 0; i < 30 * 120 && !ev.some(e => e.t === 'cleared'); i++) { const gold = g.gold; ev = tick(g); if (ev.some(e => e.t === 'cleared')) {
      const c = ev.find(e => e.t === 'cleared') as { bonus: number };
      expect(c.bonus).toBe(Math.round(25 * 1.25) + Math.min(25, Math.round(gold * 0.05))); } }
    expect(g.clearPaid).toBe(true); expect(g.hp).toBe(92);
  });
});

describe('a whole battle', () => {
  it('Millbrook Fields with six archers is won, and scored', () => {
    const g = game(); playOut(g, 6);
    expect(g.state).toBe('victory'); expect(g.wave).toBe(MAPS[0].waves);
    expect(stars(g)).toBe(g.hp > 80 ? 3 : g.hp > 40 ? 2 : 1);
    expect(g.defeated).toBeGreaterThan(30);
  });
  it('with no towers the castle falls', () => {
    const g = game(); playOut(g, 0);
    expect(g.state).toBe('fallen'); expect(g.hp).toBe(0); expect(stars(g)).toBe(0);
  });
  it('the same seed and inputs replay exactly', () => {
    const a = game({ seed: 7, map: 1 }), b = game({ seed: 7, map: 1 });
    playOut(a, 8); playOut(b, 8);
    expect([a.state, a.hp, a.gold, a.defeated, a.time]).toEqual([b.state, b.hp, b.gold, b.defeated, b.time]);
  });
  it('a different seed plays differently', () => {
    const a = game({ seed: 1, map: 1 }), b = game({ seed: 2, map: 1 });
    playOut(a, 8); playOut(b, 8);
    expect([a.hp, a.gold, a.time]).not.toEqual([b.hp, b.gold, b.time]);
  });
});
