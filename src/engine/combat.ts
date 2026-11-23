// An enemy fights the soldier blocking it, or (Shaman) shoots the nearest soldier in range; true = it stops walking.
// Ported from main.js enemyCombat: hit timing, the Boar Rider's charge, the Ogre's cleave, bosses' splash.
import { ATK } from '../content/enemies.ts';
import type { Enemy } from './enemies.ts';
import { hurtSoldier, type Soldier } from './soldiers.ts';
import type { Game } from './state.ts';

type Attack = [dmg: number, every: number, reach: number, kind: 'phys' | 'magic'];

export function enemyCombat(g: Game, e: Enemy, dt: number): boolean {
  const A = (ATK as unknown as Record<string, Attack>)[e.type];
  if (!A || e.def.air || !g.soldiers.length) { e.blocker = null; return false; }
  let foe: Soldier | null = e.blocker && e.blocker.alive && (e.blocker.target === e || e.blocker.extra === e) ? e.blocker : null;
  if (!foe) e.blocker = null;
  if (foe && e.type === 'rider' && !e.charged) { // the first block: the boar charges through for 12
    e.charged = true; hurtSoldier(g, foe, 12, 'phys');
    if (foe.target === e) foe.target = null; if (foe.extra === e) foe.extra = null; e.blocker = null;
    return false;
  }
  if (!foe && A[2] > 1.5) { let bd = A[2] * A[2]; for (const s of g.soldiers) { if (!s.alive) continue; const d = (s.x - e.x) ** 2 + (s.z - e.z) ** 2; if (d < bd) { bd = d; foe = s; } } }
  e.shooting = foe && foe !== e.blocker ? foe : null;
  if (!foe) return false;
  e.atkT = (e.atkT ?? A[1] * 0.5) - dt;
  if (e.atkT <= 0) {
    e.atkT = A[1]; g.events.push({ t: 'enemyHit', e, s: foe });
    const ad = A[0] * g.dmgMul, f = foe;
    const nearFoe = (s: Soldier) => s.alive && (s.x - f.x) ** 2 + (s.z - f.z) ** 2 < 1;
    if (e.type === 'gruk' || e.type === 'boss') { for (const s of g.soldiers) if (nearFoe(s)) hurtSoldier(g, s, ad, A[3]); } // splash 1 tile
    else if (e.type === 'brute') { const o = g.soldiers.find(s => s !== f && nearFoe(s)); hurtSoldier(g, f, ad, A[3]); if (o) hurtSoldier(g, o, ad, A[3]); } // cleaves 2
    else hurtSoldier(g, f, ad, A[3]);
  }
  const dx = foe.x - e.x, dz = foe.z - e.z; if (dx || dz) e.faceT = Math.atan2(dx, dz);
  return true;
}
