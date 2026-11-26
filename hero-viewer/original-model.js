import * as THREE from 'three';

export function buildOriginalHero(F, aldric, { add, boxGeo, R_ }) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const ink = 0x26212b, iron = 0x737483, steel = 0xadaaaf, blue = 0x434e76;
  const cloth = 0x443640, skin = aldric ? 0xc48b66 : 0xb77a59, gold = 0xc28b39, leather = 0x594034;
  const box = (x, y, z, w, h, d, color, glow = false) => add(body, boxGeo, F.m(color, { basic: glow }), x, y, z, [w, h, d]);
  for (const sign of [-1, 1]) {
    const x = sign * .14;
    R_('legs', [x, .63, 0], body);
    box(x, .38, 0, .22, .51, .25, aldric ? iron : ink);
    box(x, .10, .04, .24, .19, .34, leather);
    box(x, .27, .07, .23, .16, .21, aldric ? steel : cloth);
    R_();
  }
  box(0, .86, 0, .53, .54, .38, aldric ? iron : cloth);
  box(0, .66, .02, .55, .10, .43, leather);
  box(0, .66, .25, .13, .11, .03, gold);
  box(0, 1.27, .02, .39, .39, .32, skin);
  box(0, 1.12, .17, .29, .10, .06, aldric ? 0x59505a : 0x4b302a);
  for (const sign of [-1, 1]) {
    box(sign * .09, 1.31, .183, .065, .03, .016, ink);
    box(sign * .087, 1.343, .184, .10, .033, .021, 0x49332d);
  }
  box(0, 1.25, .195, .065, .075, .055, skin);
  if (aldric) {
    box(0, 1.47, -.015, .45, .13, .36, 0x4c342f);
    for (const sign of [-1, 1]) {
      box(sign * .19, 1.39, -.015, .08, .11, .30, steel);
      box(sign * .085, 1.55, -.03, .14, .07, .28, 0x4c342f);
      box(sign * .32, 1.03, 0, .24, .17, .42, steel);
      box(sign * .15, .72, -.24, .26, .51 + sign * .08, .09, blue);
    }
    box(0, .9, .205, .32, .36, .05, blue);
    box(0, .49, .224, .21, .33, .06, blue);
    box(0, .91, .24, .12, .15, .02, ink);
    for (const x of [-.05, 0, .05]) box(x, 1.0, .24, .026, .04, .02, ink);
  } else {
    box(0, 1.46, -.03, .49, .20, .43, cloth);
    box(0, 1.26, -.17, .46, .36, .20, cloth);
    for (const sign of [-1, 1]) {
      box(sign * .22, 1.27, .03, .09, .32, .35, cloth);
      box(sign * .25, 1.06, 0, .21, .17, .45, 0x52404a);
      box(sign * .17, .47, -.01, .25, .40 + sign * .12, .46, cloth);
      box(sign * .28, .32 + sign * .06, -.005, .09, .07, .43, 0x913f22);
    }
    box(-.07, .81, .228, .10, .53, .05, 0xa3876c);
    box(-.07, 1.061, .264, .10, .09, .032, gold);
    box(-.15, 1.245, .19, .045, .14, .015, 0x99463a);
  }
  for (const sign of [-1, 1]) {
    const x = sign * .34;
    R_('arms', [x, 1.01, 0], body);
    box(x, .79, .015, .16, .35, .19, aldric ? iron : cloth);
    box(x, .64, .09, .17, .14, .18, aldric ? leather : skin);
    if (!aldric && sign === -1) {
      for (const y of [.70, .75, .80]) box(x, y, .03, .18, .04, .21, 0xc0a287);
    }
    if (aldric && sign === -1) {
      box(x, .67, .27, .064, .067, .39, leather);
      box(x, .67, .40, .23, .065, .052, gold);
      box(x, .67, .68, .084, .055, .52, steel);
      box(x, .67, .96, .055, .04, .09, steel);
    }
    if (aldric && sign === 1) {
      box(x + .04, .75, .24, .38, .42, .10, gold);
      box(x + .04, .75, .30, .29, .32, .05, blue);
      box(x + .04, .47, .24, .25, .15, .10, gold);
      box(x + .04, .36, .24, .12, .08, .09, gold);
      box(x + .04, .71, .335, .105, .16, .02, ink);
      for (const k of [-.047, 0, .047]) box(x + .04 + k, .81, .335, .025, .05, .02, ink);
    }
    if (!aldric && sign === 1) {
      box(x + .05, .57, .14, .04, .16, .04, ink);
      for (const y of [.48, .24]) box(x + .05, y, .14, .25, .055, .24, ink);
      for (const ax of [-.10, .10]) for (const az of [-.10, .10]) box(x + .05 + ax, .36, .14 + az, .038, .23, .038, iron);
      box(x + .05, .35, .14, .15, .15, .15, 0xff8c26, true);
      box(x + .05, .37, .223, .08, .10, .02, 0xffd36a, true);
    }
    R_();
  }
  return root;
}
