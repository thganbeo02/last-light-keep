export const HEROES = {
  aldric: {
    name: 'Aldric Vane',
    title: 'The Last Captain',
    role: 'Frontline captain',
    lore: 'Aldric held Greyhollow’s gate for three nights. On the fourth he led forty survivors to the Keep, and the beacon went dark behind him. He has stood at the front of every fight since.',
    passive: 'Hold Fast',
    hp: 400, dmg: 22, rate: 1.1, armor: 0.25, mr: 0.15, reach: 0.95, blocks: 3,
    aura: 3, protection: 0.15,
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

export const HERO_RECOVERY = 15;
export const HERO_SPEED = 4;
export const HERO_BURN_DPS = 7;

export const HERO_ABILITIES = {
  'rally-the-line': { hero: 'aldric', name: 'Rally the Line', target: 'self', cd: 20, duration: 6, radius: 3, haste: 0.3 },
  'shield-wall': { hero: 'aldric', name: 'Shield Wall', target: 'self', cd: 30, duration: 4, protection: 0.7 },
  'the-gate-holds': { hero: 'aldric', name: 'The Gate Holds', target: 'self', hits: 40, duration: 8, radius: 3, reflect: 0.5 },
  kindle: { hero: 'corwin', name: 'Kindle', target: 'road', cd: 12, duration: 5, radius: 1.5, interval: 0.5, burn: 1.5 },
  'ashen-ward': { hero: 'corwin', name: 'Ashen Ward', target: 'tower', cd: 25, duration: 8, radius: 1.5, push: 1, burn: 2 },
  'undying-coal': { hero: 'corwin', name: 'Undying Coal', target: 'self', dmg: 120, gold: 3 },
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
  'rally-the-line': `Raises a banner for ${rally.duration} s. Soldiers within ${rally.radius} tiles attack ${rally.haste * 100}% faster and fallen Barracks soldiers there return immediately.`,
  'shield-wall': `Aldric takes ${shield.protection * 100}% less damage for ${shield.duration} s and holds every ground enemy within reach.`,
  'the-gate-holds': `After taking ${gate.hits} hits, raise a spectral gate for ${gate.duration} s. It stops ground enemies and reflects ${gate.reflect * 100}% of their attacks. Soldiers within ${gate.radius} tiles survive at 1 health or higher.`,
  kindle: `Ignites a road patch for ${kindle.duration} s. Enemies that cross it take stacking burn damage.`,
  'ashen-ward': `Wards a tower for ${ward.duration} s. Its attacks ignite enemies, and nearby ground enemies are pushed back ${ward.push} tile once.`,
  'undying-coal': `Once per battle. Deals ${coal.dmg} magic damage to all burning enemies. For the rest of the battle, burning kills earn ${coal.gold} extra gold.`,
};
