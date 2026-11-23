// The simulator's verdicts (the full simulator is `npm run sim`, minutes long, so it isn't part of npm test).
import { describe, expect, it } from 'vitest';
import { compare, simulate, type Run } from '../tools/sim.ts';

const runs = (n: number, f: (i: number) => Run) => Array.from({ length: n }, (_, i) => f(i));

describe('compare', () => {
  it('passes two samples from the same game', () => {
    const a = runs(40, i => [i % 4 ? 1 : 0, i % 4 ? 60 + (i % 7) * 5 : 0, 10, 300 + i, 0.8, 8]);
    const b = runs(40, i => [(i + 1) % 4 ? 1 : 0, (i + 1) % 4 ? 62 + (i % 5) * 6 : 0, 10, 305 + i, 0.8, 8]);
    expect(compare(a, b).every(v => v.ok)).toBe(true);
  });
  it('flags a game that is clearly easier', () => {
    const a = runs(40, i => [i % 2, i % 2 ? 40 : 0, 10, 300, 0.8, 8]), b = runs(40, () => [1, 95, 10, 300, 0.8, 8]);
    const bad = compare(a, b).filter(v => !v.ok).map(v => v.metric);
    expect(bad).toContain('win rate'); expect(bad).toContain('castle hp');
  });
});

describe('simulate', () => {
  it('plays a Watch battle to the end and reports it as the baseline does', () => {
    const r = simulate(0, 1);
    expect(r[0]).toBe(1); expect(r[2]).toBe(6); expect(r[5]).toBeGreaterThanOrEqual(7);
  });
});
