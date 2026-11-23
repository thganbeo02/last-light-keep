// Muzzle height above the ground (world y; towers stand at y = 1) for each attacking tower form. Projectiles start
// there, so it sets how long an arrow or shard flies. It comes from the 3D models, so it can't be extracted as a
// literal: recorded from the 3.x game with window.__muzzles() on 2026-11-24 (it is the same at every rank).
// Cannons average their barrels.
export const MUZZLE_Y = {
  arrow: { 1: 4.0305, 2: 4.0305, 3: 4.0305, a: 4.0305, b: 4.0305 },
  cannon: { 1: 2.2001362613639, 2: 2.5481362613639, 3: 2.5481362613639, a: 3.014206452354757, b: 2.4673634665766362 },
  frost: { 1: 3.4795, 2: 3.117, 3: 3.552, a: 3.7405, b: 3.1605 },
  tesla: { 1: 3.987, 2: 4.2625, 3: 4.538, a: 3.987, b: 3.813 },
  flame: { 1: 2.5225, 2: 2.5225, 3: 2.8125, a: 2.131, b: 2.653 },
} as const;
