export const HEROES = {
  aldric: {
    name: 'Aldric Vane',
    title: 'The Last Captain',
    role: 'Frontline captain',
    lore: 'Aldric held Greyhollow’s gate for three nights. On the fourth he led forty survivors to the Keep, and the beacon went dark behind him. He has stood at the front of every fight since.',
    passive: 'Hold Fast',
    hp: 400, dmg: 28, rate: 1.1, armor: 0.25, mr: 0.15, reach: 0.95, blocks: 3,
    aura: 3, protection: 0.15, cleave: 0.5, // each swing also hits every other enemy he holds for half damage
  },
  corwin: {
    name: 'Corwin Ashguard',
    title: 'The Ember Warden',
    role: 'Fire caster',
    lore: 'Corwin walked out of the burning chapterhouse at Cinderwell carrying a single coal. He has kept it alive in his iron lantern ever since.',
    passive: 'Lantern Light',
    hp: 230, dmg: 20, rate: 1.45, armor: 0.05, mr: 0.25, reach: 4.5, blocks: 0,
    aura: 3, resistLoss: 0.2,
  },
};

export const HERO_RECOVERY = 12;
export const HERO_SPEED = 4;
export const HERO_BURN_DPS = 7;
/** Share of max health a hero heals each second after 2 s out of combat, like a Paladin. */
export const HERO_REGEN = 0.1;

/**
 * Each hero has a passive and three skills that cast themselves, as in Kingdom Rush: the player only moves the hero.
 * `crowd` is how many ground enemies a skill waits for within `near` tiles (Undying Coal counts burning enemies instead).
 */
export const HERO_ABILITIES = {
  'rally-the-line': { hero: 'aldric', name: 'Rally the Line', cd: 20, duration: 6, radius: 3, haste: 0.3, boost: 0.2, crowd: 2 }, // haste: soldiers; boost: Aldric and towers
  'shield-wall': { hero: 'aldric', name: 'Shield Wall', cd: 30, duration: 4, protection: 0.7, crowd: 3, near: 3, low: 0.4 },
  'the-gate-holds': { hero: 'aldric', name: 'The Gate Holds', hits: 40, duration: 8, radius: 3, reflect: 0.5, crowd: 2 },
  kindle: { hero: 'corwin', name: 'Kindle', cd: 12, duration: 5, radius: 1.5, interval: 0.5, burn: 1.5, crowd: 2 },
  'ashen-ward': { hero: 'corwin', name: 'Ashen Ward', cd: 25, duration: 8, radius: 2.5, push: 1, burn: 2, crowd: 2 },
  'undying-coal': { hero: 'corwin', name: 'Undying Coal', dmg: 120, gold: 1, crowd: 5 },
} as const;

export type HeroKey = keyof typeof HEROES;
export type HeroAbility = keyof typeof HERO_ABILITIES;

const rally = HERO_ABILITIES['rally-the-line'];
const shield = HERO_ABILITIES['shield-wall'];
const gate = HERO_ABILITIES['the-gate-holds'];
const kindle = HERO_ABILITIES.kindle;
const ward = HERO_ABILITIES['ashen-ward'];
const coal = HERO_ABILITIES['undying-coal'];

export const HERO_ABILITY_TEXT: Record<HeroAbility, string> = {
  'rally-the-line': `When ${rally.crowd} ground enemies reach Aldric, he raises a banner for ${rally.duration} s. Within ${rally.radius} tiles, soldiers attack ${rally.haste * 100}% faster and fallen ones return immediately, and Aldric and towers attack ${rally.boost * 100}% faster.`,
  'shield-wall': `When ${shield.crowd} ground enemies are within ${shield.near} tiles, or Aldric drops below ${shield.low * 100}% health in a fight, he braces for ${shield.duration} s: he takes ${shield.protection * 100}% less damage and holds every ground enemy within reach.`,
  'the-gate-holds': `After Aldric takes ${gate.hits} hits, the next time ${gate.crowd} ground enemies are close he raises a spectral gate on the road for ${gate.duration} s. It stops ground enemies and reflects ${gate.reflect * 100}% of their attacks. Soldiers within ${gate.radius} tiles survive at 1 health or higher.`,
  kindle: `When ${kindle.crowd} ground enemies bunch up within Corwin’s range, he ignites the road under them for ${kindle.duration} s. Enemies that cross it take stacking burn damage.`,
  'ashen-ward': `When ${ward.crowd} ground enemies close on a tower within Corwin’s range, he wards it for ${ward.duration} s. Its attacks ignite enemies, and ground enemies within ${ward.radius} tiles, except bosses, are pushed back ${ward.push} tile once.`,
  'undying-coal': `Once per battle, when ${coal.crowd} enemies are burning or a boss is, deals ${coal.dmg} magic damage to every burning enemy. For the rest of the battle, burning kills earn ${coal.gold} extra gold.`,
};
