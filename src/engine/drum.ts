// The War Drum and the once-a-tick boost pass. Ported from main.js (drumStat, drumPass, Tower.drumTick).
// drumPass also runs the War Council's timed effects (Last Stand's countdown, Arrow Slits, the Hunter's Mark,
// Bleed, Frost Bite), because that is where 3.x runs them.
import { DRUM } from '../content/barracks.ts';
import { hurt } from './enemies.ts';
import { smoothPath } from './map.ts';
import { fireArrow } from './projectiles.ts';
import { has, type Game } from './state.ts';
import type { SpecKey, Stat, Tower } from './towers.ts';

export type DrumKey = 1 | 2 | 3 | SpecKey;
/** haste: fire-rate boost; rad: radius; rngB: War Horn's range boost; hex: Hex Totem's extra damage taken */
export interface DrumStat { haste: number; rad: number; rngB?: number; hex?: number }

export function drumStat(g: Game, k: DrumKey, rank = 1): DrumStat {
  const d: DrumStat = { ...(DRUM as Record<DrumKey, DrumStat>)[k] }, r = rank - 1;
  d.haste = +(d.haste + 0.05 * r).toFixed(2); d.rad = +(d.rad + 0.3 * r).toFixed(1);
  if (d.rngB) d.rngB = +(d.rngB + 0.05 * r).toFixed(2);
  if (d.hex) d.hex = +(d.hex + 0.05 * r).toFixed(2);
  const h = (id: string) => has(g, id);
  if (h('drum.root')) d.haste = +(d.haste + 0.02).toFixed(2);
  if (h('drum.beat')) d.haste = +(d.haste + 0.03).toFixed(2);
  if (h('drum.hide')) d.rad = +(d.rad + 0.5).toFixed(1);
  if (k === 'a' && h('drum.hornm')) d.rngB = +(d.rngB! + 0.1).toFixed(2);
  if (k === 'b' && h('drum.totem')) d.hex = +(d.hex! + 0.07).toFixed(2);
  return d;
}
export const drumAsStat = (d: DrumStat): Stat & { haste: number; rngB: number; hex: number } => ({ dmg: 0, range: d.rad, rate: 1, dps: 0, haste: d.haste, rngB: d.rngB || 0, hex: d.hex || 0 });

/** Sets a drum's stats from its level or specialisation; called whenever it is built or upgraded. */
export const refreshDrum = (g: Game, t: Tower) => { t.ds = drumStat(g, (t.spec || Math.min(t.lvl, 3)) as DrumKey, t.spec ? t.rank : 1); };

/** Once a tick, before towers fire: timed War Council effects, then each tower's boost and each enemy's hex. */
export function drumPass(g: Game, dt: number) {
  if (g.standT > 0) g.standT -= dt;
  if (has(g, 'kingdom.slits') && g.state === 'play') { // Arrow Slits: the castle shoots the nearest enemy within 4, once a second
    g.slitT -= dt;
    if (g.slitT <= 0) {
      const P = g.map.paths[0], c = smoothPath(P, P.len - 0.4); let best = null, bd = 16;
      for (const e of g.enemies) { if (!e.alive) continue; const d2 = (e.x - c.x) ** 2 + (e.z - c.z) ** 2; if (d2 < bd) { bd = d2; best = e; } }
      if (best) { g.slitT = 1; fireArrow(g, { x: c.x, y: 0.92 + 2.6, z: c.z }, best, 8, false, {}); }
    }
  }
  const fb = has(g, 'frost.bite');
  for (const e of g.enemies) {
    if (!e.alive) continue;
    if (e.markT > 0) e.markT -= dt;
    if (e.bleedT > 0) { e.bleedT -= dt; hurt(g, e, 4 * dt, 'phys'); if (!e.alive) continue; } // Bleed: 4 a second
    if (fb && e.slow > 0) hurt(g, e, 2 * dt, 'magic'); // Frost Bite: 2 a second while slowed
  }
  const drums = g.towers.filter(t => t.type === 'drum' && t.buildT >= 1 && !(t.stunT > 0));
  for (const t of g.towers) {
    if (t.type === 'drum') continue;
    let h = 0, h2 = 0, rb = 0;
    for (const d of drums) { // the strongest drum in reach counts; Twin Drums adds half the second-strongest
      const s = d.ds as DrumStat, r = s.rad;
      if ((d.x - t.x) ** 2 + (d.z - t.z) ** 2 <= r * r) { if (s.haste > h) { h2 = h; h = s.haste; } else h2 = Math.max(h2, s.haste); rb = Math.max(rb, s.rngB || 0); }
    }
    if (has(g, 'drum.twin')) h += h2 * 0.5;
    if (g.standT > 0) h = Math.max(h, 0.3); // Last Stand
    t.haste = h; t.rngB = t.type === 'barracks' ? 0 : rb;
  }
  const hexers = drums.filter(d => (d.ds as DrumStat).hex);
  for (const e of g.enemies) {
    let x = 0;
    if (hexers.length && e.alive) for (const d of hexers) { const s = d.ds as DrumStat, r = s.rad; if ((d.x - e.x) ** 2 + (d.z - e.z) ** 2 <= r * r) x = Math.max(x, s.hex!); }
    e.hex = x;
  }
}

/** A drum's own War Council abilities: Thunder (a stun every 12 s) and, for War Horns, Charge (a push back every 20 s). */
export function drumTick(g: Game, t: Tower, dt: number) {
  if (g.state !== 'play') return;
  const s = t.ds as DrumStat, r2 = s.rad * s.rad;
  const inR = (e: Game['enemies'][number]) => e.alive && !e.def.air && (e.x - t.x) ** 2 + (e.z - t.z) ** 2 <= r2;
  if (has(g, 'drum.thund')) { t.thT = (t.thT ?? 12) - dt; if (t.thT <= 0) { t.thT = 12; for (const e of g.enemies) if (inR(e)) e.stun = Math.max(e.stun, 0.5); } }
  if (t.spec === 'a' && has(g, 'drum.charge')) { t.chT = (t.chT ?? 20) - dt; if (t.chT <= 0) { t.chT = 20; for (const e of g.enemies) if (inR(e) && e.type !== 'boss' && e.type !== 'gruk') e.d = Math.max(0, e.d - 1); } }
}
