// Melee between enemies and Barracks soldiers. A placeholder until the Barracks step of docs/M1.md ports
// main.js enemyCombat: with no soldiers on the field, no enemy is ever held in a fight.
import type { Enemy } from './enemies.ts';
import type { Game } from './state.ts';

export function enemyCombat(_g: Game, _e: Enemy, _dt: number): boolean {
  return false;
}
