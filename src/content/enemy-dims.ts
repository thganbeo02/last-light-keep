// Each enemy type's centre height above its feet, in world units. It comes from the 3D models (scaled by ES = 1.25),
// so it can't be extracted as a literal: it was recorded from the 3.x game with window.__enemyDims() on 2026-11-24.
// Ranges measured centre to centre in 3D (Shaman heal, Static Charge, Shatter) depend on it.
export const ENEMY_CY = {
  runner: 0.6461476433706206,
  soldier: 1.2121522637350732,
  knight: 1.0073585944553423,
  shaman: 0.8799999999999999,
  brute: 1.28925,
  golem: 1.3131249967217444,
  flyer: 0,
  wraith: 0,
  sapper: 0.899390032644025,
  rider: 0.8678665853377988,
  gruk: 2.0295,
  boss: 2.392299741798793,
} as const;
