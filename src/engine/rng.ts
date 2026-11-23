// Seeded randomness. The engine never calls Math.random: every roll comes from an Rng carried in the game state,
// so a seed plus the same inputs always replays the same battle (simulator runs, bug reports, replays).

export interface Rng { s: number }

export const makeRng = (seed: number): Rng => ({ s: seed >>> 0 });

/** One step of mulberry32: a float in [0, 1). */
export function next(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A float in [a, b), like main.js `rand`. */
export const range = (r: Rng, a = 0, b = 1) => a + next(r) * (b - a);

/** An integer in [a, b] inclusive, like main.js `randi`. */
export const int = (r: Rng, a: number, b: number) => Math.floor(range(r, a, b + 1));
