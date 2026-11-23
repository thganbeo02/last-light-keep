// What each wave sends: how many of each enemy, in which groups, down which path, and how tough they are.
// Ported from main.js (hpMul, waveCounts, waveGroups) with randomness from a seeded Rng.
import { GROUPING } from '../content/enemies.ts';
import { MAPS } from '../content/maps.ts';
import { int, type Rng } from './rng.ts';

export type MapDef = (typeof MAPS)[number];
export type EnemyType = keyof typeof GROUPING | 'boss';
export interface Spawn { type: EnemyType; delay: number; path: number }

/** Enemy health multiplier for wave n. The AI player (Watch mode) uses the second, steeper growth. */
export const hpMul = (map: MapDef, n: number, diff: number, watch = false) =>
  map.hpBase * Math.pow(map.growth[watch ? 1 : 0], n - 1) * diff;

/** Enemy counts for wave n: each unit type is [first wave, base count, extra per wave]; bosses are listed by wave. */
export function waveCounts(map: MapDef, n: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, [start, base, grow]] of Object.entries(map.units) as [string, number[]][]) out[k] = n >= start ? Math.round(base + grow * (n - start + 1)) : 0;
  out.boss = (map.bosses as Record<number, number>)[n] || 0;
  return out;
}

/** The spawn queue for wave n: enemies split into shuffled groups, each group on one random path, bosses last. */
export function waveGroups(map: MapDef, n: number, rng: Rng): { q: Spawn[]; bosses: number } {
  const counts = waveCounts(map, n), groups: [EnemyType, number, number][] = [];
  for (const [k, c] of Object.entries(counts)) {
    if (k === 'boss') continue;
    const [lo, hi, gap] = GROUPING[k as keyof typeof GROUPING];
    for (let left = c; left > 0;) { const m = Math.min(left, int(rng, lo, hi)); groups.push([k as EnemyType, m, gap]); left -= m; }
  }
  for (let i = groups.length - 1; i > 0; i--) { const j = int(rng, 0, i); [groups[i], groups[j]] = [groups[j], groups[i]]; }
  for (let i = 0; i < counts.boss; i++) groups.push(['boss', 1, 4]);
  const q: Spawn[] = [];
  for (const [type, c, gap] of groups) {
    const path = int(rng, 0, map.paths.length - 1);
    for (let i = 0; i < c; i++) q.push({ type, delay: i === 0 ? 2 : gap, path });
  }
  return { q, bosses: counts.boss };
}
