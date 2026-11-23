import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/content/maps.ts';
import { buildMap, pathAt, smoothPath } from '../src/engine/map.ts';
import live from './fixtures/maps-3x.json';

const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };

describe('map geometry matches the 3.x game exactly', () => {
  live.maps.forEach((want, i) => {
    it(want.key, () => {
      const g = buildMap(i);
      expect(g.key).toBe(want.key);
      expect(g.plots.map(p => [p.gx, p.gz])).toEqual(want.plots);
      expect(g.paths.map(p => p.len)).toEqual(want.lens);
      expect(g.samples.length).toBe(want.samples);
      expect(g.samples.reduce((a, s, k) => a + s.x * (k % 7 + 1) + s.z * (k % 5 + 2), 0)).toBe(want.sampleSum);
      expect(fnv(Array.from(g.tiles).join(''))).toBe(want.tileHash);
    });
  });
  it('covers every built map', () => expect(live.maps.map(m => m.key)).toEqual(MAPS.map(m => m.key)));
});

describe('path math', () => {
  const P = buildMap(0).paths[0];
  it('pathAt clamps to the ends', () => {
    expect(pathAt(P, -5)).toEqual(P.pts[0]);
    expect(pathAt(P, P.len + 5)).toEqual(P.pts[P.pts.length - 1]);
  });
  it('smoothPath gives a unit direction along the road', () => {
    const dir = { x: 0, z: 0 }; smoothPath(P, 3, undefined, dir);
    expect(Math.hypot(dir.x, dir.z)).toBeCloseTo(1);
    expect(dir).toEqual({ x: 1, z: 0 }); // Millbrook's road starts heading east
  });
});
