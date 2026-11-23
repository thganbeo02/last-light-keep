import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/content/maps.ts';
import { TT } from '../src/content/towers.ts';
import { aiThink, makeWatchGame } from '../src/engine/ai.ts';
import { tick } from '../src/engine/game.ts';
import type { Game } from '../src/engine/state.ts';

const playOut = (g: Game) => { for (let i = 0; i < 30 * 60 * 25 && g.state === 'play'; i++) tick(g); return g; };

describe('Watch mode opening', () => {
  it('one of each tower already standing, little gold, wave 1 under way, 3 s played', () => {
    const g = makeWatchGame({ map: 1, seed: 3 });
    expect(new Set(g.towers.map(t => t.type))).toEqual(new Set(Object.keys(TT)));
    expect(g.towers.every(t => t.buildT === 1)).toBe(true);
    expect(g.wave).toBe(1);
    expect(g.time).toBeCloseTo(3);
    expect(g.diff).toBeGreaterThanOrEqual(0.85 / 1.3);
  });
  it('gold starts at the map’s gold − 160, before anything it earns in the first 3 s', () => {
    const g = makeWatchGame({ map: 0, seed: 1 });
    expect(g.gold).toBeGreaterThanOrEqual(MAPS[0].gold - 160);
  });
});

describe('the AI player', () => {
  it('buys the best option it can afford, never going into debt', () => {
    const g = makeWatchGame({ map: 1, seed: 5 }); g.gold = 1000;
    const spent = g.towers.reduce((a, t) => a + t.spend, 0);
    aiThink(g);
    expect(g.towers.reduce((a, t) => a + t.spend, 0)).toBeGreaterThan(spent);
    for (let i = 0; i < 30 * 120; i++) { tick(g); expect(g.gold).toBeGreaterThanOrEqual(0); }
  });
  it('pays 3.5% more for each new tower per tower it already has', () => {
    const g = makeWatchGame({ map: 1, seed: 2 }); g.gold = 10000;
    for (let k = 0; k < 40; k++) { // think until it builds something
      const n = g.towers.length, gold = g.gold; aiThink(g);
      if (g.towers.length > n) { const t = g.towers[g.towers.length - 1]; expect(gold - g.gold).toBe(Math.round(TT[t.type].cost * (1 + n * 0.035))); expect(t.spend).toBe(gold - g.gold); return; }
    }
    throw new Error('never built');
  });
  it('wins Millbrook Fields', () => {
    for (const seed of [1, 2, 3]) expect(playOut(makeWatchGame({ map: 0, seed })).state).toBe('victory');
  });
  it('a seed replays exactly', () => {
    const a = playOut(makeWatchGame({ map: 2, seed: 9 })), b = playOut(makeWatchGame({ map: 2, seed: 9 }));
    expect([a.state, a.hp, a.gold, a.defeated, a.towers.map(t => `${t.type}${t.lvl}${t.spec}${t.rank}`).join()]).toEqual([b.state, b.hp, b.gold, b.defeated, b.towers.map(t => `${t.type}${t.lvl}${t.spec}${t.rank}`).join()]);
  });
});
