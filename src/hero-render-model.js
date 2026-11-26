import * as THREE from 'three';

const PI = Math.PI;

export function rbox(w, h, d, r, seg = 2) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg), p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), c = new THREE.Vector3();
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(THREE.MathUtils.clamp(v.x, -hw, hw), THREE.MathUtils.clamp(v.y, -hh, hh), THREE.MathUtils.clamp(v.z, -hd, hd));
    const o = v.clone().sub(c);
    if (o.lengthSq() > 1e-9) { o.normalize(); p.setXYZ(i, c.x + o.x * r, c.y + o.y * r, c.z + o.z * r); n.setXYZ(i, o.x, o.y, o.z); }
  }
  return g;
}

export function buildRevisedHero(F, aldric, { add, boxGeo, G, R_ }) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const ink = 0x29202a, iron = 0x77717b, steel = 0xaaa29b, blue = 0x484b70, navy = 0x30344f;
  const cloth = 0x473644, shadow = 0x322630, trim = 0xa56139, gold = 0xd39742, leather = 0x624334;
  const skin = aldric ? 0xd5956d : 0xbf7c56, hair = aldric ? 0x523631 : 0x392825;
  const detail = (geo, color, x, y, z, scale = 1, rot, glow = false) => {
    const part = add(body, geo, F.m(color, { basic: glow }), x, y, z, scale, rot);
    part.userData.noInk = true;
    return part;
  };
  const box = (x, y, z, w, h, d, color, rot) => detail(boxGeo, color, x, y, z, [w, h, d], rot);
  const bevel = (x, y, z, w, h, d, color, rot) => detail(rbox(w, h, d, Math.min(w, h, d) * .21, 3), color, x, y, z, 1, rot);
  const plate = (points, color, x, y, z, depth, rot) => {
    const shape = new THREE.Shape(points.map(([px, py]) => new THREE.Vector2(px, py)));
    const edge = Math.min(depth * .36, .013);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelThickness: edge, bevelSize: edge, bevelSegments: 1, steps: 1 });
    detail(geo, color, x, y, z, 1, rot);
  };

  for (const sign of [-1, 1]) {
    const x = sign * .15;
    R_('legs', [x, .63, 0], body);
    bevel(x, .37, 0, .23, .51, .25, aldric ? iron : shadow);
    bevel(x, .09, .07, .25, .17, .36, leather);
    bevel(x, .037, .082, .26, .061, .37, 0x443027);
    box(x, .167, .12, .233, .044, .11, 0x98745c, [-.3, 0, 0]);
    if (aldric) {
      bevel(x, .27, .078, .22, .13, .22, steel, [.16, 0, 0]);
      bevel(x, .46, .084, .229, .16, .17, iron, [-.12, 0, sign * .09]);
    }
    R_();
  }

  bevel(0, .89, -.015, .55, .50, .39, aldric ? iron : shadow);
  bevel(0, 1.274, .023, .42, .39, .335, skin);
  bevel(0, 1.115, .087, .31, .10, .24, hair);
  bevel(0, 1.245, .208, .064, .083, .064, skin);
  box(0, 1.149, .213, .095, .019, .014, hair);
  for (const sign of [-1, 1]) {
    bevel(sign * .214, 1.27, .02, .071, .116, .116, skin);
    box(sign * .099, 1.29, .194, .077, .034, .012, 0xe2cbb1);
    box(sign * .086, 1.29, .204, .035, .031, .012, ink);
    box(sign * .092, 1.333, .202, .110, .035, .028, hair, [0, 0, sign * .18]);
    bevel(sign * .122, 1.152, .179, .092, .123, .086, aldric ? 0x74635c : hair, [0, 0, sign * .28]);
  }
  bevel(0, 1.116, .193, .15, .061, .061, aldric ? 0x87756a : hair);

  const tornHem = [[-.50, 1], [.46, 1], [.55, .04], [.39, .11], [.33, -.02],
    [.17, .07], [.08, -.11], [-.01, -.07], [-.05, .05], [-.19, .01], [-.29, -.09], [-.37, .08], [-.55, .01]];
  const clothPanel = (x, y, z, w, h, color, rot) => plate(tornHem.map(([px, py]) => [px * w, py * h]), color, x, y, z, .021, rot);
  const clasp = (x, y, z) => {
    detail(G.cyl, 0x815021, x, y, z, [.054, .025, .054], [PI / 2, 0, 0]);
    detail(G.cyl, gold, x, y, z + .016, [.044, .016, .044], [PI / 2, 0, 0]);
    detail(G.oct, 0xe4a956, x, y, z + .026, [.030, .030, .017]);
  };
  const crest = (x, y, z, scale) => {
    const tower = [[-.075, -.105], [-.065, .034], [-.081, .07], [-.081, .117],
      [-.05, .117], [-.05, .085], [-.018, .085], [-.018, .117], [.018, .117],
      [.018, .085], [.05, .085], [.05, .117], [.081, .117], [.081, .07],
      [.065, .034], [.075, -.105], [.019, -.105], [.019, -.063], [-.019, -.063], [-.019, -.105]];
    plate(tower.map(([px, py]) => [px * scale, py * scale]), ink, x, y, z, .005);
    box(x, y + .155 * scale, z + .008, .051 * scale, .053 * scale, .01, 0xe2ad59);
  };

  if (aldric) {
    bevel(0, 1.424, -.05, .45, .188, .35, hair);
    for (const sign of [-1, 1]) {
      bevel(sign * .198, 1.397, .002, .103, .070, .29, 0x8c7d77, [-.1, 0, sign * .12]);
      for (let i = 0; i < 3; i++) {
        bevel(sign * (.06 + i * .058), 1.54 - i * .044, -.050 - i * .036,
          .104, .109, .28, i === 0 ? 0x644339 : hair, [-.34 - i * .13, -sign * .14, sign * .18]);
      }
      bevel(sign * .152, 1.403, -.185, .15, .109, .16, hair, [-.32, 0, sign * .27]);
    }
    box(.096, 1.394, .192, .015, .077, .011, 0xa45040, [0, 0, .41]);
    bevel(0, 1.087, .017, .43, .108, .388, navy);
    plate([[-.21, .77], [0, .73], [.21, .77], [.32, .14], [.35, .02], [.25, .08], [.21, -.02],
      [.12, .04], [.045, -.09], [-.04, -.03], [-.09, .06], [-.18, -.02], [-.23, .09], [-.34, .026]],
      blue, 0, .30, -.31, .038, [.17, PI, 0]);
    plate([[-.19, .16], [0, .082], [.19, .16], [.176, .076], [0, -.043], [-.176, .076]],
      navy, 0, .925, -.233, .035, [.18, PI, 0]);
    plate([[-.17, .15], [0, .073], [.17, .15], [.165, .116], [0, -.01], [-.165, .116]],
      0x575878, 0, .952, -.254, .022, [.18, PI, 0]);
    bevel(0, .905, .187, .369, .289, .094, 0x696b88);
    crest(0, .893, .237, .70);
    clothPanel(0, .326, .245, .235, .39, blue, [.09, 0, 0]);
    for (const sign of [-1, 1]) {
      box(sign * .094, .515, .28, .024, .292, .018, 0xb2a181, [.09, 0, sign * .035]);
      bevel(sign * .206, .563, .135, .141, .189, .189, iron, [.27, 0, -sign * .19]);
    }
    clasp(-.168, 1.048, .257);
  } else {
    const hood = [[-.29, -.19], [-.28, -.05], [-.23, .12], [-.13, .23], [.12, .23], [.23, .13], [.27, -.03], [.29, -.19],
      [.177, -.119], [.188, -.02], [.155, .087], [.084, .143], [-.081, .143], [-.155, .083], [-.185, -.026], [-.174, -.117]];
    bevel(0, 1.34, -.083, .48, .48, .36, shadow);
    plate([[-.217, -.073], [-.19, .101], [-.10, .16], [.10, .16], [.19, .101], [.217, -.073],
      [.152, -.136], [-.152, -.136]], 0x493746, 0, 1.337, -.235, .039, [.18, PI, 0]);
    plate(hood, cloth, 0, 1.368, -.043, .174);
    plate(hood.map(([x, y]) => [x * .89, y * .87]), trim, 0, 1.373, .133, .035);
    for (const sign of [-1, 1]) {
      bevel(sign * .146, 1.407, .161, .103, .085, .064, hair, [0, 0, sign * .45]);
      box(sign * .173, 1.32, .205, .036, .105, .022, hair, [0, 0, -sign * .2]);
      const angle = sign * .62;
      clothPanel(sign * .195, .255 + sign * .023, .102, .34, .481, cloth, [.15, angle, -sign * .16]);
      clothPanel(sign * .192, .217, -.205, .37, .47, shadow, [.10, PI - angle, sign * .10]);
    }
    for (const [x, y, a] of [[-.145, 1.241, .42], [-.118, 1.23, -.7], [-.152, 1.274, -.6]]) {
      box(x, y, .194, .019, .062, .016, 0x94463a, [0, 0, a]);
    }
    clothPanel(0, .223, .166, .45, .49, 0x4d3848, [.15, 0, 0]);
    clothPanel(-.074, .234, .249, .125, .76, 0xb09378, [.05, 0, -.06]);
    for (const sign of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        clothPanel(sign * (.207 + k * .023), .91 - k * .054, -.205 + k * .019,
          .35, .19, k ? 0x945634 : cloth, [.14, PI - sign * .56, sign * .27]);
        clothPanel(sign * (.207 + k * .023), .91 - k * .054, .112 - k * .019,
          .35, .19, k ? 0x945634 : cloth, [.20, sign * .63, -sign * .27]);
      }
      for (let k = 0; k < 3; k++) {
        box(sign * (.112 + k * .078), .257 + k * .033, .254 - k * .034, .056, .075, .021,
          k % 2 === 0 ? 0xaa5c35 : 0x7e4532, [.15, sign * .33, -sign * .19]);
      }
    }
    bevel(0, 1.054, .03, .51, .14, .41, cloth, [.11, 0, .08]);
    clasp(-.075, 1.003, .264);
  }

  bevel(0, .66, .025, .55, .095, .428, leather);
  bevel(0, .666, .255, aldric ? .132 : .094, .101, .054, gold);
  box(0, .666, .286, aldric ? .084 : .055, .055, .012, leather);
  for (const x of [-.19, -.113, .113, .19]) box(x, .668, .245, .021, .021, .017, 0x9d7955);

  for (const sign of [-1, 1]) {
    const x = sign * .34;
    R_('arms', [x, 1.01, 0], body);
    bevel(x, .823, .017, .164, .331, .183, aldric ? iron : cloth);
    bevel(x, .649, .096, .17, .136, .17, aldric ? leather : skin);
    bevel(x - sign * .078, .661, .141, .071, .088, .092, aldric ? leather : skin);
    if (aldric) {
      for (let k = 0; k < 3; k++) {
        bevel(x + sign * (k * .016 - .017), 1.025 - k * .080, .004,
          .246 - k * .017, .13, .389 - k * .054, k === 0 ? steel : iron, [0, 0, -sign * .37]);
      }
      detail(G.oct, gold, x, 1.054, .183, [.058, .062, .027]);
      bevel(x, .79, .066, .176, .142, .205, steel, [.13, 0, 0]);
    } else {
      bevel(x, .882, .019, .225, .186, .27, cloth, [0, 0, -sign * .24]);
      for (let k = 0; k < 4; k++) {
        bevel(x, .713 + k * .031, .053, .182, .038, .212, k % 2 ? 0x9d806b : 0xbca18a, [0, 0, sign * .19]);
      }
    }
    if (aldric && sign === -1) {
      bevel(x, .672, .188, .075, .078, .24, leather);
      bevel(x, .672, .297, .215, .064, .056, gold);
      bevel(x, .672, .121, .086, .080, .071, gold);
      const blade = [[-.04, -.275], [.04, -.275], [.039, .196], [0, .274], [-.039, .196]];
      plate(blade, steel, x, .666, .565, .032, [PI / 2, 0, 0]);
      box(x, .675, .542, .023, .027, .424, 0xd2cbc3);
    } else if (aldric) {
      const shield = [[-.217, .20], [0, .30], [.217, .20], [.198, -.072], [.143, -.214], [0, -.336], [-.143, -.214], [-.198, -.072]];
      const cx = x + .038;
      plate(shield, gold, cx, .672, .199, .075);
      plate(shield.map(([px, py]) => [px * .84, py * .875]), blue, cx, .674, .279, .024);
      crest(cx, .65, .310, 1);
      box(cx - .085, .805, .313, .084, .012, .005, 0xb8a784, [0, 0, -.66]);
      box(cx + .075, .49, .311, .108, .009, .005, 0x817e90, [0, 0, .62]);
      for (const sx of [-.165, .165]) detail(G.oct, 0xf3be61, cx + sx, .835, .288, [.022, .022, .013]);
    } else if (sign === 1) {
      const cx = x + .033, z = .151;
      detail(G.torus, iron, cx, .566, z, [.043, .062, .05]);
      detail(G.torus, gold, cx, .508, z, [.033, .044, .042], [0, PI / 2, 0]);
      for (const [y, w, h] of [[.454, .218, .041], [.418, .271, .041], [.209, .271, .048], [.181, .223, .025]]) {
        bevel(cx, y, z, w, h, w, 0x493330);
      }
      detail(G.oct, 0xff6f23, cx, .315, z, [.098, .103, .098], [.26, .65, -.2], true);
      detail(G.oct, 0xffce66, cx - .016, .329, z + .04, [.054, .061, .054], [.39, -.26, .32], true);
      for (const dx of [-.102, .102]) for (const dz of [-.102, .102]) {
        bevel(cx + dx, .316, z + dz, .036, .191, .036, 0x706053);
        detail(G.oct, gold, cx + dx, .419, z + dz, [.026, .027, .026]);
        detail(G.oct, gold, cx + dx, .209, z + dz, [.026, .027, .026]);
      }
    }
    R_();
  }
  return root;
}
