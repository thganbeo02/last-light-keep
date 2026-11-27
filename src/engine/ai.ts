// The AI player behind Watch mode, and the simulator's player. Ported from main.js (WANT, computeKS, covDyn,
// coverage, bestSpot, drumSpot, drumValue, aiThink, and the Watch mode opening in resetGame).
// Every .7 s it scores each build and upgrade as road covered × damage × need ÷ cost and buys the best it can afford.
import { WANT } from '../content/ai.ts';
import { ED } from '../content/enemies.ts';
import { DTYPE, SPEC, TT } from '../content/towers.ts';
import { drumAsStat, drumStat, type DrumKey } from './drum.ts';
import { spawnEnemy } from './enemies.ts';
import { moveHero } from './heroes.ts';
import { startWave, tick, DT } from './game.ts';
import { int, range } from './rng.ts';
import { barrAsStat, barrStat, type BarrKey } from './soldiers.ts';
import { makeGame, type Game, type GameOptions } from './state.ts';
import {
  buildTower, rankCost, specialise, specStat, stats, tStat, upCost, upgradeTower,
  type SpecKey, type Spot, type Stat, type Tower, type TowerType,
} from './towers.ts';
import { waveCounts } from './waves.ts';

type FormStat = Stat & { haste?: number; rngB?: number; hex?: number };
const TYPES = Object.keys(TT) as TowerType[];

/** Stats of any tower type at a level, as main.js tStat gives them (Barracks and War Drum in their own terms). */
function levelStat(g: Game, type: TowerType, lvl: number): FormStat {
  if (type === 'barracks') return barrAsStat(barrStat(g, Math.min(lvl, 3) as BarrKey));
  if (type === 'drum') return drumAsStat(drumStat(g, Math.min(lvl, 3) as DrumKey));
  return tStat(g, type, lvl);
}
function formSpecStat(g: Game, type: TowerType, k: SpecKey, rank = 1): FormStat {
  if (type === 'barracks') return barrAsStat(barrStat(g, k, rank));
  if (type === 'drum') return drumAsStat(drumStat(g, k, rank));
  return specStat(g, type, k, rank);
}

/** Road samples within r of a plot, weighted toward the castle (cached per plot and radius, like main.js). */
const covCache = new WeakMap<Spot, Map<string, number>>();
export function coverage(g: Game, s: Spot, r: number): number {
  let m = covCache.get(s); if (!m) covCache.set(s, m = new Map());
  const k = r.toFixed(1), hit = m.get(k); if (hit !== undefined) return hit;
  let c = 0; const r2 = r * r;
  for (const p of g.map.samples) { const dx = p.x - s.x, dz = p.z - s.z; if (dx * dx + dz * dz < r2) c += p.w; }
  m.set(k, c); return c;
}

/** How many towers already cover each road sample. */
function computeKS(g: Game): Float32Array {
  const ks = new Float32Array(g.map.samples.length);
  for (const t of g.towers) { const r2 = stats(g, t).range ** 2; g.map.samples.forEach((p, i) => { if ((p.x - t.x) ** 2 + (p.z - t.z) ** 2 < r2) ks[i]++; }); }
  return ks;
}
/** Coverage that counts road already covered by other towers for less. */
function covDyn(g: Game, ks: Float32Array, s: { x: number; z: number }, r: number) {
  let c = 0; const r2 = r * r;
  for (let i = 0; i < g.map.samples.length; i++) { const p = g.map.samples[i], dx = p.x - s.x, dz = p.z - s.z; if (dx * dx + dz * dz < r2) c += p.w / (1 + 0.5 * ks[i]); }
  return c;
}

function bestSpot(g: Game, ks: Float32Array, type: TowerType, r: number) {
  let best: number | null = null, bs = -1;
  g.spots.forEach((s, i) => {
    if (s.used || s.block) return;
    let c = covDyn(g, ks, s, r);
    if (type === 'flame' || type === 'frost') c *= 1 + coverage(g, s, 2.2) * 0.02; // short-range towers like tight bends
    c *= 1 + range(g.rng, -0.06, 0.06);
    if (c > bs) { bs = c; best = i; }
  });
  return best === null ? null : { plot: best as number, cov: bs };
}

/** What a drum is worth at (x, z): the extra damage of the towers it would boost. */
function drumValue(g: Game, x: number, z: number, s: FormStat) {
  let v = 0;
  for (const t of g.towers) {
    if (t.type === 'drum' || t.type === 'barracks' || (t.x - x) ** 2 + (t.z - z) ** 2 > s.range * s.range) continue;
    const st = stats(g, t), base = coverage(g, g.spots[t.plot], st.range) * st.dps;
    v += base * Math.max(0, (s.haste! - (t.haste || 0)) + (s.rngB || 0) * 0.6 + (s.hex || 0));
  }
  return v * 0.35; // coverage here ignores kill pressure, so damage towers' scores run lower
}
function drumSpot(g: Game, st: FormStat) {
  let best: number | null = null, bs = 0;
  g.spots.forEach((s, i) => { if (s.used || s.block) return; const v = drumValue(g, s.x, s.z, st) * range(g.rng, 0.94, 1.06); if (v > bs) { bs = v; best = i; } });
  return best === null ? null : { plot: best as number, cov: bs };
}

type Option =
  | { kind: 'build'; type: TowerType; plot: number; cost: number; score: number }
  | { kind: 'up' | 'rank'; t: Tower; cost: number; score: number }
  | { kind: 'spec'; t: Tower; k: SpecKey; cost: number; score: number };

/** One AI decision: score every option and buy one (main.js aiThink). */
export function aiThink(g: Game) {
  if (g.state !== 'play') return;
  const lv: Record<string, number> = {}; let tot = 0;
  for (const t of g.towers) { lv[t.type] = (lv[t.type] || 0) + t.lvl; tot += t.lvl; }
  const nextAir = g.wave >= 3 ? 0.25 : 0;
  let ar = 0, mr = 0, wsum = 0; // the next wave's armour and magic resist, weighted by health
  for (const [k, c] of Object.entries(waveCounts(g.def, g.wave + 1))) { const d = ED[k as keyof typeof ED]; ar += d.armor * d.hp * c; mr += d.mr * d.hp * c; wsum += d.hp * c; }
  ar /= wsum || 1; mr /= wsum || 1;
  const need = (type: TowerType) => { // more of what's missing from the mix, and what the next wave is weak to
    let n = 1 + (WANT[type] - (lv[type] || 0) / Math.max(1, tot)) * 4;
    const dt = (DTYPE as Record<string, string>)[type];
    n *= dt === 'phys' ? 1 - ar * 0.9 : dt === 'magic' ? 1 - mr * 0.9 : 1;
    if (nextAir) n *= TT[type].air ? 1 + nextAir : 1 - nextAir * 0.6;
    return Math.max(0.2, n);
  };
  const ks = computeKS(g), opts: Option[] = [], costMul = 1 + g.towers.length * 0.035; // each new tower costs the AI 3.5% more
  for (const type of TYPES) {
    const st = levelStat(g, type, 1), b = type === 'drum' ? drumSpot(g, st) : bestSpot(g, ks, type, st.range);
    if (!b) continue;
    const cost = Math.round(TT[type].cost * costMul);
    opts.push({ kind: 'build', type, plot: b.plot, cost, score: b.cov * (type === 'drum' ? 1 : st.dps) * need(type) * 1.3 / cost });
  }
  for (const t of g.towers) {
    if (t.buildT < 1) continue;
    const at = (s: FormStat) => coverage(g, g.spots[t.plot], s.range) * s.dps;
    if (t.type === 'drum') {
      const cur = stats(g, t), dv = (s2: FormStat) => drumValue(g, t.x, t.z, s2) - drumValue(g, t.x, t.z, cur);
      if (t.lvl === 3 && !t.spec) { for (const k of ['a', 'b'] as SpecKey[]) opts.push({ kind: 'spec', t, k, cost: SPEC.drum[k].cost, score: dv(formSpecStat(g, 'drum', k)) * need('drum') * range(g.rng, 0.85, 1.15) / SPEC.drum[k].cost }); continue; }
      if (t.spec) { if (t.rank < 3) { const cost = rankCost('drum', t.spec, t.rank + 1); opts.push({ kind: 'rank', t, cost, score: dv(formSpecStat(g, 'drum', t.spec, t.rank + 1)) * need('drum') / cost }); } continue; }
      const cost = upCost(t); opts.push({ kind: 'up', t, cost, score: dv(levelStat(g, 'drum', t.lvl + 1)) * need('drum') * 1.1 / cost }); continue;
    }
    if (t.lvl === 3 && !t.spec) {
      const a = levelStat(g, t.type, 3);
      for (const k of ['a', 'b'] as SpecKey[]) { const b = formSpecStat(g, t.type, k), cost = SPEC[t.type][k].cost; opts.push({ kind: 'spec', t, k, cost, score: (at(b) - at(a)) * need(t.type) * range(g.rng, 0.85, 1.15) / cost }); }
      continue;
    }
    if (t.spec) { if (t.rank < 3) { const a = formSpecStat(g, t.type, t.spec, t.rank), b = formSpecStat(g, t.type, t.spec, t.rank + 1), cost = rankCost(t.type, t.spec, t.rank + 1); opts.push({ kind: 'rank', t, cost, score: (at(b) - at(a)) * need(t.type) * 0.9 / cost }); } continue; }
    if (t.lvl >= 3) continue;
    const a = levelStat(g, t.type, t.lvl), b = levelStat(g, t.type, t.lvl + 1), cost = upCost(t);
    opts.push({ kind: 'up', t, cost, score: (at(b) - at(a)) * need(t.type) * 1.1 / cost });
  }
  if (!opts.length) return;
  opts.sort((a, b) => b.score - a.score);
  const top = opts[0];
  let choice: Option | undefined;
  if (top.cost <= g.gold) choice = top;
  else if (g.gold < top.cost * 0.55 || g.hp < 50) choice = opts.find(o => o.cost <= g.gold && o.score > top.score * 0.65); // settle for something nearly as good
  if (!choice) return;
  if (choice.kind === 'build') { const t = buildTower(g, choice.type, choice.plot, { free: true })!; g.gold -= choice.cost; t.spend = choice.cost; }
  else if (choice.kind === 'spec') specialise(g, choice.t, choice.k);
  else upgradeTower(g, choice.t);
}

/**
 * A Watch mode battle as 3.x starts one: one of each tower already standing on well-placed plots, little gold,
 * wave 1 under way with up to 7 enemies already on covered road, and 3 s played. The AI then plays it.
 */
export function makeWatchGame(o: Omit<GameOptions, 'mode'>): Game {
  const g = makeGame({ ...o, mode: 'watch' });
  g.ai = aiThink;
  const order = [...TYPES];
  for (let i = order.length - 1; i > 0; i--) { const j = int(g.rng, 0, i); [order[i], order[j]] = [order[j], order[i]]; }
  for (const type of order) {
    const st = levelStat(g, type, 1), ks = computeKS(g);
    const cands = g.spots.map((s, i) => ({ i, s })).filter(c => !c.s.used && !c.s.block).map(c => ({ ...c, c: covDyn(g, ks, c.s, st.range) })).sort((a, b) => b.c - a.c).slice(0, 4);
    if (cands.length) buildTower(g, type, cands[int(g.rng, 0, cands.length - 1)].i, { instant: true, free: true });
  }
  g.gold = 90 + g.def.gold - 250;
  startWave(g);
  const covered = g.map.samples.filter(p => g.towers.some(t => Math.hypot(t.x - p.x, t.z - p.z) < stats(g, t).range - 0.5));
  const pre = Math.min(g.spawnQ.length, 7);
  for (let i = 0; i < pre; i++) {
    const s = g.spawnQ.shift()!, c = covered.length ? covered[int(g.rng, 0, covered.length - 1)] : g.map.samples[int(g.rng, 8, 60)];
    spawnEnemy(g, s.type, c.d, c.path);
  }
  for (let i = 0; i < 90; i++) tick(g, [], DT);
  return g;
}

/**
 * The simulator's hero player. Each wave it posts Aldric where two towers' cover begins, farthest from the castle,
 * and Corwin on the road the towers cover most, nearest the castle, and walks the hero back there between fights.
 * The hero's skills cast themselves. Hero balance is measured against this player, not a human,
 * so compare its numbers between versions rather than reading them as a player's.
 */
const posts = new WeakMap<Game, { wave: number; x: number; z: number }>();
export function heroThink(g: Game) {
  const h = g.hero;
  if (!h?.unit.alive) return;
  const s = h.unit;
  let post = posts.get(g);
  if (!post || post.wave !== g.wave) {
    const ks = computeKS(g), sm = g.map.samples;
    let bi = 0;
    if (h.key === 'aldric') sm.forEach((p, i) => { if (ks[i] >= 2 && (ks[bi] < 2 || p.w < sm[bi].w)) bi = i; }); // the front of the towers' cover
    else sm.forEach((p, i) => { if (ks[i] * p.w > ks[bi] * sm[bi].w) bi = i; });
    const p = sm[bi];
    posts.set(g, post = { wave: g.wave, x: p.x, z: p.z });
  }
  if (!s.target && !h.route.length && (s.x - post.x) ** 2 + (s.z - post.z) ** 2 > 1) moveHero(g, post);
}
