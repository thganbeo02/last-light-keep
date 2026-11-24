// npm run sim [-- --runs 40 --maps 0,1,2] — plays Watch mode battles on the engine and compares them with the
// baseline in test/baseline.json: 3.2's own battles, recorded in the last version that ran its own rules (the
// __watchRun hook, removed in milestone 2). A map matches when the engine's numbers sit within what that game's
// run-to-run variation allows; after a balance change, the gaps show how far it moved.
import { readFileSync } from 'node:fs';
import { MAPS } from '../src/content/maps.ts';
import { makeWatchGame } from '../src/engine/ai.ts';
import { tick } from '../src/engine/game.ts';

/** One battle as the baseline records it: [won, castle hp, wave reached, seconds, toughness, towers]. */
export type Run = [number, number, number, number, number, number];

export function simulate(map: number, seed: number): Run {
  const g = makeWatchGame({ map, seed });
  for (let i = 0; i < 30 * 1500 && g.state === 'play'; i++) tick(g);
  return [g.state === 'victory' ? 1 : 0, g.hp, g.wave, Math.round(g.time), Math.round(g.diff * 1000) / 1000, g.towers.length];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };

export interface Verdict { metric: string; base: number; engine: number; limit: number; ok: boolean }

/**
 * Compares the engine's runs with the baseline's for one map. A metric passes when the gap between the two means
 * is under 2.5 standard errors of that gap (from both samples' own spread), so it fails only when the difference is
 * bigger than run-to-run luck explains.
 */
export function compare(base: Run[], eng: Run[]): Verdict[] {
  const out: Verdict[] = [];
  const check = (metric: string, a: number[], b: number[], floor: number) => {
    const se = Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length), limit = Math.max(2.5 * se, floor);
    out.push({ metric, base: mean(a), engine: mean(b), limit, ok: Math.abs(mean(a) - mean(b)) <= limit });
  };
  check('win rate', base.map(r => r[0]), eng.map(r => r[0]), 0.1);
  check('castle hp', base.map(r => r[1]), eng.map(r => r[1]), 5);
  check('wave reached', base.map(r => r[2]), eng.map(r => r[2]), 0.5);
  const wonB = base.filter(r => r[0]), wonE = eng.filter(r => r[0]);
  if (wonB.length >= 5 && wonE.length >= 5 && wonB.every(r => r[3] < 1500)) check('length of a win (s)', wonB.map(r => r[3]), wonE.map(r => r[3]), 5); // older baselines hold a running clock instead
  return out;
}

if (process.argv[1]?.endsWith('sim.ts')) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const runs = Number(arg('--runs') ?? 40), maps = (arg('--maps') ?? MAPS.map((_, i) => i).join(',')).split(',').map(Number);
  const baseline = JSON.parse(readFileSync(new URL('../test/baseline.json', import.meta.url), 'utf8')) as { maps: Record<string, Run[]> };
  let allOk = true;
  for (const m of maps) {
    const t0 = performance.now(), eng: Run[] = [];
    for (let s = 1; s <= runs; s++) eng.push(simulate(m, s));
    const v = compare(baseline.maps[m], eng);
    console.log(`\n${MAPS[m].name} (${runs} engine runs vs ${baseline.maps[m].length} 3.x runs, ${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    for (const r of v) { console.log(`  ${r.ok ? 'ok  ' : 'GAP '} ${r.metric.padEnd(20)} 3.x ${r.base.toFixed(2).padStart(7)}  engine ${r.engine.toFixed(2).padStart(7)}  (allowed ±${r.limit.toFixed(2)})`); allOk &&= r.ok; }
  }
  console.log(allOk ? '\nEvery map matches 3.x.' : '\nSome maps differ from 3.x: see GAP lines.');
  process.exitCode = allOk ? 0 : 1;
}
