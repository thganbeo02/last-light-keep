import { describe, expect, it } from 'vitest';
import { GROUPING } from '../src/content/enemies.ts';
import { MAPS } from '../src/content/maps.ts';
import { int, makeRng, next } from '../src/engine/rng.ts';
import { hpMul, waveCounts, waveGroups } from '../src/engine/waves.ts';

const mill = MAPS.find(m => m.key === 'mill')!, crater = MAPS.find(m => m.key === 'crater')!;

describe('rng', () => {
  it('replays the same sequence from the same seed', () => {
    const a = makeRng(42), b = makeRng(42);
    expect(Array.from({ length: 5 }, () => next(a))).toEqual(Array.from({ length: 5 }, () => next(b)));
  });
  it('int stays inside [a, b] and reaches both ends', () => {
    const r = makeRng(1), seen = new Set<number>();
    for (let i = 0; i < 2000; i++) { const v = int(r, 2, 5); expect(v).toBeGreaterThanOrEqual(2); expect(v).toBeLessThanOrEqual(5); seen.add(v); }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });
});

describe('waves', () => {
  it('counts follow [first wave, base, extra per wave]', () => {
    // Millbrook wave 6: runner [1,3,1] → 3+1·6 = 9; soldier [2,1,.8] → 1+.8·5 = 5; brute [6,0,1] → 0+1·1 = 1
    expect(waveCounts(mill, 6)).toEqual({ runner: 9, soldier: 5, brute: 1, boss: 0 });
    expect(waveCounts(mill, 1)).toEqual({ runner: 4, soldier: 0, brute: 0, boss: 0 });
    expect(waveCounts(crater, 15).boss).toBe(2);
  });
  it('health grows per wave and scales with difficulty', () => {
    expect(hpMul(mill, 1, 1)).toBeCloseTo(mill.hpBase);
    expect(hpMul(mill, 3, 1.25)).toBeCloseTo(mill.hpBase * mill.growth[0] ** 2 * 1.25);
    expect(hpMul(mill, 3, 1, true)).toBeCloseTo(mill.hpBase * mill.growth[1] ** 2);
  });
  it('the queue holds every counted enemy, bosses last, in legal group sizes and paths', () => {
    for (let seed = 0; seed < 20; seed++) {
      const n = 15, counts = waveCounts(crater, n), { q, bosses } = waveGroups(crater, n, makeRng(seed));
      const got: Record<string, number> = {};
      for (const s of q) got[s.type] = (got[s.type] || 0) + 1;
      for (const [k, c] of Object.entries(counts)) expect(got[k] || 0, k).toBe(c);
      expect(q.slice(-bosses).every(s => s.type === 'boss')).toBe(true);
      expect(q.every(s => s.path >= 0 && s.path < crater.paths.length)).toBe(true);
      // a group starts with a 2 s delay; its size never exceeds that type's maximum
      let run = 0;
      q.forEach((s, i) => { run = s.delay === 2 ? 1 : run + 1; if (s.type !== 'boss') expect(run).toBeLessThanOrEqual(GROUPING[s.type as keyof typeof GROUPING][1]); if (i && s.delay !== 2) expect(s.type).toBe(q[i - 1].type); });
    }
  });
  it('is deterministic for a seed', () => {
    expect(waveGroups(crater, 10, makeRng(7))).toEqual(waveGroups(crater, 10, makeRng(7)));
  });
});
