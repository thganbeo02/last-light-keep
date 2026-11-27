import { HERO_ABILITIES } from './content/heroes.ts';

// Pose the same voxel rig in battle and in the Almanac. Times are seconds.
const ALDRIC = {
  slash: [
    [0, { rightArm: -.3 }],
    [.13, { leftArm: -2.1, rightArm: -.6, turn: -.36, pitch: -.15, left: .25 }],
    [.19, { leftArm: .7, rightArm: -.38, turn: .38, pitch: .24, forward: .17, left: -.55, right: .28 }],
    [.36, {}],
  ],
  hurt: [
    [0, {}],
    [.07, { pitch: -.28, leftArm: .48, rightArm: -.55, forward: -.1, right: -.26 }],
    [.24, {}],
  ],
  'rally-the-line': [
    [0, {}],
    [.25, { leftArm: -2.1, rightArm: -.45, pitch: -.13, left: .18 }],
    [.48, { leftArm: -2.45, rightArm: -.63, pitch: -.15, lift: .045 }],
    [.78, { leftArm: -.85, rightArm: -.4 }],
    [1, {}],
  ],
  'shield-wall': [
    [0, {}],
    [.18, { leftArm: -.42, rightArm: -1.32, turn: -.18, pitch: .24, lift: -.09, left: -.38, right: .3 }],
  ],
  'the-gate-holds': [
    [0, {}],
    [.29, { leftArm: -1.85, rightArm: -.9, lift: .07, pitch: -.15, left: -.35, right: -.26 }],
    [.43, { leftArm: .58, rightArm: -.72, pitch: .37, lift: -.10, forward: .13, left: -.48, right: .28 }],
    [.72, { leftArm: -.35, rightArm: -.53, pitch: .08 }],
    [1.05, {}],
  ],
  fall: [
    [0, {}],
    [.15, { pitch: -.32, leftArm: -.55, rightArm: -.55, left: -.3 }],
    [.43, { pitch: -1.48, turn: .16, leftArm: .65, rightArm: -.48, forward: -.16, left: -.32, right: .18 }],
    [.66, { pitch: -1.48, turn: .16, leftArm: .35, rightArm: -.28, forward: -.18, left: -.1, right: .1 }],
  ],
};

const CORWIN = {
  'ember-bolt': [
    [0, { rightArm: -.32 }],
    [.10, { leftArm: .53, rightArm: -.7, turn: -.26, pitch: -.12 }],
    [.16, { leftArm: -1.38, rightArm: -.38, turn: .24, pitch: .17, forward: .09 }],
    [.36, { rightArm: -.32 }],
  ],
  'close-attack': [
    [0, { rightArm: -.32 }],
    [.07, { pitch: -.24, forward: -.10, lift: -.04, leftArm: -.4, rightArm: -.5 }],
    [.15, { pitch: -.19, forward: -.08, lift: -.035, leftArm: -1.16, rightArm: -.42, turn: .13 }],
    [.23, { pitch: -.10, forward: -.04, leftArm: -.78, rightArm: -.38 }],
    [.36, { rightArm: -.32 }],
  ],
  hurt: [
    [0, { rightArm: -.32 }],
    [.07, { pitch: -.26, turn: -.22, leftArm: .5, rightArm: -1.02, forward: -.13 }],
    [.24, { rightArm: -.32 }],
  ],
  kindle: [
    [0, { rightArm: -.32 }],
    [.23, { leftArm: -1.95, rightArm: -.66, turn: -.36, pitch: -.17 }],
    [.37, { leftArm: -1.05, rightArm: -.44, turn: .24, pitch: .27, forward: .15, left: -.34 }],
    [.72, { rightArm: -.32 }],
  ],
  'ashen-ward': [
    [0, { rightArm: -.32 }],
    [.23, { rightArm: -1.5, leftArm: -.45, turn: .31, pitch: -.09 }],
    [.52, { rightArm: -1.23, leftArm: -1.36, turn: -.17, pitch: .10, lift: .04 }],
    [.93, { rightArm: -.32 }],
  ],
  'undying-coal': [
    [0, { rightArm: -.32 }],
    [.24, { rightArm: -.88, leftArm: -.6, pitch: .28, lift: -.09, left: -.33, right: .27 }],
    [.50, { rightArm: -2.45, leftArm: -1.9, pitch: -.2, lift: .12, left: -.22, right: -.16 }],
    [.80, { rightArm: -1.35, leftArm: -.77, lift: .02 }],
    [1.12, { rightArm: -.32 }],
  ],
  fall: [
    [0, { rightArm: -.32 }],
    [.19, { pitch: .42, roll: -.22, rightArm: -.94, leftArm: -.52, lift: -.17 }],
    [.53, { pitch: .29, roll: -1.29, rightArm: -.37, leftArm: -1.23, left: .15 }],
    [.72, { pitch: .24, roll: -1.49, rightArm: -.21, leftArm: -.88 }],
  ],
};

const mix = (a, b, p) => a + (b - a) * p;
function sample(frames, time) {
  const i = frames.findIndex(([t]) => t > time);
  if (i < 1) return frames[i === 0 ? 0 : frames.length - 1][1];
  const [start, from] = frames[i - 1], [end, to] = frames[i];
  const p = (time - start) / (end - start);
  const eased = p * p * (3 - 2 * p);
  return Object.fromEntries(Object.keys({ ...from, ...to }).map(k => [k, mix(from[k] ?? 0, to[k] ?? 0, eased)]));
}

export function poseHero({ b, arms, legs }, hero, clip, time, strideWeight = 1) {
  const aldric = hero === 'aldric';
  let pose;
  if (clip === 'idle') {
    const breath = Math.sin(time * 3);
    pose = aldric
      ? { lift: breath * .012, rightArm: -.17 + breath * .055, leftArm: -.13 }
      : { lift: breath * .018, rightArm: -.32 + breath * .08, leftArm: breath * .10, turn: breath * .045 };
  } else if (clip === 'walk') {
    const phase = time * 10, stride = Math.sin(phase);
    pose = {
      left: stride * (aldric ? .62 : .49) * strideWeight, right: -stride * (aldric ? .62 : .49) * strideWeight,
      leftArm: mix(aldric ? -.13 : 0, -.22 - stride * .23, strideWeight),
      rightArm: mix(aldric ? -.17 : -.32, aldric ? -.32 + stride * .13 : -.46 + stride * .20, strideWeight),
      pitch: .10 * strideWeight, turn: stride * .07 * strideWeight,
      lift: Math.abs(Math.cos(phase)) * .025 * strideWeight,
    };
  } else {
    pose = sample((aldric ? ALDRIC : CORWIN)[clip], time);
  }
  b.position.set(0, pose.lift ?? 0, pose.forward ?? 0);
  b.rotation.set(pose.pitch ?? 0, pose.turn ?? 0, pose.roll ?? 0);
  arms[0].rotation.x = pose.leftArm ?? 0;
  arms[1].rotation.x = pose.rightArm ?? 0;
  legs[0].rotation.x = pose.left ?? 0;
  legs[1].rotation.x = pose.right ?? 0;
}

const ALDRIC_CLIPS = {
  idle: { name: 'Idle', motion: 2.1, loop: 2.1 },
  walk: { name: 'March', motion: Math.PI * .6, loop: Math.PI * .6 },
  slash: { name: 'Sword slash', motion: .36, loop: 1.2 },
  hurt: { name: 'Hit reaction', motion: .24, loop: 1 },
  'rally-the-line': { name: HERO_ABILITIES['rally-the-line'].name, motion: 1, loop: 1.85 },
  'shield-wall': { name: HERO_ABILITIES['shield-wall'].name, motion: 1, loop: 1.6 },
  'the-gate-holds': { name: HERO_ABILITIES['the-gate-holds'].name, motion: 1.05, loop: 2.2 },
  fall: { name: 'Defeat', motion: .66, loop: 1.7 },
};
const CORWIN_CLIPS = {
  idle: ALDRIC_CLIPS.idle,
  walk: { ...ALDRIC_CLIPS.walk, name: 'Walk' },
  'ember-bolt': { name: 'Auto Attack (Ranged)', motion: .36, loop: 1.2 },
  'close-attack': { name: 'Auto Attack (Melee)', motion: .36, loop: 1.2 },
  hurt: ALDRIC_CLIPS.hurt,
  kindle: { name: HERO_ABILITIES.kindle.name, motion: .72, loop: 1.85 },
  'ashen-ward': { name: HERO_ABILITIES['ashen-ward'].name, motion: .93, loop: 2.0 },
  'undying-coal': { name: HERO_ABILITIES['undying-coal'].name, motion: 1.12, loop: 2.2 },
  fall: { ...ALDRIC_CLIPS.fall, motion: .72 },
};
export const HERO_CLIPS = { aldric: ALDRIC_CLIPS, corwin: CORWIN_CLIPS };

export const ALDRIC_V2_CLIPS = {
  idle: 'Idle',
  walk: 'March v2',
  slash: 'Normal Attack',
  hurt: 'Taking Damage',
  'rally-the-line': 'Rally the Line',
  'shield-wall': 'Shield Wall v2',
  'the-gate-holds': 'The Gate Holds v2',
  fall: 'Defeated',
};
