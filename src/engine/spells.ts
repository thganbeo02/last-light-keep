// Spells: Militia Call and Catapult Barrage (from 1-2), Frost Nova (from 3-1). Ported from main.js (spellsFor,
// pickSpell's checks, spellSpot, castSpell, spellsTick, class Boulder).
import { MILITIA, SPELLS } from '../content/spells.ts';
import { smoothPath } from './map.ts';
import { freezeEnemy } from './projectiles.ts';
import { next, range } from './rng.ts';
import { makeSoldier, type BarrStat, type SoldierHost } from './soldiers.ts';
import { groundY, type Game } from './state.ts';

export type SpellKey = keyof typeof SPELLS;
export const SPELL_KEYS: SpellKey[] = ['militia', 'catapult', 'nova'];

/** Spells open on a campaign level (index into LEVELS): two from 1-2, Frost Nova from 3-1 (index 7); all in testing mode. */
export const spellsFor = (level: number, dev = false): SpellKey[] => SPELL_KEYS.filter(k => dev || (k === 'nova' ? level >= 7 : level >= 1));

export interface CatapultFx { kind: 'cat'; q: { x: number; z: number }; t: number; fired: boolean }

/** Why a spell can't be cast now, or null. Spells wait for the first wave and their cooldown; only played battles have them. */
export function cantCast(g: Game, k: SpellKey): string | null {
  if (g.mode !== 'play' || g.state !== 'play' || !g.spells.includes(k)) return 'not available';
  if (g.wave < 1) return 'ready once the first wave is called';
  if ((g.scd[k] || 0) > 0) return 'cooling down';
  return null;
}

/** Where a spell aimed at (x, z) lands: Militia snap to the nearest road sample within 2; the others hit any ground. */
export function spellSpot(g: Game, k: SpellKey, x: number, z: number): { x: number; z: number } | null {
  if (groundY(g, x, z) < -1) return null; // off the map
  if (k !== 'militia') return { x, z };
  let best = null, bd = 4;
  for (const s of g.map.samples) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
  return best && { x: best.x, z: best.z };
}

export function castSpell(g: Game, k: SpellKey, q: { x: number; z: number }): boolean {
  if (cantCast(g, k)) return false;
  const S = SPELLS[k]; g.scd[k] = S.cd; g.spellUsed = true;
  if (k === 'militia') { // two militiamen hold the road for 12 s
    const host: SoldierHost = { x: q.x, z: q.z, rally: { x: q.x, z: q.z }, bs: MILITIA as BarrStat, resp: [], soldiers: [] };
    for (let i = 0; i < MILITIA.n; i++) { const s = makeSoldier(g, host, i, true); s.ttl = 12; host.soldiers.push(s); }
  } else if (k === 'catapult') {
    g.spellFx.push({ kind: 'cat', q, t: 0, fired: false });
  } else { // Frost Nova: freeze ground enemies in reach; bosses are slowed instead
    for (const e of g.enemies) {
      if (!e.alive || e.def.air || (e.x - q.x) ** 2 + (e.z - q.z) ** 2 > S.r * S.r) continue;
      if (e.type === 'boss' || e.type === 'gruk') { e.slowF = Math.min(e.slow > 0 ? e.slowF : 1, 0.5); e.slow = Math.max(e.slow, 2.5); }
      else freezeEnemy(g, e, 2.5, null);
    }
  }
  g.events.push({ t: 'cast', k, at: q });
  return true;
}

/** Cooldowns, and the Catapult Barrage: boulders leave the castle at 2 s and land at about 3 s. */
export function spellsTick(g: Game, dt: number) {
  if (g.mode !== 'play') return;
  for (const k in g.scd) if (g.scd[k] > 0) g.scd[k] = Math.max(0, g.scd[k] - dt);
  g.spellFx = g.spellFx.filter(f => {
    f.t += dt;
    if (!f.fired && f.t >= 2) {
      f.fired = true;
      const P = g.map.paths[0], c = smoothPath(P, P.len - 0.4);
      for (let i = 0; i < 5; i++) { // five boulders anywhere in a 1.7 circle, each a little later than the last
        const a = range(g.rng, 0, 6.28), r = Math.sqrt(next(g.rng)) * 1.7, to = { x: f.q.x + Math.cos(a) * r, y: 0, z: f.q.z + Math.sin(a) * r };
        to.y = groundY(g, to.x, to.z) + 0.2;
        g.projs.push({ k: 'boulder', s: { x: c.x + range(g.rng, -1, 1), y: 0.92 + 3, z: c.z + range(g.rng, -1, 1) }, aim: to, dmg: 60, T: 1 + i * 0.06, t: 0 });
      }
    }
    return f.t < 3.4;
  });
}
