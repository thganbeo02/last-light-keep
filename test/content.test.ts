// Content parity: every value in src/content must equal the constant it was extracted from in src/main.js.
// Fails when someone changes a balance number in one place but not the other. Fix: `npm run extract`.
import { describe, expect, it } from 'vitest';
import { GROUPS, readGameConst } from '../tools/extract-content.ts';
import { mainSource } from '../tools/main-source.ts';

// Functions compare by what they return on sample inputs (the TS transform reformats their source text):
// SPEC stat formulas take a stat object, map liquid curves take a tile coordinate.
const PROBES: unknown[] = [{ dmg: 10, range: 5, rate: 1, dps: 7 }, 0, 7, 23];
const call = (f: (x: unknown) => unknown, x: unknown) => { try { return f(x); } catch { return 'throws'; } };
const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'function' ? { fn: PROBES.map(p => call(x, p)) } : x)));

describe('src/content matches src/main.js', () => {
  const src = mainSource();
  for (const [file, names] of Object.entries(GROUPS)) {
    it(file, async () => {
      const mod = await import(`../src/content/${file}.ts`);
      for (const n of names) expect(norm(mod[n]), n).toEqual(norm(readGameConst(src, n)));
    });
  }
});
