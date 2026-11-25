// The game loop: tick(g, inputs) advances a battle by one fixed step, in main.js updateGame order, after applying
// the player's inputs. Also the battle's rules: calling waves (and the early-call bonus), the countdown between
// waves, the wave-clear bonus, victory and stars. Ported from main.js (updateGame, startWave, sendWave, showEnd).
import { drumPass } from './drum.ts';
import type { HeroAbility } from '../content/heroes.ts';
import { spawnEnemy, updateEnemy } from './enemies.ts';
import { castHero, moveHero, updateHero } from './heroes.ts';
import { updateProjectiles } from './projectiles.ts';
import { rallyPick, setRally, updateSoldier } from './soldiers.ts';
import { castSpell, spellSpot, spellsTick, type SpellKey } from './spells.ts';
import { has, type Game, type GameEvent } from './state.ts';
import { buildTower, cycleAim, sellTower, specialise, updateTower, upgradeTower, type SpecKey, type TowerType } from './towers.ts';
import { waveGroups } from './waves.ts';

export const DT = 1 / 30;

/** Everything a player can do. Towers are named by id; spells and the rally point aim at a ground point. */
export type Input =
  | { do: 'build'; type: TowerType; plot: number }
  | { do: 'upgrade'; tower: number }
  | { do: 'specialise'; tower: number; k: SpecKey }
  | { do: 'sell'; tower: number }
  | { do: 'aim'; tower: number }
  | { do: 'rally'; tower: number; x: number; z: number }
  | { do: 'callWave' }
  | { do: 'heroMove'; x: number; z: number }
  | { do: 'heroCast'; k: HeroAbility; at?: { x: number; z: number }; targetTower?: number }
  | { do: 'cast'; k: SpellKey; x: number; z: number };

/** Starts the next wave: queues its spawns. */
export function startWave(g: Game) {
  g.wave++; g.clearPaid = false;
  const w = waveGroups(g.def, g.wave, g.rng);
  g.spawnQ = w.q; g.spawnT = 1; g.sinceSpawn = 0;
  g.events.push({ t: 'wave', n: g.wave, bosses: w.bosses });
}

/** Calls the next wave now. Early (before its countdown ends) pays 2 gold per second left, +25% with Early Bird,
 *  and takes the seconds left off every spell's cooldown. */
export function sendWave(g: Game, early: boolean) {
  if (g.mode !== 'play' || g.state !== 'play' || g.spawnQ.length || g.wave >= g.def.waves) return;
  const bonus = early && g.wave > 0 ? Math.max(0, Math.round(g.countdown * 2 * (has(g, 'kingdom.early') ? 1.25 : 1))) : 0;
  g.gold += bonus; g.earned += bonus;
  const skip = early && g.wave > 0 ? Math.max(0, g.countdown) : 0;
  for (const k in g.scd) g.scd[k] = Math.max(0, g.scd[k] - skip);
  startWave(g);
}

/** Stars for a finished battle: 3 above 80% castle health, 2 above 40%, 1 for any other win, 0 for a loss. */
export function stars(g: Game): number {
  if (g.state !== 'victory') return 0;
  const hf = g.hp / (g.maxHp || 100);
  return hf > 0.8 ? 3 : hf > 0.4 ? 2 : 1;
}

function apply(g: Game, i: Input) {
  const tower = 'tower' in i ? g.towers.find(t => t.id === i.tower) : undefined;
  if (g.state !== 'play') return;
  switch (i.do) {
    case 'build': buildTower(g, i.type, i.plot); break;
    case 'upgrade': if (tower) upgradeTower(g, tower); break;
    case 'specialise': if (tower) specialise(g, tower, i.k); break;
    case 'sell': if (tower) sellTower(g, tower); break;
    case 'aim': if (tower) cycleAim(tower); break;
    case 'rally': if (tower?.type === 'barracks') { const r = rallyPick(g, tower, i.x, i.z); if (r) setRally(tower, r); } break;
    case 'callWave': sendWave(g, true); break;
    case 'heroMove': { const why = g.hero?.unit.alive && moveHero(g, i); if (why) g.events.push({ t: 'heroMoveBlocked', why }); break; }
    case 'heroCast': castHero(g, i.k, i.at, i.targetTower); break;
    case 'cast': { const q = spellSpot(g, i.k, i.x, i.z); if (q) castSpell(g, i.k, q); break; }
  }
}

/** One fixed step. Returns the events it produced (the renderer plays them). */
export function tick(g: Game, inputs: Input[] = [], dt = DT): GameEvent[] {
  g.events = [];
  for (const i of inputs) apply(g, i);
  g.time += dt;
  if (g.state === 'play') {
    if (g.spawnQ.length) { // spawning: one at a time, each after its delay
      g.spawnT -= dt;
      if (g.spawnT <= 0) {
        const s = g.spawnQ.shift()!; spawnEnemy(g, s.type, 0, s.path % g.map.paths.length);
        g.spawnT = g.spawnQ.length ? g.spawnQ[0].delay : 0; g.sinceSpawn = 0;
        if (!g.spawnQ.length) g.countdown = 20;
      }
    } else if (g.mode === 'play') {
      if (g.wave >= g.def.waves) { if (!g.enemies.length) victory(g); }
      else if (g.wave > 0) { g.countdown -= dt; if (g.countdown <= 0) sendWave(g, false); } // wave 1 waits for the player
    } else { // Watch mode: the next wave comes when the field thins out or after 16 s
      g.sinceSpawn += dt;
      if (g.wave >= g.def.waves) { if (!g.enemies.length) victory(g); }
      else if (g.enemies.length < 4 || g.sinceSpawn > 16) { g.waveGap += dt; if (g.waveGap > 2.5) { g.waveGap = 0; startWave(g); } }
    }
    if (g.mode === 'play' && g.wave > 0 && !g.clearPaid && !g.spawnQ.length && !g.enemies.length && g.state === 'play') { // wave cleared
      const b = Math.round((20 + 5 * g.wave) * (has(g, 'kingdom.muster') ? 1.25 : 1)) + (has(g, 'kingdom.interest') ? Math.min(25, Math.round(g.gold * 0.05)) : 0);
      g.gold += b; g.earned += b; g.clearPaid = true; g.events.push({ t: 'cleared', n: g.wave, bonus: b });
      if (has(g, 'kingdom.repair') && g.hp > 0) g.hp = Math.min(g.maxHp, g.hp + 2);
    }
    if (g.mode !== 'play') { g.aiT -= dt; if (g.aiT <= 0) { g.aiT = 0.7; g.ai?.(g); } } // the AI player thinks every .7 s
  }
  for (const e of g.enemies) if (e.alive) updateEnemy(g, e, dt);
  if (g.state === 'play') updateHero(g, dt);
  for (const s of g.soldiers) if (s.alive && s !== g.hero?.unit) updateSoldier(g, s, dt);
  spellsTick(g, dt);
  g.soldiers = g.soldiers.filter(s => s.alive);
  drumPass(g, dt);
  for (const t of g.towers) updateTower(g, t, t.haste && t.buildT >= 1 ? dt * (1 + t.haste) : dt); // haste speeds its whole clock
  g.enemies = g.enemies.filter(e => e.alive);
  updateProjectiles(g, dt);
  return g.events;
}

function victory(g: Game) { g.state = 'victory'; g.events.push({ t: 'victory', stars: stars(g) }); }
