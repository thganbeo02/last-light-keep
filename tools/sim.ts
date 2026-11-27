// npm run sim [-- --runs 40 --maps 0,1,2] [--heroes [--difficulty normal]] — plays Watch mode battles on the engine and compares them with the
// baseline in test/baseline.json: 3.2's own battles, recorded in the last version that ran its own rules (the
// __watchRun hook, removed in milestone 2). A map matches when the engine's numbers sit within what that game's
// run-to-run variation allows; after a balance change, the gaps show how far it moved.
import { readFileSync } from 'node:fs';
import { MAPS } from '../src/content/maps.ts';
import { aiThink, heroThink, makeWatchGame } from '../src/engine/ai.ts';
import { DT, tick, type Input } from '../src/engine/game.ts';
import { makeGame, type GameOptions } from '../src/engine/state.ts';
import { buildTower, specialise, upgradeTower, type SpecKey, type TowerType } from '../src/engine/towers.ts';
import type { HeroAbility, HeroKey } from '../src/content/heroes.ts';

type Difficulty = NonNullable<GameOptions['difficulty']>;

/** One battle as the baseline records it: [won, castle hp, wave reached, seconds, toughness, towers]. */
export type Run = [number, number, number, number, number, number];

export function simulate(map: number, seed: number): Run {
  const g = makeWatchGame({ map, seed });
  for (let i = 0; i < 30 * 1500 && g.state === 'play'; i++) tick(g);
  return [g.state === 'victory' ? 1 : 0, g.hp, g.wave, Math.round(g.time), Math.round(g.diff * 1000) / 1000, g.towers.length];
}

/** What a hero did across a set of battles: how often they fell and cast each ability. */
export interface HeroReport { deaths: number; casts: Partial<Record<HeroAbility, number>> }

/** One purchase the build AI made: a new tower on a plot, or an upgrade or specialisation of the tower there. */
export type Purchase = { plot: number } & ({ do: 'build'; type: TowerType } | { do: 'up' } | { do: 'spec'; k: SpecKey });

export interface PlayedOptions { hero?: HeroKey; report?: HeroReport; difficulty?: Difficulty; record?: Purchase[]; replay?: Purchase[] }

/**
 * A played battle, where heroes exist: the difficulty's enemy health and damage, the map's own starting gold, and
 * each wave 20 s after the last spawn. Every .7 s the Watch AI builds (aiThink) and heroThink places the hero.
 * `record` collects the AI's purchases; `replay` makes those purchases instead, in order, each once it is affordable.
 * Returns [won, castle hp, wave reached, seconds].
 */
export function simulatePlayed(map: number, seed: number, { hero, report, difficulty = 'normal', record, replay }: PlayedOptions = {}) {
  const g = makeGame({ map, seed, hero, difficulty });
  let unit = g.hero?.unit, think = 0, next = 0;
  for (let i = 0; i < 30 * 1500 && g.state === 'play'; i++) {
    const inputs: Input[] = g.wave === 0 && g.time > 3 ? [{ do: 'callWave' }] : [];
    if ((think -= DT) <= 0) {
      think = 0.7;
      if (replay) {
        for (; next < replay.length; next++) {
          const b = replay[next], t = g.towers.find(t => t.plot === b.plot);
          if (!(b.do === 'build' ? buildTower(g, b.type, b.plot) : t && (b.do === 'up' ? upgradeTower(g, t) : specialise(g, t, b.k)))) break;
        }
      } else if (record) {
        const before = new Map(g.towers.map(t => [t.plot, { lvl: t.lvl, rank: t.rank, spec: t.spec }]));
        aiThink(g);
        for (const t of g.towers) {
          const o = before.get(t.plot);
          if (!o) record.push({ plot: t.plot, do: 'build', type: t.type });
          else if (t.spec && !o.spec) record.push({ plot: t.plot, do: 'spec', k: t.spec });
          else if (t.lvl > o.lvl || t.rank > o.rank) record.push({ plot: t.plot, do: 'up' });
        }
      } else aiThink(g);
      heroThink(g);
    }
    for (const e of tick(g, inputs)) if (e.t === 'heroCast' && report) report.casts[e.k] = (report.casts[e.k] ?? 0) + 1;
    if (report && unit && !unit.alive) { report.deaths++; unit = undefined; }
    if (g.hero?.unit.alive) unit = g.hero.unit;
  }
  return [g.state === 'victory' ? 1 : 0, g.hp, g.wave, Math.round(g.time)];
}

/**
 * npm run sim -- --heroes [--difficulty normal]: played battles with no hero, Aldric and Corwin. Each seed's no-hero
 * battle records the build AI's purchases, and all three replay them, so a hero is measured against the same towers.
 * Left to itself, the AI reacts to a hero's kills (gold arrives sooner, so it buys different towers before the bat
 * waves), and that swung River Crossing by 40 points either way. The replay leaves a hero's extra gold unspent,
 * so these numbers measure the hero's fighting, not its income. Each line shows a mean ± its standard error;
 * gaps under about two of those are run-to-run luck.
 */
function heroRuns(maps: number[], runs: number, difficulty: Difficulty) {
  for (const m of maps) {
    console.log(`\n${MAPS[m].name} (${runs} played battles each, ${difficulty}, the same purchases)`);
    const plans = Array.from({ length: runs }, (_, i) => { const record: Purchase[] = []; simulatePlayed(m, i + 1, { difficulty, record }); return record; });
    for (const hero of [undefined, 'aldric', 'corwin'] as const) {
      const report: HeroReport = { deaths: 0, casts: {} };
      const rs = plans.map((replay, i) => simulatePlayed(m, i + 1, { hero, report, difficulty, replay }));
      const show = (xs: number[], k = 1, d = 0) => `${(mean(xs) * k).toFixed(d).padStart(4)} ±${(sd(xs) / Math.sqrt(xs.length) * k).toFixed(d)}`;
      const casts = Object.entries(report.casts).map(([k, n]) => `${k} ${(n / runs).toFixed(1)}`).join(', ');
      console.log(`  ${(hero ?? 'no hero').padEnd(8)} wins ${show(rs.map(r => r[0]), 100)}%  castle ${show(rs.map(r => r[1]))}  wave ${show(rs.map(r => r[2]), 1, 1)}` +
        (hero ? `  falls ${(report.deaths / runs).toFixed(1)}  casts: ${casts || 'none'}` : ''));
    }
  }
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
  if (process.argv.includes('--heroes')) { heroRuns(maps, runs, (arg('--difficulty') ?? 'normal') as Difficulty); process.exit(0); }
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
