import * as THREE from 'three';
import { V3, rand, randi, pick, clamp, lerp, smooth, ease, lerpAngle, hash, vnoise, fbm, tmpC, vary } from './utils.js';
import PATCHES from './patches.json';

// utils: see utils.js

// ================================================================ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .95;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe0ff, 80, 230);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 700);
camera.position.set(30, 30, 30);

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x55663a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 160 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// flash lights for explosions (fixed count -> no shader recompiles)
const flashes = [];
for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffa04a, 0, 12, 2); scene.add(l); flashes.push(l); }
let flashIdx = 0;
function flashLight(p, I = 40, col = 0xffa04a) { const l = flashes[flashIdx++ % flashes.length]; l.position.copy(p).y += 1; l.intensity = I; l.color.setHex(col); }

function onResize() {
  const a = innerWidth / innerHeight;
  camera.aspect = a;
  camera.fov = a >= 1.25 ? 50 : clamp(50 * Math.pow(1.25 / a, .55), 50, 78);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize); onResize();

// ================================================================ materials
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const matCache = {};
const M = c => { if (!matCache[c]) { matCache[c] = new THREE.MeshLambertMaterial({ color: c }); matCache[c].userData.plain = true; } return matCache[c]; };
const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
// merge the plain-coloured box children of a group into one vertex-coloured mesh (fewer draw calls)
const geoCache = {};
const _nm = new THREE.Matrix3(), _mv = new THREE.Vector3();
function mergeStatic(group, key) {
  const list = group.children.filter(o => o.isMesh && o.material.userData.plain);
  if (list.length < 2) return;
  let geo = key && geoCache[key];
  if (!geo) {
    const bp = boxGeo.attributes.position, bn = boxGeo.attributes.normal, bi = boxGeo.index;
    const pos = [], nor = [], col = [], idx = []; let off = 0;
    for (const m of list) {
      m.updateMatrix(); _nm.getNormalMatrix(m.matrix); const c = m.material.color;
      for (let v = 0; v < bp.count; v++) {
        _mv.fromBufferAttribute(bp, v).applyMatrix4(m.matrix); pos.push(_mv.x, _mv.y, _mv.z);
        _mv.fromBufferAttribute(bn, v).applyMatrix3(_nm).normalize(); nor.push(_mv.x, _mv.y, _mv.z);
        col.push(c.r, c.g, c.b);
      }
      for (let i = 0; i < bi.count; i++) idx.push(bi.getX(i) + off);
      off += bp.count;
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    if (key) geoCache[key] = geo;
  }
  for (const m of list) group.remove(m);
  const mm = new THREE.Mesh(geo, vcMat); mm.castShadow = true; mm.receiveShadow = !key; mm.userData.merged = !key;
  group.add(mm);
}
const ME = (c, e = 1) => { const k = 'e' + c + '_' + e; return matCache[k] || (matCache[k] = new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: e })); };
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const frozenMat = new THREE.MeshLambertMaterial({ color: 0xe8fbff, emissive: 0x6ab8e0, transparent: true, opacity: .75, depthWrite: false });
const shellMat = new THREE.MeshLambertMaterial({ color: 0xaeeaff, emissive: 0x2a6a8a, transparent: true, opacity: .45, depthWrite: false });
const nightMat = new THREE.MeshLambertMaterial({ color: 0x5a3a20, emissive: 0xffb347, emissiveIntensity: 0 });
const lampMat = new THREE.MeshLambertMaterial({ color: 0x8a6a40, emissive: 0xffc860, emissiveIntensity: .2 });
const addMat = c => new THREE.MeshBasicMaterial({ color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });

function P(par, x, y, z, sx, sy, sz, c, mat, shadow = true) {
  const m = new THREE.Mesh(boxGeo, mat || M(c));
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = shadow;
  par.add(m); return m;
}
const dummy = new THREE.Object3D();
function makeBatch(list, mat, cast = true, recv = true) {
  const im = new THREE.InstancedMesh(boxGeo, mat, Math.max(1, list.length));
  list.forEach((b, i) => {
    dummy.position.set(b[0], b[1] + b[4] / 2, b[2]); dummy.rotation.set(0, b[7] || 0, 0);
    dummy.scale.set(b[3], b[4], b[5]); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
    im.setColorAt(i, tmpC.setHex(b[6]));
  });
  im.count = list.length; im.castShadow = cast; im.receiveShadow = recv; im.frustumCulled = false;
  scene.add(im); return im;
}

// ================================================================ maps
const W = 46, H = 32;
const gx2w = g => g - W / 2 + .5, gz2w = g => g - H / 2 + .5;
const id = (x, z) => z * W + x;
// units: type -> [first wave, base count, extra per wave]; bosses: wave -> count
const MAPS = [
  { key: 'mill', name: 'Millbrook Fields', blurb: 'Open farmland outside the castle walls. A gentle road, plenty of room to build, and only goblins and orcs.',
    theme: 'meadow', waves: 6, gold: 200, hpBase: .8, growth: [1.3, 1.36], plots: 12, castle: [42, 19],
    paths: [[[0, 8], [15, 8], [15, 23], [30, 23], [30, 11], [42, 11], [42, 15]]],
    liquid: null, village: [17, 25, 28, 30], hills: .5,
    units: { runner: [1, 3, 1], soldier: [2, 1, .8], brute: [6, 0, 1] }, bosses: {} },
  { key: 'river', name: 'River Crossing', blurb: 'The road crosses the river by a wooden bridge. Cave bats fly straight over the water.',
    theme: 'meadow', waves: 10, gold: 250, hpBase: 1, growth: [1.32, 1.41], plots: 16, castle: [41, 21],
    paths: [[[0, 6], [9, 6], [9, 15], [4, 15], [4, 26], [17, 26], [17, 10], [25, 10], [25, 21], [36, 21], [36, 9], [41, 9], [41, 17]]],
    liquid: { kind: 'water', axis: 'z', c: z => 31 + 1.6 * Math.sin(z * .28 + .5), w: 1.45 },
    village: [6, 17, 15, 24], hills: 1,
    units: { runner: [1, 3, 1.5], soldier: [1, 2, 1.15], flyer: [3, 1, .75], brute: [5, 0, .5] }, bosses: {} },
  { key: 'thorn', name: 'Thornwood', blurb: 'A forest road that doubles back on itself. Short sight lines suit the new Flame Tower, and goblin sappers go for your towers.',
    theme: 'forest', waves: 10, gold: 280, hpBase: .95, growth: [1.3, 1.38], plots: 14, castle: [41, 19], trees: 1.9,
    paths: [[[0, 16], [7, 16], [7, 5], [15, 5], [15, 26], [23, 26], [23, 6], [32, 6], [32, 12], [41, 12], [41, 15]]],
    liquid: null, village: [25, 16, 30, 23], hills: .8,
    units: { runner: [1, 3, 1.3], soldier: [1, 2, 1], sapper: [2, 1, .5], flyer: [3, 1, .6], brute: [4, 0, .5] }, bosses: {} },
  { key: 'mire', name: 'Mire’s Edge', blurb: 'The road wades through a bog on an old causeway. Boar riders charge, and Gruk the Mire-King waits at the end.',
    theme: 'mire', waves: 12, gold: 280, hpBase: 1.1, growth: [1.3, 1.37], plots: 14, castle: [41, 19],
    paths: [[[0, 5], [9, 5], [9, 26], [20, 26], [20, 5], [31, 5], [31, 12], [41, 12], [41, 15]]],
    liquid: { kind: 'bog', lake: [14.5, 15.5, 3, 6] }, village: [23, 16, 29, 23], hills: .6,
    bog: [[.24, .4], [.56, .7]],
    units: { runner: [1, 3, 1.3], soldier: [1, 2, 1.1], rider: [2, 1, .9], sapper: [3, 1, .4], flyer: [3, 1, .7], shaman: [5, 1, .35], brute: [5, 0, .55], gruk: [12, 1, 0] }, bosses: {} },
  { key: 'pass', name: 'Highland Pass', blurb: 'Switchbacks through the mountains. Armoured knights, healing shamans and stone golems join the horde.',
    theme: 'alpine', waves: 12, gold: 300, hpBase: 1.15, growth: [1.27, 1.325], plots: 16, castle: [40, 19],
    paths: [[[0, 4], [13, 4], [13, 13], [4, 13], [4, 24], [22, 24], [22, 5], [33, 5], [33, 12], [40, 12], [40, 15]]],
    liquid: null, village: [25, 15, 31, 21], hills: 1.7,
    units: { runner: [1, 3, 1.2], soldier: [1, 2, 1], knight: [2, 1, .7], shaman: [3, 1, .35], brute: [4, 0, .4], golem: [5, 0, .45], flyer: [6, 1, .6] }, bosses: { 6: 1, 12: 1 } },
  { key: 'frost', name: 'Frostmere', blurb: 'A frozen lake and two roads in. Ghostly wraiths fly over, and arrows pass straight through them.',
    theme: 'snow', waves: 12, gold: 320, hpBase: 1.25, growth: [1.26, 1.32], plots: 18, castle: [41, 19],
    paths: [[[0, 6], [8, 6], [8, 26], [24, 26], [24, 20], [34, 20], [34, 10], [41, 10], [41, 15]],
            [[20, 0], [20, 14], [24, 14], [24, 20], [34, 20], [34, 10], [41, 10], [41, 15]]],
    liquid: { kind: 'ice', lake: [14, 18, 3.6, 5] }, village: [26, 22, 33, 28], hills: 1.1,
    units: { runner: [1, 4, 1.3], soldier: [1, 2, 1], wraith: [2, 1, .8], flyer: [3, 1, .6], knight: [4, 1, .6], shaman: [5, 1, .35], brute: [6, 0, .5], golem: [8, 0, .4] }, bosses: { 6: 1, 12: 2 } },
  { key: 'crater', name: 'Ember Crater', blurb: 'Ash fields split by a river of lava. Two portals, every enemy type, and three Warlords.',
    theme: 'ember', waves: 15, gold: 380, hpBase: 1.35, growth: [1.24, 1.275], plots: 18, castle: [38, 19],
    paths: [[[0, 10], [9, 10], [9, 3], [18, 3], [18, 24], [30, 24], [30, 8], [38, 8], [38, 15]],
            [[0, 28], [24, 28], [24, 24], [30, 24], [30, 8], [38, 8], [38, 15]]],
    liquid: { kind: 'lava', axis: 'x', c: x => 16 + 1.5 * Math.sin(x * .3 + 1), w: 1.3, maxX: 32 }, village: [10, 20, 16, 25], hills: 1.2,
    units: { runner: [1, 4, 1.2], soldier: [1, 3, .9], knight: [2, 1, .6], shaman: [3, 1, .3], flyer: [3, 1, .5], wraith: [4, 1, .6], brute: [5, 0, .45], golem: [6, 0, .4] }, bosses: { 5: 1, 10: 1, 15: 2 } },
];
const THEMES = {
  meadow: { grass: [.27, .62, .31], dirt: 0x7a5a3a, path: 0xc9a56b, rock: 0x7d7a74, snowAt: 5, stoneAt: 4, trees: 'mixed', flowers: true, tint: null },
  mire: { grass: [.22, .4, .27], dirt: 0x4a3a2a, path: 0x8a6c46, rock: 0x6a6a5e, snowAt: 9, stoneAt: 9, trees: 'mixed', flowers: false, tint: [0x7a9a6a, .3] },
  forest: { grass: [.27, .5, .27], dirt: 0x5a4430, path: 0xb08a5a, rock: 0x6e6c64, snowAt: 9, stoneAt: 9, trees: 'mixed', flowers: true, tint: [0x5a8a5a, .2] },
  alpine: { grass: [.24, .38, .34], dirt: 0x6a5a48, path: 0xb39c7a, rock: 0x85817a, snowAt: 4, stoneAt: 3, trees: 'pine', flowers: true, tint: null },
  snow: { grass: [.58, .25, .9], dirt: 0x6a6e78, path: 0xa49482, rock: 0x7a7e86, snowAt: 2, stoneAt: 9, trees: 'snowpine', flowers: false, tint: [0xdde8f2, .25] },
  ember: { grass: [.04, .16, .24], dirt: 0x4a3c36, path: 0xa88a6a, rock: 0x4a3e3a, snowAt: 99, stoneAt: 3, trees: 'dead', flowers: false, tint: [0x9a5a3a, .45] },
};
const LIQ = {
  water: { color: 0x3d8fd6, emissive: 0x0b2f55, opacity: .82, bob: .045, y: .55, ground: .7 },
  lava: { color: 0xff6a1a, emissive: 0xff3a00, opacity: 1, bob: .03, y: .45, ground: .6 },
  bog: { color: 0x4f6a34, emissive: 0x12200a, opacity: .92, bob: .02, y: .5, ground: .65 },
  ice: { color: 0xcfeefa, emissive: 0x2a4a5a, opacity: .95, bob: 0, y: .6, ground: .75 },
};

// world state, rebuilt for every map
let MAP = MAPS[0], TH = THEMES.meadow, mapIdx = -1;
const T = new Uint8Array(W * H), HT = new Float32Array(W * H), DIST = new Int16Array(W * H), LDIST = new Int16Array(W * H), OBS = new Float32Array(W * H);
let PATHS = [], SAMPLES = [], PLOTS = [], waterTiles = [], edgeLiquid = [], chimneys = [], campfires = [], villagers = [], portals = [], windmill = null, lavaTiles = [];
let CX = 0, CZ = 0, GATE = new V3(), FLAG0 = new V3(), castleBlocks = [], castleOrder = [], castleIM = null, castleRemoved = 0;
const castleFires = [];
const worldG = new THREE.Group(); scene.add(worldG);
const worldMats = [];
const liqMat = new THREE.MeshLambertMaterial({ transparent: true });
let liqIM = null;
const emberMat = ME(0xff6a1a, 1.6);
const wmat = () => { const m = new THREE.MeshLambertMaterial(); worldMats.push(m); return m; };
// static batches go into the world group so a map change can clear them
function worldBatch(list, mat, cast = true, recv = true) { const im = makeBatch(list, mat, cast, recv); scene.remove(im); worldG.add(im); return im; }

// boggy stretches of road (Mire's Edge): dark mud plates, reeds and bubbles
const bogBubbles = [];
function decorateBog() {
  bogBubbles.length = 0; if (!MAP.bog) return;
  const P0 = PATHS[0], mud = [], reed = [], o = new V3(), d2 = new V3();
  for (const [a, b] of MAP.bog) for (let d = a * P0.len; d < b * P0.len; d += .45) {
    pathAt(P0, d, o); const y = groundY(o.x, o.z); mud.push([o.x + rand(-.15, .15), y + .03, o.z + rand(-.15, .15), rand(.9, 1.2), .06, rand(.9, 1.2)]);
    pathAt(P0, d + .1, d2); const nx = -(d2.z - o.z), nz = d2.x - o.x, nl = Math.hypot(nx, nz) || 1;
    for (const s of [-1, 1]) if (Math.random() < .55) { const r = rand(.75, 1.05); reed.push([o.x + nx / nl * s * r, y + .35, o.z + nz / nl * s * r, .06, rand(.5, .9), .06]); }
    if (Math.random() < .12) bogBubbles.push(new V3(o.x, y + .1, o.z));
  }
  const inst = (list, col) => { const m = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: col }), list.length), q = new THREE.Object3D(); list.forEach((t, i) => { q.position.set(t[0], t[1], t[2]); q.scale.set(t[3], t[4], t[5]); q.rotation.y = Math.random(); q.updateMatrix(); m.setMatrixAt(i, q.matrix); }); m.receiveShadow = true; worldG.add(m); };
  inst(mud, 0x3e4a26); inst(reed, 0x6a8a3a);
}
function groundY(x, z) {
  const gx = Math.floor(x + W / 2), gz = Math.floor(z + H / 2);
  if (gx < 0 || gz < 0 || gx >= W || gz >= H) return -6;
  const t = T[id(gx, gz)];
  if (t === 3) return 1.05;
  if (t === 2) return MAP.liquid ? LIQ[MAP.liquid.kind].ground : .7;
  if (t === 1) return .92;
  return HT[id(gx, gz)];
}
const obsY = (x, z) => { const gx = Math.floor(x + W / 2), gz = Math.floor(z + H / 2); return gx < 0 || gz < 0 || gx >= W || gz >= H ? -9 : Math.max(OBS[id(gx, gz)], groundY(x, z)); };

// ---------------------------------------------------------------- path math (each path is its own polyline)
function makePath(wp) {
  const pts = wp.map(([x, z]) => new V3(gx2w(x), .92, gz2w(z)));
  const seg = [], cum = [0];
  for (let i = 0; i < pts.length - 1; i++) { seg.push(pts[i].distanceTo(pts[i + 1])); cum.push(cum[i] + seg[i]); }
  return { pts, seg, cum, len: cum[cum.length - 1], wp };
}
function pathAt(P, d, out) {
  d = clamp(d, 0, P.len); let i = 0;
  while (i < P.seg.length - 1 && P.cum[i + 1] < d) i++;
  return out.lerpVectors(P.pts[i], P.pts[i + 1], (d - P.cum[i]) / P.seg[i]);
}
const _pa = new V3(), _pb = new V3();
function smoothPath(P, d, out, dirOut) {
  pathAt(P, d - .55, _pa); pathAt(P, d + .55, _pb);
  if (dirOut) dirOut.subVectors(_pb, _pa).setY(0).normalize();
  return out.addVectors(_pa, _pb).multiplyScalar(.5);
}

// ---------------------------------------------------------------- build a map
function bfs(src, out) {
  out.fill(99); const q = [];
  for (let i = 0; i < W * H; i++) if (src(i)) { out[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % W, z = (i / W) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const j = id(nx, nz); if (out[j] > out[i] + 1) { out[j] = out[i] + 1; q.push(j); }
    }
  }
}
function clearWorld() {
  for (const o of [...worldG.children]) { worldG.remove(o); if (o.isInstancedMesh) o.dispose(); }
  for (const m of worldMats) m.dispose(); worldMats.length = 0;
  PATHS = []; SAMPLES = []; PLOTS = []; waterTiles = []; edgeLiquid = []; chimneys = []; campfires = []; villagers = []; portals = []; windmill = null; lavaTiles = [];
  castleBlocks = []; castleFires.length = 0; castleRemoved = 0; liqIM = null;
  T.fill(0); HT.fill(1); OBS.fill(0);
}
function buildMap(idx) {
  clearWorld();
  mapIdx = idx; MAP = MAPS[idx]; TH = THEMES[MAP.theme];
  const L = MAP.liquid;
  // path tiles
  for (const wp of MAP.paths) for (let i = 0; i < wp.length - 1; i++) {
    let [x0, z0] = wp[i]; const [x1, z1] = wp[i + 1];
    const sx = Math.sign(x1 - x0), sz = Math.sign(z1 - z0);
    for (;;) { T[id(x0, z0)] = 1; if (x0 === x1 && z0 === z1) break; x0 += sx; z0 += sz; }
  }
  // liquid: a river along an axis, or a lake
  const isLiquid = (x, z) => {
    if (!L) return false;
    if (L.lake) { const [cx, cz, rx, rz] = L.lake; return ((x + .5 - cx) / rx) ** 2 + ((z + .5 - cz) / rz) ** 2 < 1; }
    if (L.axis === 'z') return Math.abs(x + .5 - L.c(z)) < L.w;
    return x <= (L.maxX ?? W) && Math.abs(z + .5 - L.c(x)) < L.w;
  };
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (isLiquid(x, z)) T[id(x, z)] = T[id(x, z)] === 1 ? 3 : 2;
  bfs(i => T[i] === 1 || T[i] === 3, DIST);
  bfs(i => T[i] === 2 || T[i] === 3, LDIST);
  // reserved zones: 4 castle, 5 village, 6 camps
  const [cgx, cgz] = MAP.castle, [vx0, vz0, vx1, vz1] = MAP.village;
  const starts = MAP.paths.map(p => p[0]);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = id(x, z); if (T[i] !== 0) continue;
    if (Math.abs(x - cgx) <= 4 && Math.abs(z - cgz) <= 4) T[i] = 4;
    else if (x >= vx0 && x <= vx1 && z >= vz0 && z <= vz1 && DIST[i] >= 2) T[i] = 5;
    else if (DIST[i] >= 2 && starts.some(([sx, sz]) => Math.max(Math.abs(x - sx), Math.abs(z - sz)) <= 5)) T[i] = 6;
  }
  // heights
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = id(x, z), t = T[i];
    if (t === 2 || t === 3) { HT[i] = .25; continue; }
    if (t !== 0) { HT[i] = 1; continue; }
    const n = fbm(x * .13 + idx * 17, z * .13 + idx * 9);
    const edge = Math.max(0, 1 - Math.min(x, W - 1 - x, z, H - 1 - z) / 6);
    let hill = (Math.max(0, (n - .45) * 8) * smooth(DIST[i], 2, 6) + edge * 3 * smooth(DIST[i], 2, 5)) * MAP.hills;
    if (L) hill *= smooth(LDIST[i], 1, 4);
    HT[i] = 1 + Math.min(5, Math.floor(hill));
  }
  // paths + samples
  PATHS = MAP.paths.map(makePath);
  for (const P of PATHS) for (let d = 0; d < P.len; d += .5) { const p = smoothPath(P, d, new V3()); SAMPLES.push({ x: p.x, z: p.z, w: 1 + .6 * d / P.len, P, d }); }
  // build plots: 2x2 pads chosen greedily to cover the path evenly
  { const ok = (x, z) => x >= 1 && z >= 1 && x < W - 1 && z < H - 1 && T[id(x, z)] === 0 && HT[id(x, z)] === 1;
    const cands = [];
    for (let z = 1; z < H - 2; z++) for (let x = 1; x < W - 2; x++) {
      if (!(ok(x, z) && ok(x + 1, z) && ok(x, z + 1) && ok(x + 1, z + 1))) continue;
      const dmin = Math.min(DIST[id(x, z)], DIST[id(x + 1, z)], DIST[id(x, z + 1)], DIST[id(x + 1, z + 1)]);
      if (dmin >= 1 && dmin <= 2) cands.push({ gx: x, gz: z, x: gx2w(x) + .5, z: gz2w(z) + .5 });
    }
    const ks = new Float32Array(SAMPLES.length);
    for (let n = 0; n < MAP.plots; n++) {
      let best = null, bs = 0;
      for (const c of cands) {
        if (PLOTS.some(p => Math.max(Math.abs(p.gx - c.gx), Math.abs(p.gz - c.gz)) < 4)) continue;
        let v = 0; SAMPLES.forEach((p, i) => { if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 < 36) v += 1 / (1 + 1.3 * ks[i]); });
        if (v > bs) { bs = v; best = c; }
      }
      if (!best) break;
      PLOTS.push(best);
      SAMPLES.forEach((p, i) => { if ((p.x - best.x) ** 2 + (p.z - best.z) ** 2 < 36) ks[i]++; });
    }
    for (const p of PLOTS) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) T[id(p.gx + dx, p.gz + dz)] = 7;
  }
  buildTerrain();
  buildShoulders();
  buildDecor();
  buildCastle();
}

// road shoulders: a dirt strip either side of the 1-tile road, so the road reads 1.5 tiles wide with rounded corners
function buildShoulders() {
  const pos = [], col = [], c = new THREE.Color(), base = new THREE.Color(TH.path), bad = (x, z) => { const gx = Math.floor(x + W / 2), gz = Math.floor(z + H / 2); if (gx < 0 || gz < 0 || gx >= W || gz >= H) return true; const t = T[id(gx, gz)]; return t === 2 || t === 3 || t === 4 || t === 7 || HT[id(gx, gz)] > 1; };
  for (const P of PATHS) {
    const pts = []; for (let d = 0; d <= P.len; d += .25) { const p = smoothPath(P, Math.min(d, P.len - .01), new V3()), q = smoothPath(P, Math.min(d + .2, P.len - .001), new V3()); const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1; pts.push({ x: p.x, z: p.z, nx: dz / l, nz: -dx / l }); }
    for (const side of [-1, 1]) for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], q = [[a, .5], [a, .76], [b, .76], [b, .5]].map(([p, o]) => [p.x + p.nx * o * side, p.z + p.nz * o * side]);
      if (q.some(([x, z]) => bad(x, z))) continue;
      const y = Math.max(...q.map(([x, z]) => groundY(x, z))) + .008;
      c.copy(base).multiplyScalar(.9 + Math.random() * .08);
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(q[k][0], y, q[k][1]); col.push(c.r, c.g, c.b); }
    }
  }
  if (!pos.length) return;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); m.receiveShadow = true; worldMats.push(m.material); worldG.add(m);
}
// ---------------------------------------------------------------- terrain
function buildTerrain() {
  const colList = [], capList = [];
  const [cgx, cgz] = MAP.castle;
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = id(x, z), t = T[i], h = HT[i], wx = gx2w(x), wz = gz2w(z);
    if (t === 2 || t === 3) {
      colList.push([wx, -4, wz, 1, 4.1, 1, vary(MAP.theme === 'ember' ? 0x2a2220 : 0x5e5446, .04)]);
      capList.push([wx, .1, wz, 1, .15, 1, vary(MAP.theme === 'ember' ? 0x5a2a1a : 0x8c8466, .05)]);
      waterTiles.push([wx, wz, x * .7 + z * .9]);
      if (x === 0 || z === 0 || x === W - 1 || z === H - 1) edgeLiquid.push([wx, wz, x === 0 ? -1 : x === W - 1 ? 1 : 0, z === 0 ? -1 : z === H - 1 ? 1 : 0]);
    } else if (t === 1) {
      colList.push([wx, -4, wz, 1, 4.72, 1, vary(TH.dirt, .04)]);
      capList.push([wx, .72, wz, 1, .2, 1, vary(TH.path, .05)]);
    } else {
      const cap = h >= 4 ? .35 : .3;
      colList.push([wx, -4, wz, 1, 4 + h - cap, 1, vary(h >= 3 ? TH.rock : TH.dirt, .04)]);
      let c;
      if (t === 4 && Math.abs(x - cgx) <= 3 && Math.abs(z - cgz) <= 3) c = vary(0xa49e92, .05);
      else if (t === 7) c = vary(MAP.theme === 'ember' ? 0x5a4a40 : 0xa08a64, .04);
      else if (h >= TH.snowAt + 1 || (MAP.theme === 'snow' && h >= 1)) c = vary(0xf0f4f8, .025);
      else if (h >= TH.snowAt) c = vary(0xe4eaee, .03);
      else if (h >= TH.stoneAt) c = vary(TH.rock + 0x101010, .05);
      else { const [hh, ss, ll] = TH.grass; c = tmpC.setHSL(hh + (fbm(x * .3, z * .3) - .5) * .08, ss, ll + rand(-.03, .03)).getHex(); }
      capList.push([wx, h - cap, wz, 1, cap, 1, c]);
    }
  }
  worldBatch(colList, wmat(), false, true);
  worldBatch(capList, wmat(), true, true);
  if (waterTiles.length) {
    const lq = LIQ[MAP.liquid.kind];
    liqMat.color.setHex(lq.color); liqMat.emissive.setHex(lq.emissive); liqMat.opacity = lq.opacity; liqMat.transparent = lq.opacity < 1;
    liqMat.needsUpdate = true;
    liqIM = new THREE.InstancedMesh(boxGeo, liqMat, waterTiles.length);
    liqIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage); liqIM.receiveShadow = true; liqIM.frustumCulled = false;
    worldG.add(liqIM); updateWater(0, true);
  }
}
function updateWater(t, force) {
  if (!liqIM) return;
  const lq = LIQ[MAP.liquid.kind];
  if (!lq.bob && !force) return;
  waterTiles.forEach((w, i) => {
    dummy.position.set(w[0], lq.y + lq.bob * Math.sin(t * (MAP.liquid.kind === 'lava' ? .8 : 1.7) + w[2]), w[1]); dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, .3, 1); dummy.updateMatrix(); liqIM.setMatrixAt(i, dummy.matrix);
  });
  liqIM.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- decor
let staticList, nightList, lampList, emberList;
const S = (x, y, z, sx, sy, sz, c, ry = 0) => staticList.push([x, y, z, sx, sy, sz, c, ry]);
function tree(x, y, z, s) {
  const kind = TH.trees === 'mixed' ? (Math.random() < .55 ? 'oak' : 'pine') : TH.trees === 'pine' ? (Math.random() < .85 ? 'pine' : 'oak') : TH.trees;
  if (kind === 'oak') {
    S(x, y, z, .26 * s, 1.0 * s, .26 * s, vary(0x6b4423, .05));
    const g = tmpC.setHSL(.28 + rand(-.03, .03), .55, .32 + rand(-.04, .04)).getHex();
    S(x, y + .8 * s, z, 1.05 * s, .9 * s, 1.05 * s, g);
    for (let k = 0; k < 3; k++) S(x + rand(-.35, .35) * s, y + rand(.7, 1.35) * s, z + rand(-.35, .35) * s, rand(.45, .65) * s, rand(.4, .6) * s, rand(.45, .65) * s, vary(g, .05));
  } else if (kind === 'pine' || kind === 'snowpine') {
    S(x, y, z, .22 * s, .7 * s, .22 * s, vary(0x5a3a1e, .05));
    const g = tmpC.setHSL(.36 + rand(-.03, .03), .45, .24 + rand(-.03, .03)).getHex();
    for (let k = 0; k < 4; k++) {
      const w = (1.15 - k * .26) * s;
      S(x, y + (.45 + k * .38) * s, z, w, .4 * s, w, vary(g, .03), k * .2);
      if (kind === 'snowpine') S(x, y + (.75 + k * .38) * s, z, w * .82, .12 * s, w * .82, vary(0xf2f6fa, .02), k * .2);
    }
    S(x, y + 1.95 * s, z, .14 * s, .25 * s, .14 * s, kind === 'snowpine' ? 0xf2f6fa : g);
  } else { // charred dead tree
    const c = vary(0x2a221e, .04);
    S(x, y, z, .24 * s, 1.5 * s, .24 * s, c);
    S(x + .25 * s, y + .9 * s, z, .5 * s, .1 * s, .1 * s, c, .3); S(x - .2 * s, y + 1.2 * s, z, .1 * s, .1 * s, .45 * s, c, .5);
    if (Math.random() < .5) emberList.push([x, y + 1.5 * s, z, .1, .1, .1, 0]);
  }
}
function rock(x, y, z, s) {
  const n = randi(2, 4);
  for (let k = 0; k < n; k++) S(x + rand(-.3, .3) * s, y - .05, z + rand(-.3, .3) * s, rand(.35, .7) * s, rand(.25, .6) * s, rand(.35, .7) * s, vary(MAP.theme === 'ember' ? 0x3a3230 : MAP.theme === 'snow' ? 0x8a8e96 : 0x8a8a8a, .08), rand(0, 1.5));
}
function house(gx, gz, sx, sz, wall, roof, ry) {
  const x = gx2w(gx), z = gz2w(gz), y = 1;
  const along = ry ? 'z' : 'x';
  const SX = ry ? sz : sx, SZ = ry ? sx : sz;
  S(x, y, z, SX, 1.1, SZ, wall);
  S(x, y, z, SX + .06, .14, SZ + .06, 0x6b4a2e);
  for (let k = 0; k < 4; k++) {
    const sh = k * .2;
    if (along === 'x') S(x, y + 1.1 + k * .22, z, SX + .3, .22, Math.max(.2, SZ + .3 - sh * 2.4), vary(roof, .03));
    else S(x, y + 1.1 + k * .22, z, Math.max(.2, SX + .3 - sh * 2.4), .22, SZ + .3, vary(roof, .03));
  }
  S(x + (along === 'x' ? .4 : 0), y + .1, z - SZ / 2 - .02, .3, .55, .06, 0x5a3a1e);
  nightList.push([x - SX / 4, y + .55, z - SZ / 2 - .03, .26, .26, .05, 0]);
  nightList.push([x + SX / 2 + .03, y + .55, z, .05, .26, .26, 0]);
  nightList.push([x - SX / 2 - .03, y + .55, z, .05, .26, .26, 0]);
  const cx = x + SX / 3, cz = z + SZ / 5;
  S(cx, y + 1.3, cz, .24, 1.0, .24, 0x7a7068);
  chimneys.push(new V3(cx, y + 2.35, cz));
}
function addVillagers(n, [x0, z0, x1, z1]) {
  const rp = () => new V3(gx2w(rand(x0 + .5, x1 - .5)), 1, gz2w(rand(z0 + .5, z1 - .5)));
  for (let k = 0; k < n; k++) {
    const g = new THREE.Group(), legs = [];
    const shirt = pick([0x3a6ea5, 0xa53a3a, 0x6aa53a, 0xa5873a, 0x7a3aa5]);
    for (const s of [-1, 1]) { const l = new THREE.Group(); l.position.set(s * .06, .22, 0); g.add(l); P(l, 0, -.1, 0, .08, .2, .09, 0x4a3a2a); legs.push(l); }
    P(g, 0, .33, 0, .22, .25, .15, shirt); P(g, 0, .55, 0, .17, .17, .17, 0xf0c090); P(g, 0, .65, 0, .19, .05, .19, pick([0x4a2a1a, 0xe0c060, 0x222222]));
    worldG.add(g);
    villagers.push({ g, legs, a: rp(), b: rp(), t: rand(0, 1), sp: rand(.08, .14), ph: rand(0, 6), rp });
  }
}
function meadowVillage() {
  house(7, 18, 2.2, 1.5, 0xe8dcc0, 0xb2452e, 0);
  house(11, 18, 1.8, 1.4, 0xd9c9a3, 0x7b4b2a, 0);
  house(7, 22, 2.0, 1.4, 0xece3cf, 0x4a6aa8, 1);
  house(14, 23, 1.8, 1.4, 0xd6c4a0, 0xb2452e, 0);
  house(10, 24, 1.6, 1.2, 0xe8dcc0, 0x7b4b2a, 0);
  { const x = gx2w(10), z = gz2w(21); S(x, 1, z, .8, .45, .8, 0x8f8a82); S(x, 1.45, z, .6, .05, .6, 0x3d7fc0);
    S(x - .35, 1, z, .08, 1.0, .08, 0x5a3a1e); S(x + .35, 1, z, .08, 1.0, .08, 0x5a3a1e); S(x, 1.95, z, .9, .15, .6, 0xb2452e); }
  for (const [gx, gz] of [[13, 18], [8, 20], [15, 20]]) { S(gx2w(gx), 1, gz2w(gz), .6, .45, .45, 0xe0c060); S(gx2w(gx) + .1, 1.45, gz2w(gz), .45, .35, .4, 0xd8b850); }
  for (let gx = 6; gx <= 15; gx++) { if (gx % 3 === 0) continue; S(gx2w(gx), 1, gz2w(17) - .45, .12, .5, .12, 0x7a5030); S(gx2w(gx), 1.3, gz2w(17) - .45, 1.0, .07, .06, 0x8a6038); }
  for (const [gx, gz] of [[9, 20], [12, 21], [8, 24], [13, 25]]) { if (T[id(gx, gz)] === 1) continue; S(gx2w(gx), 1, gz2w(gz), .1, 1.2, .1, 0x3a3030); lampList.push([gx2w(gx), 2.2, gz2w(gz), .22, .22, .22, 0]); }
  windmill = new THREE.Group();
  const x = gx2w(12.5), z = gz2w(20.5);
  for (let k = 0; k < 6; k++) S(x, 1 + k * .55, z, 1.3 - k * .1, .55, 1.3 - k * .1, vary(0xe2d6bc, .03));
  for (let k = 0; k < 3; k++) S(x, 4.3 + k * .2, z, 1.0 - k * .3, .2, 1.0 - k * .3, 0x7b4b2a);
  nightList.push([x, 2.4, z - .66, .25, .3, .05, 0]);
  windmill.position.set(x, 3.9, z - .65);
  for (let b = 0; b < 4; b++) {
    const arm = new THREE.Group(); arm.rotation.z = b * Math.PI / 2; windmill.add(arm);
    P(arm, 0, 1.2, 0, .08, 2.4, .06, 0x6b4a2e); P(arm, .2, 1.45, 0, .32, 1.8, .03, 0xf0ead8);
  }
  P(windmill, 0, 0, -.05, .25, .25, .2, 0x4a3420);
  worldG.add(windmill);
  addVillagers(5, [7, 19, 14, 23.5]);
}
// small settlement placed inside the map's village rectangle
function hamlet() {
  const [x0, z0, x1, z1] = MAP.village;
  const free = (gx, gz) => gx >= x0 && gz >= z0 && gx <= x1 && gz <= z1 && T[id(gx, gz)] === 5;
  const spotsH = [];
  for (let tries = 0; tries < 80 && spotsH.length < 4; tries++) {
    const gx = randi(x0 + 1, x1 - 1), gz = randi(z0 + 1, z1 - 1);
    if (!(free(gx - 1, gz) && free(gx + 1, gz) && free(gx, gz - 1) && free(gx, gz + 1))) continue;
    if (spotsH.some(([a, b]) => Math.abs(a - gx) < 3 && Math.abs(b - gz) < 3)) continue;
    spotsH.push([gx, gz]);
  }
  const th = MAP.theme;
  for (const [gx, gz] of spotsH) {
    if (th === 'alpine') house(gx, gz, 1.8, 1.4, vary(0x9a948a, .04), 0x4a5060, Math.random() < .3);
    else if (th === 'snow') { house(gx, gz, 1.8, 1.4, vary(0x8a5a3a, .04), 0xf0f4f8, Math.random() < .3); }
    else { // ember: ruined shrine pillars with braziers
      const x = gx2w(gx), z = gz2w(gz);
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const hgt = rand(.6, 2.4); S(x + ox, 1, z + oz, .5, hgt, .5, vary(0x6a5a52, .05)); }
      S(x, 1, z, 2.6, .12, 2.6, 0x4a3e38);
      S(x, 1, z, .5, .6, .5, 0x3a3030); campfires.push(new V3(x, 1.65, z));
    }
  }
  if (th === 'snow') { const [gx, gz] = spotsH.length ? [spotsH[0][0] + 2, spotsH[0][1]] : [x0 + 1, z0 + 1]; const x = gx2w(gx), z = gz2w(gz);
    S(x, 1, z, .6, .55, .6, 0xf4f8fb); S(x, 1.5, z, .45, .42, .45, 0xf4f8fb); S(x, 1.9, z, .32, .3, .32, 0xf4f8fb); S(x, 1.98, z + .17, .06, .06, .14, 0xff8a2a); }
  if (th !== 'ember') addVillagers(3, [x0 + .5, z0 + .5, x1 - .5, z1 - .5]);
  for (const [gx, gz] of spotsH.slice(0, 2)) { const x = gx2w(gx) + 1.4, z = gz2w(gz) - 1.2; if (T[id(gx + 1, gz - 1)] !== 5) continue; S(x, 1, z, .1, 1.2, .1, 0x3a3030); lampList.push([x, 2.2, z, .22, .22, .22, 0]); }
}
// enemy camps and a portal at the start of each path
function camps() {
  for (const P of PATHS) {
    const [sx, sz] = P.wp[0];
    const ox = sx === 0 ? -1 : sx === W - 1 ? 1 : 0, oz = ox ? 0 : sz === 0 ? -1 : 1;
    const px = gx2w(sx) + ox * .7, pz = gz2w(sz) + oz * .7;
    const along = ox ? 'z' : 'x';
    for (const s of [-1, 1]) for (let k = 0; k < 6; k++) S(px + (along === 'x' ? s * 1.05 : 0), .92 + k * .5, pz + (along === 'z' ? s * 1.05 : 0), .5, .5, .5, vary(0x2a2a35, .04));
    for (let k = -3; k <= 3; k++) S(px + (along === 'x' ? k * .4 : 0), 3.92 - Math.abs(k) * .12, pz + (along === 'z' ? k * .4 : 0), .45, .45, .45, vary(0x2a2a35, .04));
    const glowM = P2(px, 2.4, pz, along === 'z' ? .15 : 1.6, 2.9, along === 'z' ? 1.6 : .15);
    portals.push({ pos: new V3(px, 2.3, pz), glow: glowM, out: new V3(ox, 0, oz), P });
    // tents and a campfire on free camp tiles near the portal
    const camp = [];
    for (let z = Math.max(0, sz - 5); z <= Math.min(H - 1, sz + 5); z++) for (let x = Math.max(0, sx - 5); x <= Math.min(W - 1, sx + 5); x++) if (T[id(x, z)] === 6) camp.push([x, z]);
    const used = [];
    const take = () => { for (let k = 0; k < 40 && camp.length; k++) { const c = pick(camp); if (used.every(([a, b]) => Math.abs(a - c[0]) + Math.abs(b - c[1]) >= 3)) { used.push(c); return c; } } return null; };
    for (let k = 0; k < 3; k++) { const c = take(); if (!c) break; const x = gx2w(c[0]), z = gz2w(c[1]), col = pick([0x7a2222, 0x4a3a2a, 0x5a2a4a]);
      for (let j = 0; j < 4; j++) S(x, 1 + j * .3, z, 1.5 - j * .36, .3, 1.3 - j * .3, vary(col, .04));
      S(x, 1, z - .66, .3, .55, .04, 0x1a1010); }
    const c = take();
    if (c) { const x = gx2w(c[0]), z = gz2w(c[1]);
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; S(x + Math.cos(a) * .4, 1, z + Math.sin(a) * .4, .18, .14, .18, 0x777777); }
      campfires.push(new V3(x, 1.05, z)); }
    const b = take();
    if (b) { S(gx2w(b[0]), 1, gz2w(b[1]), .08, 2.2, .08, 0x2a2020); S(gx2w(b[0]) + .3, 2.6, gz2w(b[1]), .55, .7, .04, 0x7a1a3a); }
  }
}
function P2(x, y, z, sx, sy, sz) { const m = new THREE.Mesh(boxGeo, addMat(0x8a3aff)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); worldG.add(m); worldMats.push(m.material); return m; }
// bridges over every run of path-on-liquid tiles
function bridges() {
  const seen = new Uint8Array(W * H);
  const lava = MAP.liquid && MAP.liquid.kind === 'lava';
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (T[id(x, z)] !== 3 || seen[id(x, z)]) continue;
    const horiz = (x > 0 && (T[id(x - 1, z)] === 1 || T[id(x - 1, z)] === 3)) || (x < W - 1 && (T[id(x + 1, z)] === 1 || T[id(x + 1, z)] === 3));
    const run = [];
    let cx = x, cz = z;
    while (cx < W && cz < H && T[id(cx, cz)] === 3) { seen[id(cx, cz)] = 1; run.push([cx, cz]); if (horiz) cx++; else cz++; }
    const deck = lava ? 0x5a4a44 : 0x9a6b3d, post = lava ? 0x3a3030 : 0x6a4526, rail = lava ? 0x4a3e3a : 0x7a5030;
    const a = horiz ? gx2w(run[0][0]) - .7 : gz2w(run[0][1]) - .7, b = horiz ? gx2w(run[run.length - 1][0]) + .7 : gz2w(run[run.length - 1][1]) + .7;
    const fixed = horiz ? gz2w(z) : gx2w(x);
    const at = (u, v, w, sx, sy, sz, c) => horiz ? S(u, v, fixed + w, sx, sy, sz, c) : S(fixed + w, v, u, sz, sy, sx, c);
    for (let u = a; u <= b; u += .26) at(u, .92, 0, .24, .13, 1.45, vary(deck, .06));
    for (let u = a; u <= b + .01; u += 1.0) for (const s of [-1, 1]) { at(u, .92, s * .68, .12, .65, .12, post); at(u, -1.2, s * .55, .25, 2.2, .25, post); }
    for (const s of [-1, 1]) at((a + b) / 2, 1.42, s * .68, b - a, .08, .08, rail);
    for (const u of [a - .3, b + .3]) for (const s of [-1, 1]) { at(u, 1, s * .8, .14, 1.0, .14, 0x4a3420); const lx = horiz ? u : fixed + s * .8, lz = horiz ? fixed + s * .8 : u; lampList.push([lx, 2.0, lz, .22, .22, .22, 0]); }
  }
}
function buildDecor() {
  staticList = []; nightList = []; lampList = []; emberList = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = id(x, z), t = T[i], h = HT[i];
    if (t !== 0) continue;
    const wx = gx2w(x), wz = gz2w(z);
    const far = DIST[i] >= 3 || h > 1;
    const dens = fbm(x * .2 + 40, z * .2 + 10);
    const treeP = (MAP.theme === 'ember' ? .03 + dens * .12 : .07 + dens * .36) * (MAP.trees || 1);
    if (far && h < 5 && Math.random() < treeP) tree(wx + rand(-.2, .2), h, wz + rand(-.2, .2), rand(.75, 1.15) * (h >= 4 ? .8 : 1));
    else if (far && Math.random() < (MAP.theme === 'alpine' || MAP.theme === 'ember' ? .14 : .08)) rock(wx, h, wz, rand(.6, 1.3));
    else if (DIST[i] >= 2 && TH.flowers && h < TH.stoneAt && Math.random() < .12) {
      const fc = MAP.theme === 'alpine' ? pick([0xffffff, 0xb08ad8, 0x7a9a5a]) : pick([0xffe066, 0xff6f91, 0xffffff, 0x9ad0ff, 0x7cc657, 0x7cc657]);
      S(wx + rand(-.4, .4), h, wz + rand(-.4, .4), .1, rand(.1, .22), .1, fc);
    } else if (MAP.theme === 'snow' && DIST[i] >= 2 && Math.random() < .05) {
      S(wx + rand(-.3, .3), h, wz + rand(-.3, .3), .14, rand(.4, .8), .14, vary(0xbfe8f5, .04), rand(0, 1)); // ice crystal
    } else if (MAP.theme === 'ember' && DIST[i] >= 1 && Math.random() < .05) {
      emberList.push([wx + rand(-.3, .3), h, wz + rand(-.3, .3), rand(.3, .6), .03, .08, 0, rand(0, 3)]); // glowing crack
    }
  }
  if (MAP.liquid && MAP.liquid.kind === 'water') {
    waterTiles.forEach(w => { if (Math.random() < .12) S(w[0] + rand(-.3, .3), .7, w[1] + rand(-.3, .3), .3, .04, .3, 0x4c9a3a); });
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (T[id(x, z)] !== 0 || DIST[id(x, z)] < 2 || LDIST[id(x, z)] > 2) continue;
      if (Math.random() < .22) for (let k = 0; k < 3; k++) S(gx2w(x) + rand(-.45, .45), HT[id(x, z)], gz2w(z) + rand(-.45, .45), .06, rand(.3, .6), .06, vary(0x6f9a3a, .06));
    }
  }
  if (MAP.liquid && MAP.liquid.kind === 'ice') { // ice-fishing holes and a hut on the lake
    for (let k = 0; k < 4; k++) { const w = pick(waterTiles); S(w[0], .75, w[1], .4, .02, .4, 0x2a4a6a); }
    const w = waterTiles[Math.floor(waterTiles.length / 2)]; S(w[0], .75, w[1] + 1, 1, .8, .9, 0x7a5a3a); S(w[0], 1.55, w[1] + 1, 1.2, .15, 1.1, 0xf0f4f8);
  }
  if (MAP.liquid && MAP.liquid.kind === 'lava') lavaTiles = waterTiles;
  bridges();
  if (MAP.theme === 'meadow') meadowVillage(); else hamlet();
  camps();
  for (const p of PLOTS) {
    S(p.x, 1, p.z, 1.84, .08, 1.84, MAP.theme === 'ember' ? 0x7a6a5e : 0xc2b394);
    for (const [ox, oz] of [[-.86, -.86], [.86, -.86], [-.86, .86], [.86, .86]]) S(p.x + ox, 1, p.z + oz, .22, .2, .22, 0x77706a);
  }
  worldBatch(staticList, wmat(), true, true);
  for (const b of staticList) markObs(b[0], b[2], b[1] + b[4]);
  if (windmill) markObs(windmill.position.x, windmill.position.z, 6.5);
  if (nightList.length) worldBatch(nightList, nightMat, false, false);
  if (lampList.length) worldBatch(lampList, lampMat, false, false);
  if (emberList.length) worldBatch(emberList, emberMat, false, false);
}
function markObs(x, z, top) { const gx = Math.floor(x + W / 2), gz = Math.floor(z + H / 2); for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const a = gx + dx, b = gz + dz; if (a >= 0 && b >= 0 && a < W && b < H) OBS[id(a, b)] = Math.max(OBS[id(a, b)], top); } }

// ---------------------------------------------------------------- castle
function buildCastle() {
  CX = gx2w(MAP.castle[0]); CZ = gz2w(MAP.castle[1]);
  GATE.set(CX, 1, CZ - 3.6);
  const CB = (x, y, z, sx, sy, sz, c) => castleBlocks.push({ x, y, z, sx, sy, sz, c, on: true });
  const stone = () => vary(0xbdb6a8, .06);
  const half = 3.5;
  for (let layer = 0; layer < 4; layer++) {
    const y = 1 + layer * .6;
    for (let k = -3; k <= 3; k++) {
      if (!(layer < 3 && k === 0)) CB(CX + k, y, CZ - half, 1, .6, .6, stone());
      CB(CX + k, y, CZ + half, 1, .6, .6, stone());
      CB(CX - half, y, CZ + k, .6, .6, 1, stone());
      CB(CX + half, y, CZ + k, .6, .6, 1, stone());
    }
  }
  for (let k = -3; k <= 3; k += 2) {
    CB(CX + k, 3.4, CZ - half, .5, .4, .6, stone()); CB(CX + k, 3.4, CZ + half, .5, .4, .6, stone());
    CB(CX - half, 3.4, CZ + k, .6, .4, .5, stone()); CB(CX + half, 3.4, CZ + k, .6, .4, .5, stone());
  }
  CB(CX, 1, CZ - half + .1, 1, 1.75, .3, 0x5a3a1e);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = CX + sx * half, z = CZ + sz * half;
    for (let l = 0; l < 7; l++) CB(x, 1 + l * .6, z, 1.6, .6, 1.6, stone());
    for (const [ox, oz] of [[-.6, -.6], [.6, -.6], [-.6, .6], [.6, .6]]) CB(x + ox, 5.2, z + oz, .4, .4, .4, stone());
    for (let r = 0; r < 4; r++) CB(x, 5.2 + r * .35, z, 1.4 - r * .35, .35, 1.4 - r * .35, vary(0x3a4f8a, .03));
  }
  const kz = CZ + .8;
  for (let l = 0; l < 9; l++) CB(CX, 1 + l * .6, kz, 2.8, .6, 2.6, stone());
  for (let r = 0; r < 5; r++) CB(CX, 6.4 + r * .35, kz, 3.0 - r * .6, .35, 2.8 - r * .55, vary(0x8a2a2a, .03));
  for (const [ox, oz] of [[-1, -1.32], [1, -1.32], [0, -1.32]]) CB(CX + ox, 4.2, kz + oz, .35, .5, .05, 0xffc860);
  CB(CX, 8.1, kz, .1, 2.0, .1, 0x3a3030);
  castleBlocks.forEach(b => b.prio = b.y + rand(0, 2.5) + (b.c === 0xffc860 ? -2 : 0));
  castleOrder = castleBlocks.map((b, i) => i).sort((a, b) => castleBlocks[b].prio - castleBlocks[a].prio);
  castleIM = new THREE.InstancedMesh(boxGeo, wmat(), castleBlocks.length);
  castleIM.castShadow = castleIM.receiveShadow = true; castleIM.frustumCulled = false; worldG.add(castleIM);
  castleBlocks.forEach((b, i) => setBlock(i, true));
  FLAG0.set(CX + .05, 9.6, CZ + .8);
  for (let z = -4; z <= 4; z++) for (let x = -4; x <= 4; x++) markObs(CX + x, CZ + z, 7.5);
}
function setBlock(i, on) {
  const b = castleBlocks[i]; b.on = on;
  dummy.position.set(b.x, b.y + b.sy / 2, b.z); dummy.rotation.set(0, 0, 0);
  if (on) dummy.scale.set(b.sx, b.sy, b.sz); else dummy.scale.set(0, 0, 0);
  dummy.updateMatrix(); castleIM.setMatrixAt(i, dummy.matrix); castleIM.setColorAt(i, tmpC.setHex(b.c));
  castleIM.instanceMatrix.needsUpdate = true; castleIM.instanceColor.needsUpdate = true;
}
// castle flag
const flagIM = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x2a5ad8 }), 24);
flagIM.castShadow = true; flagIM.frustumCulled = false; scene.add(flagIM);
function updateFlag(t, visible) {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
    const i = r * 6 + c;
    dummy.position.set(FLAG0.x + c * .2 + .1, FLAG0.y - r * .2, FLAG0.z + Math.sin(t * 5 - c * .9) * .07 * c / 2);
    dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(visible ? .2 : 0); dummy.updateMatrix(); flagIM.setMatrixAt(i, dummy.matrix);
    flagIM.setColorAt(i, tmpC.setHex((r === 1 || r === 2) && (c === 2 || c === 3) ? 0xffd040 : 0x2a5ad8));
  }
  flagIM.instanceMatrix.needsUpdate = true; flagIM.instanceColor.needsUpdate = true;
}
buildMap(0);

// ================================================================ sky, clouds, stars, birds
const skyMat = new THREE.ShaderMaterial({
  uniforms: { top: { value: new THREE.Color(0x4a8fe0) }, bot: { value: new THREE.Color(0xbfe0ff) } },
  vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying vec3 vP; void main(){ float h=clamp(vP.y*1.5+.12,0.,1.); gl_FragColor=vec4(mix(bot,top,pow(h,.8)),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
  side: THREE.BackSide, depthWrite: false, fog: false
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), skyMat); sky.renderOrder = -10; scene.add(sky);
const sunDisc = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false, toneMapped: false }));
scene.add(sunDisc);
const starGeo = new THREE.BufferGeometry(); { const a = [];
  for (let i = 0; i < 700; i++) { const v = new V3(rand(-1, 1), rand(.05, 1), rand(-1, 1)).normalize().multiplyScalar(450); a.push(v.x, v.y, v.z); }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); }
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
const stars = new THREE.Points(starGeo, starMat); scene.add(stars);
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 });
const clouds = [];
for (let i = 0; i < 0; i++) { // clouds removed: they blocked the view
  const g = new THREE.Group(), n = randi(4, 8);
  for (let j = 0; j < n; j++) P(g, rand(-2.5, 2.5), rand(0, .9), rand(-1.4, 1.4), rand(1.6, 3.8), rand(.8, 1.4), rand(1.2, 2.6), 0, cloudMat, true);
  g.position.set(rand(-70, 70), rand(15, 23), rand(-45, 45)); g.userData.v = rand(.6, 1.5);
  scene.add(g); clouds.push(g);
}
const birds = [];
for (let i = 0; i < 6; i++) {
  const g = new THREE.Group(); P(g, 0, 0, 0, .12, .1, .3, 0x222222, null, false);
  const w = []; for (const s of [-1, 1]) { const p = new THREE.Group(); g.add(p); P(p, s * .22, 0, 0, .4, .03, .15, 0x333333, null, false); w.push(p); }
  scene.add(g); birds.push({ g, w, a: i * .5, r: 14 + i * .8, h: 11 + rand(-1, 1), ph: rand(0, 6) });
}

// ================================================================ particle pools
const F_BOUNCE = 1, F_GROW = 2, F_COIN = 4, F_SPIN = 8;
class Pool {
  constructor(cap, mat, geo, glow = false) {
    this.cap = cap; this.n = 0; this.glow = glow;
    const m = this.mesh = new THREE.InstancedMesh(geo || boxGeo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, tmpC.setRGB(1, 1, 1)); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false; scene.add(m);
    const f = () => new Float32Array(cap);
    this.k = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'ml', 'sz', 'rx', 'ry', 'rz', 'rv', 'g', 'dr', 'fl', 'r', 'gg', 'b', 'r2', 'g2', 'b2'];
    for (const k of this.k) this[k] = f();
  }
  spawn(x, y, z, vx, vy, vz, life, size, col, grav = 0, flags = 0, drag = 0, col2) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = this.ml[i] = life; this.sz[i] = size; this.g[i] = grav; this.fl[i] = flags; this.dr[i] = drag;
    this.rx[i] = rand(0, 6); this.ry[i] = rand(0, 6); this.rz[i] = rand(0, 6); this.rv[i] = rand(-8, 8);
    tmpC.set(col); this.r[i] = tmpC.r; this.gg[i] = tmpC.g; this.b[i] = tmpC.b;
    if (col2 !== undefined) tmpC.set(col2);
    this.r2[i] = tmpC.r; this.g2[i] = tmpC.g; this.b2[i] = tmpC.b;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { const j = --this.n; if (i !== j) for (const k of this.k) this[k][i] = this[k][j]; continue; }
      const fl = this.fl[i], age = this.ml[i] - this.life[i];
      if (fl & F_COIN && age > .9) { this.vy[i] += 16 * dt; this.vx[i] *= .9; this.vz[i] *= .9; }
      else this.vy[i] -= this.g[i] * dt;
      const dr = Math.exp(-this.dr[i] * dt);
      this.vx[i] *= dr; this.vy[i] *= dr; this.vz[i] *= dr;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (fl & F_BOUNCE && this.vy[i] < 0) {
        const gy = groundY(this.px[i], this.pz[i]) + this.sz[i] * .4;
        if (this.py[i] < gy && gy > -5) { this.py[i] = gy; this.vy[i] *= -.35; this.vx[i] *= .55; this.vz[i] *= .55; this.rv[i] *= .5; }
      }
      if (fl & F_COIN) this.ry[i] += 9 * dt; else if (fl & F_SPIN || fl & F_BOUNCE) { this.rx[i] += this.rv[i] * dt; this.rz[i] += this.rv[i] * .7 * dt; }
      i++;
    }
    const m = this.mesh;
    for (i = 0; i < this.n; i++) {
      const f = this.life[i] / this.ml[i];
      let s = this.sz[i];
      if (this.fl[i] & F_GROW) s *= 1 + (1 - f) * 1.5;
      if (f < .3) s *= f / .3;
      dummy.position.set(this.px[i], this.py[i], this.pz[i]);
      dummy.rotation.set(this.rx[i], this.ry[i], this.rz[i]); dummy.scale.set(s, s, s); dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      const u = 1 - f, br = this.glow ? Math.min(1, f * 2.2) : 1;
      tmpC.setRGB(lerp(this.r[i], this.r2[i], u) * br, lerp(this.gg[i], this.g2[i], u) * br, lerp(this.b[i], this.b2[i], u) * br);
      m.setColorAt(i, tmpC);
    }
    m.count = this.n; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
  }
  clear() { this.n = 0; this.mesh.count = 0; }
}
const debris = new Pool(3000, new THREE.MeshLambertMaterial());
debris.mesh.castShadow = true;
const smoke = new Pool(1800, new THREE.MeshLambertMaterial({ transparent: true, opacity: .5, depthWrite: false }));
const glow = new Pool(4500, new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), null, true);
const coinGeo = new THREE.BoxGeometry(.3, .3, .07);
const coins = new Pool(400, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x5a3a00 }), coinGeo);
const pools = [debris, smoke, glow, coins];

// ================================================================ effects
const FIRE1 = 0xffd060, FIRE2 = 0x8a1500;
let shake = 0;
function addShake(p, amt) { const d = camera.position.distanceTo(p); shake = Math.max(shake, amt * clamp(1.4 - d / 30, 0, 1)); }
function fxSparks(p, col, n = 8, sp = 4) { for (let i = 0; i < n; i++) glow.spawn(p.x, p.y, p.z, rand(-sp, sp), rand(0, sp * 1.2), rand(-sp, sp), rand(.2, .45), rand(.06, .13), col, 9, 0, 1); }
function fxSmoke(p, n = 4, col = 0x555555, s = .35) { for (let i = 0; i < n; i++) smoke.spawn(p.x + rand(-.3, .3), p.y + rand(0, .3), p.z + rand(-.3, .3), rand(-.4, .4), rand(.8, 1.8), rand(-.4, .4), rand(1, 2), rand(.6, 1) * s, col, 0, F_GROW | F_SPIN, 1.2, 0x9a9a9a); }
function fxDust(p, n = 8, s = .25) { for (let i = 0; i < n; i++) { const a = rand(0, 6.28); smoke.spawn(p.x + Math.cos(a) * .3, p.y + .1, p.z + Math.sin(a) * .3, Math.cos(a) * rand(1, 2.5), rand(.2, .8), Math.sin(a) * rand(1, 2.5), rand(.6, 1.1), s * rand(.7, 1.2), 0xb8a07a, 0, F_GROW | F_SPIN, 2.5, 0xd8c8a8); } }
function fxExplosion(p, s = 1) {
  for (let i = 0; i < 26 * s; i++) { const v = new V3(rand(-1, 1), rand(-.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(2, 7) * s); glow.spawn(p.x, p.y + .2, p.z, v.x, v.y, v.z, rand(.3, .65), rand(.18, .42) * s, FIRE1, -1, F_SPIN, 3.5, FIRE2); }
  for (let i = 0; i < 10 * s; i++) smoke.spawn(p.x + rand(-.5, .5), p.y + rand(0, .5), p.z + rand(-.5, .5), rand(-1.2, 1.2), rand(1, 2.6), rand(-1.2, 1.2), rand(1.2, 2.2), rand(.4, .7) * s, 0x3a3530, 0, F_GROW | F_SPIN, 1.5, 0x8a8580);
  for (let i = 0; i < 8 * s; i++) debris.spawn(p.x, p.y + .2, p.z, rand(-3, 3), rand(3, 7), rand(-3, 3), rand(1.2, 2), rand(.08, .18), pick([0x6b4a2e, 0x5a8a3a, 0x7a6a5a]), 18, F_BOUNCE, .3);
  fxSparks(p, 0xffe0a0, 10, 6);
  flashLight(p, 70 * s); addShake(p, .35 * s);
}
function fxCoins(p, n) { for (let i = 0; i < n; i++) coins.spawn(p.x, p.y + .3, p.z, rand(-1.8, 1.8), rand(4, 7), rand(-1.8, 1.8), rand(1.4, 1.9), 1, 0xffcc33, 16, F_COIN | F_BOUNCE, .2); }
function fxIce(p) { for (let i = 0; i < 10; i++) debris.spawn(p.x, p.y, p.z, rand(-2.5, 2.5), rand(1, 4), rand(-2.5, 2.5), rand(.5, .9), rand(.06, .14), pick([0xbff4ff, 0xe8fbff, 0x8ad8ff]), 12, F_BOUNCE, .5); fxSparks(p, 0x7fe0ff, 6, 3); }

// lightning segments
const boltOuter = addMat(0x5aa8ff), boltCore = addMat(0xffffff);
const boltSegs = []; const boltFree = [];
function seg(a, b, w, mat, life) {
  const m = boltFree.pop() || new THREE.Mesh(boxGeo, mat);
  m.material = mat; m.position.lerpVectors(a, b, .5); m.lookAt(b); m.scale.set(w, w, a.distanceTo(b) + w);
  scene.add(m); boltSegs.push({ m, life });
}
function bolt(a, b, col) {
  boltOuter.color.setHex(col);
  const n = Math.max(3, Math.round(a.distanceTo(b) / .7));
  let prev = a.clone();
  for (let i = 1; i <= n; i++) {
    const p = new V3().lerpVectors(a, b, i / n);
    if (i < n) p.add(new V3(rand(-.3, .3), rand(-.3, .3), rand(-.3, .3)));
    seg(prev, p, .16, boltOuter, .16); seg(prev, p, .05, boltCore, .16); prev = p;
  }
}

// ================================================================ enemies
// armor: share of physical damage blocked; mr: share of magic damage blocked. True damage ignores both.
const ED = {
  runner: { name: 'Goblin', title: 'Goblin Raider', desc: 'Quick and fragile. Goblins rush in packs of three to five, so splash damage shreds them.', weak: 'Anything; Cannon splash and Flame Tower', hp: 29, speed: 3.0, reward: 4, dmg: 3, air: false, armor: 0, mr: 0, bw: .6, step: 15 },
  soldier: { name: 'Orc', title: 'Orc Spearman', desc: 'The backbone of the horde. Its shield and leather blunt arrows a little.', weak: 'Tesla Coil, Frost Spire', hp: 75, speed: 1.85, reward: 6, dmg: 5, air: false, armor: .3, mr: 0, bw: .8, step: 9 },
  knight: { name: 'Knight', title: 'Iron Knight', desc: 'Full plate armour turns away most arrows and cannonballs. Magic goes straight through it.', weak: 'Tesla Coil, Frost Spire, Flame Tower', hp: 143, speed: 1.5, reward: 12, dmg: 6, air: false, armor: .7, mr: 0, bw: .85, step: 8 },
  shaman: { name: 'Shaman', title: 'Goblin Shaman', desc: 'A masked healer. Every 2 seconds it restores 8% health to nearby enemies. Its charms resist magic.', weak: 'Archer Tower, Cannon (kill it first)', hp: 91, speed: 1.6, reward: 12, dmg: 4, air: false, armor: 0, mr: .6, bw: .7, step: 9 },
  brute: { name: 'Ogre', title: 'Ogre Brute', desc: 'Huge health and a heavy club. Slow, but each one that reaches the gate hits hard.', weak: 'Frost Spire slow, then anything', hp: 299, speed: 1.0, reward: 15, dmg: 12, air: false, armor: .2, mr: 0, bw: 1.15, step: 5 },
  golem: { name: 'Golem', title: 'Rune Golem', desc: 'Living stone carved with runes that soak up magic. Slow and very tough.', weak: 'Cannon, Archer Tower, Flame Tower', hp: 494, speed: .8, reward: 26, dmg: 14, air: false, armor: .3, mr: .75, bw: 1.2, step: 4 },
  flyer: { name: 'Bat', title: 'Cave Bat', desc: 'Flies over the path. Cannons and Flame Towers cannot reach it.', weak: 'Archer Tower, Tesla Coil, Frost Spire', hp: 55, speed: 2.3, reward: 7, dmg: 4, air: true, armor: 0, mr: 0, bw: .7, step: 13 },
  wraith: { name: 'Wraith', title: 'Frost Wraith', desc: 'A flying ghost. Arrows pass almost straight through it, and Cannons and Flame Towers cannot reach it.', weak: 'Tesla Coil, Frost Spire', hp: 78, speed: 2.0, reward: 12, dmg: 5, air: true, armor: .85, mr: 0, bw: .7, step: 6 },
  sapper: { name: 'Sapper', title: 'Goblin Sapper', desc: 'Hauls a bomb. It stops beside the first tower it reaches and plants a charge that knocks that tower out for 5 seconds.', weak: 'Archer Tower and Cannon: kill it before it reaches your towers', hp: 52, speed: 2.2, reward: 8, dmg: 4, air: false, armor: 0, mr: 0, bw: .65, step: 13 },
  rider: { name: 'Boar Rider', title: 'Boar Rider', desc: 'A goblin on a war boar. Fast, and it charges straight through the first slow or freeze that hits it.', weak: 'Cannon splash, Archer Tower, a second slow', hp: 72, speed: 2.6, reward: 9, dmg: 5, air: false, armor: .1, mr: 0, bw: .8, step: 14 },
  gruk: { name: 'Gruk', title: 'Gruk the Mire-King', desc: 'Chieftain of the bog trolls. Slows wear off him twice as fast, and at half health two Boar Riders charge out ahead of him.', weak: 'Cannon and Flame Tower, with slows kept on him', hp: 1820, speed: .7, reward: 120, dmg: 30, air: false, armor: .2, mr: .1, bw: 2.0, step: 3 },
  boss: { name: 'Warlord', title: 'Stone Warlord', desc: 'Leader of the horde. Enormous health and armour against both physical and magic damage.', weak: 'Frost Spire slow, then Flame Tower', hp: 2210, speed: .62, reward: 140, dmg: 34, air: false, armor: .4, mr: .4, bw: 2.2, step: 2.6 },
};
const ES = 1.25; // enemy model scale
const wraithMat = new THREE.MeshLambertMaterial({ color: 0xcfe6ff, emissive: 0x4a6a9a, transparent: true, opacity: .62 });
function limb(par, x, y, z, w, h, d, c) { const p = new THREE.Group(); p.position.set(x, y, z); par.add(p); P(p, 0, -h / 2, 0, w, h, d, c); return p; }
const eyeR = () => ME(0xff3020, 1.5), eyeY = () => ME(0xffd040, 1.5);
const BUILD = {
  runner(b) {
    const legs = [limb(b, -.09, .28, 0, .11, .28, .12, 0x4a3420), limb(b, .09, .28, 0, .11, .28, .12, 0x4a3420)];
    P(b, 0, .43, 0, .34, .3, .24, 0x6a4428);
    P(b, 0, .73, .02, .36, .3, .32, 0x6cbf4a);
    P(b, -.25, .8, 0, .16, .07, .06, 0x6cbf4a); P(b, .25, .8, 0, .16, .07, .06, 0x6cbf4a);
    P(b, -.08, .76, .185, .07, .05, .02, 0, eyeR(), false); P(b, .08, .76, .185, .07, .05, .02, 0, eyeR(), false);
    const arms = [limb(b, -.22, .56, 0, .08, .24, .08, 0x6cbf4a), limb(b, .22, .56, 0, .08, .24, .08, 0x6cbf4a)];
    P(arms[1], 0, -.24, .12, .04, .04, .3, 0xd0d0d0);
    return { legs, arms, cy: .55, hb: 1.15, shell: [.6, .95, .5] };
  },
  soldier(b) {
    const legs = [limb(b, -.12, .38, 0, .15, .38, .17, 0x3a2c20), limb(b, .12, .38, 0, .15, .38, .17, 0x3a2c20)];
    P(b, 0, .63, 0, .52, .48, .34, 0x7a5230); P(b, 0, .42, 0, .54, .08, .36, 0x2a1e14);
    P(b, -.3, .86, 0, .2, .12, .3, 0x8a8f99); P(b, .3, .86, 0, .2, .12, .3, 0x8a8f99);
    P(b, 0, 1.03, .02, .34, .32, .32, 0x5b8a3c); P(b, 0, 1.2, 0, .4, .12, .38, 0x8a8f99); P(b, 0, 1.3, 0, .06, .12, .06, 0xb0b5bf);
    P(b, -.08, 1.05, .18, .07, .05, .02, 0, eyeY(), false); P(b, .08, 1.05, .18, .07, .05, .02, 0, eyeY(), false);
    const arms = [limb(b, -.33, .82, 0, .13, .42, .14, 0x5b8a3c), limb(b, .33, .82, 0, .13, .42, .14, 0x5b8a3c)];
    P(arms[0], -.1, -.28, .06, .08, .52, .44, 0x8a2a22); P(arms[0], -.15, -.28, .06, .04, .14, .14, 0xc0c4cc);
    P(arms[1], .02, -.1, .14, .05, 1.35, .05, 0x6b4a2a); P(arms[1], .02, .62, .14, .09, .2, .09, 0xd8d8d8);
    return { legs, arms, cy: .75, hb: 1.62, shell: [.85, 1.45, .7] };
  },
  brute(b) {
    const legs = [limb(b, -.24, .55, 0, .3, .55, .32, 0x5a4a3a), limb(b, .24, .55, 0, .3, .55, .32, 0x5a4a3a)];
    P(b, 0, 1.08, 0, .95, .85, .66, 0x8e7d9b); P(b, 0, .98, .3, .72, .55, .12, 0xa99bb4);
    P(b, 0, .62, 0, 1.0, .18, .7, 0x4a3420);
    P(b, 0, 1.66, .14, .52, .44, .46, 0x8e7d9b);
    P(b, -.13, 1.56, .39, .06, .16, .06, 0xf0ead8); P(b, .13, 1.56, .39, .06, .16, .06, 0xf0ead8);
    P(b, -.12, 1.72, .375, .09, .06, .02, 0, eyeR(), false); P(b, .12, 1.72, .375, .09, .06, .02, 0, eyeR(), false);
    const arms = [limb(b, -.62, 1.4, 0, .28, .8, .3, 0x8e7d9b), limb(b, .62, 1.4, 0, .28, .8, .3, 0x8e7d9b)];
    P(arms[0], 0, -.86, 0, .34, .3, .34, 0x7a6a88); P(arms[1], 0, -.86, 0, .34, .3, .34, 0x7a6a88);
    P(arms[1], 0, -.9, .45, .2, .2, .95, 0x6b4a2a); P(arms[1], 0, -.9, .85, .34, .34, .34, 0x5a3a1e);
    return { legs, arms, cy: 1.05, hb: 2.35, shell: [1.5, 2.1, 1.0] };
  },
  flyer(b) {
    P(b, 0, 0, 0, .36, .3, .62, 0x5a2d82); P(b, 0, -.1, .05, .26, .1, .44, 0x8a5ab2);
    P(b, 0, .08, .4, .3, .26, .26, 0x6a3a92); P(b, -.1, .25, .38, .05, .15, .05, 0x2a1a3a); P(b, .1, .25, .38, .05, .15, .05, 0x2a1a3a);
    P(b, -.08, .1, .535, .07, .05, .02, 0, eyeY(), false); P(b, .08, .1, .535, .07, .05, .02, 0, eyeY(), false);
    P(b, 0, 0, -.48, .1, .08, .4, 0x4a2272); P(b, 0, .05, -.72, .2, .04, .14, 0x8a2a8a);
    const wings = [];
    for (const s of [-1, 1]) { const w = new THREE.Group(); w.position.set(s * .17, .08, 0); b.add(w); P(w, s * .45, 0, 0, .9, .04, .5, 0x3f1f60); P(w, s * .95, 0, -.1, .3, .03, .35, 0x7a3aa0); wings.push(w); }
    return { legs: [], arms: [], wings, cy: 0, hb: .7, shell: [1.2, .6, 1.0] };
  },
  knight(b) {
    const legs = [limb(b, -.13, .4, 0, .16, .4, .18, 0x9aa0aa), limb(b, .13, .4, 0, .16, .4, .18, 0x9aa0aa)];
    P(b, 0, .66, 0, .56, .5, .36, 0xc8ccd4); P(b, 0, .66, .19, .3, .36, .04, 0xb02a2a);
    P(b, 0, .42, 0, .58, .08, .38, 0x5a5e66);
    P(b, -.34, .9, 0, .22, .14, .34, 0xdde0e6); P(b, .34, .9, 0, .22, .14, .34, 0xdde0e6);
    P(b, 0, 1.08, .02, .36, .36, .36, 0xc8ccd4); P(b, 0, 1.08, .2, .26, .05, .02, 0x1a1a1e);
    P(b, 0, 1.32, -.04, .08, .14, .32, 0xd03030);
    const arms = [limb(b, -.36, .86, 0, .14, .44, .15, 0xb8bcc4), limb(b, .36, .86, 0, .14, .44, .15, 0xb8bcc4)];
    P(arms[0], -.1, -.3, .08, .08, .6, .48, 0x2a4a9a); P(arms[0], -.15, -.3, .08, .04, .4, .08, 0xe0b840); P(arms[0], -.15, -.25, .08, .04, .08, .3, 0xe0b840);
    P(arms[1], .02, -.45, .3, .06, .06, .7, 0xe8ecf2); P(arms[1], .02, -.45, 0, .2, .05, .05, 0xc0a040);
    return { legs, arms, cy: .8, hb: 1.72, shell: [.95, 1.55, .8] };
  },
  shaman(b) {
    const legs = [limb(b, -.1, .3, 0, .11, .3, .12, 0x3a2a1a), limb(b, .1, .3, 0, .11, .3, .12, 0x3a2a1a)];
    P(b, 0, .5, 0, .42, .42, .32, 0x4a2a5a); P(b, 0, .3, 0, .48, .14, .36, 0x3a1e4a);
    P(b, 0, .86, .02, .36, .3, .32, 0x5a9a4a);
    P(b, 0, .86, .18, .3, .26, .04, 0xeee6d2); P(b, -.07, .9, .205, .06, .05, .02, 0, ME(0x6aff8a, 2), false); P(b, .07, .9, .205, .06, .05, .02, 0, ME(0x6aff8a, 2), false);
    for (const [x, c] of [[-.12, 0xd04040], [0, 0xe0c040], [.12, 0x40a0d0]]) P(b, x, 1.12, -.02, .06, .26, .06, c);
    const arms = [limb(b, -.27, .66, 0, .09, .3, .1, 0x5a9a4a), limb(b, .27, .66, 0, .09, .3, .1, 0x5a9a4a)];
    P(arms[1], .04, -.1, .14, .05, 1.1, .05, 0x6b4a2a); P(arms[1], .04, .48, .14, .16, .16, .16, 0, ME(0x6aff8a, 2), false);
    return { legs, arms, cy: .6, hb: 1.35, shell: [.7, 1.2, .6] };
  },
  golem(b) {
    const legs = [limb(b, -.32, .5, 0, .38, .5, .42, 0x6a6a62), limb(b, .32, .5, 0, .38, .5, .42, 0x6a6a62)];
    P(b, 0, 1.1, 0, 1.2, .95, .8, 0x7a7a70); P(b, -.3, 1.55, .1, .5, .12, .5, 0x5a8a3a); P(b, .35, 1.0, -.38, .4, .3, .1, 0x5a8a3a);
    const rune = ME(0x3ae0ff, 1.8);
    P(b, 0, 1.15, .41, .5, .08, .02, 0, rune, false); P(b, 0, 1.15, .41, .08, .45, .02, 0, rune, false);
    P(b, 0, 1.75, .18, .5, .4, .45, 0x84847a);
    P(b, -.12, 1.78, .41, .1, .06, .02, 0, rune, false); P(b, .12, 1.78, .41, .1, .06, .02, 0, rune, false);
    const arms = [limb(b, -.78, 1.45, 0, .42, .85, .45, 0x74746a), limb(b, .78, 1.45, 0, .42, .85, .45, 0x74746a)];
    P(arms[0], 0, -.95, 0, .55, .45, .55, 0x6a6a60); P(arms[1], 0, -.95, 0, .55, .45, .55, 0x6a6a60);
    return { legs, arms, cy: 1.1, hb: 2.35, shell: [1.9, 2.1, 1.1] };
  },
  wraith(b) {
    const m = wraithMat;
    P(b, 0, .1, 0, .5, .5, .4, 0, m, false); P(b, 0, -.25, -.05, .42, .3, .34, 0, m, false); P(b, 0, -.52, -.12, .3, .26, .26, 0, m, false); P(b, 0, -.75, -.22, .16, .22, .16, 0, m, false);
    P(b, 0, .48, .02, .42, .38, .4, 0x2a3a5a); P(b, 0, .48, .2, .3, .26, .04, 0x0a0e18);
    P(b, -.08, .5, .225, .08, .05, .02, 0, ME(0x7ae8ff, 2.5), false); P(b, .08, .5, .225, .08, .05, .02, 0, ME(0x7ae8ff, 2.5), false);
    const arms = [limb(b, -.3, .28, .05, .1, .45, .1, 0xb8d4f0), limb(b, .3, .28, .05, .1, .45, .1, 0xb8d4f0)];
    return { legs: [], arms, cy: 0, hb: .95, shell: [.9, 1.4, .8] };
  },
  boss(b) {
    const legs = [limb(b, -.45, 1.1, 0, .55, 1.1, .6, 0x5a5a66), limb(b, .45, 1.1, 0, .55, 1.1, .6, 0x5a5a66)];
    P(b, 0, 1.9, 0, 1.6, 1.5, 1.0, 0x6b6b7a);
    const crack = ME(0xff7a1a, 2.2);
    P(b, -.3, 1.95, .51, .12, 1.0, .03, 0, crack, false); P(b, .35, 1.8, .51, .1, .6, .03, 0, crack, false); P(b, 0, 2.3, .51, .7, .1, .03, 0, crack, false);
    P(b, 0, 1.6, -.55, 1.35, 1.7, .08, 0x8a1a1a);
    P(b, -.95, 2.5, 0, .62, .5, .74, 0x8a8a98); P(b, .95, 2.5, 0, .62, .5, .74, 0x8a8a98);
    P(b, 0, 3.0, .1, .82, .72, .76, 0x74747f);
    P(b, -.18, 3.05, .49, .16, .09, .03, 0, ME(0xffb030, 2.5), false); P(b, .18, 3.05, .49, .16, .09, .03, 0, ME(0xffb030, 2.5), false);
    const gold = ME(0xffc830, .35);
    P(b, 0, 3.42, .1, .88, .14, .82, 0, gold);
    for (const x of [-.34, 0, .34]) P(b, x, 3.6, .1 + .3, .14, .24, .1, 0, gold);
    P(b, -.34, 3.6, -.2, .14, .24, .1, 0, gold); P(b, .34, 3.6, -.2, .14, .24, .1, 0, gold);
    const arms = [limb(b, -1.05, 2.4, 0, .5, 1.3, .55, 0x6b6b7a), limb(b, 1.05, 2.4, 0, .5, 1.3, .55, 0x6b6b7a)];
    P(arms[0], 0, -1.4, 0, .6, .5, .6, 0x3a3a44); P(arms[1], 0, -1.4, 0, .6, .5, .6, 0x3a3a44);
    P(arms[1], 0, -1.45, .55, .14, .14, 1.4, 0x5a3a1a); P(arms[1], 0, -1.45, 1.25, .7, .55, .5, 0x2a2a30);
    return { legs, arms, cy: 1.9, hb: 4.15, shell: [2.6, 3.8, 1.6] };
  }
};
// ================================================================ enemy models (cel-shaded, built from the art board)
// Each type is built once as a template from smooth parts, then merged into a few meshes per moving part
// (body, legs, arms, wings), one material bucket each, plus an ink-outline hull. Enemies share those meshes.
const EMODEL = (() => {
const V = THREE.Vector3, PI = Math.PI;
let RIG = null, TGT = null;
// R_('legs'|'arms', pivot) sends the following parts into a new pivot group; R_() ends it
function R_(kind, p) {
  if (!kind) { TGT = null; return; }
  const o = new THREE.Group(); o.position.set(...p); RIG.body.add(o); RIG[kind].push(o);
  const i = new THREE.Group(); i.position.set(-p[0], -p[1], -p[2]); o.add(i); TGT = i;
}
const host = par => (TGT && par === RIG.body ? TGT : par);
const put = (par, g) => host(par).add(g);
// ---------------------------------------------------------------- geometry helpers
// rounded box: a subdivided box whose corners are pushed onto spheres
function rbox(w, h, d, r, seg = 2) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg), p = g.attributes.position, n = g.attributes.normal, v = new V(), c = new V();
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(THREE.MathUtils.clamp(v.x, -hw, hw), THREE.MathUtils.clamp(v.y, -hh, hh), THREE.MathUtils.clamp(v.z, -hd, hd));
    const o = v.clone().sub(c);
    if (o.lengthSq() > 1e-9) { o.normalize(); p.setXYZ(i, c.x + o.x * r, c.y + o.y * r, c.z + o.z * r); n.setXYZ(i, o.x, o.y, o.z); }
  }
  return g;
}
// tube along a smooth curve whose radius runs from r0 to r1 (rf can reshape it)
function ttube(pts, r0, r1, radial = 18, seg = 40, rf) {
  radial = Math.min(radial, 7); seg = Math.max(3, Math.ceil(seg / 4));
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new V(...p)));
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false), p = g.attributes.position, v = new V(), c = new V();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg; curve.getPointAt(t, c); const r = rf ? rf(t) : r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c); p.setXYZ(k, v.x, v.y, v.z); }
  }
  g.userData.ends = [curve.getPointAt(0), curve.getPointAt(1)];
  return g;
}
const G = { sph: new THREE.SphereGeometry(1, 10, 7), cone: new THREE.ConeGeometry(1, 1, 8), cyl: new THREE.CylinderGeometry(1, 1, 1, 10), oct: new THREE.OctahedronGeometry(1, 0), torus: new THREE.TorusGeometry(1, .14, 5, 16) };
const UP = new V(0, 1, 0);

// ---------------------------------------------------------------- the two finishes
const ramp = (() => { const d = new Uint8Array([70, 70, 70, 255, 150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]); const t = new THREE.DataTexture(d, 4, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
const inkV = `uniform float th; void main(){ vec3 p = position + normal * th; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`;
const inkF = `uniform vec3 col; void main(){ gl_FragColor = vec4(col, 1.0); }`;
function finish(kind) {
  return {
    kind,
    m(color, o = {}) {
      const base = { color, transparent: !!o.op, opacity: o.op || 1, side: o.side || THREE.FrontSide, vertexColors: !!o.vc, depthWrite: !o.op };
      if (o.basic) return new THREE.MeshBasicMaterial(base);
      if (kind === 'A') return new THREE.MeshStandardMaterial({ ...base, roughness: o.rough ?? .62, metalness: o.metal ?? 0, emissive: o.emi ?? 0, emissiveIntensity: o.ei ?? 1 });
      const m = new THREE.MeshToonMaterial({ ...base, gradientMap: ramp, emissive: o.emi ?? 0, emissiveIntensity: o.ei ?? 1 });
      if (o.metal) m.color.offsetHSL(0, 0, .08);
      return m;
    },
  };
}
// add a mesh; s may be a number or [x,y,z]
function add(par, geo, mat, x = 0, y = 0, z = 0, s = 1, rot) {
  par = host(par);
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  if (Array.isArray(s)) m.scale.set(...s); else m.scale.setScalar(s);
  if (rot) m.rotation.set(...rot);
  m.castShadow = true; par.add(m); return m;
}
// a capsule-like limb between two points
function limb(par, a, b, r, mat, r2 = r) {
  const A = new V(...a), B = new V(...b), g = ttube([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], b], r, r2, 24, 12);
  const m = add(par, g, mat); add(par, G.sph, mat, A.x, A.y, A.z, r); add(par, G.sph, mat, B.x, B.y, B.z, r2); return m;
}
// point a mesh's +y axis along dir
function aim(m, dir) { m.quaternion.setFromUnitVectors(UP, new V(...dir).normalize()); return m; }
// ink outlines for the cel finish (inverted hull)
function ink(root) {
  const list = []; root.traverse(o => { if (o.isMesh && !o.userData.noInk && !o.material.transparent && !o.material.isMeshBasicMaterial) list.push(o); });
  for (const o of list) {
    const s = o.scale, k = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3 || 1;
    const mat = new THREE.ShaderMaterial({ vertexShader: inkV, fragmentShader: inkF, side: THREE.BackSide, uniforms: { th: { value: .011 / k }, col: { value: new THREE.Color(o.userData.inkCol ?? 0x22142a) } } });
    const h = new THREE.Mesh(o.geometry, mat); h.userData.noInk = true; o.add(h);
  }
}

// ---------------------------------------------------------------- Cave Bat
function wingGeo() {
  const s = new THREE.Shape();
  const tips = [[1.72, .74], [1.5, -.12], [1.08, -.5], [.62, -.56], [.12, -.36]];
  s.moveTo(0, .06); s.quadraticCurveTo(.3, .34, .56, .44); s.quadraticCurveTo(.8, .62, 1.02, .66); s.quadraticCurveTo(1.4, .78, tips[0][0], tips[0][1]);
  for (let i = 1; i < tips.length; i++) {
    const [px, py] = tips[i - 1], [x, y] = tips[i], mx = (px + x) / 2, my = (py + y) / 2, cx = mx + (1.0 - mx) * .38, cy = my + (.5 - my) * .38;
    s.quadraticCurveTo(cx, cy, x, y);
  }
  s.quadraticCurveTo(.02, -.18, 0, .06);
  const g = new THREE.ExtrudeGeometry(s, { depth: .014, bevelEnabled: true, bevelThickness: .008, bevelSize: .008, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -.007);
  const p = g.attributes.position, col = [], a = new THREE.Color(0x5b2a8e), b = new THREE.Color(0xc3509e), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i) - .9, p.getY(i) - .55); c.copy(a).lerp(b, THREE.MathUtils.smoothstep(d, .2, 1.1)); col.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return { g, tips };
}
function bat(F) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const fur = F.m(0x6a3a9c, { rough: .85 }), furL = F.m(0x8350b4, { rough: .8 }), pink = F.m(0xe8687e, { rough: .7 }), lilac = F.m(0xc39ae0, { rough: .8 }),
    eye = F.m(0xffcf3a, { rough: .18, emi: 0x7a5200, ei: .35 }), pupil = F.m(0x140818, { rough: .15 }), white = F.m(0xfff4e6, { rough: .35 }), mouth = F.m(0x4a0f22, { rough: .6 }),
    tongue = F.m(0xf06a78, { rough: .4 }), claw = F.m(0xeedcc8, { rough: .4 }), mem = F.m(0xffffff, { rough: .7, vc: true, side: THREE.DoubleSide });
  add(body, G.sph, fur, 0, -.05, 0, [.32, .4, .29]);
  add(body, G.sph, furL, 0, -.02, .14, [.2, .26, .15]);
  // head
  const hd = new THREE.Group(); hd.position.set(0, .44, .04); body.add(hd);
  add(hd, G.sph, fur, 0, 0, 0, [.35, .31, .32]);
  add(hd, G.sph, fur, 0, -.06, .2, [.19, .13, .14]);
  for (const s of [-1, 1]) {
    add(hd, G.sph, pupil, s * .03, -.02, .335, [.012, .01, .01]).userData.noInk = true;
    add(hd, G.sph, eye, s * .12, .04, .23, [.1, .09, .075]);
    add(hd, G.sph, pupil, s * .105, .03, .29, [.026, .05, .02]);
    add(hd, G.sph, white, s * .09, .07, .295, .014).userData.noInk = true;
    add(hd, rbox(.22, .07, .12, .03), fur, s * .12, .12, .25, 1, [0, 0, s * .45]);
    // ears
    const ear = new THREE.Group(); ear.position.set(s * .17, .17, -.02); ear.rotation.set(-.12, 0, -s * .38); hd.add(ear);
    add(ear, G.cone, fur, 0, .22, 0, [.135, .46, .07]);
    add(ear, G.cone, pink, 0, .19, .045, [.092, .36, .03]);
    // fangs
    add(hd, G.cone, white, s * .055, -.115, .355, [.024, .075, .024], [PI, 0, 0]);
  }
  add(hd, G.sph, mouth, 0, -.135, .3, [.12, .075, .06]);
  add(hd, G.sph, tongue, 0, -.165, .33, [.07, .035, .035]);
  // spiky fur collar
  add(body, G.sph, lilac, 0, .22, .02, [.26, .07, .24]);
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * PI * 2, d = new V(Math.sin(a) * .85, -.55, Math.cos(a) * .85);
    const m = add(body, G.cone, lilac, Math.sin(a) * .2, .17, Math.cos(a) * .19 + .02, [.065, .2, .04]); aim(m, d.toArray()); m.position.addScaledVector(d.normalize(), .08);
  }
  // legs and claws
  for (const s of [-1, 1]) {
    limb(body, [s * .12, -.34, .08], [s * .13, -.48, .14], .06, fur, .055);
    add(body, G.sph, fur, s * .13, -.52, .15, [.075, .055, .08]);
    for (const k of [-1, 0, 1]) { const c = add(body, G.cone, claw, s * .13 + k * .035, -.58, .19, [.016, .08, .016]); aim(c, [k * .2, -1, .5]); }
  }
  // wings
  const { g: wg, tips } = wingGeo(); const wings = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * .22, .14, -.04); body.add(piv);
    const w = new THREE.Group(); w.scale.x = s; piv.add(w); wings.push(piv); RIG.wings.push(piv);
    add(w, wg, mem).userData.inkCol = 0x3a1650;
    add(w, ttube([[0, .06, 0], [.3, .3, 0], [.56, .44, 0], [.8, .6, 0], [1.02, .66, 0]], .055, .03, 16, 30), furL);
    add(w, G.sph, furL, 1.02, .66, 0, .04);
    for (const [x, y] of tips) add(w, ttube([[1.02, .66, 0], [(1.02 + x) / 2 + .02, (.66 + y) / 2 + .03, 0], [x, y, 0]], .024, .006, 10, 20), fur);
    const th = add(w, G.cone, claw, 1.06, .74, 0, [.02, .1, .02]); aim(th, [.3, 1, 0]);
  }
  root.userData.tick = (t) => {
    const f = Math.sin(t * 7.5);
    wings.forEach((w, i) => { const s = i ? 1 : -1; w.rotation.z = s * (f * .55 + .12); w.rotation.y = -s * (.25 + f * .1); });
    body.position.y = -f * .05; hd.rotation.x = Math.sin(t * 1.3) * .06;
  };
  root.userData.frame = { y: .15, d: 5.6 };
  return root;
}

// ---------------------------------------------------------------- Frost Wraith
function wraith(F) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const hood = F.m(0x3b3cb0, { rough: .7 }), hoodL = F.m(0x5b62da, { rough: .6 }), voidM = F.m(0x05040c, { basic: true }), eyeM = F.m(0xf4fbff, { basic: true }),
    ice = F.m(0xd6e8f6, { rough: .45 }), iceD = F.m(0x9cc2e2, { rough: .5 }), silver = F.m(0xc8ccd8, { rough: .25, metal: .9 }), gem = F.m(0x4ad8ff, { rough: .05, emi: 0x1aa8e0, ei: .9 }),
    ghost = F.m(0xa8e6f6, { rough: .3, op: .78, emi: 0x2a7a9a, ei: .55 }), ghostS = F.m(0xbff0ff, { rough: .3, op: .85, emi: 0x3a9ac0, ei: .6 }), shard = F.m(0x7ae4ff, { rough: .1, emi: 0x2ab0e0, ei: 1 });
  // hood with a curled tip
  add(body, G.sph, hood, 0, .12, 0, [.46, .5, .44]);
  add(body, ttube([[0, .5, -.12], [.06, .78, -.2], [.26, .9, -.16], [.44, .84, -.04], [.52, .74, .06]], .26, .012, 24, 60, t => .26 * Math.pow(1 - t, 1.25) + .012), hood);
  add(body, G.torus, hoodL, 0, .06, .34, [.3, .33, .5], [-.12, 0, 0]);
  add(body, G.sph, voidM, 0, .05, .33, [.28, .29, .13]).userData.noInk = true;
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape(); sh.moveTo(-.055 * s, -.005); sh.lineTo(.06 * s, .04); sh.quadraticCurveTo(.045 * s, -.03, -.035 * s, -.03); sh.closePath();
    const e = add(body, new THREE.ShapeGeometry(sh, 8), eyeM, s * .085, .06, .465); e.userData.noInk = true;
  }
  // icy mantle, swirls and brooch
  add(body, new THREE.CylinderGeometry(.34, .58, .2, 12), ice, 0, -.3, .01);
  add(body, new THREE.CylinderGeometry(.33, .5, .22, 12), hood, 0, -.44, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i + .5) / 12 * PI * 2, d = [Math.sin(a), -.45, Math.cos(a)];
    aim(add(body, G.cone, ice, Math.sin(a) * .56, -.36, Math.cos(a) * .56, [.08, .24, .05]), d);
    aim(add(body, G.cone, hood, Math.sin(a + .26) * .48, -.56, Math.cos(a + .26) * .48, [.07, .22, .05]), [d[0] * .6, -1, d[2] * .6]);
  }
  for (const s of [-1, 1]) add(body, new THREE.TorusGeometry(.045, .011, 4, 12, PI * 1.5), iceD, s * .26, -.3, .5, 1, [-.5, s * .45, s > 0 ? 0 : PI]);
  add(body, G.oct, silver, 0, -.28, .55, [.1, .14, .05]);
  add(body, G.oct, gem, 0, -.28, .58, [.065, .095, .04]);
  // ghostly tail
  const tail = new THREE.Group(); tail.position.y = -.5; body.add(tail);
  add(tail, ttube([[0, 0, 0], [0, -.4, .06], [.12, -.8, .02], [-.04, -1.15, -.04], [-.2, -1.4, .06], [-.28, -1.55, .14]], .3, .01, 32, 70, t => .3 * Math.pow(1 - t, .9) + .01), ghost);
  add(tail, ttube([[.12, -.1, -.05], [.2, -.5, -.08], [.12, -.85, -.12], [.24, -1.05, -.08]], .14, .01, 20, 40), ghost);
  // arms with claws
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * .32, -.4, .05); body.add(arm); arms.push(arm); RIG.arms.push(arm);
    add(arm, ttube([[0, 0, 0], [s * .2, -.12, .08], [s * .4, -.32, .16], [s * .48, -.5, .2]], .11, .06, 20, 30), ghostS);
    add(arm, G.sph, ghostS, s * .48, -.52, .2, [.08, .07, .07]);
    for (const k of [-1, 0, 1]) add(arm, ttube([[s * .48 + k * .045, -.54, .22 + k * .02], [s * (.5 + .02 * k) + k * .05, -.66, .3], [s * .5 + k * .06, -.76, .24]], .03, .004, 10, 16), ghostS);
  }
  const shards = [[.32, -1.25, .22, .05], [.26, -1.48, .28, .04], [-.4, -1.0, .12, .035]].map(([x, y, z, s]) => add(body, G.oct, shard, x, y, z, [s, s * 2, s]));
  root.userData.tick = (t) => {
    body.position.y = Math.sin(t * 1.8) * .06; tail.rotation.z = Math.sin(t * 2.1) * .08; tail.rotation.x = Math.sin(t * 1.6) * .05;
    arms.forEach((a, i) => { a.rotation.z = (i ? 1 : -1) * Math.sin(t * 2 + i) * .1; a.rotation.x = Math.sin(t * 2.2 + i) * .08; });
    shards.forEach((s, i) => { s.rotation.y = t * (1 + i * .4); s.position.y += Math.sin(t * 2 + i * 2) * .0015; });
  };
  root.userData.frame = { y: -.75, d: 6.2 };
  return root;
}

// ---------------------------------------------------------------- Orc Spearman
function orc(F) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = F.m(0x88aa36, { rough: .7 }), skinD = F.m(0x6a8a28, { rough: .75 }), steel = F.m(0x9aa1ad, { rough: .32, metal: .85 }), steelD = F.m(0x6e7480, { rough: .4, metal: .8 }),
    lea = F.m(0x7c4a2a, { rough: .8 }), leaD = F.m(0x5a3220, { rough: .85 }), red = F.m(0xbd3224, { rough: .6 }), redD = F.m(0x8e2318, { rough: .7 }), wood = F.m(0x9a5e30, { rough: .75 }),
    eye = F.m(0xffd84a, { rough: .2, emi: 0x6a4a00, ei: .3 }), dark = F.m(0x1a1008, { rough: .3 }), tusk = F.m(0xf2ead6, { rough: .4 });
  // legs and boots (crouched stance)
  const legs = [[-1, [-.3, .5, .2], [-.3, .2, .12]], [1, [.3, .5, -.06], [.31, .2, -.14]]];
  for (const [s, knee, ank] of legs) {
    R_('legs', [s * .17, .86, 0]); limb(body, [s * .17, .86, 0], knee, .14, skin, .12);
    limb(body, knee, ank, .115, skin, .1);
    add(body, new THREE.CylinderGeometry(.15, .13, .16, 12), leaD, ank[0], ank[1] + .04, ank[2], 1);
    add(body, rbox(.26, .2, .38, .08), lea, ank[0], .1, ank[2] + .06);
    add(body, rbox(.28, .05, .4, .02), leaD, ank[0], .015, ank[2] + .06);
  }
  R_();
  // leather skirt flaps
  for (let i = 0; i < 9; i++) {
    const a = (i / 9 - .5) * PI * 1.5 + (i % 2 ? .0 : 0), r = .32;
    const f = add(body, rbox(.17, .34, .05, .02), i % 2 ? lea : leaD, Math.sin(a) * r, .7, Math.cos(a) * r * .85);
    f.rotation.set(.2, a, 0); f.rotation.order = 'YXZ'; f.rotation.set(.22, a, 0);
  }
  // torso, belt, strap
  add(body, rbox(.64, .58, .44, .17), lea, 0, 1.13, 0);
  add(body, rbox(.66, .12, .47, .05), leaD, 0, .9, 0);
  add(body, rbox(.21, .15, .05, .025), steel, 0, .9, .245); add(body, rbox(.11, .06, .06, .02), leaD, 0, .9, .25);
  add(body, ttube([[-.3, 1.42, .14], [-.05, 1.25, .25], [.18, 1.05, .25], [.33, .93, .16]], .04, .04, 12, 30), leaD);
  for (const [x, y] of [[-.18, 1.36], [.08, 1.18]]) add(body, G.oct, steel, x, y, .26, [.03, .03, .02]);
  add(body, G.sph, skin, 0, 1.4, -.02, [.36, .2, .26]);
  // head
  const hd = new THREE.Group(); hd.position.set(.02, 1.6, .06); body.add(hd);
  add(hd, G.sph, skin, 0, 0, 0, [.22, .22, .22]);
  add(hd, rbox(.36, .2, .28, .08), skin, 0, -.11, .07);
  add(hd, G.sph, skin, 0, -.02, .2, [.055, .045, .055]);
  for (const s of [-1, 1]) {
    add(hd, G.sph, eye, s * .075, .02, .175, [.04, .03, .02]); add(hd, G.sph, dark, s * .07, .02, .19, .012);
    add(hd, rbox(.13, .04, .07, .015), skinD, s * .075, .065, .18, 1, [0, 0, s * .32]);
    aim(add(hd, G.cone, tusk, s * .11, -.07, .2, [.028, .1, .028]), [s * .25, 1, .15]);
    const ear = add(hd, G.cone, skin, s * .27, .0, -.02, [.06, .22, .035]); aim(ear, [s, .45, -.15]);
  }
  // helmet
  add(hd, new THREE.SphereGeometry(1, 10, 5, 0, PI * 2, 0, PI * .52), steel, 0, .02, -.01, [.27, .28, .28]);
  add(hd, G.torus, steelD, 0, .03, -.01, [.275, .285, .3], [PI / 2, 0, 0]);
  add(hd, new THREE.TorusGeometry(1, .1, 5, 16, PI), steel, 0, .03, -.01, [.29, .29, .29], [0, PI / 2, 0]);
  for (const s of [-1, 1]) add(hd, rbox(.06, .24, .17, .025), steel, s * .245, -.09, .08, 1, [0, 0, -s * .1]);
  add(hd, rbox(.05, .15, .035, .015), steel, 0, .0, .275);
  // pauldron
  const pd = add(body, new THREE.SphereGeometry(1, 10, 5, 0, PI * 2, 0, PI * .5), steel, .37, 1.4, 0, [.21, .17, .21], [0, 0, -.45]);
  for (const k of [-1, 1]) add(body, G.oct, steelD, .43, 1.5, k * .09 + .03, [.025, .025, .025]);
  // spear arm (its right, our left)
  R_('arms', [-.36, 1.38, 0]); limb(body, [-.36, 1.38, 0], [-.5, 1.1, .12], .1, skin, .09);
  limb(body, [-.5, 1.1, .12], [-.42, 1.0, .32], .09, skin, .085);
  add(body, new THREE.CylinderGeometry(.1, .095, .14, 12), leaD, -.47, 1.05, .22, 1, [1.1, 0, .3]);
  add(body, rbox(.17, .17, .17, .065), skin, -.42, .98, .34);
  const spear = new THREE.Group(); spear.position.set(-.42, .98, .34); spear.rotation.z = .08; put(body, spear);
  add(spear, G.cyl, wood, 0, .05, 0, [.035, 2.0, .035]);
  for (let k = 0; k < 4; k++) add(spear, G.torus, lea, 0, .78 + k * .07, 0, [.05, .05, .05], [PI / 2 + (k % 2 ? .4 : -.4), 0, 0]);
  add(spear, G.cyl, steel, 0, 1.08, 0, [.05, .07, .05]);
  add(spear, new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(.1, .17), new THREE.Vector2(0, .46)], 6), steel, 0, 1.11, 0, [1, 1, .55]);
  // shield arm
  R_('arms', [.36, 1.36, 0]); limb(body, [.36, 1.36, 0], [.52, 1.1, .1], .1, skin, .09);
  limb(body, [.52, 1.1, .1], [.46, 1.02, .3], .09, skin, .085);
  const sh = new THREE.Group(); sh.position.set(.52, .98, .42); sh.rotation.set(0, -.38, .04); put(body, sh);
  add(sh, rbox(.52, .64, .07, .025), red);
  for (const x of [-.09, .09]) add(sh, rbox(.012, .56, .02, .005), redD, x, 0, .037);
  for (const [x, y, w, h] of [[0, .3, .56, .06], [0, -.3, .56, .06], [.26, 0, .06, .64], [-.26, 0, .06, .64]]) add(sh, rbox(w, h, .09, .022), steel, x, y, 0);
  for (const x of [-1, 1]) for (const y of [-1, 1]) { add(sh, rbox(.11, .11, .1, .02), steelD, x * .23, y * .27, 0); add(sh, new THREE.ConeGeometry(.032, .035, 4), steel, x * .23, y * .27, .065, 1, [PI / 2, 0, PI / 4]); }
  add(sh, rbox(.18, .18, .03, .01), steelD, 0, 0, .045);
  add(sh, new THREE.ConeGeometry(.12, .1, 4), steel, 0, 0, .1, 1, [PI / 2, PI / 4, 0]);
  R_();
  root.userData.tick = (t) => {
    const b = Math.sin(t * 2.2); body.position.y = b * .012; hd.rotation.y = Math.sin(t * .7) * .12; spear.rotation.x = b * .03; sh.rotation.x = b * .03;
  };
  root.userData.frame = { y: 1.12, d: 5.4 };
  return root;
}

// ---------------------------------------------------------------- shared bits
function eyes(par, x, y, z, s, col, brow, browMat, ang = .35) {
  const eye = F_.m(col, { rough: .2, emi: col, ei: .25 }), pupil = F_.m(0x140c08, { rough: .2 });
  for (const k of [-1, 1]) {
    add(par, G.sph, eye, k * x, y, z, [s, s * .8, s * .55]);
    add(par, G.sph, pupil, k * x * .95, y - s * .1, z + s * .45, [s * .32, s * .45, s * .2]);
    if (brow) add(par, rbox(s * 2.3, s * .55, s * .9, s * .22), browMat, k * x, y + s * .85, z + s * .1, 1, [0, 0, k * ang]);
  }
}
let F_ = null; // the finish in use while a builder runs

// ---------------------------------------------------------------- Goblin Raider
function goblin(F) {
  F_ = F;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = F.m(0x8cc63a, { rough: .7 }), skinD = F.m(0x6ea42a), ear = F.m(0xf0a070), cloth = F.m(0x7a4a26), clothL = F.m(0x9a6a3a), patch = F.m(0xb08050),
    rope = F.m(0xd8b070), wrap = F.m(0xb89068), boot = F.m(0x6a3a1e), steel = F.m(0xc8ccd4, { metal: .8, rough: .3 }), dark = F.m(0x3a1a10), white = F.m(0xfff4e0);
  // running legs
  const legs = [[-1, [-.12, .4, .2], [-.13, .14, .26]], [1, [.13, .38, -.1], [.14, .16, -.24]]];
  for (const [s, knee, ank] of legs) {
    R_('legs', [s * .1, .62, 0]); limb(body, [s * .1, .62, 0], knee, .075, skin, .065); limb(body, knee, ank, .06, skin, .055);
    for (let k = 0; k < 3; k++) { const f = .25 + k * .22; add(body, G.torus, wrap, knee[0] + (ank[0] - knee[0]) * f, knee[1] + (ank[1] - knee[1]) * f, knee[2] + (ank[2] - knee[2]) * f, [.07, .07, .07], [PI / 2 + .3, 0, 0]); }
    add(body, rbox(.15, .1, .24, .045), boot, ank[0], ank[1] - .06, ank[2] + .05);
  }
  R_();
  // ragged tunic, patches, rope belt
  const tor = new THREE.Group(); tor.position.set(0, .82, 0); tor.rotation.x = .25; body.add(tor);
  add(tor, new THREE.CylinderGeometry(.17, .25, .42, 32), cloth);
  for (let i = 0; i < 9; i++) { const a = i / 9 * PI * 2; aim(add(tor, G.cone, i % 2 ? cloth : clothL, Math.sin(a) * .22, -.25, Math.cos(a) * .22, [.07, .14, .04]), [Math.sin(a) * .25, -1, Math.cos(a) * .25]); }
  add(tor, rbox(.1, .09, .02, .02), patch, -.06, .06, .21, 1, [0, 0, .2]); add(tor, rbox(.08, .07, .02, .02), patch, .1, -.1, .22, 1, [0, 0, -.3]);
  add(tor, G.torus, rope, 0, -.12, 0, [.22, .22, .3], [PI / 2, 0, 0]);
  add(tor, ttube([[.04, -.13, .22], [.06, -.24, .25], [.03, -.33, .24]], .018, .012, 8, 10), rope);
  // head: big, with long ears and a grin
  const hd = new THREE.Group(); hd.position.set(0, 1.18, .12); body.add(hd);
  add(hd, G.sph, skin, 0, 0, 0, [.25, .23, .23]);
  add(hd, G.sph, skin, 0, -.09, .12, [.18, .11, .14]);
  aim(add(hd, G.cone, skin, 0, -.01, .27, [.045, .14, .045]), [0, -.25, 1]);
  eyes(hd, .095, .03, .17, .06, 0xffc21a, true, skinD, .5);
  add(hd, G.sph, dark, 0, -.13, .2, [.11, .045, .06]);
  for (let k = -2; k <= 2; k++) add(hd, rbox(.024, .03, .02, .006), white, k * .035, -.11, .245);
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(s * .22, .04, -.02); hd.add(e);
    aim(add(e, G.cone, skin, s * .17, .07, 0, [.11, .44, .035]), [s, .4, -.15]);
    aim(add(e, G.cone, ear, s * .16, .07, .02, [.07, .32, .015]), [s, .4, -.15]);
  }
  // arms: a fist and a dagger
  R_('arms', [-.2, 1.02, .05]); limb(body, [-.2, 1.02, .05], [-.32, .86, .18], .055, skin, .05); limb(body, [-.32, .86, .18], [-.24, .98, .32], .05, skin, .045);
  add(body, G.sph, skin, -.24, 1.0, .35, .07);
  R_('arms', [.2, 1.02, .02]); limb(body, [.2, 1.02, .02], [.33, .84, .02], .055, skin, .05); limb(body, [.33, .84, .02], [.36, .72, .2], .05, skin, .045);
  add(body, G.sph, skin, .36, .7, .23, .065);
  const dg = new THREE.Group(); dg.position.set(.37, .68, .26); dg.rotation.set(1.2, 0, -.3); put(body, dg);
  add(dg, G.cyl, F.m(0x5a3018), 0, -.04, 0, [.022, .1, .022]); add(dg, rbox(.12, .025, .04, .01), F.m(0x8a6a3a), 0, .02, 0);
  add(dg, G.cone, steel, 0, .16, 0, [.045, .26, .012]);
  R_();
  root.userData.tick = t => { const b = Math.abs(Math.sin(t * 5)); body.position.y = b * .04; hd.rotation.z = Math.sin(t * 5) * .05; };
  root.userData.frame = { y: .78, d: 3.7 };
  return root;
}

// ---------------------------------------------------------------- Iron Knight
function heater(w, h) { const s = new THREE.Shape(); s.moveTo(-w / 2, h / 2); s.lineTo(w / 2, h / 2); s.lineTo(w / 2, -h * .05); s.quadraticCurveTo(w * .45, -h * .38, 0, -h / 2); s.quadraticCurveTo(-w * .45, -h * .38, -w / 2, -h * .05); s.closePath(); return s; }
function knight(F) {
  F_ = F;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const steel = F.m(0xb8bec8, { metal: .85, rough: .3 }), steelD = F.m(0x7e8592, { metal: .8, rough: .35 }), red = F.m(0xc3302a), redD = F.m(0x8e1f1a),
    gold = F.m(0xe8b030, { metal: .7, rough: .3 }), blue = F.m(0x2a4cb8), lea = F.m(0x6a3a1e), dark = F.m(0x14141a);
  for (const s of [-1, 1]) {
    R_('legs', [s * .16, .82, 0]); limb(body, [s * .16, .82, 0], [s * .2, .46, .04], .12, steel, .1); limb(body, [s * .2, .46, .04], [s * .2, .14, 0], .1, steel, .09);
    add(body, G.sph, steelD, s * .2, .46, .1, [.1, .1, .06]);
    add(body, rbox(.2, .12, .32, .05), steelD, s * .2, .07, .06);
  }
  R_();
  add(body, rbox(.5, .22, .38, .1), steelD, 0, .84, 0);
  add(body, rbox(.62, .56, .44, .18), steel, 0, 1.18, 0);
  add(body, G.sph, steel, 0, 1.22, .1, [.3, .28, .2]);
  // tabard with a pointed hem
  add(body, rbox(.24, .66, .03, .01), red, 0, .98, .25); aim(add(body, G.cone, red, 0, .6, .25, [.12, .12, .015]), [0, -1, 0]);
  add(body, rbox(.03, .6, .032, .01), redD, -.07, .99, .255); add(body, rbox(.03, .6, .032, .01), redD, .07, .99, .255);
  add(body, rbox(.66, .1, .47, .04), lea, 0, .9, 0); add(body, rbox(.14, .1, .04, .02), gold, 0, .9, .245);
  // big layered pauldrons
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) add(body, new THREE.SphereGeometry(1, 10, 5, 0, PI * 2, 0, PI * .5), k ? steelD : steel, s * (.38 + k * .03), 1.42 - k * .08, 0, [.22 - k * .02, .14, .22 - k * .02], [0, 0, -s * (.4 + k * .15)]);
  // bucket helm, visor and plume
  const hd = new THREE.Group(); hd.position.set(0, 1.64, .02); body.add(hd);
  add(hd, new THREE.CylinderGeometry(.19, .2, .32, 12), steel); add(hd, new THREE.SphereGeometry(1, 10, 5, 0, PI * 2, 0, PI * .5), steel, 0, .15, 0, [.19, .12, .19]);
  add(hd, rbox(.3, .2, .08, .03), steelD, 0, -.02, .18);
  for (const y of [.03, -.03]) add(hd, rbox(.22, .018, .02, .004), dark, 0, y, .225);
  for (let k = -2; k <= 2; k++) add(hd, G.sph, dark, k * .035, -.09, .222, .009).userData.noInk = true;
  add(hd, G.cyl, gold, 0, .24, -.02, [.03, .06, .03]);
  for (let k = 0; k < 6; k++) { const a = -.2 + k * .32; const p = add(hd, G.sph, k % 2 ? redD : red, 0, .32 + Math.sin(a) * .04, -.1 - k * .055, [.035, .16 - k * .012, .07]); p.rotation.x = -.6 - k * .18; }
  // sword arm
  R_('arms', [-.38, 1.32, 0]); limb(body, [-.38, 1.32, 0], [-.48, 1.02, .08], .1, steel, .09); limb(body, [-.48, 1.02, .08], [-.42, .86, .24], .09, steel, .085);
  add(body, rbox(.15, .14, .15, .05), steelD, -.42, .84, .27);
  const sw = new THREE.Group(); sw.position.set(-.42, .84, .28); sw.rotation.set(1.1, 0, .25); put(body, sw);
  add(sw, G.cyl, lea, 0, 0, 0, [.025, .14, .025]); add(sw, rbox(.2, .03, .05, .012), gold, 0, .08, 0); add(sw, G.sph, gold, 0, -.08, 0, .035);
  add(sw, rbox(.06, .5, .018, .008), steel, 0, .34, 0); aim(add(sw, G.cone, steel, 0, .62, 0, [.03, .08, .009]), [0, 1, 0]);
  // shield arm and heater shield
  R_('arms', [.38, 1.32, 0]); limb(body, [.38, 1.32, 0], [.5, 1.06, .1], .1, steel, .09); limb(body, [.5, 1.06, .1], [.44, .98, .28], .09, steel, .085);
  const sh = new THREE.Group(); sh.position.set(.5, 1.0, .4); sh.rotation.set(0, -.35, 0); put(body, sh);
  const sg = s => new THREE.ExtrudeGeometry(heater(.56 * s, .72 * s), { depth: .05, bevelEnabled: true, bevelThickness: .015, bevelSize: .015, bevelSegments: 2, curveSegments: 8 });
  add(sh, sg(1), steelD, 0, 0, -.03); add(sh, sg(.88), blue, 0, 0, .0);
  add(sh, rbox(.08, .44, .03, .012), gold, 0, -.02, .075); add(sh, rbox(.32, .08, .03, .012), gold, 0, .08, .075);
  R_();
  root.userData.tick = t => { body.position.y = Math.sin(t * 1.8) * .01; hd.rotation.y = Math.sin(t * .7) * .1; };
  root.userData.frame = { y: .98, d: 4.5 };
  return root;
}

// ---------------------------------------------------------------- Goblin Shaman
function shaman(F) {
  F_ = F;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = F.m(0x86b83a), robe = F.m(0x8a2440), robeD = F.m(0x5e1a30), gold = F.m(0xe0a830, { metal: .5, rough: .4 }), mask = F.m(0xeedcb0), redM = F.m(0xc8302a),
    wood = F.m(0x8a5a2a), woodD = F.m(0x5a3a1a), gem = F.m(0x4ae070, { rough: .1, emi: 0x2ac050, ei: 1 }), glow = F.m(0x6aff8a, { basic: true }), wrap = F.m(0xa07a50);
  // legs peeking out
  for (const s of [-1, 1]) { R_('legs', [s * .08, .38, 0]); limb(body, [s * .08, .38, 0], [s * .1, .12, .03], .05, skin, .045); add(body, rbox(.12, .08, .2, .035), F.m(0x6a3a1e), s * .1, .05, .06); add(body, G.torus, wrap, s * .1, .2, .02, [.06, .06, .06], [PI / 2, 0, 0]); }
  R_();
  // robe, trim and cape
  add(body, new THREE.CylinderGeometry(.15, .34, .62, 12), robe, 0, .62, 0);
  add(body, G.torus, gold, 0, .33, 0, [.335, .335, .2], [PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) { const a = i / 6 * PI * 2 + .3; add(body, G.oct, gold, Math.sin(a) * .28, .45, Math.cos(a) * .28, [.03, .05, .02]).rotation.y = a; }
  add(body, new THREE.CylinderGeometry(.2, .4, .78, 12, 1, true, PI * .55, PI * .9), robeD, 0, .62, -.02).material.side = THREE.DoubleSide;
  add(body, new THREE.CylinderGeometry(.26, .2, .14, 12), robeD, 0, .98, 0);
  for (let i = 0; i < 7; i++) add(body, G.sph, [gold, redM, F.m(0x3ab0c0)][i % 3], Math.sin(i * .5 - 1.5) * .16, .88 - Math.cos(i * .5 - 1.5) * .05, .14 + Math.cos(i * .5 - 1.5) * .05, .028);
  // head with mask, ears and feathers
  const hd = new THREE.Group(); hd.position.set(0, 1.18, .02); body.add(hd);
  add(hd, G.sph, skin, 0, 0, 0, [.19, .19, .18]);
  for (const s of [-1, 1]) { aim(add(hd, G.cone, skin, s * .3, .04, -.02, [.08, .36, .03]), [s, .3, -.15]); aim(add(hd, G.cone, F.m(0xe89068), s * .29, .04, 0, [.05, .26, .012]), [s, .3, -.15]); }
  add(hd, G.sph, F.m(0xf6e8c4, { emi: 0xf6e8c4, ei: .15 }), 0, -.01, .12, [.18, .25, .12]);
  aim(add(hd, G.cone, redM, 0, .07, .235, [.07, .08, .01]), [0, -1, 0]);
  for (const s of [-1, 1]) add(hd, rbox(.08, .035, .02, .01), glow, s * .065, -.02, .24, 1, [0, 0, s * .3]).userData.noInk = true;
  aim(add(hd, G.cone, mask, 0, -.18, .14, [.06, .12, .04]), [0, -1, .2]);
  const fc = [0xe0302a, 0xf2c030, 0x2ab0b8, 0xe87a20, 0x3ac0a0];
  for (let k = 0; k < 5; k++) { const a = (k - 2) * .38, f = add(hd, G.sph, F.m(fc[k]), Math.sin(a) * .16, .26 + Math.cos(a) * .12, -.02, [.05, .2, .015]); f.rotation.z = -a; }
  add(hd, G.torus, gold, 0, .14, 0, [.17, .17, .2], [PI / 2, 0, 0]);
  // casting hand and staff
  R_('arms', [-.18, .98, .02]); limb(body, [-.18, .98, .02], [-.34, .9, .14], .045, robe, .04); limb(body, [-.34, .9, .14], [-.42, 1.02, .24], .04, skin, .035);
  for (let k = 0; k < 4; k++) aim(add(body, G.cone, skin, -.44 + k * .02, 1.06, .26, [.012, .07, .012]), [-.3 + k * .2, 1, .3]);
  R_('arms', [.18, .98, .02]); limb(body, [.18, .98, .02], [.3, .86, .1], .045, robe, .04); add(body, G.sph, skin, .32, .86, .14, .05);
  add(body, ttube([[.33, 0, .14], [.34, .6, .15], [.32, 1.2, .14], [.34, 1.5, .16], [.42, 1.62, .16], [.44, 1.5, .16]], .03, .022, 10, 60), wood);
  add(body, ttube([[.31, .1, .14], [.36, .5, .13], [.3, .9, .16], [.36, 1.3, .14]], .012, .012, 6, 40), woodD);
  add(body, G.oct, gem, .35, 1.55, .16, [.06, .1, .06]);
  for (let k = 0; k < 3; k++) { add(body, ttube([[.42, 1.52, .16], [.43 + k * .02, 1.38 - k * .04, .17]], .004, .004, 4, 4), wrap); add(body, G.sph, [redM, gold, F.m(0x3ab0c0)][k], .43 + k * .02, 1.36 - k * .04, .17, .024); }
  R_();
  root.userData.tick = t => { body.position.y = Math.sin(t * 2) * .015; root.children[0].children.forEach(() => {}); hd.rotation.z = Math.sin(t * 1.4) * .06; };
  root.userData.frame = { y: .9, d: 4.2 };
  return root;
}

// ---------------------------------------------------------------- Ogre Brute
function ogre(F) {
  F_ = F;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = F.m(0x9c88b4, { rough: .75 }), skinD = F.m(0x7e6a98), lea = F.m(0x7a4a26), leaD = F.m(0x5a3218), steel = F.m(0xa0a6b0, { metal: .8, rough: .35 }),
    wood = F.m(0xb06a2a), woodD = F.m(0x8a4e1e), tusk = F.m(0xf2ead6), stitch = F.m(0x3a2010);
  for (const s of [-1, 1]) { R_('legs', [s * .24, .74, 0]); limb(body, [s * .24, .74, 0], [s * .3, .36, .06], .19, skin, .16); limb(body, [s * .3, .36, .06], [s * .3, .1, .04], .15, skin, .14); add(body, G.sph, skin, s * .3, .07, .12, [.17, .09, .22]); }
  R_();
  add(body, new THREE.CylinderGeometry(.42, .46, .34, 12), lea, 0, .74, 0);
  for (let i = 0; i < 12; i++) { const a = i / 12 * PI * 2; aim(add(body, G.cone, i % 2 ? lea : leaD, Math.sin(a) * .42, .52, Math.cos(a) * .42, [.08, .14, .04]), [Math.sin(a) * .2, -1, Math.cos(a) * .2]); }
  add(body, rbox(.92, .14, .62, .06), leaD, 0, .9, 0); add(body, rbox(.2, .16, .06, .03), steel, 0, .9, .32); add(body, rbox(.1, .07, .07, .02), leaD, 0, .9, .33);
  // hunched torso and belly
  add(body, G.sph, skin, 0, 1.28, -.04, [.56, .5, .44]);
  add(body, G.sph, skin, 0, 1.1, .16, [.42, .34, .3]);
  add(body, rbox(.26, .22, .06, .04), lea, .3, 1.55, -.05, 1, [0, 0, -.5]);
  for (const k of [-1, 0, 1]) add(body, rbox(.012, .07, .012, .004), stitch, .3 + k * .07, 1.55 + k * .04, .0, 1, [0, 0, -.5]);
  // small head jutting forward
  const hd = new THREE.Group(); hd.position.set(0, 1.7, .36); body.add(hd);
  add(hd, G.sph, skin, 0, 0, 0, [.21, .21, .21]); add(hd, rbox(.36, .16, .24, .07), skin, 0, -.12, .06);
  add(hd, rbox(.3, .06, .1, .03), skinD, 0, .07, .15); eyes(hd, .07, .02, .16, .035, 0xfff0c0, false);
  for (const s of [-1, 1]) aim(add(hd, G.cone, tusk, s * .11, -.06, .17, [.03, .1, .03]), [s * .2, 1, 0]);
  add(hd, G.sph, skin, 0, -.02, .19, [.05, .04, .04]);
  // huge arms; club in the right hand
  R_('arms', [-.5, 1.4, 0]); limb(body, [-.5, 1.4, 0], [-.64, 1.0, .06], .17, skin, .17); limb(body, [-.64, 1.0, .06], [-.6, .64, .14], .19, skin, .16);
  add(body, rbox(.28, .26, .28, .1), skin, -.6, .54, .16);
  R_('arms', [.5, 1.4, 0]); limb(body, [.5, 1.4, 0], [.66, 1.0, .02], .17, skin, .17); limb(body, [.66, 1.0, .02], [.66, .66, .16], .19, skin, .16);
  add(body, rbox(.26, .24, .26, .1), skin, .66, .58, .2);
  const club = new THREE.Group(); club.position.set(.66, .58, .22); club.rotation.set(PI * .64, 0, -.1); club.scale.setScalar(.85); put(body, club);
  add(club, ttube([[0, -.05, 0], [0, .4, 0], [0, .78, 0]], .07, .17, 20, 20), wood);
  add(club, G.sph, wood, 0, .8, 0, [.17, .08, .17]); add(club, G.torus, steel, 0, .55, 0, [.15, .15, .2], [PI / 2, 0, 0]);
  for (let k = 0; k < 4; k++) add(club, rbox(.03, .2, .02, .008), woodD, Math.sin(k * 1.6) * .13, .55, Math.cos(k * 1.6) * .13, 1, [0, k * 1.6, 0]);
  R_();
  root.userData.tick = t => { const b = Math.sin(t * 1.6); body.position.y = b * .015; body.scale.set(1 + b * .006, 1 - b * .006, 1 + b * .006); hd.rotation.y = Math.sin(t * .6) * .15; };
  root.userData.frame = { y: 1.0, d: 5.0 };
  return root;
}

// ---------------------------------------------------------------- Rune Golem
function golem(F) {
  F_ = F;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const st = F.m(0xbca37a, { rough: .9 }), stD = F.m(0x917a58, { rough: .9 }), stL = F.m(0xd4bd92, { rough: .9 }), moss = F.m(0x7ab83a), rune = F.m(0x3ae8f0, { basic: true }), runeG = F.m(0x2ac8e0, { emi: 0x2ac8e0, ei: 1 });
  for (const s of [-1, 1]) { R_('legs', [s * .22, .72, 0]); add(body, rbox(.3, .5, .34, .06), stD, s * .22, .38, 0); add(body, rbox(.36, .16, .44, .05), st, s * .22, .08, .05); add(body, rbox(.32, .14, .36, .05), st, s * .22, .66, 0); }
  R_();
  add(body, rbox(.7, .28, .46, .07), stD, 0, .84, 0);
  add(body, rbox(.74, .12, .5, .03), F.m(0x8a6a3a), 0, .98, 0); add(body, rbox(.18, .14, .04, .02), stL, 0, .98, .26); add(body, rbox(.08, .07, .05, .02), stD, 0, .98, .275);
  add(body, rbox(.86, .66, .56, .09), st, 0, 1.36, 0);
  add(body, rbox(.5, .44, .1, .06), stL, 0, 1.38, .28);
  add(body, rbox(.06, .3, .03, .012), rune, 0, 1.38, .335).userData.noInk = true; add(body, rbox(.3, .06, .03, .012), rune, 0, 1.38, .335).userData.noInk = true;
  for (const [x, y] of [[0, .18], [0, -.18], [.16, 0], [-.16, 0]]) add(body, rbox(.06, .06, .03, .01), runeG, x, 1.38 + y, .335);
  // small head sunk between shoulders
  const hd = new THREE.Group(); hd.position.set(0, 1.78, .1); body.add(hd);
  add(hd, rbox(.32, .26, .3, .07), st); add(hd, rbox(.34, .07, .1, .03), stD, 0, .05, .14);
  for (const s of [-1, 1]) add(hd, rbox(.06, .035, .02, .01), rune, s * .07, 0, .16).userData.noInk = true;
  // boulder shoulders with moss
  for (const s of [-1, 1]) { add(body, rbox(.42, .34, .44, .1), st, s * .56, 1.6, 0, 1, [0, 0, -s * .15]); }
  add(body, G.sph, moss, -.56, 1.79, .02, [.2, .05, .18]); add(body, G.sph, moss, -.64, 1.72, .14, [.1, .04, .08]);
  // stacked arms and huge fists
  const arms = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(s * .62, 1.42, 0); body.add(a); arms.push(a); RIG.arms.push(a);
    add(a, rbox(.28, .34, .3, .07), stD, s * .04, -.24, 0); add(a, rbox(.32, .3, .34, .08), st, s * .06, -.54, .04);
    add(a, rbox(.42, .38, .42, .1), stL, s * .07, -.86, .06);
    for (let k = 0; k < 3; k++) add(a, rbox(.1, .08, .1, .03), stD, s * .07 + (k - 1) * .12, -.74, .27);
  }
  root.userData.tick = t => { body.position.y = Math.abs(Math.sin(t * 1.2)) * .02; arms.forEach((a, i) => { a.rotation.x = Math.sin(t * 1.2 + i * PI) * .08; }); };
  root.userData.frame = { y: 1.05, d: 5.2 };
  return root;
}

// ---------------------------------------------------------------- Stone Warlord
const G_RIM = new THREE.TorusGeometry(1, .05, 4, 18);
function warlord(F) {
  F_ = F;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = F.m(0x7a6482, { rough: .85 }), skinD = F.m(0x5e4a68), arm = F.m(0x5c4a70, { metal: .4, rough: .5 }), armD = F.m(0x423454, { metal: .4, rough: .5 }),
    gold = F.m(0xe8b030, { metal: .75, rough: .3 }), red = F.m(0xc02a2a), redD = F.m(0x8a1c1e), lava = F.m(0xff8a2a, { basic: true }), ruby = F.m(0xe02a3a, { rough: .1, emi: 0xa01020, ei: .6 }),
    tusk = F.m(0xf2ead6), stone = F.m(0x6e6a78, { rough: .9 }), wood = F.m(0x6a3a1e);
  // cape behind
  const cape = add(body, new THREE.CylinderGeometry(.5, .78, 1.7, 12, 1, true, PI * .58, PI * .84), red, 0, 1.12, -.08); cape.material = F.m(0xc02a2a, { side: THREE.DoubleSide }); cape.userData.noInk = true;
  // legs
  for (const s of [-1, 1]) {
    R_('legs', [s * .24, .9, 0]); limb(body, [s * .24, .9, 0], [s * .28, .5, .06], .2, skin, .17); limb(body, [s * .28, .5, .06], [s * .28, .16, .02], .17, armD, .16);
    add(body, G.sph, arm, s * .28, .5, .14, [.15, .14, .1]); add(body, rbox(.32, .16, .44, .07), armD, s * .28, .08, .08);
    add(body, G.torus, gold, s * .28, .3, .03, [.17, .17, .2], [PI / 2, 0, 0]);
  }
  R_();
  // armored torso, gold trim, lava cracks and ruby
  add(body, rbox(.9, .3, .58, .1), armD, 0, .96, 0); add(body, rbox(.94, .12, .62, .04), gold, 0, 1.08, 0);
  add(body, rbox(.96, .78, .64, .2), arm, 0, 1.5, 0);
  add(body, rbox(.62, .5, .1, .08), armD, 0, 1.52, .3); add(body, rbox(.66, .05, .12, .02), gold, 0, 1.78, .3);
  for (const [x, y, l, a] of [[-.12, 1.6, .2, .5], [-.05, 1.48, .16, -.6], [.08, 1.56, .18, .7], [.14, 1.43, .14, -.4]]) add(body, rbox(.04, l * 1.3, .025, .01), lava, x * 1.3, y, .355, 1, [0, 0, a]).userData.noInk = true;
  add(body, rbox(.2, .18, .05, .03), gold, 0, 1.08, .32); add(body, G.oct, ruby, 0, 1.08, .36, [.06, .07, .04]);
  add(body, rbox(.22, .5, .03, .01), red, 0, .76, .3); aim(add(body, G.cone, red, 0, .48, .3, [.11, .1, .015]), [0, -1, 0]);
  add(body, rbox(.03, .5, .035, .01), gold, -.11, .76, .305); add(body, rbox(.03, .5, .035, .01), gold, .11, .76, .305);
  // layered pauldrons with gold rims
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const p = add(body, new THREE.SphereGeometry(1, 10, 5, 0, PI * 2, 0, PI * .5), k === 0 ? arm : armD, s * (.56 + k * .05), 1.86 - k * .1, 0, [.3 - k * .03, .18, .3 - k * .03], [0, 0, -s * (.35 + k * .18)]);
    const rim = add(body, G_RIM, gold, s * (.56 + k * .05), 1.86 - k * .1, 0, .3 - k * .03); rim.rotation.order = 'ZXY'; rim.rotation.set(PI / 2, 0, -s * (.35 + k * .18));
  }
  // head: tusks, scowl, spiked crown
  const hd = new THREE.Group(); hd.position.set(0, 2.08, .12); body.add(hd);
  add(hd, G.sph, skin, 0, 0, 0, [.24, .24, .23]); add(hd, rbox(.4, .18, .28, .08), skin, 0, -.13, .06);
  add(hd, rbox(.34, .07, .1, .03), skinD, 0, .07, .17, 1); eyes(hd, .08, .02, .19, .035, 0xffb020, false);
  for (const s of [-1, 1]) aim(add(hd, G.cone, tusk, s * .13, -.08, .2, [.035, .12, .035]), [s * .25, 1, 0]);
  add(hd, new THREE.CylinderGeometry(.21, .22, .1, 12), gold, 0, .18, 0);
  for (let k = 0; k < 7; k++) { const a = k / 7 * PI * 2; aim(add(hd, G.cone, gold, Math.sin(a) * .2, .3, Math.cos(a) * .2, [.04, .16, .04]), [Math.sin(a) * .2, 1, Math.cos(a) * .2]); }
  add(hd, G.oct, ruby, 0, .2, .22, [.04, .05, .03]);
  // arms; hammer in the right hand
  for (const s of [-1, 1]) {
    R_('arms', [s * .58, 1.62, 0]); limb(body, [s * .58, 1.62, 0], [s * .7, 1.22, .06], .17, skin, .16); limb(body, [s * .7, 1.22, .06], [s * .66, .9, .2], .17, armD, .17);
    add(body, G.torus, gold, s * .69, 1.05, .14, [.18, .18, .25], [1.2, 0, 0]); add(body, rbox(.28, .26, .28, .09), arm, s * .66, .82, .24);
  }
  const hm = new THREE.Group(); hm.position.set(.66, .82, .26); hm.rotation.set(PI * .7, 0, -.1); hm.scale.setScalar(.9); put(body, hm);
  add(hm, G.cyl, wood, 0, .3, 0, [.05, .9, .05]); add(hm, G.torus, gold, 0, .02, 0, [.07, .07, .1], [PI / 2, 0, 0]);
  add(hm, rbox(.36, .3, .5, .07), stone, 0, .8, 0); for (const z of [-.16, .16]) add(hm, rbox(.38, .32, .06, .03), gold, 0, .8, z);
  R_();
  root.userData.tick = t => { const b = Math.sin(t * 1.3); body.position.y = b * .015; cape.rotation.y = Math.sin(t * 1.7) * .04; hd.rotation.y = Math.sin(t * .5) * .12; };
  root.userData.frame = { y: 1.25, d: 6.1 };
  return root;
}

// ---------------------------------------------------------------- Boar Rider (from the art): goblin lancer on a war boar
function rider(F) {
  F_ = F;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const fur = F.m(0x8a4a26), furD = F.m(0x5a2a16), furL = F.m(0xa8622e), snout = F.m(0xd87a7a), nose = F.m(0x6a2a2a), tusk = F.m(0xf2e6c8), hoof = F.m(0x3a302c),
    skin = F.m(0x9acb2e), skinD = F.m(0x7aa422), ear = F.m(0xf08a40), vest = F.m(0x7a4422), boot = F.m(0x7a4a26), wrap = F.m(0xd8b880),
    red = F.m(0xb8282a), stitch = F.m(0xe0b860), strap = F.m(0x6a3a1a), gold = F.m(0xe0a030, { metal: .6, rough: .35 }), wood = F.m(0x8a4e22), steel = F.m(0xb8bcc8, { metal: .8, rough: .3 }), mouth = F.m(0x5a1a1a), tooth = F.m(0xfff4e0);
  // four chunky legs with dark hooves (front-left, front-right, back-left, back-right)
  for (const [x, z] of [[-.2, .32], [.2, .32], [-.2, -.34], [.2, -.34]]) { R_('legs', [x, .58, z]); limb(body, [x, .58, z], [x, .2, z + .02], .12, fur, .09); add(body, rbox(.17, .12, .19, .04), hoof, x, .07, z + .04); R_(); }
  add(body, G.sph, fur, 0, .74, -.02, [.4, .36, .56]);
  add(body, G.sph, furL, 0, .62, .08, [.3, .24, .4]);
  // bristly mane down the spine, tallest over the shoulders
  for (let k = 0; k < 10; k++) { const z = .42 - k * .09, h = .26 - k * .014; aim(add(body, G.cone, k % 2 ? furD : fur, 0, 1.04 - k * .012, z, [.09, h, .06]), [0, 1, -.35]); for (const s of [-1, 1]) aim(add(body, G.cone, furD, s * .09, .99 - k * .012, z, [.06, h * .7, .05]), [s * .5, 1, -.35]); }
  // head: heavy brow, pink snout, curved tusks, angry eyes, open mouth
  const hd = new THREE.Group(); hd.position.set(0, .72, .5); body.add(hd);
  add(hd, G.sph, fur, 0, 0, 0, [.3, .27, .28]);
  add(hd, rbox(.38, .1, .14, .04), furD, 0, .15, .16, 1, [-.25, 0, 0]);
  add(hd, G.cyl, snout, 0, -.06, .27, [.13, .16, .12], [PI / 2, 0, 0]);
  add(hd, G.sph, mouth, 0, -.17, .2, [.13, .06, .07]); add(hd, G.cone, tooth, .05, -.14, .25, [.02, .05, .02], [PI, 0, 0]);
  for (const s of [-1, 1]) {
    add(hd, G.sph, nose, s * .05, -.06, .34, [.03, .045, .02]).userData.noInk = true;
    add(hd, ttube([[s * .11, -.12, .2], [s * .21, -.06, .25], [s * .24, .12, .2]], .05, .012, 8, 10), tusk);
    aim(add(hd, G.cone, fur, s * .2, .22, -.04, [.08, .18, .04]), [s * .7, 1, -.2]); aim(add(hd, G.cone, snout, s * .19, .22, -.02, [.05, .12, .015]), [s * .7, 1, -.2]);
  }
  eyes(hd, .12, .06, .21, .05, 0xffb020, false);
  // bristle-tufted tail
  add(body, ttube([[0, .86, -.54], [0, .98, -.66], [0, .96, -.78]], .035, .025, 6, 8), fur);
  for (const s of [-1, 0, 1]) aim(add(body, G.cone, furD, s * .03, .96, -.82, [.045, .16, .03]), [s * .4, .4, -1]);
  // red saddle blanket with gold stitching, girth strap with gold buckles
  for (const s of [-1, 1]) { add(body, rbox(.05, .38, .44, .02), red, s * .37, .87, -.06, 1, [0, 0, s * .25]); add(body, rbox(.056, .03, .46, .01), stitch, s * .41, .7, -.06, 1, [0, 0, s * .25]); add(body, rbox(.03, .09, .09, .015), gold, s * .43, .8, .14); }
  add(body, rbox(.64, .06, .48, .03), red, 0, 1.08, -.06);
  add(body, G.torus, strap, 0, .74, .14, [.41, .38, .22]);
  add(body, G.sph, gold, 0, 1.13, .14, .035);
  // goblin rider: vest, rope belt, wrapped boots
  add(body, new THREE.CylinderGeometry(.13, .17, .32, 12), vest, 0, 1.28, -.04);
  add(body, rbox(.02, .12, .02, .006), stitch, -.05, 1.3, .1); add(body, rbox(.08, .02, .02, .006), stitch, -.05, 1.3, .105);
  add(body, G.torus, wrap, 0, 1.15, -.04, [.17, .17, .25], [PI / 2, 0, 0]);
  for (const s of [-1, 1]) { limb(body, [s * .12, 1.15, -.04], [s * .33, .98, .02], .055, skin, .05); add(body, rbox(.12, .14, .17, .04), boot, s * .36, .92, .06); add(body, G.torus, wrap, s * .36, .98, .05, [.07, .07, .1], [PI / 2, 0, 0]); }
  const h2 = new THREE.Group(); h2.position.set(0, 1.6, .06); body.add(h2);
  add(h2, G.sph, skin, 0, 0, 0, [.18, .17, .17]);
  aim(add(h2, G.cone, skin, 0, -.05, .2, [.04, .14, .04]), [0, -.35, 1]);
  eyes(h2, .07, .03, .13, .045, 0xffc21a, true, skinD, .5);
  add(h2, G.sph, mouth, 0, -.09, .13, [.08, .035, .04]); add(h2, G.cone, tooth, .035, -.08, .16, [.012, .035, .012], [PI, 0, 0]);
  for (const s of [-1, 1]) { aim(add(h2, G.cone, skin, s * .22, .04, -.02, [.08, .34, .03]), [s, .4, -.15]); aim(add(h2, G.cone, ear, s * .21, .04, 0, [.05, .25, .01]), [s, .4, -.15]); }
  // lance held level, with a red ribbon and a rope grip; other hand on the saddle
  limb(body, [.14, 1.38, 0], [.22, 1.28, .24], .05, skin, .045); add(body, G.sph, skin, .22, 1.28, .27, .06);
  limb(body, [-.14, 1.38, 0], [-.16, 1.16, .12], .045, skin, .04); add(body, G.sph, skin, -.16, 1.14, .14, .05);
  const ln = new THREE.Group(); ln.position.set(.22, 1.28, .3); ln.rotation.set(PI / 2 - .12, 0, 0); body.add(ln);
  add(ln, G.cyl, wood, 0, .2, 0, [.03, 1.3, .03]);
  add(ln, G.torus, wrap, 0, .76, 0, [.045, .045, .15], [PI / 2, 0, 0]); add(ln, G.torus, red, 0, .82, 0, [.045, .045, .15], [PI / 2, 0, 0]);
  add(ln, G.cone, steel, 0, 1.0, 0, [.07, .3, .04]);
  add(ln, rbox(.22, .06, .012, .01), red, .1, .8, .02, 1, [0, 0, -.5]); add(ln, rbox(.16, .05, .012, .01), red, .16, .74, .02, 1, [0, 0, -.9]);
  root.userData.tick = t => { body.position.y = Math.abs(Math.sin(t * 6)) * .05; };
  root.userData.frame = { y: .9, d: 4.6 };
  return root;
}
// ---------------------------------------------------------------- Goblin Sapper (from the art): bandana, huge bomb, torch
function sapper(F) {
  F_ = F;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = F.m(0x9acb2e), skinD = F.m(0x7aa422), ear = F.m(0xf08a40), red = F.m(0xc8282a), redD = F.m(0x9a1c1e), tunic = F.m(0x4a3a2e), tunicD = F.m(0x3a2c22), patch = F.m(0x8a6a4a),
    rope = F.m(0xd8b070), wrap = F.m(0xd8c090), iron = F.m(0x3a3438, { metal: .45, rough: .5 }), rim = F.m(0x6a5446, { metal: .5 }), wood = F.m(0x7a4a22),
    flame = F.m(0xff8a20, { basic: true }), flame2 = F.m(0xffe060, { basic: true }), spark = F.m(0xfff080, { basic: true }), soot = F.m(0x2a2a20), mouth = F.m(0x5a1a1a), tooth = F.m(0xfff4e0);
  // lunging legs with cloth wraps, bare feet
  for (const [s, knee, ank] of [[-1, [-.15, .42, .2], [-.19, .13, .32]], [1, [.15, .4, -.12], [.19, .13, -.24]]]) {
    R_('legs', [s * .1, .66, 0]); limb(body, [s * .1, .66, 0], knee, .08, skin, .07); limb(body, knee, ank, .065, skin, .06);
    for (let k = 0; k < 3; k++) { const f = .3 + k * .2; add(body, G.torus, wrap, knee[0] + (ank[0] - knee[0]) * f, knee[1] + (ank[1] - knee[1]) * f, knee[2] + (ank[2] - knee[2]) * f, [.08, .08, .1], [PI / 2 + .3, 0, 0]); }
    add(body, rbox(.15, .07, .24, .04), skin, ank[0], ank[1] - .08, ank[2] + .06); R_();
  }
  // patched tunic with a ragged hem and a knotted rope belt
  add(body, new THREE.CylinderGeometry(.17, .25, .44, 14), tunic, 0, .88, 0);
  for (let i = 0; i < 10; i++) { const a = i / 10 * PI * 2; aim(add(body, G.cone, i % 2 ? tunic : tunicD, Math.sin(a) * .23, .64, Math.cos(a) * .23, [.07, .15, .04]), [Math.sin(a) * .3, -1, Math.cos(a) * .3]); }
  add(body, rbox(.1, .09, .02, .02), patch, -.07, 1.0, .19, 1, [0, 0, .2]); add(body, rbox(.09, .08, .02, .02), patch, .08, .74, .23, 1, [0, 0, -.25]);
  add(body, G.torus, rope, 0, .82, 0, [.23, .23, .35], [PI / 2, 0, 0]);
  add(body, G.sph, rope, .06, .8, .22, .05); add(body, ttube([[.06, .78, .23], [.08, .68, .25], [.05, .6, .24]], .02, .014, 6, 6), rope);
  // head: long nose, angry grin, huge ears, soot smudges, red bandana with flapping tails
  const hd = new THREE.Group(); hd.position.set(0, 1.24, .12); body.add(hd);
  add(hd, G.sph, skin, 0, 0, 0, [.24, .22, .22]);
  aim(add(hd, G.cone, skin, 0, -.06, .26, [.05, .2, .05]), [0, -.45, 1]);
  eyes(hd, .095, .03, .17, .06, 0xffa020, true, skinD, .55);
  add(hd, G.sph, mouth, .02, -.13, .17, [.1, .045, .05]); add(hd, G.cone, tooth, .05, -.11, .21, [.015, .04, .015], [PI, 0, 0]);
  add(hd, G.sph, soot, -.17, -.04, .12, [.04, .03, .02]).userData.noInk = true; add(hd, G.sph, soot, .15, -.09, .14, [.03, .025, .02]).userData.noInk = true;
  for (const s of [-1, 1]) { aim(add(hd, G.cone, skin, s * .3, .02, -.02, [.11, .46, .035]), [s, .35, -.15]); aim(add(hd, G.cone, ear, s * .29, .02, 0, [.07, .34, .012]), [s, .35, -.15]); }
  add(hd, new THREE.SphereGeometry(1, 12, 6, 0, PI * 2, 0, PI * .55), red, 0, .02, -.01, [.25, .2, .24]);
  add(hd, G.torus, redD, 0, .07, -.01, [.245, .235, .3], [PI / 2 + .15, 0, 0]);
  add(hd, G.sph, red, .12, .16, -.18, .07);
  add(hd, rbox(.24, .08, .02, .01), red, .26, .22, -.22, 1, [0, -.5, .55]); add(hd, rbox(.2, .07, .02, .01), redD, .2, .28, -.26, 1, [0, -.7, 1.0]);
  // the bomb: a huge iron ball lashed on with rope, fuse lit
  add(body, G.sph, iron, .06, 1.2, -.5, .46);
  add(body, G.cyl, rim, .06, 1.66, -.5, [.12, .08, .12]);
  for (const [rx, rz] of [[.25, 0], [0, .6], [-.4, .2]]) add(body, G.torus, rope, .06, 1.2, -.5, [.47, .47, .55], [PI / 2 + rx, rz, 0]);
  for (const s of [-1, 1]) add(body, ttube([[s * .14, 1.32, -.2], [s * .16, 1.12, .1], [s * .12, .92, .18]], .022, .022, 6, 8), rope);
  add(body, ttube([[.06, 1.7, -.5], [.04, 1.86, -.44], [.16, 1.94, -.46], [.24, 1.9, -.4]], .025, .02, 6, 10), rope);
  add(body, G.oct, spark, .25, 1.91, -.39, [.07, .07, .07]).userData.noInk = true;
  for (let k = 0; k < 5; k++) { const a = k / 5 * PI * 2; add(body, rbox(.12, .02, .02, .005), flame, .25 + Math.cos(a) * .09, 1.91 + Math.sin(a) * .09, -.39, 1, [0, 0, a]).userData.noInk = true; }
  // left arm thrusts a lit torch forward; right hand grips the bomb rope
  R_('arms', [-.2, 1.04, .04]);
  limb(body, [-.2, 1.04, .04], [-.36, .96, .18], .055, skin, .05); limb(body, [-.36, .96, .18], [-.4, 1.06, .32], .05, skin, .045); add(body, G.sph, skin, -.4, 1.06, .35, .07);
  const tc = new THREE.Group(); tc.position.set(-.4, 1.06, .36); tc.rotation.set(.35, 0, .25); put(body, tc);
  add(tc, G.cyl, wood, 0, .05, 0, [.035, .5, .035]); add(tc, G.torus, wrap, 0, .2, 0, [.05, .05, .1], [PI / 2, 0, 0]);
  add(tc, G.sph, flame, 0, .34, 0, [.09, .08, .09]).userData.noInk = true;
  for (const [x, z, h, r] of [[0, 0, .3, .07], [.05, .02, .2, .045], [-.05, -.01, .22, .045], [.01, .05, .16, .04]]) add(tc, G.cone, flame, x, .42 + h * .3, z, [r, h, r], [x * 3, 0, -x * 4]).userData.noInk = true;
  add(tc, G.cone, flame2, 0, .42, 0, [.045, .17, .045]).userData.noInk = true; add(tc, G.sph, flame2, 0, .34, 0, .05).userData.noInk = true;
  R_();
  R_('arms', [.2, 1.04, 0]); limb(body, [.2, 1.04, 0], [.3, .9, .14], .055, skin, .05); limb(body, [.3, .9, .14], [.15, .98, .22], .05, skin, .045); add(body, G.sph, skin, .14, .98, .24, .065); R_();
  root.userData.tick = t => { body.position.y = Math.abs(Math.sin(t * 5)) * .03; };
  root.userData.frame = { y: .95, d: 4.4 };
  return root;
}
// ---------------------------------------------------------------- Gruk the Mire-King (from the art)
function gruk(F) {
  F_ = F;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = F.m(0x8aa848), skinD = F.m(0x6e8c36), moss = F.m(0x9ac43a), mossD = F.m(0x6e9a2a), vine = F.m(0x4a7a22), slime = F.m(0xc8e870, { emi: 0x6a9a20, ei: .3 }),
    belt = F.m(0x7a4a26), iron = F.m(0x7a787e, { metal: .7, rough: .4 }), cloth = F.m(0x4a7a2a), bone = F.m(0xeee0c0), band = F.m(0x6a4422), wood = F.m(0xb0702e), woodD = F.m(0x8a5422),
    nail = F.m(0xe8d8b0), cat = F.m(0x7a4a22), leaf = F.m(0x7aa83a), scar = F.m(0x8a3a20), ear = F.m(0xd88a7a), mouth = F.m(0x5a1a1a), stitch = F.m(0xd8b880);
  const drip = (x, y, z, s = 1) => { add(body, G.cone, slime, x, y - .05 * s, z, [.03 * s, .12 * s, .03 * s], [PI, 0, 0]).userData.noInk = true; add(body, G.sph, slime, x, y - .15 * s, z, .035 * s).userData.noInk = true; };
  // stumpy legs with pale toenails
  for (const s of [-1, 1]) {
    R_('legs', [s * .3, .8, 0]);
    limb(body, [s * .3, .8, 0], [s * .36, .38, .04], .24, skin, .22); limb(body, [s * .36, .38, .04], [s * .36, .14, .06], .22, skinD, .21);
    add(body, G.sph, skin, s * .36, .1, .14, [.24, .11, .28]);
    for (const k of [-1, 0, 1]) add(body, G.sph, nail, s * .36 + k * .1, .08, .38, [.06, .05, .05]);
    R_();
  }
  // ragged green loincloth, belt with an iron buckle and a stitched leather flap
  for (let i = 0; i < 12; i++) { const a = i / 12 * PI * 2; aim(add(body, G.cone, i % 2 ? cloth : mossD, Math.sin(a) * .44, .7, Math.cos(a) * .4, [.1, .32, .05]), [Math.sin(a) * .15, -1, Math.cos(a) * .15]); }
  add(body, new THREE.CylinderGeometry(.5, .52, .16, 16), belt, 0, .95, 0);
  add(body, rbox(.22, .18, .06, .04), iron, -.06, .95, .5); add(body, rbox(.12, .08, .07, .02), belt, -.06, .95, .51);
  add(body, rbox(.16, .26, .04, .02), belt, .22, .8, .48); for (const y of [.84, .74]) for (const r of [.7, -.7]) add(body, rbox(.08, .015, .01, .004), stitch, .22, y, .505, 1, [0, 0, r]);
  // huge belly and chest, scars
  add(body, G.sph, skin, 0, 1.24, .14, [.54, .48, .44]);
  add(body, G.sph, skin, 0, 1.55, -.04, [.7, .5, .5]);
  add(body, G.sph, skin, 0, 1.66, .3, [.32, .2, .2]);
  add(body, G.sph, skinD, 0, 1.2, .57, [.04, .03, .02]);
  add(body, rbox(.16, .025, .02, .01), scar, -.24, 1.3, .52, 1, [0, -.4, .6]); add(body, rbox(.14, .025, .02, .01), scar, .5, 1.62, .32, 1, [0, .5, .8]);
  for (const [x, y, z] of [[.2, 1.45, .45], [-.3, 1.15, .45], [.34, 1.1, .4]]) add(body, G.sph, mossD, x, y, z, .04);
  // moss mantle over the shoulders and back, dripping slime
  add(body, G.sph, moss, 0, 1.84, -.2, [.86, .22, .46]);
  for (const s of [-1, 1]) add(body, G.sph, moss, s * .66, 1.84, -.02, [.36, .17, .36]);
  for (let i = 0; i < 22; i++) { const a = i / 22 * PI * 2, x = Math.sin(a) * .9, z = -.16 + Math.cos(a) * .44; aim(add(body, G.cone, i % 3 ? moss : mossD, x, 1.72, z, [.09, .2, .05]), [Math.sin(a) * .2, -1, Math.cos(a) * .2]); if (i % 3 === 0) drip(x, 1.6, z, .9); }
  // vines over the chest, cattails and reeds on the shoulders
  for (const [x, z, l] of [[-.5, .3, .5], [-.22, .44, .38], [.3, .4, .44], [.56, .26, .55]]) add(body, ttube([[x, 1.78, z], [x * 1.05, 1.78 - l * .5, z + .08], [x * .9, 1.78 - l, z + .02]], .022, .016, 6, 8), vine);
  for (const s of [-1, 1]) {
    const x = s * .64; add(body, G.cyl, leaf, x, 2.12, -.18, [.018, .5, .018]); add(body, G.cyl, cat, x, 2.38, -.18, [.045, .16, .045]);
    for (const k of [-1, 1]) aim(add(body, G.cone, leaf, x + k * .06, 2.05, -.16, [.03, .34, .012]), [k * .4, 1, 0]);
  }
  // head: underbite with big tusks, glowing eyes, pointed ears, bone-spike crown on a studded band
  const hd = new THREE.Group(); hd.position.set(0, 1.8, .56); hd.scale.setScalar(1.18); body.add(hd);
  add(hd, G.sph, skin, 0, 0, 0, [.27, .25, .25]);
  add(hd, rbox(.46, .2, .32, .08), skin, 0, -.16, .08);
  add(hd, rbox(.36, .07, .12, .03), skinD, 0, .08, .19, 1, [-.2, 0, 0]);
  add(hd, G.sph, mouth, 0, -.12, .23, [.16, .05, .05]);
  for (const s of [-1, 1]) {
    aim(add(hd, G.cone, bone, s * .14, -.12, .22, [.05, .18, .05]), [s * .25, 1, .1]);
    aim(add(hd, G.cone, skin, s * .3, .02, -.02, [.07, .2, .035]), [s, .3, -.2]); aim(add(hd, G.cone, ear, s * .29, .02, 0, [.045, .14, .012]), [s, .3, -.2]);
  }
  eyes(hd, .09, .03, .2, .04, 0xffd030, false);
  add(hd, G.sph, skin, 0, -.01, .25, [.06, .05, .05]);
  add(hd, G.torus, band, 0, .17, 0, [.25, .25, .4], [PI / 2, 0, 0]);
  for (let k = 0; k < 8; k++) { const a = k / 8 * PI * 2; add(hd, G.sph, iron, Math.sin(a) * .25, .17, Math.cos(a) * .25, .025); }
  for (const [a, h] of [[-.9, .16], [-.45, .22], [0, .3], [.45, .22], [.9, .16]]) aim(add(hd, G.cone, bone, Math.sin(a) * .22, .3, Math.cos(a) * .22, [.05, h, .05]), [Math.sin(a) * .2, 1, Math.cos(a) * .1]);
  // arms: huge forearms, mossy and dripping; a banded log club in the right hand
  for (const s of [-1, 1]) {
    R_('arms', [s * .66, 1.66, 0]);
    limb(body, [s * .66, 1.66, 0], [s * .86, 1.2, .06], .22, skin, .2); limb(body, [s * .86, 1.2, .06], [s * .84, .8, .2], .26, skin, .22);
    add(body, G.sph, skin, s * .84, .7, .24, [.22, .2, .22]);
    add(body, G.sph, moss, s * .88, 1.08, .1, [.2, .1, .2]); drip(s * .96, 1.02, .12); drip(s * .78, .98, .2, .8); drip(s * .9, .6, .3, .8);
    if (s > 0) {
      const club = new THREE.Group(); club.position.set(s * .84, .66, .3); club.rotation.set(PI * .6, 0, -.15); put(body, club);
      add(club, ttube([[0, -.1, 0], [0, .4, 0], [0, .9, 0]], .12, .24, 12, 10), wood);
      add(club, G.cyl, woodD, 0, .92, 0, [.24, .04, .24]); add(club, G.torus, woodD, 0, .93, 0, [.12, .12, .2], [PI / 2, 0, 0]);
      add(club, G.cyl, iron, 0, .55, 0, [.21, .14, .21]); for (let k = 0; k < 5; k++) { const a = k / 5 * PI * 2; add(club, G.sph, iron, Math.sin(a) * .22, .55, Math.cos(a) * .22, .03); }
      add(club, G.sph, moss, .06, .78, .1, [.16, .08, .14]); add(club, G.cone, slime, .1, .66, .16, [.03, .12, .03], [PI, 0, 0]).userData.noInk = true;
    }
    R_();
  }
  root.userData.tick = t => { const b = Math.sin(t * 1.4); body.position.y = b * .015; hd.rotation.y = Math.sin(t * .5) * .12; };
  root.userData.frame = { y: 1.25, d: 6.6 };
  return root;
}
// ---------------------------------------------------------------- Barracks soldiers (cel-shaded, same pipeline as enemies; from the soldier art)
function human(F, o) {
  F_ = F;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const skin = F.m(0xe8a878), tunic = F.m(o.tunic), metal = F.m(o.metal ?? 0xa8a8b4, { metal: .8, rough: .3 }), trim = F.m(o.trim ?? 0xf0b030, { metal: .6, rough: .35 }),
    boot = F.m(0x8a4a24), belt = F.m(0x7a4422), dark = F.m(0x2a1a10), wood = F.m(0x9a5a2a), steel = F.m(0xc8ccd4, { metal: .85, rough: .25 }), beard = F.m(o.beard ?? 0x9a4e22), hem = F.m(o.hem ?? 0xe0c088);
  const torsoM = o.plate ? metal : o.mail ? F.m(0x8a8e9a, { metal: .6, rough: .4 }) : tunic, legM = o.legMetal ? metal : F.m(o.pants ?? 0x6a4a2a);
  // stout legs and chunky boots
  for (const s of [-1, 1]) {
    R_('legs', [s * .12, .5, 0]);
    limb(body, [s * .12, .5, 0], [s * .13, .16, .02], .095, legM, .085);
    add(body, rbox(.19, .2, .26, .05), o.legMetal ? metal : boot, s * .13, .1, .04);
    add(body, rbox(.21, .06, .21, .02), o.legMetal ? trim : boot, s * .13, .22, .02);
    R_();
  }
  // wide torso with a skirt
  add(body, rbox(.48, .44, .32, .12), torsoM, 0, .8, 0);
  add(body, rbox(.5, .2, .34, .06), o.plate ? metal : tunic, 0, .56, 0);
  if (!o.plate) add(body, rbox(.52, .04, .35, .015), hem, 0, .46, 0);
  if (o.tabard) { add(body, rbox(.22, .58, .02, .01), F.m(o.tabard), 0, .68, .175); add(body, rbox(.04, .56, .025, .01), trim, -.11, .68, .18); add(body, rbox(.04, .56, .025, .01), trim, .11, .68, .18); }
  if (o.plate) { add(body, rbox(.34, .16, .05, .04), metal, 0, .98, .15); add(body, rbox(.36, .03, .055, .01), trim, 0, .91, .17); }
  if (o.sun) add(body, G.sph, F.m(0xf2c230, { emi: 0xf2c230, ei: .4 }), 0, .82, .2, [.06, .06, .02]);
  add(body, rbox(.5, .08, .34, .03), belt, 0, .6, 0); add(body, rbox(.1, .09, .035, .015), o.plate || o.mail ? trim : steel, 0, .6, .18);
  if (!o.plate) { const st = add(body, rbox(.06, .5, .02, .01), belt, 0, .8, .165); st.rotation.z = .7; }
  if (o.cape) add(body, rbox(.46, .78, .035, .012), F.m(o.cape), 0, .62, -.19, 1, [.1, 0, 0]);
  if (o.pauldron) for (const s of [-1, 1]) { add(body, G.sph, metal, s * .27, 1.0, 0, [.14, .1, .14]); add(body, G.torus, trim, s * .27, .97, 0, [.13, .13, .22], [PI / 2, 0, 0]); }
  if (o.quiver) { add(body, G.cyl, wood, -.12, .92, -.2, [.07, .36, .07], [.3, 0, .4]); for (const k of [-1, 0, 1]) add(body, G.cone, F.m(0xf2f0e8), -.2 + k * .035, 1.14, -.25, [.025, .08, .02]); }
  // head: big, bearded, with an open-faced helmet
  const hd = new THREE.Group(); hd.position.set(0, 1.16, .02); body.add(hd);
  add(hd, G.sph, skin, 0, 0, 0, [.165, .17, .16]);
  add(hd, G.sph, beard, 0, -.085, .07, [.145, .11, .1]);
  add(hd, rbox(.15, .035, .035, .012), beard, 0, -.035, .148);
  add(hd, G.sph, skin, 0, -.005, .162, [.04, .035, .035]);
  for (const s of [-1, 1]) { add(hd, G.sph, dark, s * .06, .03, .145, .022).userData.noInk = true; const br = add(hd, rbox(.06, .018, .02, .006), beard, s * .06, .065, .15); br.rotation.z = s * .25; }
  const dome = (sx, sy, y = .03) => add(hd, new THREE.SphereGeometry(1, 12, 6, 0, PI * 2, 0, PI * .5), metal, 0, y, -.005, [sx, sy, sx]);
  if (o.helm === 'kettle') {
    dome(.18, .16); add(hd, G.cyl, metal, 0, .04, 0, [.27, .028, .27]); add(hd, G.torus, F.m(0x8a8a96), 0, .05, 0, [.18, .18, .3], [PI / 2, 0, 0]);
    for (let k = 0; k < 6; k++) { const a = k / 6 * PI * 2; add(hd, G.sph, steel, Math.cos(a) * .24, .05, Math.sin(a) * .24, .018); }
    add(hd, rbox(.03, .16, .3, .01), metal, 0, .13, 0);
  }
  if (o.helm === 'nasal') {
    dome(.18, .18); add(hd, G.torus, F.m(0x7a7e8a), 0, .04, 0, [.18, .18, .3], [PI / 2, 0, 0]);
    add(hd, rbox(.035, .12, .03, .01), metal, 0, .0, .17);
    for (const s of [-1, 1]) add(hd, rbox(.04, .14, .1, .02), metal, s * .16, -.04, .03);
  }
  if (o.helm === 'knight' || o.helm === 'paladin') {
    dome(.185, .19); add(hd, G.torus, trim, 0, .04, 0, [.185, .185, .3], [PI / 2, 0, 0]);
    add(hd, rbox(.04, .2, .34, .015), trim, 0, .14, -.02);
    for (const s of [-1, 1]) { add(hd, rbox(.05, .16, .12, .02), metal, s * .165, -.04, .04); add(hd, rbox(.055, .02, .13, .006), trim, s * .165, .04, .04); }
    if (o.helm === 'knight') add(hd, G.sph, trim, .19, .0, 0, [.02, .05, .05]);
    if (o.plume) for (let k = 0; k < 6; k++) add(hd, G.sph, F.m(o.plume), 0, .3 + Math.sin(k * .5) * .06 - k * .02, -.02 - k * .055, [.035, .1 - k * .008, .07]);
    if (o.helm === 'paladin') aim(add(hd, G.cone, trim, 0, .26, .0, [.04, .1, .04]), [0, 1, 0]);
  }
  if (o.helm === 'hood') {
    add(hd, G.sph, tunic, 0, .03, -.04, [.2, .2, .19]);
    aim(add(hd, G.cone, tunic, 0, .2, -.1, [.08, .18, .08]), [0, .5, -1]);
    add(hd, G.torus, tunic, 0, .0, .07, [.16, .17, .3], [0, 0, 0]);
  }
  // weapon arm (x-) and shield arm (x+)
  R_('arms', [-.28, .98, 0]);
  limb(body, [-.28, .98, 0], [-.32, .76, .12], .075, o.plate ? metal : o.mail ? torsoM : tunic, .07);
  add(body, G.sph, o.plate ? metal : skin, -.32, .72, .16, .075);
  if (!o.plate) add(body, G.cyl, o.mail ? tunic : hem, -.31, .8, .13, [.08, .06, .08]);
  const wg = new THREE.Group(); wg.position.set(-.32, .72, .18); put(body, wg);
  if (o.weapon === 'sword' || o.weapon === 'broad') {
    const Lb = o.weapon === 'broad' ? .6 : .46, gold = o.weapon === 'broad' || o.goldHilt;
    wg.rotation.x = .9; add(wg, G.cyl, belt, 0, 0, 0, [.03, .14, .03]); add(wg, rbox(.22, .045, .06, .015), gold ? trim : metal, 0, .08, 0);
    add(wg, rbox(.085, Lb, .03, .012), steel, 0, .1 + Lb / 2, 0); add(wg, G.cone, steel, 0, .14 + Lb, 0, [.042, .09, .015]);
    add(wg, G.sph, gold ? trim : metal, 0, -.08, 0, .035);
  }
  if (o.weapon === 'fork') { wg.rotation.x = .9; add(wg, G.cyl, wood, 0, .3, 0, [.028, .9, .028]); add(wg, rbox(.16, .03, .03, .008), steel, 0, .74, 0); for (const k of [-1, 0, 1]) add(wg, rbox(.024, .2, .024, .006), steel, k * .065, .86, 0); }
  if (o.weapon === 'hammer') { wg.rotation.x = .7; add(wg, G.cyl, belt, 0, .15, 0, [.035, .56, .035]); add(wg, rbox(.3, .17, .17, .04), F.m(0xf6d24a, { emi: 0xf2c230, ei: .7 }), 0, .47, 0); add(wg, rbox(.32, .03, .19, .01), trim, 0, .4, 0); add(wg, G.cone, trim, 0, .6, 0, [.04, .07, .04]); }
  if (o.weapon === 'bow') { wg.rotation.set(0, 0, .1); add(wg, new THREE.TorusGeometry(1, .08, 5, 14, PI), F.m(0xc0662a), 0, .1, 0, [.34, .34, .34], [0, PI / 2, PI / 2]); add(wg, G.cyl, F.m(0xf0e8d0), 0, .1, 0, [.006, .68, .006]); for (const s of [-1, 1]) add(wg, rbox(.05, .05, .05, .01), steel, 0, .1 + s * .34, 0); }
  R_();
  R_('arms', [.28, .98, 0]);
  limb(body, [.28, .98, 0], [.34, .78, .12], .075, o.plate ? metal : o.mail ? torsoM : tunic, .07);
  add(body, G.sph, o.plate ? metal : skin, .34, .74, .16, .075);
  const sg = new THREE.Group(); sg.position.set(.38, .76, .22); sg.rotation.y = -.35; put(body, sg);
  if (o.shield === 'round') { add(sg, G.cyl, F.m(0xa8622a), 0, 0, 0, [.26, .05, .26], [PI / 2, 0, 0]); add(sg, G.torus, metal, 0, 0, .025, [.26, .26, .3]); add(sg, G.sph, steel, 0, 0, .05, .07); for (let k = 0; k < 6; k++) { const a = k / 6 * PI * 2; add(sg, G.sph, steel, Math.cos(a) * .25, Math.sin(a) * .25, .05, .02); } }
  if (o.shield === 'kite' || o.shield === 'heater' || o.shield === 'sun') {
    const face = F.m(o.shield === 'sun' ? 0xf4f0e6 : 0x2a52c8), h = o.shield === 'kite' ? .46 : .38;
    add(sg, rbox(.36, h, .045, .02), trim, 0, .05, 0); add(sg, rbox(.3, h - .05, .055, .02), face, 0, .05, .005);
    aim(add(sg, G.cone, trim, 0, .05 - h / 2 - .09, 0, [.18, .18, .022]), [0, -1, 0]); aim(add(sg, G.cone, face, 0, .05 - h / 2 - .07, .006, [.15, .14, .022]), [0, -1, 0]);
    if (o.shield === 'sun') { add(sg, G.sph, F.m(0xf2c230, { emi: 0xf2c230, ei: .4 }), 0, .03, .045, [.08, .08, .025]); for (let k = 0; k < 8; k++) { const a = k / 8 * PI * 2, r = add(sg, G.cone, trim, Math.sin(a) * .13, .03 + Math.cos(a) * .13, .04, [.025, .07, .01]); r.rotation.z = -a; } }
    else if (o.emblem === 'castle') { add(sg, rbox(.14, .12, .02, .005), trim, 0, .0, .04); for (const k of [-1, 0, 1]) add(sg, rbox(.035, .05, .02, .005), trim, k * .05, .08, .04); add(sg, rbox(.05, .06, .025, .005), face, 0, -.03, .045); }
    else { const dmd = add(sg, rbox(.1, .1, .03, .01), trim, 0, .03, .04); dmd.rotation.z = PI / 4; dmd.scale.y = 1.5; }
  }
  R_();
  root.userData.tick = t => { body.position.y = Math.abs(Math.sin(t * 2)) * .015; };
  root.userData.frame = { y: .75, d: 4 };
  return root;
}
const footman = F => human(F, { tunic: 0x3a52c0, pants: 0x6a4a2a, helm: 'kettle', weapon: 'sword', shield: 'round' });
const shieldman = F => human(F, { tunic: 0x3a52c0, mail: true, tabard: 0x3a52c0, pants: 0x3a3a90, helm: 'nasal', weapon: 'sword', goldHilt: true, shield: 'kite' });
const guard = F => human(F, { tunic: 0x9a9aa8, plate: true, legMetal: true, tabard: 0x2a52c8, helm: 'knight', plume: 0x2a48d0, weapon: 'broad', shield: 'heater', emblem: 'castle', pauldron: true });
const paladin = F => human(F, { tunic: 0xf0ece0, plate: true, legMetal: true, metal: 0xece6da, beard: 0x7a3a1a, sun: true, cape: 0xf4f0e6, helm: 'paladin', weapon: 'hammer', shield: 'sun', pauldron: true });
const militia = F => human(F, { tunic: 0x8a6a3a, pants: 0x5a4a2a, hem: 0xc8a878, helm: 'none', weapon: 'fork', shield: 'round' });
const ranger = F => human(F, { tunic: 0x5a8a24, pants: 0x4a7a24, hem: 0x8a5a2a, cape: 0x5a8a24, helm: 'hood', weapon: 'bow', quiver: true });
// material tags: the builders ask for colours and finishes; merging sorts parts into four shared materials
const EF = { m(color, o = {}) { const m = new THREE.MeshBasicMaterial({ color, side: o.side || THREE.FrontSide, vertexColors: !!o.vc }); m.userData.o = o; return m; } };
const BUILDERS = { runner: goblin, soldier: orc, knight, shaman, brute: ogre, golem, flyer: bat, wraith, boss: warlord, rider, gruk, sapper, footman, shieldman, guard, paladin, ranger, militia };
const SCALE = { runner: .7, soldier: .76, knight: .76, shaman: .8, brute: 1.08, golem: 1.1, flyer: .6, wraith: .65, boss: 1.55, rider: .78, gruk: 1.32, sapper: .7, footman: .7, shieldman: .7, guard: .72, paladin: .74, ranger: .7, militia: .66 };
const toonRamp = (() => { const d = new Uint8Array([85, 85, 85, 255, 155, 155, 155, 255, 212, 212, 212, 255, 240, 240, 240, 255]); const t = new THREE.DataTexture(d, 4, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
const MATS = {
  toon: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp }),
  dbl: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp }),
  ghost: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp, transparent: true, opacity: .8, depthWrite: false, emissive: 0x2a6a8a, emissiveIntensity: .55 }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
};
function inkMat(th) {
  const m = new THREE.MeshBasicMaterial({ color: 0x22142a, side: THREE.BackSide });
  m.onBeforeCompile = sh => { sh.uniforms.th = { value: th }; sh.vertexShader = 'uniform float th;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * th;'); };
  m.customProgramCacheKey = () => 'ink' + th;
  return m;
}
const bucketOf = m => { const o = m.userData.o || {}; return o.op ? 'ghost' : (o.basic || (o.ei || 0) >= .6) ? 'glow' : m.side === THREE.DoubleSide ? 'dbl' : 'toon'; };
const _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _p = new V(), _c = new THREE.Color(), _c2 = new THREE.Color();
function mergeList(list, twoSided) { // list of {mesh, rel}; twoSided adds a flipped copy of every triangle
  const pos = [], nor = [], col = [];
  for (const { mesh, rel } of list) {
    let g = mesh.geometry; if (g.index) g = g.toNonIndexed();
    const P = g.attributes.position, N = g.attributes.normal, C = mesh.material.vertexColors && g.attributes.color;
    _n.getNormalMatrix(rel); _c.copy(mesh.material.color);
    for (let i = 0; i < P.count; i++) {
      _p.fromBufferAttribute(P, i).applyMatrix4(rel); pos.push(_p.x, _p.y, _p.z);
      _p.fromBufferAttribute(N, i).applyMatrix3(_n).normalize(); nor.push(_p.x, _p.y, _p.z);
      if (C) { _c2.fromBufferAttribute(C, i).multiply(_c); col.push(_c2.r, _c2.g, _c2.b); } else col.push(_c.r, _c.g, _c.b);
    }
  }
  if (twoSided) { const n = pos.length; for (let i = 0; i < n; i += 9) for (const k of [0, 6, 3]) { pos.push(pos[i + k], pos[i + k + 1], pos[i + k + 2]); nor.push(-nor[i + k], -nor[i + k + 1], -nor[i + k + 2]); col.push(col[i + k], col[i + k + 1], col[i + k + 2]); } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere(); return g;
}
const TEMPLATES = {};
function template(type) {
  if (TEMPLATES[type]) return TEMPLATES[type];
  RIG = { body: null, legs: [], arms: [], wings: [] };
  // builders take the body group from their own root; capture it by wrapping THREE.Group creation order: root, then body
  const S = SCALE[type];
  const root = buildWithRig(type);
  root.scale.setScalar(S); root.updateMatrixWorld(true);
  const groups = [{ key: 'body', node: RIG.body }, ...RIG.legs.map((n, i) => ({ key: 'legs' + i, node: n })), ...RIG.arms.map((n, i) => ({ key: 'arms' + i, node: n })), ...RIG.wings.map((n, i) => ({ key: 'wings' + i, node: n }))];
  const pivots = new Set(groups.slice(1).map(g => g.node));
  const owner = o => { for (let p = o.parent; p; p = p.parent) if (pivots.has(p)) return p; return RIG.body; };
  const out = {}, debris = [], box = new THREE.Box3();
  for (const g of groups) { g.pos = new V().setFromMatrixPosition(g.node.matrixWorld); out[g.key] = { pos: g.pos.clone(), buckets: {}, ink: [] }; }
  root.traverse(o => {
    if (!o.isMesh) return;
    const own = owner(o), g = groups.find(q => q.node === own);
    const rel = new THREE.Matrix4().makeTranslation(-g.pos.x, -g.pos.y, -g.pos.z).multiply(o.matrixWorld);
    const b = bucketOf(o.material), e = { mesh: o, rel };
    (out[g.key].buckets[b] = out[g.key].buckets[b] || []).push(e);
    if (b === 'toon' && !o.userData.noInk) out[g.key].ink.push(e);
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const sz = o.geometry.boundingBox.getSize(new V()), ws = new V().setFromMatrixScale(o.matrixWorld);
    const vol = Math.abs(sz.x * ws.x * sz.y * ws.y * sz.z * ws.z);
    const c = o.geometry.boundingBox.getCenter(new V()).applyMatrix4(rel);
    debris.push({ key: g.key, pos: c, vol, col: o.material.vertexColors ? new THREE.Color(0x8a3a9a) : o.material.color.clone() });
    box.expandByObject(o);
  });
  const T = { groups: {}, debris: debris.sort((a, b) => b.vol - a.vol).slice(0, 28), box, ink: inkMat(.026 / S),
    legs: RIG.legs.length, arms: RIG.arms.length, wings: RIG.wings.length };
  for (const k in out) {
    const G2 = out[k], meshes = [];
    for (const b in G2.buckets) meshes.push({ geo: mergeList(G2.buckets[b], b === 'dbl'), mat: MATS[b], shadow: b !== 'glow' && b !== 'ghost' });
    if (G2.ink.length) meshes.push({ geo: mergeList(G2.ink), mat: T.ink, ink: true });
    T.groups[k] = { pos: G2.pos, meshes };
  }
  return (TEMPLATES[type] = T);
}
function buildWithRig(type) {
  // every builder starts with `root = new Group(), body = new Group(); root.add(body)`: catch the body as it is added
  const add0 = THREE.Group.prototype.add; let rootSeen = null;
  THREE.Group.prototype.add = function (...objs) { if (!RIG.body && objs[0] && objs[0].isGroup && !rootSeen) { rootSeen = this; RIG.body = objs[0]; } return add0.apply(this, objs); };
  let root;
  try { root = BUILDERS[type](EF); } finally { THREE.Group.prototype.add = add0; TGT = null; }
  return root;
}
// build one enemy into group b; returns what the Enemy class expects
function build(type, b) {
  const T = template(type), parts = {};
  const into = (grp, key) => { for (const m of T.groups[key].meshes) { const o = new THREE.Mesh(m.geo, m.mat); o.castShadow = !!m.shadow; if (m.ink) o.userData.ink = true; grp.add(o); } };
  into(b, 'body');
  const pivot = key => { const g = new THREE.Group(); g.position.copy(T.groups[key].pos); b.add(g); into(g, key); parts[key] = g; return g; };
  const legs = [...Array(T.legs)].map((_, i) => pivot('legs' + i)), arms = [...Array(T.arms)].map((_, i) => pivot('arms' + i)), wings = [...Array(T.wings)].map((_, i) => pivot('wings' + i));
  parts.body = b;
  const bx = T.box, h = bx.max.y, air = (ED[type] || {}).air;
  const size = bx.getSize(new V());
  return {
    legs, arms, wings: wings.length ? wings : undefined,
    cy: air ? 0 : h * .5, hb: h + .15,
    shell: [size.x * .8, size.y * .9, size.z * .9], shellY: (bx.min.y + bx.max.y) / 2,
    debris: T.debris.map(d => ({ p: parts[d.key], pos: d.pos, vol: d.vol, col: d.col })),
  };
}
return { build, template };
})();

for (const k in ED) BUILD[k] = b => EMODEL.build(k, b);
let enemies = [];
const barBgMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: .75, depthWrite: false });
const barMats = [0x5fd36a, 0xf2c94c, 0xeb5757].map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false }));
const bossBarMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, depthWrite: false });
const planeGeo = new THREE.PlaneGeometry(1, 1), planeGeoL = new THREE.PlaneGeometry(1, 1).translate(.5, 0, 0);
const _v = new V3(), _w = new V3(), _dir = new V3();
class Enemy {
  constructor(type, d, mul, path) {
    const def = this.def = ED[type]; this.type = type; this.path = path || PATHS[0]; this.healT = rand(.5, 2); this.sunder = 0; this.brittle = 0; this.freeze = 0; this.stun = 0; this.shockT = 0; this.shockDmg = 0; this.iceBrittle = false;
    this.maxHp = this.hp = def.hp * mul; this.d = d; this.alive = true;
    this.lat = rand(-.55, .55) * (type === 'boss' || type === 'gruk' ? .2 : 1); // roads are 1.5 tiles wide: spread across them
    this.g = new THREE.Group(); this.b = new THREE.Group(); this.g.add(this.b);
    const parts = BUILD[type](this.b);
    Object.assign(this, parts);
    this.parts = parts.debris || []; if (!parts.debris) this.b.traverse(o => { if (o.isMesh) this.parts.push({ p: o.parent, pos: o.position.clone(), vol: o.scale.x * o.scale.y * o.scale.z, col: o.material.color.clone() }); });
    mergeStatic(this.b, type + 'b');
    [...parts.legs, ...parts.arms, ...(parts.wings || [])].forEach((l, i) => mergeStatic(l, type + i));
    this.meshes = []; this.b.traverse(o => { if (o.isMesh && !o.userData.ink) { o.userData.m = o.material; this.meshes.push(o); } });
    this.shellM = P(this.g, 0, parts.shellY != null ? parts.shellY : parts.shell[1] / 2 + (type === 'flyer' ? -.3 : type === 'wraith' ? -.85 : 0), 0, ...parts.shell, 0, shellMat, false); this.shellM.visible = false;
    this.bar = new THREE.Group();
    const bw = def.bw;
    P(this.bar, 0, 0, 0, bw + .06, .14, 1, 0, barBgMat, false).geometry = planeGeo;
    this.fg = P(this.bar, -bw / 2, 0, .01, bw, .08, 1, 0, type === 'boss' || type === 'gruk' ? bossBarMat : barMats[0], false); this.fg.geometry = planeGeoL;
    this.bar.children[0].renderOrder = 5; this.fg.renderOrder = 6;
    scene.add(this.g, this.bar);
    this.heading = 0; this.anim = rand(0, 6); this.seed = rand(0, 100); this.slow = 0; this.slowF = 1; this.burn = 0;
    this.flash = 0; this.flashing = false; this.center = new V3(); this.lastStep = 0;
    this.g.scale.setScalar(ES); this.cy *= ES; this.hb *= ES;
    this.place(0, true);
  }
  place(dt, snap) {
    smoothPath(this.path, this.d, _v, _dir);
    _v.x += _dir.z * this.lat; _v.z -= _dir.x * this.lat;
    const g = this.g;
    g.position.x = _v.x; g.position.z = _v.z;
    g.position.y = this.def.air ? (this.type === 'wraith' ? 2.4 : 2.7) + Math.sin(game.time * 2.2 + this.seed) * .3 : groundY(_v.x, _v.z);
    const hd = this.fighting && this.faceT != null ? this.faceT : Math.atan2(_dir.x, _dir.z); // face the soldier while fighting, else the road
    this.heading = snap ? hd : lerpAngle(this.heading, hd, 1 - Math.exp(-7 * dt));
    g.rotation.y = this.heading;
    this.center.set(g.position.x, g.position.y + this.cy, g.position.z);
  }
  update(dt) {
    if (this.type === 'gruk') {
      if (this.slow > (this._ls || 0) + 1e-6) this.slow = (this._ls || 0) + (this.slow - (this._ls || 0)) * .5; // slows wear off twice as fast
      if (!this.roared && this.hp < this.maxHp * .5) { this.roared = true; for (const k of [1.6, 3.2]) spawnEnemy('rider', Math.min(this.d + k, this.path.len - 2), this.path); msg('Gruk roars! Boar Riders charge ahead.'); addShake(this.g.position, .25); }
    }
    if (this.type === 'rider' && !this.shrug && (this.slow > 0 || this.freeze > 0)) { this.shrug = true; this.slow = 0; this.freeze = 0; fxSparks(this.center, 0xffd060, 8, 3); }
    if (this.slow > 0) this.slow -= dt;
    if (this.type === 'gruk') this._ls = Math.max(0, this.slow);
    if (this.sunder > 0) { this.sunder -= dt; if (Math.random() < dt * 5) glow.spawn(this.center.x, this.center.y + .3, this.center.z, 0, .8, 0, .5, .08, 0xff4020, 0, F_SPIN, 1, 0x300000); }
    if (this.brittle > 0) { this.brittle -= dt; if (this.slow > 0 && Math.random() < dt * 6) glow.spawn(this.center.x + rand(-.3, .3), this.center.y + rand(0, .5), this.center.z + rand(-.3, .3), 0, .3, 0, .5, .08, 0x4a7aff, 0, F_SPIN, 1, 0x0a1a5a); }
    if (this.freeze > 0) this.freeze -= dt;
    if (this.stun > 0) { this.stun -= dt; if (Math.random() < dt * 8) glow.spawn(this.center.x + rand(-.3, .3), this.g.position.y + this.hb * .8, this.center.z + rand(-.3, .3), 0, .3, 0, .5, .09, 0xffe060, 0, F_SPIN, 1, 0x604000); }
    if (this.shockT > 0) this.shockT -= dt;
    if (this.type === 'sapper' && !this.planted) {
      if (this.plantT > 0) {
        this.plantT -= dt; if (Math.random() < dt * 14) glow.spawn(this.center.x, this.center.y + .3, this.center.z, rand(-.5, .5), 1, rand(-.5, .5), .3, .06, 0xffc040, 0, F_SPIN, 1, 0x803000);
        if (this.plantT <= 0) { this.planted = true; const t = this.plantOn; if (towers.includes(t)) { t.stunT = 5; fxExplosion(new V3(t.x, 1.3, t.z), .6); addShake(new V3(t.x, 1, t.z), .12); msg(`A sapper knocked out your ${TT[t.type].name}!`); } }
      } else for (const t of towers) if ((t.x - this.g.position.x) ** 2 + (t.z - this.g.position.z) ** 2 < 5) { this.plantT = .9; this.plantOn = t; break; }
    }
    const fighting = this.fighting = enemyCombat(this, dt);
    const held = this.freeze > 0 || this.stun > 0 || this.plantT > 0 || fighting;
    const bog = MAP.bog && !this.def.air && MAP.bog.some(([a, b]) => this.d > a * this.path.len && this.d < b * this.path.len) ? .7 : 1;
    const sp = held ? 0 : this.def.speed * (this.slow > 0 ? this.slowF : 1) * bog;
    this.d += sp * dt;
    if (this.d >= this.path.len - .3) { reachCastle(this); return; }
    this.place(dt);
    // animation
    this.anim += held ? 0 : dt * this.def.step * (this.slow > 0 ? this.slowF : 1);
    const s = Math.sin(this.anim), amp = this.type === 'boss' ? .4 : .7;
    if (this.legs.length) { this.legs[0].rotation.x = s * amp; this.legs[1].rotation.x = -s * amp; }
    if (this.legs.length > 3) { this.legs[2].rotation.x = -s * amp; this.legs[3].rotation.x = s * amp; }
    if (this.arms.length) { this.arms[0].rotation.x = -s * amp * .7; this.arms[1].rotation.x = s * amp * .7 - (this.type === 'boss' ? .3 : 0); }
    if (this.flinch > 0) this.flinch = Math.max(0, this.flinch - dt * 6); this.b.rotation.x = -(this.flinch || 0) * .3;
    if (this.swing > 0) { this.swing = Math.max(0, this.swing - dt * 3); if (this.arms.length) this.arms[0].rotation.x = -this.swing * 1.4; }
    if (this.wings) { const f = Math.sin(this.anim) * .55; this.wings[0].rotation.z = f; this.wings[1].rotation.z = -f; this.b.position.y = Math.cos(this.anim) * .06; }
    else this.b.position.y = Math.abs(Math.cos(this.anim)) * (this.type === 'runner' ? .08 : .05);
    if (this.type === 'boss') this.b.rotation.z = Math.sin(this.anim) * .05;
    if (this.type === 'wraith') { this.b.rotation.z = Math.sin(this.anim) * .12; if (Math.random() < dt * 8) glow.spawn(this.center.x + rand(-.2, .2), this.center.y - .6, this.center.z + rand(-.2, .2), 0, -.3, 0, .7, .08, 0xa8e0ff, 0, F_SPIN, 1, 0x102040); }
    if (this.type === 'shaman') {
      this.healT -= dt;
      if (this.healT <= 0) {
        this.healT = 2;
        let n = 0;
        for (const o of enemies) if (o.alive && o !== this && o.hp < o.maxHp && !(o.burn > 0 && skH('flame.ever')) && o.center.distanceToSquared(this.center) < 6.8) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * .08); n++; for (let k = 0; k < 5; k++) glow.spawn(o.center.x + rand(-.3, .3), o.center.y + rand(-.2, .4), o.center.z + rand(-.3, .3), 0, rand(.8, 1.6), 0, .7, .09, 0x6aff8a, 0, F_SPIN, 1, 0x0a4a1a); }
        if (n) for (let k = 0; k < 16; k++) { const a = k / 16 * 6.28; glow.spawn(this.center.x + Math.cos(a) * 1.2, this.g.position.y + .2, this.center.z + Math.sin(a) * 1.2, Math.cos(a) * 1.5, .5, Math.sin(a) * 1.5, .5, .1, 0x6aff8a, 0, F_SPIN, 1, 0x0a4a1a); }
      }
    }
    if ((this.type === 'brute' || this.type === 'boss' || this.type === 'golem' || this.type === 'gruk') && Math.floor(this.anim / Math.PI) !== this.lastStep) {
      this.lastStep = Math.floor(this.anim / Math.PI);
      const big = this.type === 'boss';
      fxDust(this.g.position, big ? 10 : 4, big ? .45 : .25);
      if (big) addShake(this.g.position, .18);
    }
    if (this.type === 'boss' && Math.random() < dt * 14) glow.spawn(this.center.x + rand(-.6, .6), this.center.y + rand(0, 1), this.center.z + rand(-.6, .6), rand(-.3, .3), rand(.6, 1.6), rand(-.3, .3), rand(.5, 1), rand(.06, .12), 0xff8a2a, 0, F_SPIN, 0, 0x501000);
    if (this.type === 'runner' && Math.random() < dt * 3) fxDust(this.g.position, 1, .15);
    // burning
    if (this.burn > 0) {
      this.burn -= dt; hurt(this, 7 * dt * game.dotMul, 'true', true);
      if (Math.random() < dt * 25) glow.spawn(this.center.x + rand(-.25, .25), this.center.y + rand(-.2, .4), this.center.z + rand(-.25, .25), 0, rand(1, 2), 0, rand(.3, .5), rand(.1, .2), FIRE1, -1, F_SPIN, 1, FIRE2);
    }
    if (!this.alive) return;
    this.shellM.visible = this.slow > 0 || this.freeze > 0;
    this.shellM.material = this.freeze > 0 ? frozenMat : shellMat;
    if (this.slow > 0 && Math.random() < dt * 6) glow.spawn(this.center.x + rand(-.3, .3), this.center.y + rand(0, .5), this.center.z + rand(-.3, .3), 0, -.4, 0, .8, .06, 0xbff4ff, 0, F_SPIN);
    // flash
    if (this.flash > 0) this.flash -= dt;
    const fl = this.flash > 0;
    if (fl !== this.flashing) { this.flashing = fl; for (const m of this.meshes) m.material = fl ? flashMat : m.userData.m; }
    // health bar
    this.bar.position.set(this.g.position.x, this.g.position.y + this.hb, this.g.position.z);
    this.bar.quaternion.copy(camera.quaternion);
    const f = Math.max(0, this.hp / this.maxHp);
    this.fg.scale.x = this.def.bw * f;
    if (this.type !== 'boss' && this.type !== 'gruk') this.fg.material = barMats[f > .6 ? 0 : f > .3 ? 1 : 2];
  }
  remove() { this.alive = false; scene.remove(this.g, this.bar); }
}
// kind: 'phys' (reduced by armour), 'magic' (reduced by magic resist) or 'true' (never reduced)
function hurt(e, amt, kind = 'true', quiet = false, pierce = 0) {
  if (!e.alive) return;
  if (kind === 'phys' && e.iceBrittle && e.freeze > 0) { pierce = Math.max(pierce, .5); e.iceBrittle = false; fxSparks(e.center, 0x9ad8ff, 8, 3); }
  let block = (kind === 'phys' ? e.def.armor : kind === 'magic' ? e.def.mr : 0) * (e.sunder > 0 ? .5 : 1) * (1 - pierce);
  if (block > 0 && e.burn > 0 && skH('flame.scorch')) block *= .85;
  if (block > 0 && e.hex > 0 && skH('drum.wither')) block = Math.max(0, block - .1);
  e.hp -= amt * (1 - block) * (e.brittle > 0 && e.slow > 0 ? 2 : 1) * (1 + (e.hex || 0)) * (e.markT > 0 ? 1.1 : 1);
  if (!quiet) { e.flash = .09; if (block >= .5 && Math.random() < .6) fxSparks(e.center, kind === 'phys' ? 0xb8c0cc : 0xc8a8ff, 3, 2); }
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.remove();
  if (e.shockT > 0 && e.shockDmg) { // Static Charge
    const c = e.center.clone(), dmg = e.shockDmg; e.shockDmg = 0;
    for (let k = 0; k < 4; k++) bolt(c, c.clone().add(new V3(rand(-1.8, 1.8), rand(-.4, .8), rand(-1.8, 1.8))), 0x9a7bff);
    for (const o of enemies) if (o.alive && o !== e && o.center.distanceToSquared(c) < 3.24) hurt(o, dmg, 'magic', true);
  }
  e.g.updateMatrixWorld(true);
  for (const pt of e.parts) {
    _w.copy(pt.pos); pt.p.localToWorld(_w);
    const vol = pt.vol;
    const n = clamp(Math.round(vol * 60), 1, e.type === 'boss' ? 8 : 5);
    const sz = clamp(Math.cbrt(vol / n), .06, .4);
    const col = pt.col;
    for (let i = 0; i < n; i++) debris.spawn(_w.x + rand(-.1, .1), _w.y + rand(-.1, .1), _w.z + rand(-.1, .1), rand(-2.5, 2.5), rand(2, 6), rand(-2.5, 2.5), rand(1.6, 2.6), sz, col, 15, F_BOUNCE, .2);
  }
  fxSparks(e.center, 0xfff0b0, 8, 4);
  fxSmoke(e.center, e.type === 'boss' ? 14 : 3, 0x6a6a6a, e.type === 'boss' ? .8 : .35);
  if (e.freeze > 0 && skH('frost.shatter') && e.type !== 'boss' && e.type !== 'gruk') { for (const o of enemies) if (o.alive && o !== e && o.center.distanceToSquared(e.center) < 2.25) hurt(o, e.maxHp * .3, 'magic', true); fxIce(e.center); }
  if (e.burn > 0 && skH('flame.wild')) for (const o of enemies) if (o.alive && o !== e && !o.def.air && o.center.distanceToSquared(e.center) < 2.25) { o.burn = Math.max(o.burn, 2); hurt(o, 5, 'true', true); }
  let reward = Math.round(e.def.reward * 1.6 * (1 + .05 * (game.wave - 1)) * (skH('kingdom.tax') ? 1.06 : 1));
  if (e.burn > 0 && skH('flame.ash')) reward += 1;
  if (e.hex > 0 && skH('drum.soul')) { reward += 2; if ((game.soulHeal || 0) < 10 && game.hp > 0) { game.soulHeal = (game.soulHeal || 0) + 1; game.hp = Math.min(game.maxHp, game.hp + 1); } }
  fxCoins(e.center, clamp(Math.round(reward / 2), 1, e.type === 'boss' ? 26 : 8));
  if (e.type === 'boss') { fxExplosion(e.center, 2); msg('The Warlord has fallen!'); }
  game.gold += reward; game.earned = (game.earned || 0) + reward; game.defeated++;
}
function reachCastle(e) {
  e.remove();
  if (game.state !== 'play') return;
  game.hp = Math.max(0, game.hp - Math.round(e.def.dmg * eDmgMul()));
  if (skH('kingdom.stand') && !game.standUsed && game.hp > 0 && game.hp <= 25) { game.standUsed = true; game.standT = 10; msg('Last Stand! Every tower fires 30% faster for 10 s'); }
  const p = new V3(CX + rand(-1.5, 1.5), rand(2, 4), CZ - 3.4);
  fxExplosion(p, e.type === 'boss' ? 2 : .6);
  for (let i = 0; i < 10; i++) smoke.spawn(p.x, p.y, p.z, rand(-1, 1), rand(.5, 2), rand(-1, 1), rand(1, 1.8), rand(.3, .5), 0x6a2a8a, 0, F_GROW | F_SPIN, 1, 0x3a2a4a);
  updateCastleDamage();
  if (game.hp <= 0) castleFalls();
  else if (e.type === 'boss') msg('The Warlord smashed the gate!');
}
function removeCastleBlock(i, big) {
  if (!castleBlocks[i].on) return;
  setBlock(i, false); castleRemoved++;
  const b = castleBlocks[i];
  const n = big ? 4 : 3;
  for (let k = 0; k < n; k++) debris.spawn(b.x + rand(-.3, .3), b.y + b.sy / 2, b.z + rand(-.3, .3), rand(-3, 3), rand(2, 6), rand(-3, 3), rand(1.8, 3), rand(.18, .32), b.c, 15, F_BOUNCE, .1);
  fxSmoke(new V3(b.x, b.y, b.z), 2, 0x8a8478, .4);
  if (castleFires.length < 9 && Math.random() < .35) castleFires.push(new V3(b.x, b.y, b.z));
}
function updateCastleDamage() {
  const N = castleBlocks.length;
  const target = Math.floor(N * (1 - game.hp / game.maxHp) * .5);
  let k = 0;
  while (castleRemoved < target && k < castleOrder.length) { removeCastleBlock(castleOrder[k], false); k++; }
}

// ================================================================ towers
const TT = {
  arrow: { name: 'Archer Tower', cost: 60, range: 6.6, rate: .6, dmg: 10, air: true, col: 0x3f8f3f, dps: 17 },
  cannon: { name: 'Cannon', cost: 100, range: 6.4, rate: 2.0, dmg: 34, air: false, splash: 1.8, col: 0x4a4f5a, dps: 34 },
  frost: { name: 'Frost Spire', cost: 80, range: 5.6, rate: 1.05, dmg: 7, air: true, col: 0x5fd0ff, dps: 22 },
  tesla: { name: 'Tesla Coil', cost: 125, range: 5.5, rate: 1.4, dmg: 24, air: true, chain: 3, col: 0x9a7bff, dps: 40 },
  flame: { name: 'Flame Tower', cost: 105, range: 3.9, rate: .1, dmg: 3.0, air: false, col: 0xff6a20, dps: 52 },
  barracks: { name: 'Barracks', cost: 90, range: 2.5, rate: 1, dmg: 4, air: false, col: 0x2a5ad0, dps: 12 },
  drum: { name: 'War Drum', cost: 110, range: 5, rate: 1, dmg: 0, air: true, col: 0xc83a2a, dps: 0 },
};
const TYPES = Object.keys(TT);

const DTYPE = { arrow: 'phys', cannon: 'phys', frost: 'magic', tesla: 'magic', flame: 'true', barracks: 'phys', drum: 'sup' };
const DNAME = { phys: 'Physical', magic: 'Magic', true: 'True', sup: 'Support' };
const DCOL = { phys: '#e8c890', magic: '#b89aff', true: '#ff9a6a', sup: '#f0c860' };
// level 4: after level 3, each tower picks one of two specialisations
const SPEC = {
  arrow: {
    a: { name: 'Longbow', now: 'One marksman with a huge bow fires slow, heavy shots. Aims at the strongest enemy.', short: 'Heavy shots at the strongest enemy', cost: 220, desc: 'One marksman with a huge bow: range 11, 2.5x damage, slower shots. Aims at the strongest enemy.', st: s => ({ dmg: s.dmg * 2.5, range: 11, rate: s.rate * 1.6, dps: s.dps * 1.6 }) },
    b: { name: 'Volley', now: 'Archers shoot different enemies with every volley.', short: 'Several archers fire at different targets', cost: 220, desc: 'Several archers shoot different enemies with every volley.', st: s => ({ dmg: s.dmg * 1.1, rate: s.rate * .85, dps: s.dps * 2.6 }) } },
  cannon: {
    a: { name: 'Siege Mortar', now: 'A huge mortar whose slow blasts punch through armor. Cannot hit enemies within 3 tiles.', short: 'Armor-piercing blasts; cannot fire within 3 tiles', cost: 300, desc: 'A huge mortar: range 12, splash radius 3, 1.3x damage that ignores 40% of armor, slower fire. Cannot hit enemies within 3 tiles.', st: s => ({ dmg: s.dmg * 1.3, range: 12, rate: s.rate * 1.4, dps: s.dps * 1.25 }) },
    b: { name: 'Scattergun', now: 'A flared barrel fires an instant cone of shot that hits every ground enemy in a 70 degree cone.', short: 'Short-range blasts; best beside a bend', cost: 280, desc: 'A flared barrel fires an instant cone of shot: range 4.5, hits every ground enemy in a 70 degree cone.', st: s => ({ dmg: s.dmg * 1.3, range: 4.5, rate: s.rate * .7, dps: s.dps * 2 }) } },
  frost: {
    a: { name: 'Deep Freeze', now: 'Heavy shards aimed at the strongest enemy slow it to 25% speed.', short: 'Holds one dangerous enemy in place', cost: 240, desc: 'Heavy shards aimed at the strongest enemy slow it to 25% speed for 3 s.', st: s => ({ dmg: s.dmg * 1.4, dps: s.dps * 1.05 }) },
    b: { name: 'Glacier Field', now: 'Shards burst on impact and slow nearby enemies to 45% speed.', short: 'Slows groups across a stretch of road', cost: 260, desc: 'Shards burst on impact and slow every enemy within 1.6 tiles to 45% speed.', st: s => ({ dps: s.dps * 1.6 }) } },
  tesla: {
    a: { name: 'Storm', now: 'Lightning chains through crowds and loses only 15% damage per jump.', short: 'Lightning chains through crowds', cost: 340, desc: 'Lightning chains to 8 enemies and loses only 15% damage per jump.', st: s => ({ dmg: s.dmg * 1.15, dps: s.dps * 1.7 }) },
    b: { name: 'Overload', now: 'A constant beam on one enemy. Its damage builds the longer it holds the same target.', short: 'A beam ramps up while it holds one target', cost: 340, desc: 'A constant beam on one enemy. Its damage builds up to 3x over 3 seconds while it holds the same target.', st: s => ({ dmg: s.dmg * .21, rate: .12, dps: s.dps * 1.3 }) } },
  flame: {
    a: { name: 'Fireline', now: 'Leaves pools of burning napalm on the path that burn anything walking through.', short: 'Controls a stretch of ground with lingering fire', cost: 300, desc: 'Leaves pools of burning napalm on the path for 4 s that burn anything walking through.', st: s => ({ dmg: s.dmg * 1.1, dps: s.dps * 1.6 }) },
    b: { name: 'Inferno', now: 'A narrow, white-hot jet on one enemy. Aims at the strongest enemy.', short: 'Burns down one durable target', cost: 300, desc: 'A narrow, white-hot jet on one enemy: 2.2x damage, longer range. Aims at the strongest enemy.', st: s => ({ dmg: s.dmg * 2.2, range: s.range + .8, dps: s.dps * 1.1 }) } },
  barracks: {
    a: { name: 'Paladins', now: 'Holy knights who heal between fights; every fourth hit is a holy strike.', short: 'Tough healers with holy strikes', cost: 260, desc: 'Three Paladins: 275 health, 35% armor and 30% magic resist. They heal 5% health per second out of combat (other soldiers 2%), and every fourth hit is a holy strike for 40 true damage.', st: s => ({}) },
    b: { name: 'Rangers', now: 'Three rangers shoot arrows and hit flyers. Rally them off the road for Overwatch.', short: 'Archers that also hit flyers', cost: 250, desc: 'Three Rangers shoot arrows from up to 4 tiles away, hitting ground and air. Rally them on the road to block, or off the road for Overwatch: shoot only, never block.', st: s => ({}) } },
  drum: {
    a: { name: 'War Horn', now: 'A great horn: boosted towers fire faster and also reach further.', short: 'Boosted towers reach further', cost: 280, desc: 'Towers within 6 tiles fire 30% faster and get +20% range.', st: s => ({}) },
    b: { name: 'Hex Totem', now: 'A cursed totem: enemies inside its radius take extra damage from everything.', short: 'Enemies nearby take more damage', cost: 280, desc: 'Towers within 6 tiles fire 30% faster, and enemies inside the radius take 15% more damage from every source, soldiers included.', st: s => ({}) } },
};
// each specialisation has 3 ranks: every rank adds 30% damage, 0.4 range and fires 8% faster, plus one extra per branch
const specStat = (type, k, rank = 1) => {
  if (type === 'barracks') return barrAsStat(barrStat(k, rank));
  if (type === 'drum') return drumAsStat(drumStat(k, rank));
  const s = tStat(type, 3, false); Object.assign(s, SPEC[type][k].st(s));
  const r = rank - 1; s.dmg *= Math.pow(1.3, r); s.range += .4 * r; s.rate *= Math.pow(.92, r); s.dps *= Math.pow(1.3 / .92, r);
  return skApply(type, s, k);
};
const rankCost = (type, k, rank) => Math.round(SPEC[type][k].cost * (rank === 2 ? .8 : 1.1) / 10) * 10; // cost to reach rank 2 or 3
const RANKX = {
  arrow: { a: r => '', b: r => `${2 + r} archers, each at a different enemy.` },
  cannon: { a: r => `Splash radius ${(2.8 + .2 * r).toFixed(1)}. Ignores ${Math.round(mortarPierce(r) * 100)}% of armor.`, b: r => '' },
  frost: { a: r => `Slow lasts ${2 + r} s.`, b: r => `Burst radius ${(1.3 + .3 * r).toFixed(1)} tiles.` },
  tesla: { a: r => `Chains to ${7 + r} enemies.`, b: r => `Beam builds up to ${overloadCap(r)}x.` },
  flame: { a: r => `Pools burn for ${3 + r} s.`, b: r => '' },
  barracks: { a: r => `Paladins have ${barrStat('a', r).hp} health.`, b: r => `Rangers hit for ${barrStat('b', r).dmg} every ${barrStat('b', r).rate}s.` },
  drum: { a: r => `Towers fire ${dpct(drumStat('a', r).haste)} faster with +${dpct(drumStat('a', r).rngB)} range.`, b: r => `Towers fire ${dpct(drumStat('b', r).haste)} faster; enemies take +${dpct(drumStat('b', r).hex)} damage.` },
};
const rankNote = (type, k, r) => `Rank ${r}: ${RANKX[type][k](r) || 'stronger shots.'}`;
const towerName = t => t.spec ? `${SPEC[t.type][t.spec].name} (${TT[t.type].name})` : TT[t.type].name;
let patches = []; // burning ground
let icePatches = [], shrapnel = [], charges = [];
const iceMat = new THREE.MeshBasicMaterial({ color: 0xd8f4ff, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide });
const iceGeo = new THREE.CircleGeometry(1.1, 20).rotateX(-Math.PI / 2);
const chargeMat = ME(0xff3020, 1.5);
function freezeEnemy(o, dur, tw) { if (!o.alive) return; o.freeze = Math.max(o.freeze, dur); if (tw && tw.ab.brittleice) o.iceBrittle = true; fxIce(o.center); }
const UPC = { arrow: [70, 110], cannon: [120, 170], frost: [95, 135], tesla: [150, 210], flame: [125, 175], barracks: [110, 160], drum: [120, 170] };
const upCost = t => UPC[t.type][t.lvl - 1];
const SHORT = { arrow: 'Archer', cannon: 'Cannon', frost: 'Frost', tesla: 'Tesla', flame: 'Flame', barracks: 'Barracks', drum: 'War Drum' };
const NOTE = {
  arrow: l => l >= 3 ? 'Fires a second arrow at another target. Hits ground and air.' : 'Fast, cheap, hits ground and air. Lv 3 fires two arrows.',
  cannon: l => `Splash radius ${(1.8 + .25 * (l - 1)).toFixed(2)}. Ground only.${l >= 3 ? ' Twin barrels.' : ''}`,
  frost: l => `Slows to ${Math.round((.55 - .07 * l) * 100)}% speed for ${2 + .5 * l} s.${l >= 2 ? ' Also slows nearby enemies.' : ''}`,
  tesla: l => `Chains to ${2 + l} enemies, 28% less damage per jump.`,
  flame: l => 'Hits everything in its cone and sets enemies burning. Ground only.',
  barracks: l => `${BARR[l].n} soldiers with ${BARR[l].hp} health block the road and fight. Tap the flag button to move their rally point.`,
  drum: l => `Towers within ${DRUM[l].rad} tiles fire ${dpct(DRUM[l].haste)} faster. Deals no damage itself.`,
};
const TS = 1.45; // tower scale on the 2x2 plots
const auraMat = new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: .14, depthWrite: false, side: THREE.DoubleSide });
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: .45, depthWrite: false });
let towers = [];

let spots = PLOTS.map(p => ({ ...p, used: false, block: 0, cov: {} }));
function coverage(s, r) {
  const k = r.toFixed(1); if (s.cov[k] !== undefined) return s.cov[k];
  let c = 0; const r2 = r * r;
  for (const p of SAMPLES) { const dx = p.x - s.x, dz = p.z - s.z; if (dx * dx + dz * dz < r2) c += p.w; }
  return s.cov[k] = c;
}
// ---- skill tree effects. SKILL_ACTIVE is set for battles you play; SKILL_VIEW while the almanac draws
let SKILL_ACTIVE = null, SKILL_VIEW = null;
const SKX = () => SKILL_VIEW || SKILL_ACTIVE;
const skH = id => { const x = SKX(); return !!(x && x.has.has(id)); };
function skCompute(s) { const has = new Set(), tr = (s && s.tree) || {}; for (const k in tr) for (const id in tr[k]) if (tr[k][id]) has.add(k + '.' + id); return { has }; }
// [tower, stat, amount, only for this specialisation]
const SK_STAT = { 'arrow.root': ['arrow', 'dmg', .05], 'arrow.tips': ['arrow', 'dmg', .08], 'arrow.draw': ['arrow', 'rate', .1], 'arrow.eye': ['arrow', 'rng', .08], 'arrow.guild': ['arrow', 'rate', .1],
  'cannon.root': ['cannon', 'dmg', .05], 'cannon.heavy': ['cannon', 'dmg', .08], 'cannon.reload': ['cannon', 'rate', .1], 'cannon.grape': ['cannon', 'dmg', .15, 'b'],
  'frost.hoar': ['frost', 'dmg', .1], 'frost.lens': ['frost', 'rng', .1],
  'tesla.root': ['tesla', 'dmg', .05], 'tesla.ground': ['tesla', 'rng', .08], 'tesla.cap': ['tesla', 'rate', .1],
  'flame.root': ['flame', 'dmg', .05], 'flame.bellows': ['flame', 'rng', .1], 'flame.valve': ['flame', 'rate', .1] };
function skMod(type, stat, spec) { const x = SKX(); if (!x) return 0; let v = 0; for (const id in SK_STAT) { const [t, st, val, sp] = SK_STAT[id]; if (t === type && st === stat && (!sp || sp === spec) && x.has.has(id)) v += val; } return v; }
function skApply(type, s, spec) { const d = skMod(type, 'dmg', spec), r = skMod(type, 'rng', spec), q = skMod(type, 'rate', spec); if (d || r || q) { s.dmg *= 1 + d; s.range *= 1 + r; s.rate /= 1 + q; s.dps *= (1 + d) * (1 + q); } return s; }
const sellRate = () => skH('kingdom.treasury') ? .9 : skH('kingdom.qm') ? .8 : .7;
const mortarDead = () => skH('cannon.mortar') ? 2 : MORTAR_DEAD;
const inDrum = (p, spec) => towers.some(t => t.type === 'drum' && t.ds && (!spec || t.spec === spec) && (t.x - p.x) ** 2 + (t.z - p.z) ** 2 <= t.ds.rad * t.ds.rad);
const tStat = (type, lvl, sk = true) => {
  if (type === 'barracks') return barrAsStat(barrStat(Math.min(lvl, 3)));
  if (type === 'drum') return drumAsStat(drumStat(Math.min(lvl, 3)));
  const d = TT[type];
  const s = { dmg: d.dmg * Math.pow(1.7, lvl - 1), range: d.range + .7 * (lvl - 1), rate: d.rate * Math.pow(.86, lvl - 1), dps: d.dps * Math.pow(1.7, lvl - 1) / Math.pow(.86, lvl - 1) };
  return sk ? skApply(type, s, null) : s;
};
// ---------------------------------------------------------------- detailed Archer Tower model
// Non-box parts use their own (non-"plain") materials so mergeStatic leaves them alone.
const msCache = {};
const MS = (c, e = 0) => { const k = c + '_' + e; return msCache[k] || (msCache[k] = new THREE.MeshLambertMaterial({ color: c, emissive: e ? c : 0x000000, emissiveIntensity: e, flatShading: true })); };
const AG = {
  eave: new THREE.CylinderGeometry(1, 1, 1, 4, 1).rotateY(Math.PI / 4),
  roof1: new THREE.CylinderGeometry(.5, 1, 1, 4, 1).rotateY(Math.PI / 4),
  roof2: new THREE.CylinderGeometry(.27, 1, 1, 4, 1).rotateY(Math.PI / 4),
  oct: new THREE.OctahedronGeometry(1, 0),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cone: new THREE.ConeGeometry(1, 1, 10),
  sph: new THREE.SphereGeometry(1, 12, 8),
  bow: new THREE.TorusGeometry(1, .09, 5, 14, Math.PI),
};
const _zf = new V3(0, 0, 1);
// a box stretched between two points (legs, braces, ladder rails)
function beam(par, a, b, w, d, c) {
  const m = new THREE.Mesh(boxGeo, M(c)), v = new V3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = v.length();
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(_zf, v.normalize()); m.scale.set(w, d, len); m.castShadow = true;
  par.add(m); return m;
}
function geo(par, g, mat, x, y, z, sx, sy, sz, shadow = true) {
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = shadow; par.add(m); return m;
}
const AW = { wood: 0xd9832c, dark: 0xa8581c, light: 0xeba04a, stone: 0xdcc89a, stone2: 0xc8b182, bolt: 0xa4a8b0, gold: 0xf2b62e };
const AROOF = { 1: 0x3f8f2c, 2: 0xc8402a, 3: 0x2a62d8, a: 0x2f8a2a, b: 0x8a2a9a };
// one hooded archer facing +z, drawing a bow
function hoodedArcher(par, x, z, big) {
  const a = new THREE.Group(); a.position.set(x, -.06, z); a.scale.setScalar(1.55); par.add(a);
  const cloak = MS(big ? 0x2a7a2a : 0x3a8a2a), skin = MS(0xf0c49a), wood = MS(0x8a4a1e);
  geo(a, AG.cyl, cloak, 0, .2, 0, .11, .3, .1);                       // body
  geo(a, AG.sph, cloak, 0, .4, -.01, .12, .12, .12);                    // hood
  geo(a, AG.cone, cloak, 0, .53, -.05, .07, .14, .07).rotation.x = -.5; // hood tip
  geo(a, boxGeo, skin, 0, .39, .085, .12, .1, .04, false);              // face
  geo(a, boxGeo, MS(0x2a1a10), -.03, .4, .107, .025, .02, .01, false); geo(a, boxGeo, MS(0x2a1a10), .03, .4, .107, .025, .02, .01, false);
  geo(a, boxGeo, cloak, .07, .29, .1, .06, .06, .18, false);            // drawing arm
  geo(a, boxGeo, skin, .02, .29, .2, .06, .06, .06, false);             // hand
  const bowR = big ? .34 : .16;
  const bow = geo(a, AG.bow, big ? MS(AW.gold, .15) : wood, -.02, .3, .22, bowR, bowR, big ? 1.6 : 1); bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
  if (big) for (const s of [-1, 1]) geo(a, boxGeo, MS(0x2a8a3a), -.02, .3 + s * bowR * .55, .22 + bowR * .55, .03, .1, .03, false);
  geo(a, AG.cyl, MS(0xe8e0d0), .02, .3, .22, .008, big ? .5 : .32, .008, false).rotation.x = Math.PI / 2; // arrow
  geo(a, boxGeo, wood, -.06, .32, -.1, .07, .2, .07);                   // quiver
  geo(a, boxGeo, MS(0xf2f0e8), -.06, .45, -.1, .06, .06, .06, false);   // fletching
  return a;
}
function archerModel(t, g) {
  const L = Math.min(t.lvl, 3), sp = t.spec, trim = !!sp;
  // stone base and leg pedestals
  P(g, 0, .03, 0, 1.16, .06, 1.16, 0xb8a47a);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, sx * .29, .15, sz * .29, .54, .2, .54, vary(sx * sz > 0 ? AW.stone : AW.stone2, .03));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, sx * .38, .29, sz * .38, .26, .1, .26, vary(AW.stone, .03));
  // splayed legs
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) beam(g, [sx * .4, .32, sz * .4], [sx * .3, 1.6, sz * .3], .22, .22, AW.wood);
  // cross braces on each side and a bolted horizontal brace on the front
  for (const [ax, az, bx, bz] of [[-1, 1, 1, 1], [1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1]]) {
    beam(g, [ax * .35, .7, az * .35], [bx * .31, 1.42, bz * .31], .07, .07, AW.dark);
    beam(g, [bx * .35, .7, bz * .35], [ax * .31, 1.42, az * .31], .07, .07, AW.dark);
  }
  beam(g, [.02, .98, .37], [.42, 1.1, .3], .1, .12, AW.light);
  P(g, .14, 1.02, .43, .05, .05, .03, AW.bolt); P(g, .36, 1.08, .4, .05, .05, .03, AW.bolt);
  // ladder up the front
  for (const x of [-.3, -.08]) beam(g, [x, .3, .5], [x * .9, 1.58, .4], .05, .05, AW.light);
  for (let k = 0; k < 5; k++) { const f = (k + .5) / 5, z = lerp(.5, .4, f); P(g, -.19 * (1 - f * .05), lerp(.3, 1.58, f), z + .02, .24, .045, .06, AW.light); }
  // platform, parapet and bolted corner posts
  P(g, 0, 1.6, 0, 1.0, .08, 1.0, AW.dark);
  for (const [x, z, sx, sz] of [[0, .48, .9, .13], [0, -.48, .9, .13], [.48, 0, .13, .9], [-.48, 0, .13, .9]]) { P(g, x, 1.82, z, sx, .36, sz, AW.wood); P(g, x * 1.03, 1.66, z * 1.03, sx === .13 ? .14 : sx, .07, sz === .13 ? .14 : sz, AW.dark); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    P(g, sx * .5, 1.82, sz * .5, .25, .5, .25, AW.light);
    P(g, sx * .5, 1.74, sz * .63, .07, .07, .02, AW.bolt); P(g, sx * .63, 1.74, sz * .5, .02, .07, .07, AW.bolt);
    if (L >= 2) { P(g, sx * .5, 1.94, sz * .63, .13, .13, .02, 0x6a6a72); P(g, sx * .5, 1.94, sz * .643, .055, .055, .02, AW.bolt); }
  }
  // posts and brackets holding the roof
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    P(g, sx * .43, 2.27, sz * .43, .1, .54, .1, AW.wood);
    beam(g, [sx * .43, 2.3, sz * .43], [sx * .43, 2.5, sz * .2], .05, .05, AW.dark); beam(g, [sx * .43, 2.3, sz * .43], [sx * .2, 2.5, sz * .43], .05, .05, AW.dark);
  }
  for (const [x, z, sx, sz] of [[0, .43, .96, .08], [0, -.43, .96, .08], [.43, 0, .08, .96], [-.43, 0, .08, .96]]) P(g, x, 2.52, z, sx, .08, sz, AW.dark);
  // two-tier hipped roof
  const rc = sp ? AROOF[sp] : AROOF[L], rm = MS(rc), rd = MS(new THREE.Color(rc).multiplyScalar(.75).getHex());
  geo(g, AG.eave, rd, 0, 2.57, 0, 1.12, .1, 1.12);
  geo(g, AG.roof1, rm, 0, 2.82, 0, 1.1, .42, 1.1);
  geo(g, AG.eave, rd, 0, 3.0, 0, .8, .07, .8);
  geo(g, AG.roof2, rm, 0, 3.22, 0, .8, .42, .8);
  // shingle seams: thin dark ribs running down each slope
  for (let s = 0; s < 4; s++) for (const f of [-.5, 0, .5]) {
    const ang = s * Math.PI / 2, ux = Math.sin(ang), uz = Math.cos(ang), px = Math.cos(ang), pz = -Math.sin(ang);
    beam(g, [ux * .4 + px * f * .4, 3.0, uz * .4 + pz * f * .4], [ux * .78 + px * f * .78, 2.64, uz * .78 + pz * f * .78], .035, .035, new THREE.Color(rc).multiplyScalar(.6).getHex());
  }
  if (trim) for (const [y, h] of [[2.55, .8], [2.98, .57]]) for (const [x, z, sx, sz] of [[0, h, h * 2, .05], [0, -h, h * 2, .05], [h, 0, .05, h * 2], [-h, 0, .05, h * 2]]) geo(g, boxGeo, MS(AW.gold, .2), x, y, z, sx, .05, sz, false);
  // gold cap, finial and flag
  geo(g, boxGeo, MS(AW.gold, .15), 0, 3.47, 0, .32, .1, .32);
  geo(g, AG.oct, MS(AW.gold, .2), 0, 3.68, 0, .14, .22, .14);
  if (L >= 2 || sp) {
    const fx = sp === 'a' ? .02 : .15, big = sp === 'a';
    geo(g, AG.cyl, MS(0x8a6a3a), fx + .1, 3.75, 0, .018, big ? .7 : .5, .018);
    geo(g, AG.sph, MS(AW.gold, .2), fx + .1, big ? 4.1 : 4.0, 0, .03, .03, .03, false);
    t.flag = geo(g, boxGeo, MS(0x3a9a2a), fx + .1 + (big ? .32 : .22), big ? 3.95 : 3.9, 0, big ? .62 : .42, big ? .24 : .18, .025);
    if (big) geo(g, boxGeo, MS(AW.gold, .2), fx + .42, 3.82, 0, .62, .03, .027, false);
  } else t.flag = null;
  // archers ride the head, which turns toward the target
  t.head.position.set(0, 1.64, 0);
  const n = sp === 'b' ? 3 : sp === 'a' ? 1 : L >= 3 ? 2 : 1;
  const xs = n === 3 ? [-.27, 0, .27] : n === 2 ? [-.19, .19] : [0];
  xs.forEach(x => hoodedArcher(t.head, x, n === 3 && x === 0 ? .05 : 0, sp === 'a'));
  t.muzzle.position.set(0, .45, .45);
  t.top = 3.3;
}
// ---------------------------------------------------------------- detailed Cannon model
const CG = {
  oct: new THREE.CylinderGeometry(1, 1, 1, 8).rotateY(Math.PI / 8).rotateX(Math.PI / 2),       // octagonal prism along z
  flare: new THREE.CylinderGeometry(1, .5, 1, 8).rotateY(Math.PI / 8).rotateX(Math.PI / 2),    // widens toward +z
  taper: new THREE.CylinderGeometry(1, .82, 1, 8).rotateY(Math.PI / 8).rotateX(Math.PI / 2),
  wheel: new THREE.CylinderGeometry(1, 1, 1, 10).rotateY(Math.PI / 10).rotateZ(Math.PI / 2),   // axis along x
  hex: new THREE.CylinderGeometry(1, 1, 1, 6).rotateZ(Math.PI / 2),
  hexY: new THREE.CylinderGeometry(1, 1, 1, 6),
  pyr: new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4),
};
const CW = { wood: 0xc8702c, dark: 0x9a5224, light: 0xe08a3a, wheel: 0x8a4424, wheelIn: 0x5e2c18, iron: 0x4a4672, ironD: 0x3a3660, rim: 0x8c88a8, bore: 0x1c1430, gold: 0xf0b02a, sand: 0xdcbf86, sand2: 0xc9aa70, slate: 0x6c6a8c, slate2: 0x5e5c7e, pale: 0xc9c5c0 };
function cannonBarrel(bp, x, R, kind) {
  const iron = MS(CW.iron), gold = MS(CW.gold, .15), rim = MS(CW.rim), bore = MS(CW.bore);
  let front;
  if (kind === 'mortar') {
    geo(bp, CG.taper, iron, x, 0, .05, R, R, .7);
    geo(bp, CG.oct, rim, x, 0, .5, R + .08, R + .08, .26); geo(bp, CG.oct, bore, x, 0, .5, R - .03, R - .03, .27, false);
    geo(bp, CG.oct, gold, x, 0, .3, R + .03, R + .03, .1); geo(bp, CG.oct, gold, x, 0, -.12, R * .86 + .03, R * .86 + .03, .08);
    for (const s of [-1, 1]) geo(bp, AG.sph, gold, x + s * (R + .05), 0, .3, .04, .04, .04, false);
    geo(bp, CG.oct, MS(CW.ironD), x, 0, -.33, R * .7, R * .7, .1);
    front = .64;
  } else if (kind === 'scatter') {
    geo(bp, CG.oct, iron, x, 0, -.18, R, R, .62);
    geo(bp, CG.flare, iron, x, 0, .32, R * 2.05, R * 2.05, .5);
    geo(bp, CG.oct, gold, x, 0, .62, R * 2.3, R * 2.3, .14); geo(bp, CG.flare, bore, x, 0, .58, R * 1.85, R * 1.85, .25, false);
    for (const z of [-.02, -.36]) { geo(bp, CG.oct, gold, x, 0, z, R + .03, R + .03, .09); geo(bp, AG.sph, gold, x + R + .04, 0, z, .035, .035, .035, false); }
    geo(bp, CG.oct, MS(CW.ironD), x, 0, -.52, R * .78, R * .78, .08);
    front = .7;
  } else {
    geo(bp, CG.oct, iron, x, 0, .05, R, R, 1.0);
    geo(bp, CG.oct, rim, x, 0, .58, R + .06, R + .06, .2); geo(bp, CG.oct, bore, x, 0, .6, R - .07, R - .07, .2, false);
    for (const z of [.2, -.28]) { geo(bp, CG.oct, gold, x, 0, z, R + .03, R + .03, .1); for (const s of [-1, 1]) geo(bp, AG.sph, gold, x + s * (R + .04), .02, z, .035, .035, .035, false); }
    geo(bp, CG.oct, MS(CW.ironD), x, 0, -.48, R * .82, R * .82, .06);
    front = .7;
  }
  // vent knob on top at the rear
  const kz = kind === 'mortar' ? -.2 : kind === 'scatter' ? -.42 : -.38, kr = kind === 'mortar' ? R * .86 : R;
  geo(bp, AG.cyl, gold, x, kr + .03, kz, .035, .08, .035); geo(bp, AG.cyl, gold, x, kr + .08, kz, .06, .04, .06);
  return front;
}
function cannonModel(t, g) {
  const L = Math.min(t.lvl, 3), sp = t.spec, twin = !sp && L >= 3;
  // sandstone slab, four cut tiles
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    P(g, sx * .29, .05, sz * .29, .57, .1, .57, vary(sx * sz > 0 ? CW.sand : CW.sand2, .03));
    P(g, sx * .28, .11, sz * .28, .51, .04, .51, vary(CW.sand, .03));
  }
  // dark stone plinth from level 2
  let top = .13;
  if (L >= 2 || sp) {
    const y = .25, h = .24;
    for (let i = -1; i <= 1; i++) for (const [ax, az] of [[1, 0], [0, 1]]) for (const s of [-1, 1]) {
      const cx = ax ? s * .43 : i * .29, cz = az ? s * .43 : i * .29;
      if (Math.abs(i) === 1 && (ax ? Math.abs(cz) : Math.abs(cx)) > .25) continue;
      P(g, cx, y, cz, ax ? .14 : .28, h, az ? .14 : .28, vary(i % 2 ? CW.slate : CW.slate2, .03));
    }
    P(g, 0, y - .01, 0, .78, h - .02, .78, CW.slate2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      P(g, sx * .43, y, sz * .43, .2, h, .2, vary(CW.pale, .03));
      if (sp === 'a') geo(g, CG.pyr, MS(CW.pale), sx * .43, y + h / 2 + .06, sz * .43, .16, .12, .16);
      else if (twin) for (const [dx, dz] of [[.06, -.06], [-.06, .06]]) P(g, sx * (.43 + dx), y + h / 2 + .05, sz * (.43 + dz), .08, .1, .08, CW.pale);
    }
    // gold studs on each face (an octagonal plaque on the mortar)
    for (let f = 0; f < 4; f++) {
      const a = f * Math.PI / 2, nx = Math.sin(a), nz = Math.cos(a), px = Math.cos(a), pz = -Math.sin(a);
      if (sp === 'a') { const m = geo(g, CG.hexY, MS(CW.pale), nx * .505, y, nz * .505, .1, .02, .1); m.rotation.order = 'YXZ'; m.rotation.set(Math.PI / 2, a, 0);
        const k = geo(g, CG.hexY, MS(CW.gold, .15), nx * .52, y, nz * .52, .045, .03, .045); k.rotation.order = 'YXZ'; k.rotation.set(Math.PI / 2, a, 0); }
      else for (const o of (twin ? [-.15, 0, .15] : [-.1, .1])) geo(g, twin ? AG.sph : boxGeo, MS(CW.gold, .15), nx * .505 + px * o, y, nz * .505 + pz * o, .035, .035, .035, false).rotation.y = a;
    }
    top = y + h / 2;
  }
  // carriage, wheels and barrel turn together
  const h = t.head; h.position.set(0, top, 0);
  const R = sp === 'a' ? .3 : sp === 'b' ? .19 : twin ? .19 : .24;
  const xs = twin ? [-.21, .21] : [0];
  const cx = (twin ? .21 : 0) + R + .1;
  const wood = c => vary(c, .03);
  for (const s of [-1, 1]) {
    const x = s * cx;
    P(h, x, .3, .1, .12, .5, .5, wood(CW.wood));                 // tall front cheek
    P(h, x, .22, -.32, .12, .34, .42, wood(CW.dark));             // low rear step
    beam(h, [x, .55, .32], [x, .45, .38], .12, .14, CW.light);    // bevelled nose
    P(h, x, .57, -.02, .12, .08, .26, wood(CW.light));            // saddle
    P(h, x + s * .065, .3, .1, .01, .02, .48, CW.dark);           // plank seam
    geo(h, CG.hex, MS(CW.gold, .15), x + s * .08, .46, .04, .06, .085, .085);
    for (const z of [.26, -.34]) {
      geo(h, CG.wheel, MS(CW.wheel), x + s * .13, .19, z, .1, .19, .19);
      geo(h, CG.wheel, MS(CW.wheelIn), x + s * .14, .19, z, .1, .12, .12);
      geo(h, CG.hex, MS(CW.gold, .15), x + s * .2, .19, z, .05, .06, .06);
    }
  }
  P(h, 0, .14, .25, cx * 2, .1, .18, wood(CW.light));              // front transom
  P(h, 0, .1, -.1, cx * 2 - .1, .07, .6, wood(CW.dark));           // bed
  P(h, 0, .18, -.42, cx * 2, .12, .16, wood(CW.wood));             // rear transom
  for (const z of [.26, -.34]) P(h, 0, .19, z, cx * 2 + .2, .07, .07, CW.wheelIn); // axles
  const bp = new THREE.Group(); bp.position.set(0, sp === 'a' ? .56 : .6, .04);
  bp.rotation.x = sp === 'a' ? -.8 : sp === 'b' ? -.06 : -.14; h.add(bp); t.barrel = bp; t.barrelZ = .04;
  const kind = sp === 'a' ? 'mortar' : sp === 'b' ? 'scatter' : 'gun';
  let front = 0; for (const x of xs) front = cannonBarrel(bp, x, R, kind);
  t.muzzles = xs.map(x => { const o = new THREE.Object3D(); o.position.set(x, 0, front); bp.add(o); return o; });
  t.muzzle = t.muzzles[0];
  t.top = top + (sp === 'a' ? 1.2 : 1.0);
}
// ---------------------------------------------------------------- detailed Flame Tower model
const FX = { base: 0x6e6a84, base2: 0x625e78, slate: 0x55506c, slate2: 0x433e58, sand: 0xdca457, sand2: 0xc28a3c, brick: 0xa83a2e, brick2: 0x8a2c24, copper: 0xb85a2a, copperD: 0x8a3f1e, gold: 0xf0b02a, glow: 0xff9a2a, maroon: 0x5c2a36, pale: 0xe8d8c0, green: 0x2a9a40, soot: 0x2a1c1c };
const frCache = {};
function frust(wb, wt, seg = 4) { const k = wb + '_' + wt + '_' + seg; return frCache[k] || (frCache[k] = new THREE.CylinderGeometry(wt * (seg === 4 ? Math.SQRT2 : 1), wb * (seg === 4 ? Math.SQRT2 : 1), 1, seg).rotateY(Math.PI / seg)); }
const FG = { lance: new THREE.CylinderGeometry(.5, 1, 1, 8).rotateY(Math.PI / 8).rotateX(Math.PI / 2), hexZ: new THREE.CylinderGeometry(1, 1, 1, 6).rotateX(Math.PI / 2), oct: new THREE.CylinderGeometry(1, 1, 1, 8).rotateY(Math.PI / 8) };
// move a helper group's children into par, keeping their placement (so plain boxes still merge)
function flatten(par, grp) { grp.updateMatrix(); while (grp.children.length) { const c = grp.children[0]; c.applyMatrix4(grp.matrix); par.add(c); } }
// a group sitting flat on face `a` (0 = front) of a tapered body, at height y
function onFace(B, a, y, out = 0) {
  const grp = new THREE.Group(), f = (y - B.y0) / B.H, w = B.wb + (B.wt - B.wb) * f + out, tilt = Math.atan2(B.wb - B.wt, B.H);
  grp.position.set(Math.sin(a) * w, y, Math.cos(a) * w); grp.rotation.order = 'YXZ'; grp.rotation.set(-tilt, a, 0); return grp;
}
function grate(grp, w, h, n, horiz, frame) {
  P(grp, 0, 0, 0, w + .07, h + .07, .04, frame);
  P(grp, 0, 0, .01, w, h, .04, FX.soot);
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * (horiz ? h : w) / n;
    if (horiz) P(grp, 0, o, .035, w * .86, h / n * .55, .02, 0, ME(0xffa830, 1.5), false);
    else P(grp, o, 0, .035, w / n * .5, h * .82, .02, 0, ME(0xffa830, 1.5), false);
  }
}
function flameModel(t, g) {
  const L = Math.min(t.lvl, 3), sp = t.spec;
  // grey stone slab
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { P(g, sx * .29, .05, sz * .29, .57, .1, .57, vary(sx * sz > 0 ? FX.base : FX.base2, .03)); P(g, sx * .28, .11, sz * .28, .51, .04, .51, vary(FX.base, .03)); }
  const studs = sp ? 0 : L - 1;
  for (let i = 0; i < studs; i++) for (const s of [-1, 1]) geo(g, AG.oct, MS(FX.gold, .15), s * .585, .07, (i - (studs - 1) / 2) * .16, .03, .035, .035, false);
  // tapered body
  const B = sp === 'a' ? { y0: .14, H: .62, wb: .44, wt: .38 } : sp === 'b' ? { y0: .14, H: 1.05, wb: .42, wt: .27 } : { y0: .14, H: L >= 3 ? 1.25 : 1.05, wb: .42, wt: .28 };
  const wAt = y => B.wb + (B.wt - B.wb) * (y - B.y0) / B.H;
  const band = (y, h, c, pad = .025, e = 0) => geo(g, frust(+(wAt(y - h / 2) + pad).toFixed(3), +(wAt(y + h / 2) + pad).toFixed(3)), MS(c, e), 0, y, 0, 1, h, 1);
  const bodyC = sp === 'b' ? FX.maroon : sp === 'a' || L >= 3 ? FX.brick : FX.slate;
  geo(g, frust(B.wb, B.wt), MS(bodyC), 0, B.y0 + B.H / 2, 0, 1, B.H, 1);
  const top = B.y0 + B.H;
  if (!sp && L === 2) { band(.55, .4, FX.brick, .012); band(.35, .05, FX.slate2); band(.75, .05, FX.slate2); }
  if (!sp && L >= 3) for (let y = .4; y < top - .1; y += .27) band(y, .06, FX.slate2);
  if (!sp && L === 1) band(.66, .07, FX.sand);
  // corner buttresses
  const bh = sp === 'a' ? .42 : sp === 'b' ? .46 : L >= 3 ? .5 : .42;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    if (sp === 'a' && sz < 0) continue;
    const x = sx * (B.wb - .02), z = sz * (B.wb - .02);
    geo(g, frust(.1, .06), MS(vary(FX.sand, .03)), x, .14 + bh / 2, z, 1, bh, 1);
    P(g, x, .14 + bh + .03, z, .14, .07, .14, FX.sand2);
    if (!sp && L >= 2) for (const [ax, az] of [[1, 0], [0, 1]]) { P(g, x + ax * sx * .07, .38 + (L - 2) * .06, z + az * sz * .07, ax ? .02 : .1, .2, az ? .02 : .1, FX.gold); }
  }
  // furnace grates
  const fg = onFace(B, 0, sp === 'a' ? .4 : .38, .005); grate(fg, sp === 'b' ? .4 : .3, sp === 'b' ? .44 : .26, sp === 'b' ? 4 : 3, sp === 'b', sp === 'b' ? FX.brick : FX.slate2); flatten(g, fg);
  if (sp !== 'a') for (const a of [Math.PI / 2, -Math.PI / 2]) { const sg = onFace(B, a, top - .38, .005); grate(sg, .18, .2, 3, false, FX.slate2); flatten(g, sg); }
  // collar where the turning head sits
  band(top - .03, .08, sp === 'b' ? FX.gold : L >= 3 && !sp ? FX.slate2 : FX.sand, .04, sp === 'b' ? .1 : 0);
  // ---- head (turns toward the target)
  const h = t.head; h.position.set(0, top, 0);
  const glow = MS(0xff7a1a, .9), gold = MS(FX.gold, .15);
  if (sp === 'b') {
    // Inferno: twin horns, glowing chimney, long lance
    for (const s of [-1, 1]) {
      beam(h, [s * .2, -.15, -.05], [s * .27, .66, -.12], .2, .24, FX.maroon);
      beam(h, [s * .2, .05, .07], [s * .26, .52, .0], .05, .02, 0xff9a2a).material = ME(0xffa830, 1.4);
      const tip = geo(h, AG.oct, MS(FX.pale), s * .275, .74, -.125, .12, .14, .13); tip.rotation.z = -s * .08;
      P(h, s * .275, .66, -.125, .22, .04, .26, FX.gold);
    }
    geo(h, AG.cyl, MS(FX.copper), 0, .2, -.05, .14, .4, .14);
    geo(h, AG.cyl, glow, 0, .22, -.05, .15, .3, .1);
    geo(h, AG.cyl, MS(FX.copperD), 0, .42, -.05, .15, .04, .15);
    geo(h, FG.lance, MS(FX.maroon), 0, -.05, .48, .17, .17, .75);
    P(h, .1, -.03, .5, .03, .05, .5, 0, ME(0xffa830, 1.5), false); P(h, -.1, -.03, .5, .03, .05, .5, 0, ME(0xffa830, 1.5), false);
    geo(h, FG.hexZ, MS(FX.copper), 0, -.05, .16, .23, .23, .16);
    for (const s of [-1, 1]) geo(h, CG.hex, gold, s * .24, -.05, .16, .03, .05, .05, false);
    geo(h, FG.hexZ, MS(FX.pale), 0, -.05, .86, .1, .1, .12); geo(h, AG.cyl, MS(0xffd060, 2), 0, -.05, .925, .045, .02, .045, false).rotation.x = Math.PI / 2;
    t.muzzle.position.set(0, -.05, .95); t.top = top + .85;
    return;
  }
  if (sp === 'a') {
    // Fireline: flared hood, wide fan nozzle, green fuel tank on the back
    geo(h, FG.oct, glow, 0, .2, .02, .33, .16, .33);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; P(h, Math.sin(a) * .335, .2, .02 + Math.cos(a) * .335, .05, .16, .05, FX.soot).rotation.y = a; }
    geo(h, frust(.52, .3, 8), MS(FX.brick), 0, .43, .02, 1, .32, 1);
    geo(h, frust(.54, .5, 8), MS(FX.copperD), 0, .28, .02, 1, .05, 1);
    geo(h, FG.oct, MS(FX.copperD), 0, .62, .02, .26, .08, .26); geo(h, FG.oct, glow, 0, .64, .02, .2, .07, .2, false);
    for (const a of [.9, 2.2, 4.1, 5.4]) P(h, Math.sin(a) * .27, .64, .02 + Math.cos(a) * .27, .1, .1, .1, FX.gold);
    const chev = onFace({ y0: .27, H: .32, wb: .5, wt: .29 }, 0, .45, .02); for (const s of [-1, 1]) { const m = P(chev, s * .05, 0, 0, .14, .05, .03, FX.gold); m.rotation.z = s * .6; } chev.position.z += .02; flatten(h, chev);
    geo(h, CG.oct, MS(FX.copperD), 0, .02, .2, .2, .18, .3);
    geo(h, CG.flare, gold, 0, .02, .58, .44, .22, .46); geo(h, CG.flare, glow, 0, .02, .62, .37, .16, .42, false);
    for (let i = -2; i <= 2; i++) P(h, i * .09, .02, .82, .03, .2, .02, FX.soot);
    // fuel tank
    geo(h, FG.oct, MS(FX.green, .25), 0, .02, -.44, .22, .55, .22);
    for (const y of [-.24, .28]) geo(h, FG.oct, gold, 0, .02 + y, -.44, .245, .07, .245);
    geo(h, FG.oct, gold, 0, .35, -.44, .12, .08, .12);
    for (const s of [-1, 1]) { P(h, s * .21, .02, -.44, .03, .26, .12, FX.gold); P(h, s * .225, .02, -.44, .02, .2, .07, 0, ME(0xffa020, 1.2), false); beam(h, [s * .2, .05, .3], [s * .17, .32, -.32], .06, .08, FX.gold); geo(h, CG.hex, gold, s * .2, .05, .3, .04, .06, .06, false); }
    t.muzzle.position.set(0, .02, .84); t.top = top + .8;
    return;
  }
  // levels 1-3: copper dome, glowing vents and a hex nozzle
  const k = L >= 3 ? 1.08 : 1;
  geo(h, FG.oct, glow, 0, .12, 0, .26 * k, .2, .26 * k);
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; P(h, Math.sin(a) * .265 * k, .12, Math.cos(a) * .265 * k, .05, .2, .05, FX.soot).rotation.y = a; }
  geo(h, frust(.4 * k, .27 * k, 8), MS(FX.copper), 0, .34, 0, 1, .26, 1);
  geo(h, frust(.42 * k, .4 * k, 8), MS(FX.copperD), 0, .2, 0, 1, .04, 1);
  for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; P(h, Math.sin(a) * .34 * k, .12, Math.cos(a) * .34 * k, .14, .16, .14, FX.copper).rotation.y = a; }
  geo(h, FG.oct, MS(FX.copperD), 0, .5, 0, .2, .08, .2); geo(h, FG.oct, glow, 0, .52, 0, .14, .07, .14, false);
  for (const a of [0, 2.3, 4]) P(h, Math.sin(a) * .22, .56, Math.cos(a) * .22, .13, .12, .13, FX.sand).rotation.y = a;
  const ny = -.14;
  geo(h, CG.oct, MS(FX.slate), 0, ny, .45, .14, .14, .6);
  geo(h, CG.oct, MS(L >= 3 ? FX.gold : FX.copper, L >= 3 ? .15 : 0), 0, ny, .3, .22, .22, .16);
  if (L >= 3) geo(h, CG.oct, MS(FX.copper), 0, ny, .62, .18, .18, .1);
  for (const [x, y] of [[.24, .02], [-.24, .02], [0, .24]]) geo(h, CG.hex, gold, x, ny + y, .3, .03, .04, .04, false).rotation.z = x ? 0 : Math.PI / 2;
  geo(h, FG.hexZ, gold, 0, ny, .78, .2, .2, .14);
  geo(h, FG.hexZ, MS(0xffb030, 1.8), 0, ny, .8, .13, .13, .14, false);
  t.muzzle.position.set(0, ny, .86); t.top = top + .65;
}
const G_TOR = new THREE.TorusGeometry(1, .22, 10, 40);
// ---------------------------------------------------------------- detailed Frost Spire and Tesla Coil models
const crystalGeo = new THREE.LatheGeometry([new THREE.Vector2(0, -.3), new THREE.Vector2(1, 0), new THREE.Vector2(.82, .55), new THREE.Vector2(0, 1)], 6);
function crystal(par, x, y, z, r, h, mat, tx = 0, tz = 0) { const m = geo(par, crystalGeo, mat, x, y, z, r, h, r); m.rotation.set(tx, 0, tz); return m; }
function stoneSlab(g, c1, c2, snow) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    P(g, sx * .29, .05, sz * .29, .57, .1, .57, vary(sx * sz > 0 ? c1 : c2, .03)); P(g, sx * .28, .11, sz * .28, .51, .04, .51, vary(c1, .03));
    if (snow) P(g, sx * .3 + sz * .05, .135, sz * .3 - sx * .04, .3, .025, .26, snow);
  }
}
function emblemStar(grp, s, mat, n = 3) { for (let k = 0; k < n; k++) { const m = new THREE.Mesh(boxGeo, mat); m.scale.set(s, s * .16, .02); m.rotation.z = k * Math.PI / n; m.position.z = .03; grp.add(m); } }
const FRC = { stone: 0x9ea6c4, stone2: 0x8a93b4, dark: 0x5e668c, snow: 0xf2f7ff, blue: 0x2c4cc0, blueD: 0x1e3490, gold: 0xe8b23a };
function frostModel(t, g) {
  const L = [0, 2, 1, 3][Math.min(t.lvl, 3)], sp = t.spec; // level 1 uses the tall slim look, level 2 the squat one
  stoneSlab(g, FRC.stone, FRC.stone2, FRC.snow);
  const B = sp === 'a' ? { y0: .14, H: 1.3, wb: .4, wt: .17 } : sp === 'b' ? { y0: .14, H: .95, wb: .4, wt: .3 } : L === 1 ? { y0: .14, H: .9, wb: .4, wt: .29 } : L === 2 ? { y0: .14, H: 1.15, wb: .36, wt: .23 } : { y0: .14, H: 1.2, wb: .42, wt: .3 };
  const wAt = y => B.wb + (B.wt - B.wb) * (y - B.y0) / B.H, top = B.y0 + B.H;
  const band = (y, h, c, pad = .025, e = 0) => geo(g, frust(+(wAt(y - h / 2) + pad).toFixed(3), +(wAt(y + h / 2) + pad).toFixed(3)), MS(c, e), 0, y, 0, 1, h, 1);
  geo(g, frust(B.wb, B.wt), MS(FRC.stone), 0, B.y0 + B.H / 2, 0, 1, B.H, 1);
  for (let y = B.y0 + .28; y < top - .12; y += .26) band(y, .035, FRC.stone2, .008);
  // stepped skirt with a snowy ledge
  band(.27, .26, FRC.stone2, .06); band(.405, .03, FRC.snow, .07);
  // glowing doorway and slit windows
  const ice = MS(0x7fe6ff, .9), iceL = MS(0xcff6ff, .7);
  const dg = onFace(B, 0, .3, .065); P(dg, 0, 0, 0, .2, .24, .04, FRC.dark); P(dg, 0, -.01, .01, .12, .19, .04, 0, ME(0x6fe0ff, 1.2), false); P(dg, 0, .13, 0, .24, .04, .05, FRC.stone2); flatten(g, dg);
  for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) { const w = onFace(B, a, top - .3, .005); P(w, 0, 0, 0, .09, .17, .03, FRC.dark); P(w, 0, -.01, .01, .05, .12, .03, 0, ME(0x6fe0ff, 1.1), false); flatten(g, w); }
  // banners with a snowflake
  const bannerAt = (a, y, big) => {
    const b = onFace(B, a, y, .01), w = big ? .26 : .18, h = big ? .32 : .24;
    P(b, 0, 0, 0, w + .04, h + .04, .03, FRC.gold); P(b, 0, 0, .012, w, h, .03, FRC.blue);
    const v = new THREE.Mesh(boxGeo, M(FRC.gold)); v.scale.set(w * .75, .035, .03); v.position.set(0, -h * .32, .02); b.add(v);
    if (big || a === 0) { const s = new THREE.Group(); s.position.set(0, .03, .015); emblemStar(s, w * .55, MS(0xeaf8ff, .5)); b.add(s); }
    flatten(g, b);
  };
  if (sp !== 'a') { bannerAt(0, B.y0 + B.H * (sp === 'b' ? .5 : .45), true); if (L >= 2 || sp) for (const a of [Math.PI / 2, -Math.PI / 2]) bannerAt(a, B.y0 + B.H * .42, false); }
  // level 3 / specials: blue corner buttresses with gold edges
  if (L >= 3 || sp) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const hgt = sp === 'a' ? .75 : .62, x0 = sx * (B.wb + .03), z0 = sz * (B.wb + .03), x1 = sx * (wAt(hgt) - .01), z1 = sz * (wAt(hgt) - .01);
    beam(g, [x0, .15, z0], [x1, hgt, z1], .16, .16, FRC.blue); beam(g, [x0 * 1.04, .15, z0 * 1.04], [x1 * 1.04, hgt, z1 * 1.04], .05, .05, FRC.gold);
    P(g, x1, hgt + .03, z1, .18, .06, .18, FRC.snow);
  }
  if (L >= 3 && !sp) for (let f = 0; f < 4; f++) { const a = f * Math.PI / 2; for (const o of [-.12, 0, .12]) geo(g, AG.oct, MS(0x6fe0ff, .9), Math.sin(a) * .585 + Math.cos(a) * o, .07, Math.cos(a) * .585 - Math.sin(a) * o, .025, .035, .025, false); }
  // crown
  const head = t.head; let hy;
  if (sp === 'a') {
    // Deep Freeze: gold-framed blade spire and a star emblem
    const s = onFace(B, 0, B.y0 + B.H * .45, .015); P(s, 0, 0, 0, .3, .36, .03, FRC.gold); P(s, 0, 0, .012, .26, .32, .03, FRC.blueD); const st = new THREE.Group(); st.position.set(0, .03, .02); emblemStar(st, .2, MS(0xe8eef8, .4), 4); s.add(st); flatten(g, s);
    for (const sx of [-1, 1]) { beam(g, [sx * .2, top - .45, .08], [sx * .07, top + .5, .02], .07, .07, FRC.gold); beam(g, [sx * .2, top - .45, -.08], [sx * .07, top + .5, -.02], .07, .07, FRC.gold); }
    band(top - .05, .1, FRC.gold, .02, .15);
    hy = top + .45; head.position.set(0, hy, 0);
    const c = new THREE.Group(); head.add(c); t.crystal = c;
    crystal(c, 0, -.35, 0, .15, 1.2, MS(0x3a7cff, .7));
    crystal(c, 0, -.3, 0, .09, 1.05, MS(0xbfe8ff, .9));
  } else if (sp === 'b') {
    // Glacier Field: flared stone bowl with a fan of crystals
    geo(g, frust(B.wt + .02, .5), MS(0xc4cce6, .12), 0, top + .12, 0, 1, .24, 1);
    geo(g, frust(.51, .52), MS(FRC.gold, .15), 0, top + .26, 0, 1, .05, 1);
    geo(g, frust(.4, .47), MS(0x6fe0ff, .9), 0, top + .17, 0, 1, .07, 1);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; P(g, Math.sin(a) * .5, top + .2, Math.cos(a) * .5, .12, .2, .12, FRC.gold).rotation.y = a; }
    hy = top + .4; head.position.set(0, hy, 0);
    const c = new THREE.Group(); head.add(c); t.crystal = c;
    crystal(c, 0, -.15, 0, .13, .55, ice);
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const m = crystal(c, Math.sin(a) * .22, -.18, Math.cos(a) * .22, .09, .45 + (i % 2) * .1, i % 2 ? iceL : ice); m.rotation.order = 'YXZ'; m.rotation.set(.85, a, 0); }
  } else {
    // crenellated rim with snow; gold collar from level 2
    const cr = L === 2 ? .2 : B.wt + .02;
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; P(g, Math.sin(a) * cr, top + .06, Math.cos(a) * cr, .12, .14, .12, FRC.stone2).rotation.y = a; P(g, Math.sin(a) * cr, top + .14, Math.cos(a) * cr, .12, .03, .12, FRC.snow).rotation.y = a; }
    geo(g, frust(cr, cr), MS(FRC.stone2), 0, top + .02, 0, 1, .06, 1);
    if (L >= 2) { band(top - .06, .07, FRC.gold, .03, .15); const gm = onFace(B, 0, top - .06, .04); geo(gm, AG.oct, MS(0x5fe0ff, 1), 0, 0, .02, .05, .065, .03, false); flatten(g, gm); }
    hy = top + .42; head.position.set(0, hy, 0);
    const c = new THREE.Group(); head.add(c); t.crystal = c;
    const mh = L === 1 ? .65 : L === 2 ? .8 : .85;
    crystal(c, 0, -.3, 0, .16, mh, ice); crystal(c, .02, -.25, .04, .09, mh * .9, iceL);
    const sides = L >= 3 ? 5 : 2;
    for (let i = 0; i < sides; i++) { const a = sides === 2 ? (i ? 1.9 : -1.9) : i / sides * Math.PI * 2 + .4; const m = crystal(c, Math.sin(a) * .15, -.3, Math.cos(a) * .15, .07, .42, i % 2 ? iceL : ice); m.rotation.order = 'YXZ'; m.rotation.set(.45, a, 0); }
  }
  t.orb = [];
  for (let k = 0; k < 2 + L; k++) t.orb.push(P(head, 0, 0, 0, .06, .06, .06, 0, ME(0xe8fbff, 1.2), false));
  t.muzzle = head; t.top = hy + .5;
}
const TEC = { stone: 0x8a80a8, stone2: 0x766c94, purple: 0x6a3aaa, purpleD: 0x3c2670, copper: 0xd88a38, copperD: 0xa25e24, gold: 0xf0b030, metal: 0x4a4064 };
function teslaModel(t, g) {
  const L = Math.min(t.lvl, 3), sp = t.spec;
  stoneSlab(g, TEC.stone, TEC.stone2);
  if (L >= 3 && !sp) for (let f = 0; f < 4; f++) { const a = f * Math.PI / 2; for (const o of [-.16, .16]) geo(g, AG.sph, MS(TEC.copper, .1), Math.sin(a) * .585 + Math.cos(a) * o, .07, Math.cos(a) * .585 - Math.sin(a) * o, .03, .03, .03, false); }
  const B = { y0: .14, H: .56, wb: .45, wt: .33 }, top = B.y0 + B.H;
  const wAt = y => B.wb + (B.wt - B.wb) * (y - B.y0) / B.H;
  geo(g, frust(B.wb, B.wt), MS(TEC.stone), 0, B.y0 + B.H / 2, 0, 1, B.H, 1);
  geo(g, frust(.5, .47), MS(TEC.stone2), 0, .22, 0, 1, .16, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P(g, sx * .41, .3, sz * .41, .16, .3, .16, vary(TEC.stone2, .03));
  for (let f = 0; f < 4; f++) {
    const b = onFace(B, f * Math.PI / 2, .44, .012);
    P(b, 0, 0, 0, .2, .26, .03, TEC.gold); P(b, 0, .01, .012, .16, .24, .03, TEC.purple);
    for (const s of [-1, 1]) { const v = new THREE.Mesh(boxGeo, M(TEC.gold)); v.scale.set(.1, .03, .03); v.position.set(s * .04, -.05, .02); v.rotation.z = -s * .6; b.add(v); }
    flatten(g, b);
  }
  geo(g, frust(.38, .36), MS(TEC.copper, .1), 0, top + .02, 0, 1, .08, 1);
  for (let f = 0; f < 4; f++) for (const o of [-.22, .22]) { const a = f * Math.PI / 2; geo(g, AG.sph, MS(TEC.gold, .2), Math.sin(a) * .375 + Math.cos(a) * o, top + .02, Math.cos(a) * .375 - Math.sin(a) * o, .025, .025, .025, false); }
  const head = t.head; t.orbM = null; t.arcs = null;
  if (sp === 'b') {
    // Overload: twisted pylon with a glowing core and a turning beam emitter
    const H = 1.1, y0 = top + .06;
    geo(g, frust(.24, .17, 8), MS(TEC.purpleD), 0, y0 + H / 2, 0, 1, H, 1);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + .3; const m = crystal(g, Math.sin(a) * .14, y0 + .15, Math.cos(a) * .14, .07, .8, MS(0xff4ad0, 1.1)); m.rotation.order = 'YXZ'; m.rotation.set(-.08, a, 0); }
    const pts = []; for (let i = 0; i <= 60; i++) { const f = i / 60, a = f * Math.PI * 4.2, r = .26 - f * .07; pts.push(new V3(Math.sin(a) * r, y0 + .05 + f * (H - .1), Math.cos(a) * r)); }
    const hel = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, .045, 8), MS(TEC.copper, .1)); hel.scale.set(1, 1, 1); hel.castShadow = true; g.add(hel);
    const hy = y0 + H + .08; head.position.set(0, hy, 0);
    geo(head, FG.oct, MS(TEC.purpleD), 0, 0, -.05, .2, .32, .2);
    for (const s of [-1, 1]) beam(head, [s * .1, .1, -.1], [s * .08, .42, -.3], .07, .16, TEC.purple);
    beam(head, [0, .12, -.18], [0, .48, -.36], .06, .18, TEC.purple);
    geo(head, CG.hex, MS(TEC.copper, .1), 0, 0, .05, .3, .18, .18).rotation.y = Math.PI / 2;
    geo(head, FG.hexZ, MS(0xd8ccc4), 0, 0, .2, .17, .17, .16);
    geo(head, FG.hexZ, MS(0xff58e0, 2), 0, 0, .26, .1, .1, .06, false);
    for (const s of [-1, 1]) geo(head, AG.sph, MS(TEC.copper, .2), s * .17, 0, .06, .05, .05, .05, false);
    t.muzzle.position.set(0, 0, .3); t.top = hy + .5;
    return;
  }
  // coil column
  const n = sp === 'a' ? 4 : 3 + L, step = .19, y0 = top + .08, colH = n * step + .1;
  geo(g, AG.cyl, MS(TEC.purpleD), 0, y0 + colH / 2, 0, .19, colH, .19);
  geo(g, AG.cyl, MS(TEC.copperD, .05), 0, y0 + .02, 0, .3, .06, .3);
  const coil = MS(TEC.copper, .12), coilR = L >= 3 && !sp ? .3 : .28;
  for (let i = 0; i < n; i++) { const m = geo(g, G_TOR, coil, 0, y0 + .12 + i * step, 0, coilR, coilR, coilR); m.rotation.set(Math.PI / 2 + (i % 2 ? .07 : -.07), 0, .05); }
  const ct = y0 + colH;
  if (sp === 'a') {
    // Storm: gem in a winged yoke with four charged balls
    geo(g, frust(.36, .3, 8), MS(TEC.purpleD), 0, ct + .08, 0, 1, .16, 1);
    geo(g, frust(.38, .37, 8), MS(TEC.gold, .15), 0, ct + .17, 0, 1, .04, 1);
    const gm = onFace({ y0: ct, H: .16, wb: .36, wt: .3 }, 0, ct + .08, .01); geo(gm, AG.oct, MS(0x5ae0ff, 1), 0, 0, .02, .05, .07, .03, false); flatten(g, gm);
    const balls = [];
    for (const s of [-1, 1]) {
      beam(g, [s * .3, ct + .12, 0], [s * .62, ct + .38, 0], .16, .2, TEC.purpleD);
      beam(g, [s * .32, ct + .2, .1], [s * .58, ct + .4, .1], .05, .02, 0x5ae0ff).material = MS(0x5ae0ff, 1);
      beam(g, [s * .62, ct + .38, 0], [s * .58, ct + .62, 0], .1, .12, TEC.purpleD);
      beam(g, [s * .16, ct + .18, 0], [s * .26, ct + .62, 0], .08, .1, TEC.metal);
      geo(g, AG.sph, MS(TEC.gold, .15), s * .62, ct + .38, 0, .07, .07, .07);
      balls.push(geo(g, AG.sph, MS(0x6ae8ff, 1.4), s * .58, ct + .68, 0, .07, .07, .07, false), geo(g, AG.sph, MS(0x6ae8ff, 1.4), s * .26, ct + .68, 0, .06, .06, .06, false));
    }
    const hy = ct + .42; head.position.set(0, hy, 0);
    t.orbM = geo(head, AG.oct, MS(0x5ad8ff, 1.2), 0, 0, 0, .17, .23, .17); t.orbB = t.orbM.scale.clone();
    t.arcs = [[balls[0], balls[1]], [balls[1], balls[3]], [balls[3], balls[2]], [balls[0], balls[3]]];
    t.muzzle = head; t.top = hy + .5;
    return;
  }
  // levels 1-3: faceted cap and two arc prongs
  const capW = L >= 3 ? .28 : .22;
  geo(g, frust(capW, capW * .6, 8), MS(TEC.purple), 0, ct + .13, 0, 1, .26, 1);
  if (L >= 3) { geo(g, frust(capW + .02, capW + .01, 8), MS(TEC.purpleD), 0, ct + .05, 0, 1, .07, 1); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; geo(g, CG.hex, MS(TEC.gold, .15), Math.sin(a) * (capW - .02), ct + .12, Math.cos(a) * (capW - .02), .02, .07, .07, false).rotation.y = -a + Math.PI / 2; } }
  const balls = [];
  for (const s of [-1, 1]) {
    beam(g, [s * .14, ct + .06, 0], [s * .27, ct + .35, 0], .07, .09, TEC.metal);
    beam(g, [s * .27, ct + .35, 0], [s * .2, ct + .55, 0], .07, .09, TEC.metal);
    geo(g, AG.sph, MS(TEC.gold, .15), s * .27, ct + .35, 0, .045, .045, .045, false);
    balls.push(geo(g, AG.sph, MS(TEC.copper, .25), s * .2, ct + .6, 0, .065, .065, .065));
  }
  const hy = ct + .42; head.position.set(0, hy, 0);
  const os = .09 + .015 * L; t.orbM = geo(head, AG.sph, MS(0xc070ff, 1.6), 0, 0, 0, os, os, os, false); t.orbB = t.orbM.scale.clone();
  t.arcs = [[balls[0], balls[1]]];
  t.muzzle = head; t.top = hy + .5;
}
const BPI = Math.PI, aimB = (m, d) => { m.quaternion.setFromUnitVectors(new V3(0, 1, 0), new V3(...d).normalize()); return m; };
// ---------------------------------------------------------------- Barracks models (from the art board)
const BRC = { log: 0xc8742e, logD: 0x9a5422, logE: 0xe8964a, thatch: 0xf2c440, thatchD: 0xd9a42a, gold: 0xf0b02a, blue: 0x2a5ad0, stone: 0xc2baa8, stoneD: 0x9a9284, red: 0xc83a2a, white: 0xf0ece2, steel: 0xc0c4cc, iron: 0x6a6a72, leaf: 0x7ab83a, leafD: 0x4f8f2a, bark: 0x8a4e26, glass: 0xffc840 };
const goldM = () => MS(BRC.gold, .15);
function bolt2(g, x, y, z, s = .035) { geo(g, CG.hex, MS(BRC.steel), x, y, z, s, s * 1.3, s * 1.3, false); }
// a crest: gold frame, coloured face, an emblem on top (crossed swords, sun or tower)
function crest(par, x, y, z, s, face, emblem, rotY = 0) {
  const c = new THREE.Group(); c.position.set(x, y, z); c.rotation.y = rotY; par.add(c);
  P(c, 0, 0, 0, .34 * s, .38 * s, .05, BRC.gold); P(c, 0, .01, .02, .28 * s, .32 * s, .05, face);
  aimB(geo(c, AG.cone, goldM(), 0, -.24 * s, 0, .17 * s, .14 * s, .03, false), [0, -1, 0]);
  if (emblem === 'swords') for (const r of [.75, -.75]) { const b = P(c, 0, 0, .05, .05 * s, .3 * s, .02, BRC.gold); b.rotation.z = r; }
  if (emblem === 'sun') { geo(c, AG.sph, MS(BRC.glass, .6), 0, .01, .05, .07 * s, .07 * s, .02, false); for (let k = 0; k < 8; k++) { const b = P(c, Math.sin(k * BPI / 4) * .1 * s, .01 + Math.cos(k * BPI / 4) * .1 * s, .05, .02 * s, .07 * s, .02, BRC.gold); b.rotation.z = -k * BPI / 4; } }
  if (emblem === 'tower') { P(c, 0, -.02, .05, .12 * s, .12 * s, .02, BRC.gold); for (const k of [-1, 0, 1]) P(c, k * .045 * s, .06 * s, .05, .03 * s, .05 * s, .02, BRC.gold); }
  return c;
}
function banner(par, x, y, z, w, h, face, emblem, rotY = 0) {
  const b = new THREE.Group(); b.position.set(x, y, z); b.rotation.y = rotY; par.add(b);
  geo(b, AG.cyl, goldM(), 0, h / 2 + .03, 0, .02, w + .12, .02, false).rotation.z = BPI / 2;
  P(b, 0, 0, 0, w + .03, h, .03, BRC.gold); P(b, 0, .01, .01, w, h - .02, .03, face);
  aimB(geo(b, AG.cone, MS(face), 0, -h / 2 - .04, .01, w / 2, .12, .02, false), [0, -1, 0]);
  if (emblem) crest(b, 0, .04, .02, w * 1.6, face, emblem);
  return b;
}
function barracksModel(t, g) {
  const L = Math.min(t.lvl, 3), sp = t.spec;
  stoneSlab(g, 0xcfb894, 0xbca37e);
  t.flag = null;
  if (sp === 'a') {
    // Paladins: white stone chapel with a bell tower and a glowing sun
    const W = MS(BRC.white), WD = MS(0xd8d0c2);
    geo(g, frust(.44, .4), W, -.06, .7, .02, 1, 1.1, 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { P(g, -.06 + sx * .42, .55, .02 + sz * .4, .14, .8, .14, 0xe6e0d4); geo(g, CG.pyr, goldM(), -.06 + sx * .42, 1.0, .02 + sz * .4, .08, .1, .08, false); }
    for (const s of [-1, 1]) { const r = P(g, -.06 + s * .26, 1.42, .02, .62, .07, 1.0, BRC.blue); r.rotation.z = -s * .62; P(g, -.06 + s * .5, 1.27, .02, .04, .04, 1.04, BRC.gold); }
    P(g, -.06, 1.62, .02, .06, .06, 1.04, BRC.gold);
    for (const z of [-.46, .5]) { const gf = new THREE.Group(); gf.position.set(-.06, 1.28, z); g.add(gf); for (const s of [-1, 1]) { const b = P(gf, s * .2, 0, 0, .5, .06, .06, BRC.gold); b.rotation.z = s * .62; } }
    // stained-glass windows and the sun door
    for (const s of [-1, 1]) { P(g, -.06 + s * .24, .78, .44, .12, .3, .03, 0, ME(BRC.glass, 1.1), false); geo(g, AG.sph, ME(BRC.glass, 1.1), -.06 + s * .24, .93, .44, .06, .06, .02, false); P(g, -.06 + s * .24, .78, .43, .16, .34, .02, BRC.gold); }
    P(g, -.06, .42, .44, .26, .44, .04, BRC.blue); P(g, -.06, .42, .425, .3, .48, .02, BRC.gold); geo(g, AG.sph, MS(BRC.gold, .4), -.06, .46, .47, .05, .05, .02, false);
    crest(g, -.06, 1.12, .48, .9, BRC.blue, 'sun');
    for (const s of [-1, 1]) banner(g, -.06 + s * .38, .82, .47, .14, .34, BRC.white, 'sun');
    // bell tower
    const bx = .34, bz = -.26;
    P(g, bx, 1.2, bz, .4, 2.1, .4, 0xece6da); P(g, bx, 2.28, bz, .46, .08, .46, BRC.gold);
    for (const s of [-1, 1]) { P(g, bx + s * .17, 2.5, bz, .06, .36, .4, 0xece6da); P(g, bx, 2.5, bz + s * .17, .4, .36, .06, 0xece6da); }
    geo(g, AG.cone, MS(BRC.gold, .3), bx, 2.47, bz, .1, .16, .1); geo(g, AG.sph, MS(BRC.gold, .3), bx, 2.38, bz, .03, .03, .03, false);
    for (const s of [-1, 1]) P(g, bx + s * .205, 1.6, bz, .02, .3, .12, 0, ME(BRC.glass, 1.1), false);
    geo(g, AG.roof2, MS(BRC.blue), bx, 2.88, bz, .5, .36, .5); P(g, bx, 2.7, bz, .54, .05, .54, BRC.gold);
    geo(g, AG.cyl, goldM(), bx, 3.15, bz, .02, .2, .02, false);
    const sun = new THREE.Group(); sun.position.set(bx, 3.32, bz); g.add(sun); t.sun = sun;
    geo(sun, AG.sph, ME(0xffd040, 1.5), 0, 0, 0, .09, .09, .09, false);
    for (let k = 0; k < 8; k++) { const r = geo(sun, AG.cone, ME(0xffd040, 1.2), Math.sin(k * BPI / 4) * .13, Math.cos(k * BPI / 4) * .13, 0, .03, .1, .03, false); r.rotation.z = -k * BPI / 4; }
    for (const s of [-1, 1]) { geo(g, AG.cyl, goldM(), -.3 + s * .12, 1.82, -.2, .015, .4, .015, false); P(g, -.22 + s * .12, 1.92, -.2, .16, .1, .02, BRC.white); }
    t.top = 3.3; return;
  }
  if (sp === 'b') {
    // Rangers: a treehouse on a great trunk with a lookout, ladder, bows and green banners
    const bark = MS(BRC.bark), barkD = MS(0x6a3a1a);
    geo(g, AG.cyl, bark, 0, .95, -.05, .34, 1.7, .32);
    for (let k = 0; k < 6; k++) { const a = k / 6 * BPI * 2 + .3; aimB(geo(g, AG.cone, bark, Math.sin(a) * .36, .3, -.05 + Math.cos(a) * .34, .1, .5, .1), [Math.sin(a), -.6, Math.cos(a)]); }
    for (const [x, y, z, s] of [[-.4, 1.4, -.1, 1], [.42, 1.7, -.2, 1.1], [-.25, 2.7, -.3, 1.2], [.35, 2.75, .1, 1]]) { beam(g, [x * .4, y - .3, z], [x, y, z], .1, .1, BRC.bark); geo(g, AG.sph, MS(BRC.leaf), x, y + .1, z, .26 * s, .18 * s, .26 * s); geo(g, AG.sph, MS(BRC.leafD), x + .08, y + .02, z + .06, .18 * s, .12 * s, .18 * s); }
    // lookout platform, railings, roof
    P(g, 0, 1.82, .05, 1.0, .1, .9, BRC.log); for (const sx of [-1, 1]) for (const sz of [-1, 1]) { P(g, sx * .44, 2.12, .05 + sz * .4, .08, .6, .08, BRC.log); geo(g, AG.oct, goldM(), sx * .44, 1.86, .05 + sz * .4, .05, .07, .05, false); }
    P(g, 0, 2.0, .48, .96, .26, .06, BRC.logD); P(g, -.48, 2.0, .05, .06, .26, .86, BRC.logD);
    geo(g, AG.roof1, MS(0x3a8a2a), 0, 2.58, .05, .74, .34, .68); geo(g, AG.eave, MS(0x2f6a22), 0, 2.42, .05, .76, .05, .7);
    geo(g, AG.oct, goldM(), 0, 2.84, .05, .07, .12, .07, false);
    const look = new THREE.Group(); look.position.set(.05, 1.87, .15); g.add(look); hoodedArcher(look, 0, 0, false);
    banner(g, 0, 1.6, .53, .26, .36, 0x2f7a2a, null);
    // ladder, door, bow rack, lantern
    for (const x of [-.36, -.18]) beam(g, [x, .14, .5], [x * .8, 1.8, .44], .04, .04, BRC.logE);
    for (let k = 0; k < 6; k++) { const f = (k + .5) / 6; P(g, -.25, .14 + f * 1.66, .49 - f * .05, .2, .035, .05, BRC.logE); }
    P(g, .16, .4, .33, .22, .44, .04, 0x2f6a22); P(g, .16, .4, .32, .27, .5, .02, BRC.gold); geo(g, AG.oct, MS(0x4ae070, .6), .16, .7, .34, .05, .06, .03, false);
    for (let k = 0; k < 3; k++) { const bw = geo(g, AG.bow, MS(0x9a6a2a), .48, .45, .1 - k * .14, .2, .2, .9); bw.rotation.set(0, 0, BPI / 2); }
    P(g, .48, .2, -.04, .06, .36, .36, BRC.log);
    geo(g, AG.cyl, MS(0x5a3a1a), -.52, 2.2, .44, .04, .16, .04); geo(g, AG.sph, ME(0xffc860, 1.4), -.52, 2.06, .44, .05, .06, .05, false);
    t.top = 2.9; return;
  }
  if (L === 1) {
    // log hut with a thatched roof, double door, crest and a weapon rack
    const log = MS(BRC.log), logE = MS(BRC.logE);
    P(g, 0, .62, -.02, .86, .9, .8, BRC.log);
    for (let k = 0; k < 4; k++) { const y = .26 + k * .22; P(g, 0, y, .38, .88, .025, .02, BRC.logD); P(g, 0, y, -.42, .88, .025, .02, BRC.logD); P(g, .44, y, -.02, .02, .025, .82, BRC.logD); P(g, -.44, y, -.02, .02, .025, .82, BRC.logD);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) geo(g, FG.oct, k % 2 ? logE : log, sx * .45, y + .1, -.02 + sz * .41, .1, .1, .1).rotation.x = BPI / 2; }
    // door with gold bands and rings, frame posts with gold caps
    P(g, 0, .48, .4, .44, .62, .04, BRC.logD); for (const y of [.32, .64]) P(g, 0, y, .42, .44, .05, .02, BRC.gold); P(g, 0, .48, .42, .02, .62, .02, 0x5a3418);
    for (const s of [-1, 1]) { geo(g, AG.bow, MS(BRC.steel), s * .07, .48, .43, .04, .04, .2).rotation.set(0, 0, BPI); P(g, s * .28, .55, .41, .1, .76, .08, BRC.log); P(g, s * .28, .2, .43, .14, .14, .04, BRC.gold); P(g, s * .28, .94, .43, .14, .14, .04, BRC.gold); bolt2(g, s * .28, .2, .455); bolt2(g, s * .28, .94, .455); }
    // gable frame and crest
    for (const s of [-1, 1]) { const b = P(g, s * .22, 1.2, .43, .5, .07, .06, BRC.log); b.rotation.z = -s * .6; }
    P(g, 0, 1.18, .43, .06, .4, .06, BRC.log);
    crest(g, 0, 1.18, .48, .8, BRC.blue, 'swords');
    // thatched roof in three overlapping layers per side, ridge log with gold caps
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const r = P(g, s * (.16 + k * .14), 1.5 - k * .16, -.02, .4, .08, 1.06 - k * .02, k % 2 ? BRC.thatchD : BRC.thatch); r.rotation.z = -s * .72; }
    for (const s of [-1, 1]) for (let k = 0; k < 7; k++) { const c = geo(g, AG.cone, MS(BRC.thatch), s * .62, 1.02, -.48 + k * .155, .05, .14, .05); c.rotation.z = s * 2.4; }
    geo(g, AG.cyl, log, 0, 1.78, -.02, .07, 1.0, .07).rotation.x = BPI / 2;
    for (const z of [.48, -.52]) { P(g, 0, 1.78, z, .18, .18, .08, BRC.gold); bolt2(g, 0, 1.78, z + .05); }
    geo(g, AG.oct, goldM(), 0, 1.98, .48, .1, .14, .1, false);
    geo(g, AG.cyl, log, 0, 2.15, -.48, .04, .8, .04); P(g, 0, 1.95, -.48, .1, .1, .1, BRC.gold); geo(g, AG.oct, goldM(), 0, 2.62, -.48, .06, .1, .06, false);
    t.flag = P(g, .22, 2.4, -.48, .38, .22, .02, BRC.blue);
    // weapon rack: three spears and two round shields
    beam(g, [.5, .14, .26], [.5, .82, .26], .05, .05, BRC.logE); beam(g, [.5, .14, -.3], [.5, .82, -.3], .05, .05, BRC.logE); P(g, .5, .66, -.02, .04, .05, .62, BRC.logE);
    for (const z of [.12, 0, -.12]) { geo(g, AG.cyl, MS(0x8a5a2a), .53, .7, z, .015, .6, .015); geo(g, AG.cone, MS(BRC.steel, .1), .53, 1.06, z, .035, .12, .02); }
    for (const z of [.12, -.16]) { const sh = geo(g, AG.cyl, MS(0x9a5a2a), .56, .36, z, .14, .03, .14); sh.rotation.z = BPI / 2; const rim = geo(g, AG.bow, goldM(), .575, .36, z, .14, .14, .5, false); rim.rotation.set(0, BPI / 2, 0); geo(g, AG.sph, MS(BRC.steel), .59, .36, z, .035, .035, .035, false); }
    t.top = 2.2; return;
  }
  if (L === 2) {
    // stone base, timber upper floor, red hip roof, blue banner, training dummy and a shield rack
    geo(g, frust(.44, .4), MS(BRC.stone), 0, .62, 0, 1, .96, 1);
    for (let k = 0; k < 4; k++) P(g, 0, .3 + k * .22, 0, .92 - k * .02, .02, .92 - k * .02, BRC.stoneD);
    P(g, 0, 1.45, 0, .86, .7, .86, BRC.log);
    for (const s of [-1, 1]) for (const f of [[0, .44, 1], [.44, 0, 0]]) { const b = P(g, f[0] ? s * f[0] : 0, 1.45, f[1] ? f[1] : 0, f[2] ? .72 : .03, .05, f[2] ? .03 : .72, BRC.logD); b.rotation[f[2] ? 'z' : 'x'] = s * .7; }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { P(g, sx * .44, 1.45, sz * .44, .1, .74, .1, BRC.logE); P(g, sx * .44, 1.12, sz * .44, .14, .1, .14, BRC.gold); bolt2(g, sx * .44, 1.12, sz * .51); }
    P(g, 0, 1.12, 0, .92, .06, .92, BRC.logD);
    P(g, 0, 1.62, .435, .5, .3, .04, 0x2a1a10); for (const x of [-.1, .02]) { geo(g, AG.cyl, MS(0x8a5a2a), x, 1.62, .42, .015, .28, .015); geo(g, AG.cone, MS(BRC.steel), x, 1.8, .42, .03, .08, .02); }
    geo(g, AG.sph, MS(BRC.gold, .1), .16, 1.58, .42, .06, .06, .06);
    geo(g, AG.roof1, MS(BRC.red), 0, 2.02, 0, .74, .34, .74); geo(g, AG.eave, MS(0xa02a1e), 0, 1.86, 0, .76, .05, .76);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) beam(g, [sx * .54, 1.86, sz * .54], [sx * .2, 2.18, sz * .2], .05, .05, BRC.gold);
    P(g, 0, 2.22, 0, .22, .08, .22, BRC.gold); geo(g, AG.oct, goldM(), 0, 2.4, 0, .08, .14, .08, false);
    banner(g, 0, 1.0, .47, .26, .34, BRC.blue, 'tower');
    for (const s of [-1, 1]) banner(g, s * .34, .95, .46, .08, .22, BRC.blue, null);
    P(g, 0, .38, .42, .28, .44, .04, BRC.logD); P(g, 0, .6, .43, .36, .08, .04, BRC.stoneD); for (const y of [.28, .5]) P(g, 0, y, .44, .28, .03, .02, BRC.iron);
    geo(g, AG.cyl, MS(0x8a5a2a), -.62, .45, .3, .05, .7, .05); P(g, -.62, .62, .3, .28, .06, .06, BRC.log); geo(g, AG.torus, MS(0xd8b070), -.62, .62, .3, .06, .06, .1);
    for (let k = 0; k < 3; k++) { const z = .2 - k * .17; P(g, .54, .34, z, .03, .26, .13, BRC.gold); P(g, .555, .35, z, .02, .22, .1, BRC.blue); }
    beam(g, [.5, .14, .32], [.5, .5, .32], .04, .04, BRC.logE); beam(g, [.5, .14, -.3], [.5, .5, -.3], .04, .04, BRC.logE);
    t.top = 2.4; return;
  }
  // level 3: stone keep with four crenellated turrets, blue roof, portcullis, crest, banners and armor stands
  P(g, 0, .78, 0, .86, 1.3, .82, BRC.stone);
  for (let k = 0; k < 5; k++) P(g, 0, .2 + k * .26, .415, .82, .02, .02, BRC.stoneD);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * .44, z = sz * .42;
    geo(g, FG.oct, MS(0xd0c8b6), x, .9, z, .17, 1.6, .17); for (const y of [.62, 1.3]) geo(g, FG.oct, goldM(), x, y, z, .18, .07, .18);
    geo(g, FG.oct, MS(0xd0c8b6), x, 1.75, z, .21, .12, .21);
    for (let k = 0; k < 4; k++) P(g, x + Math.sin(k * BPI / 2 + BPI / 4) * .15, 1.86, z + Math.cos(k * BPI / 2 + BPI / 4) * .15, .08, .1, .08, 0xd0c8b6);
    P(g, x + sx * .002, 1.0, z + sz * .17, .05, .14, .02, 0x2a1a10);
  }
  geo(g, AG.roof1, MS(BRC.blue), 0, 1.66, 0, .66, .36, .64); geo(g, AG.eave, MS(0x1e46a8), 0, 1.48, 0, .66, .05, .64);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) beam(g, [sx * .46, 1.48, sz * .45], [sx * .17, 1.82, sz * .17], .05, .05, BRC.gold);
  P(g, 0, 1.86, 0, .22, .08, .22, BRC.gold); geo(g, AG.oct, goldM(), 0, 2.04, 0, .08, .14, .08, false);
  // gate: stone arch and an iron portcullis
  P(g, 0, .42, .43, .4, .56, .04, 0x2a2018);
  for (let k = -2; k <= 2; k++) P(g, k * .08, .42, .45, .02, .52, .02, BRC.iron);
  for (let k = 0; k < 4; k++) P(g, 0, .2 + k * .14, .45, .36, .02, .02, BRC.iron);
  for (let k = -2; k <= 2; k++) aimB(geo(g, AG.cone, MS(BRC.iron), k * .08, .13, .45, .015, .05, .015, false), [0, -1, 0]);
  P(g, 0, .74, .44, .5, .1, .06, BRC.stoneD); for (const s of [-1, 1]) P(g, s * .23, .45, .44, .08, .6, .06, BRC.stoneD);
  crest(g, 0, 1.05, .46, 1, BRC.blue, 'swords');
  for (const s of [-1, 1]) banner(g, s * .28, 1.0, .45, .12, .34, BRC.blue, null);
  for (const s of [-1, 1]) { const x = s * .66; P(g, x, .3, .48, .1, .04, .1, BRC.log); geo(g, AG.cyl, MS(0x8a5a2a), x, .45, .48, .025, .3, .025); geo(g, AG.sph, MS(BRC.steel, .1), x, .66, .48, .1, .11, .08); for (const k of [-1, 1]) geo(g, AG.sph, MS(BRC.steel), x + k * .1, .72, .48, .05, .04, .05); geo(g, AG.cyl, MS(BRC.steel, .1), x, .84, .48, .06, .1, .06); geo(g, AG.sph, MS(BRC.steel), x, .9, .48, .06, .04, .06); P(g, x, .84, .54, .07, .015, .01, 0x2a1a10); }
  t.top = 2.1;
}

// ================================================================ Barracks: soldiers, blocking and melee (Phase 3)
// enemy attacks against soldiers: [damage per hit, seconds between hits, range in tiles, damage type]
const ATK = { runner: [3, 1.0, .6, 'phys'], soldier: [6, 1.2, 1.0, 'phys'], knight: [10, 1.25, .6, 'phys'], shaman: [5, 2.5, 3.0, 'magic'], brute: [14, 2.0, .8, 'phys'], golem: [18, 2.0, .8, 'phys'],
  sapper: [3, 1.0, .6, 'phys'], rider: [6, 1.0, .6, 'phys'], gruk: [30, 2.0, 1.0, 'phys'], boss: [35, 2.0, 1.0, 'phys'] };
const ATKX = { soldier: 'long reach', shaman: 'keeps healing allies', brute: 'cleaves 2 soldiers', sapper: 'plants its charge on a Barracks', rider: 'first block: charges through for 12', gruk: 'splash 1 tile', boss: 'splash 1 tile' };
const atkText = k => { const A = ATK[k]; if (!A) return 'None: flies over soldiers'; return `${A[0]} per hit, every ${A[1]} s, ${A[2] > 1.5 ? 'ranged ' + A[2] + ' tiles' : 'melee'}${A[3] === 'magic' ? ', magic' : ''}${ATKX[k] ? '; ' + ATKX[k] : ''}`; };
let soldiers = [], fallenSol = [], swooshes = [];
const swGeo = new THREE.RingGeometry(.32, .56, 18, 1, -1.1, 2.2);
function swoosh(so, col) { // a white arc in front of a soldier as its blade comes down
  const m = new THREE.Mesh(swGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false }));
  const h = so.heading; m.position.set(so.g.position.x + Math.sin(h) * .3, so.center.y + .05, so.g.position.z + Math.cos(h) * .3); m.rotation.set(0, h + Math.PI / 2, 0); scene.add(m); swooshes.push({ m, t: 0 });
}
function updateSoldierFx(dt) {
  swooshes = swooshes.filter(w => { w.t += dt; w.m.material.opacity = .85 * (1 - w.t / .22); w.m.scale.setScalar(1 + w.t * 1.5); if (w.t < .22) return true; scene.remove(w.m); w.m.material.dispose(); return false; });
  fallenSol = fallenSol.filter(f => { f.t += dt; const g = f.s.g;
    g.rotation.x = -Math.min(1, f.t / .35) * Math.PI / 2 * .95; g.rotation.z = f.side * Math.min(1, f.t / .35) * .2;
    if (f.t > .35 && !f.dust) { f.dust = true; fxDust(g.position, 4, .25); }
    if (f.t > 1) g.position.y -= dt * 1.2;
    if (f.t < 1.7) return true; scene.remove(g); return false; });
}
const SOL_REGEN = .02; // every soldier heals 2% health per second after 2 s out of combat (Paladins: their own faster rate)
const SOL_FIRST = ['Aldric', 'Bram', 'Cedric', 'Doran', 'Edric', 'Finn', 'Garrick', 'Hal', 'Ivo', 'Jory', 'Kael', 'Leof', 'Merek', 'Nils', 'Osric', 'Perrin', 'Rowan', 'Sten', 'Tobin', 'Ulric', 'Wat', 'Wystan', 'Yorick', 'Gunnar', 'Halvard', 'Bertram', 'Godwin', 'Oswin', 'Roderick', 'Tam', 'Willem', 'Anselm', 'Brynn', 'Corwin', 'Dunstan', 'Elric', 'Fenwick', 'Gareth', 'Hugo', 'Lambert'];
const SOL_LAST = ['Ironfoot', 'Oakshield', 'Stonebrow', 'Ashdown', 'Blackwood', 'Brightwater', 'Copperbeard', 'Fairweather', 'Greaves', 'Hammerfall', 'Hollins', 'Longstride', 'Marsh', 'Redmane', 'Strongbow', 'Thatcher', 'Underhill', 'Whitlock', 'Woodward', 'Barley', 'Cobb', 'Dale', 'Fletcher', 'Mason'];
const soldierName = () => { for (let k = 0; k < 8; k++) { const n = pick(SOL_FIRST) + ' ' + pick(SOL_LAST); if (!soldiers.some(s => s.alive && s.name === n)) return n; } return pick(SOL_FIRST) + ' ' + pick(SOL_LAST); };
const SOL_INFO = { militia: ['Militiaman', 'A farmhand with a pitchfork and a borrowed shield, called up for a few seconds of courage.'], footman: ['Footman', 'A town recruit with a kettle hat, short sword and round shield.'], shieldman: ['Shieldbearer', 'A mail-clad soldier with a kite shield, trained to hold the line.'], guard: ['Knight', 'A plumed knight in plate, with a broadsword and the castle on his shield.'], paladin: ['Paladin', 'A holy warrior who heals between fights; every fourth blow is a holy strike.'], ranger: ['Ranger', 'A hooded archer who shoots ground and air, and still blocks when cornered.'] };
const solBarMat = new THREE.MeshBasicMaterial({ color: 0x5aa8ff, transparent: true, depthWrite: false });
function defaultRally(t) { let best = null, bd = 1e9; for (const s of SAMPLES) { const d = (s.x - t.x) ** 2 + (s.z - t.z) ** 2; if (d < bd) { bd = d; best = s; } } return best ? { x: best.x, z: best.z } : { x: t.x, z: t.z }; }
class Soldier {
  constructor(tw, i, atRally) {
    this.tw = tw; this.i = i; const st = this.st = tw.bs; this.type = st.unit; this.name = soldierName(); this.maxHp = this.hp = st.hp; this.alive = true;
    this.g = new THREE.Group(); this.b = new THREE.Group(); this.g.add(this.b);
    const parts = EMODEL.build(st.unit, this.b); this.legs = parts.legs; this.arms = parts.arms; this.parts = parts.debris || []; this.cy = parts.cy * ES; this.hb = parts.hb * ES;
    this.meshes = []; this.b.traverse(o => { if (o.isMesh && !o.userData.ink) { o.userData.m = o.material; this.meshes.push(o); } });
    this.g.scale.setScalar(ES);
    const p = atRally ? this.slot() : { x: tw.x, z: tw.z };
    if (!atRally) fxDust(new V3(p.x, groundY(p.x, p.z), p.z), 5, .3);
    this.g.position.set(p.x, groundY(p.x, p.z), p.z);
    this.bar = new THREE.Group();
    P(this.bar, 0, 0, 0, .66, .12, 1, 0, barBgMat, false).geometry = planeGeo;
    this.fg = P(this.bar, -.3, 0, .01, .6, .07, 1, 0, solBarMat, false); this.fg.geometry = planeGeoL;
    this.bar.children[0].renderOrder = 5; this.fg.renderOrder = 6;
    scene.add(this.g, this.bar); soldiers.push(this);
    this.target = null; this.cd = rand(0, .4); this.anim = rand(0, 6); this.flash = 0; this.flashing = false; this.hits = 0; this.swing = 0; this.heading = 0; this.center = new V3();
  }
  // where to stand around an enemy, so several soldiers on one enemy fan out instead of stacking
  fanSpot(e) {
    const mates = soldiers.filter(s => s.alive && s.target === e && !(s.st.ranged && s.tw.rally.over)), n = mates.length, k = Math.max(0, mates.indexOf(this));
    const ex = e.g.position.x, ez = e.g.position.z;
    // fan out around a direction fixed when the fight starts. Measured from this soldier's own position, the spot
    // moved every time the soldier did, so two or more soldiers circled the enemy forever and it spun to follow them.
    if (!e.fan || game.time - e.fan.t > .5) { let ax = this.g.position.x - ex, az = this.g.position.z - ez; const l = Math.hypot(ax, az) || 1; e.fan = { x: ax / l, z: az / l, t: 0 }; }
    e.fan.t = game.time; const ax = e.fan.x, az = e.fan.z;
    const a = (k - (n - 1) / 2) * .85, c = Math.cos(a), s2 = Math.sin(a);
    return { x: ex + (ax * c - az * s2) * .7, z: ez + (ax * s2 + az * c) * .7 };
  }
  strike(a) { // the moment the blade lands
    const e = a.e, st = this.st, pos = this.g.position; if (!e.alive) return;
    this.hits++; const was = e.alive;
    hurt(e, st.dmg * (a.bash ? .6 : 1) * (skH('drum.rally') && inDrum(pos, 'a') ? 1.2 : 1), 'phys');
    e.flinch = 1;
    if (e.def.armor > 0) fxSparks(e.center, 0xffffff, 7, 3); else fxSparks(e.center, 0xfff0c0, 4, 2.2);
    if (a.bash && e.alive && e.type !== 'boss' && e.type !== 'gruk') { e.d = Math.max(0, e.d - .15); fxDust(e.g.position, 3, .2); }
    if (!a.bash) swoosh(this, st.holy ? 0xfff0a0 : 0xffffff);
    if (was && !e.alive && this.type === 'paladin' && skH('barracks.wind') && Math.random() < .2) { this.hp = this.maxHp; fxSparks(this.center, 0x8fe06a, 10, 2.5); }
    if (st.holy && this.hits % (st.holyN || 4) === 0 && e.alive) {
      hurt(e, st.holy, 'true'); fxSparks(e.center, 0xffe060, 12, 3);
      const m = new THREE.Mesh(drumRingGeo, new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: .7, depthWrite: false }));
      m.position.set(e.g.position.x, groundY(e.g.position.x, e.g.position.z) + .1, e.g.position.z); m.scale.setScalar(.3); scene.add(m); drumRings.push({ m, t: 0, r: 1.5 });
      for (let k = 0; k < 14; k++) glow.spawn(e.center.x + rand(-.2, .2), e.g.position.y + .1, e.center.z + rand(-.2, .2), 0, rand(3, 6), 0, rand(.3, .5), rand(.08, .14), 0xfff0a0, 0, F_SPIN, 1, 0xc08000);
    }
  }
  slot() { const r = this.tw.rally, n = this.tw.bs.n, a = this.i / n * Math.PI * 2 + .6, d = n > 1 ? .55 : 0; return { x: r.x + Math.cos(a) * d, z: r.z + Math.sin(a) * d }; }
  hurt(amt, kind) { if (!this.alive || this.inv > 0) return; this.calm = 0;
    if (this.type === 'ranger' && kind === 'phys' && skH('barracks.nimble') && Math.random() < .2) { fxDust(this.g.position, 2, .15); return; }
    const red = kind === 'magic' ? (this.st.mr || 0) : kind === 'phys' ? this.st.armor : 0; this.hp -= amt * (1 - red); this.flash = .09;
    if (this.hp <= 0 && this.type === 'paladin' && skH('barracks.shield') && !this.saved) { this.saved = true; this.hp = this.maxHp * .5; this.inv = 3; fxSparks(this.center, 0xffe060, 16, 3); flashLight(this.center, 30, 0xffe060); return; }
    if (this.hp <= 0) this.die(); }
  die() {
    fallenSol.push({ s: this, t: 0, side: Math.random() < .5 ? -1 : 1 }); this.g.rotation.order = 'YXZ'; this.atk = null;
    if (this.target && this.target.blocker === this) this.target.blocker = null;
    if (this.extra && this.extra.blocker === this) this.extra.blocker = null;
    this.tw.resp[this.i] = this.tw.bs.resp; this.alive = false; scene.remove(this.bar);
  }
  remove() { this.alive = false; scene.remove(this.g, this.bar); }
  face(dx, dz) { if (dx || dz) this.want = Math.atan2(dx, dz); }
  update(dt) {
    const st = this.st, r = this.tw.rally, pos = this.g.position;
    if (this.ttl != null) { this.ttl -= dt; if (this.ttl <= 0) { for (const o of [this.target, this.extra]) if (o && o.blocker === this) o.blocker = null; fxDust(pos, 5, .3); this.remove(); return; } }
    this.calm = (this.calm || 0) + dt; if (this.inv > 0) this.inv -= dt;
    if (this.type === 'ranger' && skH('barracks.hawk')) { this.hawkT = (this.hawkT ?? 1) - dt; if (this.hawkT <= 0) { this.hawkT = 1; const f = enemies.find(o => o.alive && o.def.air && (o.g.position.x - pos.x) ** 2 + (o.g.position.z - pos.z) ** 2 < 16); if (f) { hurt(f, 6, 'phys'); fxSparks(f.center, 0xd8b080, 5, 2); } } }
    if (this.extra && (!this.extra.alive || this.extra.blocker !== this)) this.extra = null;
    const ow = !!(r.over && st.ranged), inR = (e, pad) => (e.shooting && e.shooting.alive && e.shooting.tw === this.tw) || (e.g.position.x - r.x) ** 2 + (e.g.position.z - r.z) ** 2 < (st.rad + pad) ** 2;
    if (this.target && (!this.target.alive || !inR(this.target, .8))) { if (this.target.blocker === this) this.target.blocker = null; this.target = null; }
    if (!this.target && this.extra) { this.target = this.extra; this.extra = null; } // the second enemy it was holding becomes its main fight
    const takenBy = e => soldiers.some(s => s !== this && s.alive && s.target === e);
    this.scan = (this.scan || 0) - dt;
    if (!this.target || (this.scan <= 0 && takenBy(this.target))) {
      this.scan = .2;
      let free = null, fd = 1e9, any = null, ad = 1e9;
      for (const e of enemies) {
        if (!e.alive || (e.def.air && !st.ranged) || !inR(e, 0)) continue;
        const d = (e.g.position.x - pos.x) ** 2 + (e.g.position.z - pos.z) ** 2;
        if (d < ad) { ad = d; any = e; }
        if (d < fd && !takenBy(e)) { fd = d; free = e; }
      }
      const pickE = free || (this.target ? null : any); // a soldier sharing a target only moves when someone is unclaimed
      if (pickE && pickE !== this.target) { if (this.target && this.target.blocker === this) this.target.blocker = null; this.target = pickE; }
    }
    let goal = null, moving = false;
    const e = this.target;
    if (e) {
      const dx = e.g.position.x - pos.x, dz = e.g.position.z - pos.z, d = Math.hypot(dx, dz);
      if (st.ranged && (ow || e.def.air || d > 1)) {
        goal = this.slot(); this.face(dx, dz); this.aiming = d < st.ranged + .5;
        this.cd -= dt; if (this.cd <= 0 && this.aiming) { this.cd = st.rate; projs.push(new Arrow(new V3(pos.x, pos.y + 1.1, pos.z), e, st.dmg * (skH('drum.rally') && inDrum(pos, 'a') ? 1.2 : 1), false, { pierce2: skH('barracks.broad') })); this.rel = 1; }
      } else if (d > .85) { goal = this.fanSpot(e); this.face(dx, dz); }
      else {
        if (!e.blocker || !e.blocker.alive || e.blocker.target !== e) { if (e.blocker && e.blocker.extra === e) e.blocker.extra = null; e.blocker = this; }
        if (!this.extra) for (const o of enemies) { // hold one more enemy that walks into it, if nobody else has it
          if (o === e || !o.alive || o.def.air || !ATK[o.type] || (o.blocker && o.blocker.alive && (o.blocker.target === o || o.blocker.extra === o))) continue;
          if ((o.g.position.x - pos.x) ** 2 + (o.g.position.z - pos.z) ** 2 < .81) { this.extra = o; o.blocker = this; break; }
        }
        this.face(dx, dz);
        if (this.engaged !== e) { this.engaged = e; if (skH('barracks.spear')) this.cd = 0; }
        this.cd -= dt; this.fighting = true;
        if (this.cd <= 0 && !this.atk) { this.cd = st.rate; this.atk = { t: 0, hit: false, e, bash: !st.holy && this.type !== 'ranger' && this.swings % 3 === 2 }; this.swings = (this.swings || 0) + 1; }
        { const f = this.fanSpot(e); if ((f.x - pos.x) ** 2 + (f.z - pos.z) ** 2 > .03) goal = f; }
      }
    } else { goal = this.slot(); if (this.calm > 2) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * (st.heal || st.regen || SOL_REGEN) * (skH('drum.hymn') && inDrum(pos) ? 2 : 1) * dt); }
    if (goal) {
      const dx = goal.x - pos.x, dz = goal.z - pos.z, d = Math.hypot(dx, dz);
      if (d > .06) { const sp = Math.min(d, 3.2 * (skH('drum.march') && inDrum(pos) ? 1.3 : 1) * dt); pos.x += dx / d * sp; pos.z += dz / d * sp; moving = true; if (!e) this.face(dx, dz); }
    }
    pos.y = groundY(pos.x, pos.z);
    if (this.want != null) this.heading = lerpAngle(this.heading, this.want, 1 - Math.exp(-10 * dt));
    this.g.rotation.y = this.heading;
    // attack timing: wind-up, the blade lands at 0.15 s, recover by 0.36 s
    if (this.atk) { const a = this.atk; a.t += dt; if (!a.hit && a.t >= .15) { a.hit = true; this.strike(a); } if (a.t >= .36) this.atk = null; }
    if (!e) this.fighting = false;
    // animation
    if (moving) this.anim += dt * 10;
    const s = moving ? Math.sin(this.anim) : 0, a = this.atk, p = a ? a.t / .36 : 0;
    let armW = -s * .4, armS = s * .4, lunge = 0, side = 0, hop = 0;
    if (a && a.bash) { armW = -.3; armS = p < .4 ? .5 * p / .4 : p < .6 ? .5 - 2.1 * (p - .4) / .2 : -1.6 * (1 - (p - .6) / .4); lunge = Math.sin(Math.PI * Math.min(1, p / .7)) * .16; }
    else if (a) { const up = st.holy ? 2.9 : 2.4; armW = p < .4 ? -up * p / .4 : p < .55 ? -up + (up + .7) * (p - .4) / .15 : .7 * (1 - (p - .55) / .45); lunge = Math.sin(Math.PI * Math.min(1, Math.max(0, (p - .3) / .5))) * .2; }
    else if (st.ranged && e && this.aiming) { const k = Math.min(1, Math.max(0, 1 - this.cd / .35)); armW = -1.45 * Math.max(k, this.rel || 0); armS = -1.2 * k; }
    if (this.rel > 0) { this.rel = Math.max(0, this.rel - dt * 4); armS = .8 * Math.sin(Math.PI * (1 - this.rel)); }
    if (this.fighting && !moving && !a) side = Math.sin(game.time * 2.6 + this.i * 2.1) * .07;
    if (this.cheer > 0) { this.cheer -= dt; if (!e) { armW = armS = -2.7 + Math.sin(game.time * 14) * .15; hop = Math.abs(Math.sin(game.time * 9)) * .1; } }
    if (this.legs.length > 1) { this.legs[0].rotation.x = s * .6 + (a ? -lunge * 2 : 0); this.legs[1].rotation.x = -s * .6 + (a ? lunge * 1.2 : 0); }
    if (this.arms.length > 1) { this.arms[0].rotation.x = armW; this.arms[1].rotation.x = armS; }
    this.b.position.set(side / ES, hop / ES, lunge / ES); this.b.rotation.x = lunge * .9;
    if (this.flash > 0) this.flash -= dt;
    const fl = this.flash > 0;
    if (fl !== this.flashing) { this.flashing = fl; for (const m of this.meshes) m.material = fl ? flashMat : m.userData.m; }
    this.center.set(pos.x, pos.y + this.cy, pos.z);
    this.bar.position.set(pos.x, pos.y + this.hb, pos.z); this.bar.quaternion.copy(camera.quaternion);
    this.fg.scale.x = .6 * Math.max(0, this.hp / this.maxHp); this.bar.visible = this.hp < this.maxHp;
  }
}
// an enemy fights the soldier blocking it, or a ranged enemy shoots the nearest soldier in range while walking; true = it stops walking
function enemyCombat(e, dt) {
  const A = ATK[e.type]; if (!A || e.def.air || !soldiers.length) { e.blocker = null; return false; }
  let foe = e.blocker && e.blocker.alive && (e.blocker.target === e || e.blocker.extra === e) ? e.blocker : null;
  if (!foe) e.blocker = null;
  if (foe && e.type === 'rider' && !e.charged) { e.charged = true; foe.hurt(12, 'phys'); fxDust(e.g.position, 6, .3); if (foe.target === e) foe.target = null; if (foe.extra === e) foe.extra = null; e.blocker = null; return false; }
  if (!foe && A[2] > 1.5) { let bd = A[2] * A[2]; for (const s of soldiers) { if (!s.alive) continue; const d = (s.g.position.x - e.g.position.x) ** 2 + (s.g.position.z - e.g.position.z) ** 2; if (d < bd) { bd = d; foe = s; } } }
  e.shooting = foe && foe !== e.blocker ? foe : null;
  if (!foe) return false;
  e.atkT = (e.atkT ?? A[1] * .5) - dt;
  if (e.atkT <= 0) {
    e.atkT = A[1]; e.swing = 1;
    if (A[2] > 1.5) bolt(e.center.clone(), foe.center.clone(), 0x9a6aff);
    const ad = A[0] * eDmgMul();
    if (e.type === 'gruk' || e.type === 'boss') { for (const s of soldiers) if (s.alive && (s.g.position.x - foe.g.position.x) ** 2 + (s.g.position.z - foe.g.position.z) ** 2 < 1) s.hurt(ad, A[3]); fxDust(foe.g.position, 6, .3); }
    else if (e.type === 'brute') { const o = soldiers.find(s => s.alive && s !== foe && (s.g.position.x - foe.g.position.x) ** 2 + (s.g.position.z - foe.g.position.z) ** 2 < 1); foe.hurt(ad, A[3]); if (o) o.hurt(ad, A[3]); }
    else foe.hurt(ad, A[3]);
  }
  const dx = foe.g.position.x - e.g.position.x, dz = foe.g.position.z - e.g.position.z; if (dx || dz) e.faceT = Math.atan2(dx, dz);
  return !e.shooting; // a Shaman shoots on the move; only a blocker stops it
}
// barracks stats by level ('a' Paladins, 'b' Rangers) and rank
const BARR = {
  1: { n: 3, unit: 'footman', hp: 75, dmg: 6, rate: 1, armor: 0, mr: 0, resp: 8, rad: 3.0 },
  2: { n: 3, unit: 'shieldman', hp: 125, dmg: 9, rate: 1, armor: .15, mr: 0, resp: 8, rad: 3.3 },
  3: { n: 3, unit: 'guard', hp: 200, dmg: 14, rate: 1, armor: .25, mr: 0, resp: 7, rad: 3.6 },
  a: { n: 3, unit: 'paladin', hp: 275, dmg: 18, rate: 1, armor: .35, mr: .3, resp: 6, rad: 3.6, heal: .05, holy: 40 },
  b: { n: 3, unit: 'ranger', hp: 140, dmg: 14, rate: .9, armor: .1, mr: 0, resp: 7, rad: 4, ranged: 4 },
};
function barrStat(k, rank = 1) { const b = Object.assign({}, BARR[k]), r = rank - 1; b.hp = Math.round(b.hp * Math.pow(1.2, r)); b.dmg = +(b.dmg * Math.pow(1.25, r)).toFixed(1); b.rad = +(b.rad + .2 * r).toFixed(1); if (b.holy) b.holy = Math.round(b.holy * Math.pow(1.25, r)); if (k === 'b') b.rate = [.9, .8, .7][r] ?? .7;
  if (SKX()) {
    if (skH('barracks.root')) b.hp = Math.round(b.hp * 1.1);
    if (skH('barracks.pala') && k === 'a') { b.hp = Math.round(b.hp * 1.1); b.mr = +(b.mr + .1).toFixed(2); }
    if (skH('barracks.gamb')) b.armor = +(b.armor + .1).toFixed(2);
    if (skH('barracks.drill')) b.dmg = +(b.dmg * 1.1).toFixed(1);
    if (skH('barracks.medic') && !b.heal) b.regen = .03;
    if (skH('barracks.horn')) b.resp = +(b.resp * .8).toFixed(1);
    if (skH('barracks.fourth')) b.n += 1;
    if (skH('barracks.rang') && b.ranged) b.ranged += .5;
    if (skH('barracks.right') && b.holy) b.holyN = 3;
  }
  return b; }
const barrAsStat = b => ({ dmg: b.dmg, range: b.rad, rate: b.rate, dps: b.n * b.dmg / b.rate, hp: b.hp });
// rally point marker shown while a barracks is selected
const rallyFlag = new THREE.Group(); rallyFlag.visible = false; scene.add(rallyFlag);
const rallyGhost = new THREE.Group(); rallyGhost.visible = false; scene.add(rallyGhost);
const rgMat = new THREE.MeshBasicMaterial({ color: 0x4ad05a, transparent: true, opacity: .8, depthWrite: false });
P(rallyGhost, 0, .6, 0, .06, 1.2, .06, 0, rgMat, false); P(rallyGhost, .26, 1.05, 0, .46, .3, .03, 0, rgMat, false); geo(rallyGhost, AG.cyl, rgMat, 0, .04, 0, .42, .05, .42, false);
P(rallyFlag, 0, .6, 0, .06, 1.2, .06, 0x4a2f14, null, false); P(rallyFlag, .26, 1.05, 0, .46, .3, .03, 0x2a5ad0, null, false); P(rallyFlag, 0, .02, 0, .5, .04, .5, 0xffd23a, null, false);
function showRally(t) { rallyFlag.visible = true; rallyFlag.position.set(t.rally.x, groundY(t.rally.x, t.rally.z), t.rally.z); }

// ---------------------------------------------------------------- War Drum models (from the art board)
const DRC = { wood: 0xc0642a, woodD: 0x8e4220, woodL: 0xdc8a3e, red: 0xc8302a, redD: 0x9a2220, gold: 0xf0b02a, head: 0xf2e4c4, rope: 0xe8d2a0, stone: 0x9a96a0, stoneD: 0x7e7a86, purple: 0x8a2ab0, purpleD: 0x5a1a7a, glow: 0xd060ff, horn: 0x8a4a22, hornD: 0x6a3418 };
const dGold = () => MS(DRC.gold, .15), drumRimGeo = new THREE.TorusGeometry(1, .07, 6, 24);
// a drum: body along its local y axis, head on top (+y). Returns { grp, head }.
function drumBody(par, x, y, z, R, H, body, face, emblem, rot) {
  const grp = new THREE.Group(); grp.position.set(x, y, z); if (rot) grp.rotation.set(...rot); par.add(grp);
  geo(grp, AG.cyl, MS(body), 0, 0, 0, R, H, R);
  for (const s of [-1, 1]) { const rg = geo(grp, drumRimGeo, dGold(), 0, s * H / 2, 0, R * 1.04, R * 1.04, 1, false); rg.rotation.x = BPI / 2; }
  // studs around both rims and rope zigzag
  for (let k = 0; k < 10; k++) { const a = k / 10 * BPI * 2; for (const s of [-1, 1]) geo(grp, AG.sph, dGold(), Math.cos(a) * R * 1.08, s * H / 2, Math.sin(a) * R * 1.08, .028, .028, .028, false); }
  if (H > .2) for (let k = 0; k < 10; k++) {
    const a0 = k / 10 * BPI * 2, a1 = (k + .5) / 10 * BPI * 2, up = k % 2 ? 1 : -1;
    const p0 = [Math.cos(a0) * R * 1.01, up * H * .38, Math.sin(a0) * R * 1.01], p1 = [Math.cos(a1) * R * 1.01, -up * H * .38, Math.sin(a1) * R * 1.01];
    const b = beam(grp, p0, p1, .022, .022, DRC.rope); b.castShadow = false;
  }
  const head = new THREE.Group(); head.position.y = H / 2 + .004; grp.add(head);
  geo(head, AG.cyl, MS(face), 0, 0, 0, R * .98, .02, R * .98, false);
  if (emblem === 'sun') {
    geo(head, AG.cyl, MS(DRC.gold, .35), 0, .014, 0, R * .3, .012, R * .3, false);
    for (let k = 0; k < 12; k++) { const a = k / 12 * BPI * 2, r = P(head, Math.cos(a) * R * .55, .014, Math.sin(a) * R * .55, R * .38, .01, R * .07, DRC.red, null, false); r.rotation.y = -a; }
  } else if (emblem === 'diamond') {
    const d = P(head, 0, .014, 0, R * .7, .012, R * .7, DRC.red, null, false); d.rotation.y = BPI / 4;
    const e = P(head, 0, .018, 0, R * .42, .012, R * .42, face, null, false); e.rotation.y = BPI / 4;
    const f = P(head, 0, .022, 0, R * .2, .012, R * .2, DRC.red, null, false); f.rotation.y = BPI / 4;
  } else if (emblem === 'hex') {
    geo(head, CG.hexY, ME(DRC.glow, .9), 0, .014, 0, R * .55, .012, R * .55, false);
    geo(head, CG.hexY, MS(face), 0, .02, 0, R * .36, .012, R * .36, false);
    geo(head, CG.hexY, ME(DRC.glow, 1.1), 0, .026, 0, R * .2, .012, R * .2, false);
  }
  return { grp, head };
}
// a pair of padded sticks resting on a drum head; the group swings on the beat
function drumSticks(par, x, y, z, rotY, len = .34) {
  const s = new THREE.Group(); s.position.set(x, y, z); s.rotation.y = rotY; par.add(s);
  for (const o of [-.05, .05]) {
    const st = new THREE.Group(); st.position.x = o; s.add(st);
    geo(st, AG.cyl, MS(DRC.woodD), 0, 0, len / 2, .022, len, .022, false).rotation.x = BPI / 2;
    geo(st, AG.cyl, dGold(), 0, 0, .02, .03, .05, .03, false).rotation.x = BPI / 2;
    geo(st, AG.sph, MS(0xf4ead8), 0, 0, len + .02, .05, .05, .05, false);
  }
  return s;
}
function brazier(par, x, z, y = .13) {
  geo(par, frust(.06, .09), MS(0x5e5a66), x, y + .05, z, 1, .1, 1);
  P(par, x, y + .11, z, .2, .03, .2, DRC.gold);
  const f = geo(par, AG.cone, ME(0xffa020, 1.3), x, y + .2, z, .06, .14, .06, false);
  geo(par, AG.cone, ME(0xffe070, 1.5), x, y + .18, z, .03, .08, .03, false);
  return f;
}
function swags(par, w, y, z, rotY = 0, n = 2) {
  const s = new THREE.Group(); s.position.set(0, y, z); s.rotation.y = rotY; par.add(s);
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + (i + .5) * w / n;
    const c = geo(s, new THREE.TorusGeometry(1, .22, 5, 10, BPI), MS(DRC.red), cx, 0, 0, w / n / 2 * .95, w / n / 2 * .5, .25, false); c.rotation.z = BPI;
    geo(s, AG.sph, dGold(), -w / 2 + i * w / n, .01, .02, .035, .035, .035, false);
  }
  geo(s, AG.sph, dGold(), w / 2, .01, .02, .035, .035, .035, false);
  return s;
}
function drumModel(t, g) {
  const L = Math.min(t.lvl, 3), sp = t.spec;
  stoneSlab(g, 0xd8c49c, 0xc4ad84);
  t.flag = null; t.beat = []; t.sticks = []; t.rings3 = null; t.horn = null; t.wisp = null;
  if (sp === 'a') {
    // War Horn: a wooden scaffold with a huge curled horn and a small drum
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { P(g, sx * .42, .42, sz * .42, .1, .6, .1, DRC.wood); geo(g, CG.pyr, dGold(), sx * .42, .78, sz * .42, .07, .1, .07, false); P(g, sx * .42, .7, sz * .42, .13, .05, .13, DRC.gold); }
    for (const s of [-1, 1]) { beam(g, [-.38, .16, s * .42], [.38, .66, s * .42], .05, .05, DRC.woodD); beam(g, [s * .42, .16, -.38], [s * .42, .66, .38], .05, .05, DRC.woodD); }
    P(g, 0, .7, 0, .9, .07, .9, DRC.woodL); P(g, 0, .66, 0, .92, .04, .92, DRC.woodD);
    for (const s of [-1, 1]) { P(g, s * .42, .86, 0, .03, .03, .84, DRC.wood); P(g, 0, .86, s * .42, .84, .03, .03, DRC.wood); }
    // stairs on the right side
    for (let k = 0; k < 4; k++) P(g, .5 + k * .0, .2 + k * .13, .3 - k * .14, .16, .05, .14, DRC.woodL);
    beam(g, [.58, .16, .4], [.58, .7, -.14], .03, .05, DRC.woodD);
    banner(g, -.05, .5, .47, .22, .3, DRC.red, null); banner(g, .47, .5, -.05, .16, .24, DRC.red, null, BPI / 2); banner(g, -.47, .5, -.05, .16, .24, DRC.red, null, -BPI / 2);
    // horn on a gold swivel
    geo(g, AG.cyl, dGold(), -.08, .77, -.02, .16, .06, .16, false); geo(g, AG.cyl, MS(0xc88a2a), -.08, .82, -.02, .12, .04, .12, false);
    const h = new THREE.Group(); h.position.set(-.08, .98, -.02); g.add(h); t.horn = h;
    geo(h, AG.cyl, dGold(), 0, .06, 0, .05, .34, .05, false); geo(h, AG.sph, dGold(), 0, .24, 0, .08, .08, .08, false);
    const pts = []; for (let i = 0; i <= 8; i++) { const u = i / 8; pts.push(new V3(-.42 + u * .9, .14 + Math.sin(u * BPI) * .12 + u * u * .18, .14 - u * .28)); }
    for (let i = 0; i < 8; i++) {
      const a = pts[i], b = pts[i + 1], u = i / 8, r0 = .25 * Math.pow(1 - u, 1.6) + .03, r1 = .25 * Math.pow(1 - (i + 1) / 8, 1.6) + .03;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 10), MS(i % 2 ? DRC.horn : DRC.hornD));
      m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new V3(0, 1, 0), b.clone().sub(a).normalize()); m.scale.y = a.distanceTo(b) * 1.08; m.castShadow = true; h.add(m);
      if (i % 2 === 0) { const band = m.clone(); band.material = dGold(); band.scale.set(1.1, m.scale.y * .28, 1.1); h.add(band); }
    }
    // bell: flared gold rim facing front-left
    const dir = pts[0].clone().sub(pts[1]).normalize();
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(.33, .25, .14, 12, 1, true), MS(DRC.horn)); bell.material.side = THREE.DoubleSide;
    bell.position.copy(pts[0]).addScaledVector(dir, .05); bell.quaternion.setFromUnitVectors(new V3(0, 1, 0), dir); h.add(bell);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.33, .035, 6, 16), dGold()); rim.position.copy(pts[0]).addScaledVector(dir, .12); rim.quaternion.setFromUnitVectors(new V3(0, 0, 1), dir); h.add(rim);
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(.3, 14), MS(0x2a140a)); mouth.position.copy(pts[0]).addScaledVector(dir, .02); mouth.quaternion.setFromUnitVectors(new V3(0, 0, 1), dir); h.add(mouth);
    const tip = pts[8]; const tb = banner(h, tip.x + .02, tip.y - .14, tip.z, .07, .14, DRC.red, null);
    t.hornMouth = rim;
    // small drum on the back right
    const d = drumBody(g, .22, .84, -.22, .13, .14, DRC.red, DRC.head, 'sun'); t.beat.push(d.head);
    t.sticks.push(drumSticks(g, .27, .95, -.32, -.6, .2));
    t.top = 1.6;
  } else if (sp === 'b') {
    // Hex Totem: a carved pole with glowing eyes over a purple drum
    for (const s of [-1, 1]) { beam(g, [s * .42, .14, .3], [s * .14, .7, .05], .1, .1, DRC.woodD); beam(g, [s * .42, .14, -.3], [s * .14, .7, -.05], .1, .1, DRC.woodD); P(g, s * .4, .2, .3, .14, .14, .14, DRC.gold); P(g, s * .4, .2, -.3, .14, .14, .14, DRC.gold); }
    const W = 0x8a4a26, WD = 0x6a3418, eye = ME(DRC.glow, 1.4);
    for (let k = 0; k < 3; k++) {
      const y = .62 + k * .42, f = new THREE.Group(); f.position.y = y; g.add(f);
      P(f, 0, 0, 0, .44 - k * .02, .38, .4, k % 2 ? WD : W);
      P(f, 0, .21, 0, .48 - k * .02, .05, .44, DRC.gold);
      for (const s of [-1, 1]) { P(f, s * .1, .07, .2, .1, .05, .02, 0, eye, false); P(f, s * .12, .13, .2, .14, .03, .03, WD); }
      if (k === 1) { P(f, 0, -.08, .205, .2, .08, .02, 0x2a140a); for (const s of [-1, 1]) aimB(geo(f, AG.cone, MS(0xf0e6d0), s * .07, -.06, .21, .025, .06, .025, false), [0, -1, 0]); }
      else { aimB(geo(f, AG.cone, MS(0xd08a3a), 0, -.02, .25, .05, .12, .05, false), [0, -.4, 1]); }
      if (k === 0) for (const s of [-1, 1]) aimB(geo(f, AG.cone, MS(0xf0e6d0), s * .06, -.14, .22, .025, .1, .025, false), [0, -1, .2]);
      P(f, 0, .02, .205, .03, .14, .02, 0, ME(DRC.glow, 1), false);
    }
    // crossbar with purple banners, bone charms and feathers
    P(g, 0, 1.36, 0, 1.1, .08, .08, DRC.wood); for (const s of [-1, 1]) { geo(g, CG.pyr, dGold(), s * .58, 1.36, 0, .05, .08, .05, false).rotation.z = -s * BPI / 2; banner(g, s * .44, 1.16, .06, .14, .26, DRC.purple, null); }
    for (const s of [-1, 1]) for (const o of [0, 1]) { const x = s * (.2 + o * .1); geo(g, AG.cone, MS(0xf0e6d0), x, 1.1 - o * .08, .08, .03, .16, .02, false).rotation.z = BPI; geo(g, AG.cone, MS(DRC.purple), x, .98 - o * .08, .08, .03, .08, .02, false).rotation.z = BPI; }
    // crown: gold hexagon gem with feathers
    const crown = new THREE.Group(); crown.position.set(0, 1.98, 0); g.add(crown);
    geo(crown, FG.hexZ, dGold(), 0, 0, 0, .18, .18, .06, false); geo(crown, FG.hexZ, ME(DRC.glow, 1.2), 0, 0, .03, .12, .12, .04, false);
    for (const s of [-1, 1]) { P(crown, s * .2, -.12, 0, .07, .26, .07, DRC.wood); for (const r of [.5, .9]) { const fe = geo(crown, AG.cone, MS(DRC.purple), s * .26, -.12, 0, .04, .22, .02, false); fe.rotation.z = -s * r; } }
    // drum at the foot
    const d = drumBody(g, 0, .3, .36, .22, .22, DRC.purpleD, DRC.head, 'hex', [.6, 0, 0]); t.beat.push(d.head);
    // swirling magic wisps
    const w = new THREE.Group(); w.position.set(0, 1.7, 0); g.add(w); t.wisp = w;
    for (let k = 0; k < 6; k++) { const a = k / 6 * BPI * 2; geo(w, AG.oct, ME(DRC.glow, 1.3), Math.cos(a) * .42, Math.sin(k * 2.1) * .2, Math.sin(a) * .42, .05, .05, .05, false); }
    t.top = 2.2;
  } else if (L === 1) {
    // Level 1: a single drum on a draped round stage, with a red flag
    geo(g, AG.cyl, MS(DRC.wood), 0, .22, 0, .46, .16, .46); geo(g, AG.cyl, dGold(), 0, .31, 0, .47, .035, .47, false);
    for (let k = 0; k < 6; k++) { const a = k / 6 * BPI * 2 + .3; const c = geo(g, new THREE.TorusGeometry(1, .22, 5, 8, BPI), MS(DRC.red), Math.cos(a) * .47, .23, Math.sin(a) * .47, .2, .1, .25, false); c.rotation.set(0, -a + BPI / 2, BPI); geo(g, AG.sph, dGold(), Math.cos(a + .52) * .48, .25, Math.sin(a + .52) * .48, .035, .035, .035, false); }
    for (const s of [-1, 1]) { P(g, s * .36, .5, -.04, .1, .38, .14, DRC.wood); geo(g, AG.cyl, dGold(), s * .42, .58, -.04, .06, .03, .06, false).rotation.z = BPI / 2; }
    P(g, 0, .36, .38, .12, .1, .1, DRC.woodL);
    const d = drumBody(g, 0, .6, 0, .32, .3, DRC.redD, DRC.head, null, [.75, 0, 0]); t.beat.push(d.head);
    t.sticks.push(drumSticks(d.head, -.04, .03, -.12, 0, .3));
    P(g, .36, .7, -.32, .05, 1.1, .05, DRC.woodD); geo(g, CG.pyr, dGold(), .36, 1.29, -.32, .05, .1, .05, false);
    const f = new THREE.Group(); f.position.set(.36, 1.08, -.32); g.add(f); P(f, .16, 0, 0, .3, .16, .02, DRC.red); aimB(geo(f, AG.cone, MS(DRC.red), .34, 0, 0, .08, .08, .015, false), [1, 0, 0]); t.flag = f;
    t.top = 1.3;
  } else if (L === 2) {
    // Level 2: a stage with two drums, banners and braziers
    P(g, 0, .3, 0, .9, .3, .78, DRC.wood); P(g, 0, .47, 0, .94, .05, .82, DRC.woodL);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { P(g, sx * .45, .33, sz * .39, .1, .4, .1, DRC.woodD); P(g, sx * .45, .55, sz * .39, .12, .06, .12, DRC.gold); }
    swags(g, .8, .38, .41, 0, 3); swags(g, .7, .38, .46, BPI / 2, 2);
    for (let k = 0; k < 3; k++) P(g, -.18, .17 + k * .1, .45 + k * -.03, .3, .05, .1, DRC.woodL);
    for (const s of [-1, 1]) { P(g, -.32, .6, -.12 + s * .16, .08, .2, .06, DRC.woodD); P(g, .27, .58, s * .12, .06, .16, .06, DRC.woodD); }
    const d1 = drumBody(g, -.28, .82, -.05, .27, .4, DRC.redD, DRC.head, 'diamond', [BPI / 2 - .25, .55, 0]); t.beat.push(d1.head);
    const d2 = drumBody(g, .22, .72, .08, .18, .3, DRC.redD, DRC.head, 'diamond', [BPI / 2 - .2, .55, 0]); t.beat.push(d2.head);
    for (const s of [-1, 1]) { P(g, s * .5, .8, -.34, .05, .9, .05, DRC.woodD); geo(g, CG.pyr, dGold(), s * .5, 1.27, -.34, .05, .1, .05, false); banner(g, s * .5, .98, -.3, .16, .28, DRC.red, null); }
    brazier(g, -.5, .48); brazier(g, .5, .48); brazier(g, 0, .56, .05);
    t.top = 1.4;
  } else {
    // Level 3: a stone tower with a sun drum on a railed platform
    geo(g, frust(.42, .38), MS(DRC.stone), 0, .5, 0, 1, .74, 1);
    for (let y = .2; y < .85; y += .16) for (const s of [-1, 1]) { P(g, s * .2, y, .43, .3, .02, .02, DRC.stoneD); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { P(g, sx * .42, .3, sz * .42, .14, .34, .14, DRC.gold); P(g, sx * .42, .5, sz * .42, .1, .1, .1, DRC.woodD); }
    P(g, 0, .9, 0, 1.0, .08, 1.0, DRC.woodL); P(g, 0, .85, 0, 1.02, .05, 1.02, DRC.gold);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { P(g, sx * .47, 1.0, sz * .47, .09, .16, .09, DRC.gold); }
    for (const s of [-1, 1]) { P(g, s * .47, 1.02, 0, .03, .04, .86, DRC.wood); P(g, 0, 1.02, s * .47, .86, .04, .03, DRC.wood); }
    swags(g, .9, .8, .52, 0, 3); swags(g, .9, .8, .52, BPI / 2, 3);
    // door banner with the sun
    P(g, 0, .46, .44, .26, .38, .03, DRC.gold); banner(g, 0, .45, .47, .2, .3, DRC.red, 'sun');
    for (const s of [-1, 1]) banner(g, s * .5, 1.2, .3, .14, .24, DRC.red, 'sun');
    for (const s of [-1, 1]) { P(g, s * .5, 1.2, .26, .04, .56, .04, DRC.woodD); geo(g, CG.pyr, dGold(), s * .5, 1.5, .26, .04, .08, .04, false); }
    // A-frame and the big drum facing the front
    for (const s of [-1, 1]) { beam(g, [s * .3, .94, .12], [s * .25, 1.45, 0], .07, .07, DRC.wood); beam(g, [s * .3, .94, -.15], [s * .25, 1.45, 0], .07, .07, DRC.wood); geo(g, AG.cyl, dGold(), s * .27, 1.45, 0, .06, .05, .06, false).rotation.z = BPI / 2; }
    const d = drumBody(g, 0, 1.45, 0, .36, .26, DRC.red, DRC.head, 'sun', [BPI / 2 - .12, 0, 0]); t.beat.push(d.head);
    t.sticks.push(drumSticks(g, 0, 1.02, .2, BPI * .9, .26));
    // golden sound rings that pulse with the beat
    const rr = new THREE.Group(); rr.position.set(0, 1.45, 0); g.add(rr); t.rings3 = rr;
    for (let k = 0; k < 3; k++) { const r = geo(rr, new THREE.TorusGeometry(1, .012, 4, 36), ME(0xffd060, 1.2), 0, (k - 1) * .1, 0, .5 + k * .08, .5 + k * .08, 1, false); r.rotation.x = BPI / 2; r.material = r.material.clone(); r.material.transparent = true; r.material.opacity = .7; }
    t.top = 1.9;
  }
}

// ================================================================ War Drum: a support tower that speeds up the towers around it (Phase 3)
// haste = fire rate boost, rngB = range boost for boosted towers (War Horn), hex = extra damage enemies take in its radius (Hex Totem)
const DRUM = {
  1: { haste: .15, rad: 5.0 },
  2: { haste: .20, rad: 5.5 },
  3: { haste: .30, rad: 6.0 },
  a: { haste: .30, rad: 6.0, rngB: .20 },
  b: { haste: .30, rad: 6.0, hex: .15 },
};
function drumStat(k, rank = 1) {
  const d = Object.assign({}, DRUM[k]), r = rank - 1;
  d.haste = +(d.haste + .05 * r).toFixed(2); d.rad = +(d.rad + .3 * r).toFixed(1);
  if (d.rngB) d.rngB = +(d.rngB + .05 * r).toFixed(2); if (d.hex) d.hex = +(d.hex + .05 * r).toFixed(2);
  if (SKX()) { if (skH('drum.root')) d.haste = +(d.haste + .02).toFixed(2); if (skH('drum.beat')) d.haste = +(d.haste + .03).toFixed(2); if (skH('drum.hide')) d.rad = +(d.rad + .5).toFixed(1); if (k === 'a' && skH('drum.hornm')) d.rngB = +(d.rngB + .1).toFixed(2); if (k === 'b' && skH('drum.totem')) d.hex = +(d.hex + .07).toFixed(2); }
  return d;
}
const drumAsStat = d => ({ dmg: 0, range: d.rad, rate: 1, dps: 0, haste: d.haste, rngB: d.rngB || 0, hex: d.hex || 0 });
const dpct = v => Math.round(v * 100) + '%';
const drumRingGeo = new THREE.RingGeometry(.94, 1, 56).rotateX(-Math.PI / 2);
let drumRings = [];
function drumPulse(t) {
  const col = t.spec === 'b' ? 0xc860ff : 0xffc040;
  const m = new THREE.Mesh(drumRingGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .45, depthWrite: false }));
  m.position.set(t.x, groundY(t.x, t.z) + .12, t.z); m.scale.setScalar(.3); m.renderOrder = 3; scene.add(m);
  drumRings.push({ m, t: 0, r: t.st.range });
}
function clearDrumRings() { for (const r of drumRings) { scene.remove(r.m); r.m.material.dispose(); } drumRings = []; }
// once a frame: work out each tower's boost and each enemy's hex
function drumPass(dt) {
  if (game.standT > 0) game.standT -= dt;
  if (skH('kingdom.slits') && game.castleP && game.state === 'play') { // Arrow Slits: the castle shoots
    game.slitT = (game.slitT || 0) - dt;
    if (game.slitT <= 0) { const c = game.castleP; let best = null, bd = 16; for (const e of enemies) { if (!e.alive) continue; const d2 = (e.g.position.x - c.x) ** 2 + (e.g.position.z - c.z) ** 2; if (d2 < bd) { bd = d2; best = e; } } if (best) { game.slitT = 1; projs.push(new Arrow(new V3(c.x, c.y + 2.6, c.z), best, 8)); } }
  }
  { const fb = skH('frost.bite'); for (const e of enemies) { if (!e.alive) continue; // timed effects from the skill tree
    if (e.markT > 0) e.markT -= dt;
    if (e.bleedT > 0) { e.bleedT -= dt; hurt(e, 4 * dt, 'phys', true); if (!e.alive) continue; }
    if (fb && e.slow > 0) hurt(e, 2 * dt, 'magic', true); } }
  const drums = towers.filter(t => t.type === 'drum' && t.buildT >= 1 && !(t.stunT > 0));
  for (const t of towers) {
    if (t.type === 'drum') continue;
    let h = 0, h2 = 0, rb = 0;
    for (const d of drums) { const s = d.ds, r = s.rad; if ((d.x - t.x) ** 2 + (d.z - t.z) ** 2 <= r * r) { if (s.haste > h) { h2 = h; h = s.haste; } else h2 = Math.max(h2, s.haste); rb = Math.max(rb, s.rngB || 0); } }
    if (skH('drum.twin')) h += h2 * .5;
    if (game.standT > 0) h = Math.max(h, .3);
    t.haste = h; t.rngB = t.type === 'barracks' ? 0 : rb;
    if (h && t.buildT >= 1 && Math.random() < dt * 1.6) glow.spawn(t.x + rand(-.35, .35), 1.1 + rand(0, t.top * TS * .8), t.z + rand(-.35, .35), 0, rand(.8, 1.6), 0, rand(.5, .9), rand(.05, .09), rb ? 0xffe070 : 0xffa030, 0, F_SPIN, 1, 0xc85a10);
  }
  const hexers = drums.filter(d => d.ds.hex);
  for (const e of enemies) {
    let x = 0;
    if (hexers.length && e.alive) for (const d of hexers) { const r = d.ds.rad; if ((d.x - e.g.position.x) ** 2 + (d.z - e.g.position.z) ** 2 <= r * r) x = Math.max(x, d.ds.hex); }
    e.hex = x;
    if (x && Math.random() < dt * 3) glow.spawn(e.center.x + rand(-.2, .2), e.center.y + rand(-.1, .3), e.center.z + rand(-.2, .2), 0, rand(.4, .9), 0, rand(.4, .7), rand(.04, .07), 0xd060ff, 0, F_SPIN, 1, 0x6a1aa0);
  }
  for (const r of drumRings) { r.t += dt; const k = r.t / 1.1; r.m.scale.setScalar(.3 + (r.r - .3) * (1 - Math.pow(1 - Math.min(1, k), 2))); r.m.material.opacity = .45 * Math.max(0, 1 - k); }
  drumRings = drumRings.filter(r => { if (r.t < 1.1) return true; scene.remove(r.m); r.m.material.dispose(); return false; });
}
// AI: what a drum is worth = the damage of the towers it would boost
function drumValue(x, z, s) {
  let v = 0;
  for (const t of towers) {
    if (t.type === 'drum' || t.type === 'barracks' || (t.x - x) ** 2 + (t.z - z) ** 2 > s.range * s.range) continue;
    const st = t.st, base = coverage(t.spot, st.range) * st.dps;
    v += base * Math.max(0, (s.haste - (t.haste || 0)) + (s.rngB || 0) * .6 + (s.hex || 0));
  }
  return v * .35; // coverage here ignores kill pressure, so damage towers' scores run lower
}

class Tower {
  constructor(type, spot, instant, ghost = false) {
    this.type = type; this.def = TT[type]; this.spot = spot; this.lvl = 1; this.ghost = ghost;
    this.x = spot.x; this.z = spot.z; this.mode = type === 'flame' ? 'close' : 'first';
    if (!ghost) { spot.used = true; for (const s of spots) if (Math.abs(s.gx - spot.gx) <= 1 && Math.abs(s.gz - spot.gz) <= 1) s.block++; }
    this.g = new THREE.Group(); this.g.position.set(this.x, 1, this.z); scene.add(this.g);
    this.cool = rand(0, this.def.rate); this.target = null; this.retarget = 0; this.lastFire = -9; this.alt = 0;
    this.buildT = instant ? 1 : 0; this.bounce = 0; this.recoil = 0; this.spend = this.def.cost;
    this.spec = null; this.rank = 0; this.charge = 1; this.lastBeam = null; this.auraT = 0; this.napT = 0;
    this.ab = {}; this.cd = { finish: 0, snap: 0, ember: 0, flashover: 0, surge: 0, debt: 0 }; this.shots = 0; this.held = null; this.holdT = 0; this.lastHit = null; this.hitN = 0;
    this.build(); this.g.scale.setScalar(TS);
    if (!instant) { fxDust(new V3(this.x, 1, this.z), 16, .4); this.g.scale.set(TS, .01, TS); }
  }
  get st() { const s = this.spec ? specStat(this.type, this.spec, this.rank) : tStat(this.type, this.lvl); if (this.rngB) s.range *= 1 + this.rngB; return s; }
  build() {
    const g = this.g; while (g.children.length) { const c = g.children[0]; if (c.userData.merged) c.geometry.dispose(); g.remove(c); }
    const L = Math.min(this.lvl, 3), sp = this.spec, hs = 1 + .3 * (L - 1) + (sp ? .1 + .07 * this.rank : 0);
    this.aura = null; this.crystal = this.orbM = this.arcs = null;
    this.head = new THREE.Group(); this.muzzle = new THREE.Object3D(); this.top = 1;
    
    const tc = this.def.col;
    if (this.type === 'arrow') {
      archerModel(this, g);
    } else if (this.type === 'cannon') {
      cannonModel(this, g);
    } else if (this.type === 'frost') {
      frostModel(this, g);
    } else if (this.type === 'tesla') {
      teslaModel(this, g);
    } else if (this.type === 'flame') {
      flameModel(this, g);
    } else if (this.type === 'barracks') {
      barracksModel(this, g);
    } else if (this.type === 'drum') {
      drumModel(this, g); this.ds = drumStat(this.spec || Math.min(this.lvl, 3), this.spec ? this.rank : 1);
    }
    if (this.muzzle !== this.head && !this.muzzle.parent) this.head.add(this.muzzle);
    g.add(this.head);
    // banner + level pips
    const bh = this.top + .3;
    const arch = true, pipY = this.type === 'arrow' ? .18 : .06;
    if (!arch) { P(g, .44, .24 + bh / 2, -.44, .05, bh, .05, 0x3a3030); P(g, .62, .24 + bh - .18, -.44, .32, .28, .03, tc); }
    const pips = Math.min(this.lvl, 3) + this.rank;
    for (let i = 0; i < pips; i++) P(g, -(pips - 1) * .08 + i * .16, arch ? pipY : .14, arch ? .585 : .51, .12, .12, .04, 0, i >= 3 ? ME(0xd07aff, 1.2) : ME(0xffd040, .7), false);
    if (this.rank >= 3 && !arch) P(g, .62, .24 + bh - .42, -.44, .32, .12, .03, 0, ME(0xffd040, .5), false);
    mergeStatic(g); mergeStatic(this.head);
    { const sp = this.spec, ty = this.type; // abilities the skill tree switches on for this tower
      this.ab = { finish: ty === 'arrow' && sp === 'a' && skH('arrow.head'), shock: ty === 'cannon' && sp !== 'b' && skH('cannon.shaker'), wide: ty === 'cannon' && sp === 'b' && skH('cannon.scatter'),
        brittleice: ty === 'frost' && skH('frost.brittle'), flash: ty === 'frost' && sp === 'a' && skH('frost.perma'), trail: ty === 'frost' && sp === 'b' && skH('frost.black'), snap: ty === 'frost' && sp === 'b' && skH('frost.aval'),
        static: ty === 'tesla' && sp !== 'b' && skH('tesla.static'), fork: ty === 'tesla' && sp !== 'b' && skH('tesla.ball'), surge: ty === 'tesla' && sp === 'b' && skH('tesla.melt'),
        flashover: ty === 'flame' && sp === 'b' && skH('flame.inf'), brand: ty === 'flame' && sp === 'b' && skH('flame.hungry'), ember: ty === 'flame' && sp === 'a' && skH('flame.wall') }; }
    if (this.type === 'barracks' && !this.ghost && this.spot.gx >= 0) this.refreshSoldiers();
    if (this.ghost) g.traverse(o => { if (o.isMesh) { o.material = ghostMat; o.castShadow = false; } });
  }
  rankUp() {
    this.rank++; this.build(); this.bounce = 1;
    for (let i = 0; i < 36; i++) glow.spawn(this.x + rand(-.5, .5), 1.2 + rand(0, this.top * TS), this.z + rand(-.5, .5), rand(-.5, .5), rand(1.5, 3.5), rand(-.5, .5), rand(.6, 1.1), rand(.06, .14), pick([0xd07aff, 0xffd860]), 0, F_SPIN, 1, 0x4a0a80);
    fxDust(new V3(this.x, 1, this.z), 8, .3);
  }
  setSpec(k) {
    this.spec = k; this.lvl = 4; this.rank = 1; if ((this.type === 'arrow' && k === 'a') || (this.type === 'frost' && k === 'a') || (this.type === 'flame' && k === 'b')) this.mode = 'strong';
    this.build(); this.bounce = 1.2; this.target = null;
    for (let i = 0; i < 50; i++) glow.spawn(this.x + rand(-.6, .6), 1.2 + rand(0, this.top * TS), this.z + rand(-.6, .6), rand(-.8, .8), rand(2, 4.5), rand(-.8, .8), rand(.7, 1.3), rand(.08, .16), pick([0xd07aff, 0xffd860]), 0, F_SPIN, 1, 0x6a1aa0);
    fxDust(new V3(this.x, 1, this.z), 12, .35); flashLight(new V3(this.x, 2, this.z), 60, 0xd07aff);
  }
  upgrade() {
    this.lvl++; this.build(); this.bounce = 1;
    for (let i = 0; i < 30; i++) glow.spawn(this.x + rand(-.5, .5), 1.2 + rand(0, this.top), this.z + rand(-.5, .5), rand(-.5, .5), rand(1.5, 3.5), rand(-.5, .5), rand(.6, 1.1), rand(.06, .14), 0xffd860, 0, F_SPIN, 1, 0xff8a00);
    fxDust(new V3(this.x, 1, this.z), 8, .3);
  }
  remove() { scene.remove(this.g); this.g.traverse(o => { if (o.userData.merged) o.geometry.dispose(); }); }
  canHit(e) { return e.alive && (this.def.air || !e.def.air); }
  findTarget(range) {
    let best = null, bd = -1; const r2 = range * range;
    for (const e of enemies) {
      if (!this.canHit(e) || this.tooClose(e)) continue;
      const dx = e.g.position.x - this.x, dz = e.g.position.z - this.z;
      if (dx * dx + dz * dz > r2) continue;
      const m = this.mode, score = m === 'close' ? -(dx * dx + dz * dz) : m === 'last' ? -e.d : m === 'strong' ? e.hp : e.d + (e.type === 'boss' ? 3 : 0);
      if (score > bd || best === null) { bd = score; best = e; }
    }
    return best;
  }
  inRange(e, range) { const dx = e.g.position.x - this.x, dz = e.g.position.z - this.z; return dx * dx + dz * dz <= range * range; }
  update(dt) {
    const t = game.time;
    if (this.buildT < 1) {
      this.buildT = Math.min(1, this.buildT + dt * .9);
      const k = this.buildT, e = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);
      this.g.scale.set(TS, TS * Math.max(.01, e), TS);
      if (Math.random() < dt * 20) fxDust(new V3(this.x + rand(-.5, .5), 1, this.z + rand(-.5, .5)), 1, .25);
      if (k < .75) return;
    }
    if (this.bounce > 0) { this.bounce = Math.max(0, this.bounce - dt * 2.2); const s = 1 + Math.sin(this.bounce * 9) * this.bounce * .12; this.g.scale.set(TS / Math.sqrt(s), TS * s, TS / Math.sqrt(s)); }
    if (this.stunT > 0) { this.stunT -= dt; if (Math.random() < dt * 10) smoke.spawn(this.x + rand(-.4, .4), 1 + this.top * TS, this.z + rand(-.4, .4), 0, .8, 0, .9, .25, 0x4a4a4a, 0, F_GROW | F_SPIN, 1, 0x8a8a8a); if (Math.random() < dt * 6) fxSparks(new V3(this.x, 1 + this.top * TS * .7, this.z), 0xffc060, 2, 2); return; } // knocked out by a sapper
    // idle anims
    if (this.crystal) {
      this.crystal.rotation.y += dt * 1.5; this.head.position.y = this.top - .5 + Math.sin(t * 2 + this.x) * .1;
      this.orb.forEach((o, i) => { const a = t * 2.4 + i * 6.28 / this.orb.length; o.position.set(Math.cos(a) * .5, Math.sin(a * 2) * .15, Math.sin(a) * .5); o.rotation.y = a; });
    }
    if (this.orbM) { this.orbM.rotation.y += dt * 2; const f = .9 + Math.random() * .3; this.orbM.scale.copy(this.orbB).multiplyScalar(f); if (Math.random() < dt * 3) { this.g.updateMatrixWorld(true); const a = this.head.getWorldPosition(new V3()); bolt(a, a.clone().add(new V3(rand(-.7, .7), rand(-.6, .1), rand(-.7, .7))), 0x8ac8ff); } }
    if (this.arcs && Math.random() < dt * 5) { this.g.updateMatrixWorld(true); const [p, q] = pick(this.arcs); bolt(p.getWorldPosition(new V3()), q.getWorldPosition(new V3()), this.spec === 'a' ? 0x7ae8ff : 0xc890ff); }
    if (this.flag) this.flag.rotation.y = Math.sin(t * 3 + this.x) * .22;
    if (this.type === 'barracks') { if (this.sun) this.sun.rotation.z += dt; this.barracksTick(dt); return; }
    if (this.type === 'drum') { this.drumTick(dt); return; }
    if (this.recoil > 0) { this.recoil = Math.max(0, this.recoil - dt * 3); if (this.barrel) this.barrel.position.z = (this.barrelZ || 0) - this.recoil * .18; }
    if (this.type === 'flame' && Math.random() < dt * 12) { this.g.updateMatrixWorld(true); const m = this.muzzle.getWorldPosition(_w); glow.spawn(m.x, m.y, m.z, 0, .5, 0, .25, .08, FIRE1, 0, 0, 0, FIRE2); }
    const st = this.st, ab = this.ab;
    for (const k in this.cd) this.cd[k] -= dt;
    // timed abilities that do not need the current target
    if (ab.finish && this.cd.finish <= 0) {
      let w = null; for (const o of enemies) if (this.canHit(o) && this.inRange(o, st.range) && o.hp / o.maxHp < .4 && (!w || o.hp < w.hp)) w = o;
      if (w) { this.cd.finish = 4; this.g.updateMatrixWorld(true); projs.push(new Arrow(this.muzzle.getWorldPosition(new V3()), w, st.dmg * 2, true, { gold: true })); }
    }
    if (ab.snap && this.cd.snap <= 0) {
      this.cd.snap = 6; let n = 0;
      for (const o of enemies) { if (n >= 3 || !o.alive || o.def.air) continue; if (icePatches.some(p => p.tw === this && (o.g.position.x - p.x) ** 2 + (o.g.position.z - p.z) ** 2 < 1.6)) { freezeEnemy(o, 1.2, this); n++; } }
    }
    if (ab.ember && this.cd.ember <= 0) {
      const cand = SAMPLES.filter(p => (p.x - this.x) ** 2 + (p.z - this.z) ** 2 < st.range * st.range);
      if (cand.length) { this.cd.ember = 6; const c = pick(cand); for (let k = 0; k < 3; k++) { const q = pathAt(c.P, c.d + k, new V3()); patches.push({ x: q.x, z: q.z, t: 4, tick: 0 }); } }
    }
    if (ab.flashover && this.cd.flashover <= 0) {
      const src = enemies.find(o => o.alive && o.burn > 0 && this.inRange(o, st.range + 1));
      if (src) {
        let nb = null, nd = 4;
        for (const o of enemies) { if (!o.alive || o === src || o.def.air || o.burn > 0) continue; const d2 = o.center.distanceToSquared(src.center); if (d2 < nd) { nd = d2; nb = o; } }
        if (nb) { this.cd.flashover = 1.5; nb.burn = ab.brand ? 4 : 1.6; hurt(nb, st.dmg * 3, 'true'); for (let k = 0; k < 10; k++) { const f = k / 10; glow.spawn(lerp(src.center.x, nb.center.x, f), lerp(src.center.y, nb.center.y, f) + Math.sin(f * 3.14) * .6, lerp(src.center.z, nb.center.z, f), 0, .5, 0, .4, .14, FIRE1, 0, F_SPIN, 1, FIRE2); } }
      }
    }
    this.retarget -= dt;
    if (!this.target || !this.canHit(this.target) || !this.inRange(this.target, st.range) || this.tooClose(this.target) || this.retarget <= 0) { this.target = this.findTarget(st.range); this.retarget = .25; }
    const e = this.target;
    if (e && e === this.held) this.holdT += dt; else { this.held = e; this.holdT = 0; }
    this.cool -= dt;
    if (!e) return;
    const yaw = Math.atan2(e.g.position.x - this.x, e.g.position.z - this.z);
    if (!this.crystal && !this.orbM) this.head.rotation.y = lerpAngle(this.head.rotation.y, yaw, 1 - Math.exp(-10 * dt));
    if (this.cool > 0) return;
    this.cool = st.rate; this.lastFire = t; this.shots++;
    this.g.updateMatrixWorld(true);
    const mz = new V3();
    const sp = this.spec;
    if (this.type === 'arrow') {
      this.muzzle.getWorldPosition(mz);
      const opts = { pierce: Math.max(ab.pierce && this.shots % 3 === 0 ? .5 : 0, sp === 'a' && skH('arrow.long') ? .25 : 0), flak: ab.flak, pin: ab.pin && this.shots % 3 === 0,
        sky: skH('arrow.sky'), mark: skH('arrow.mark'), bleed: sp === 'b' && skH('arrow.bleed'), dead: sp === 'a' && skH('arrow.dead') };
      projs.push(new Arrow(mz, e, st.dmg * (skH('arrow.barb') && this.shots % 5 === 0 ? 2 : 1), sp === 'a', opts));
      if (sp === 'b' && skH('arrow.storm') && t - (this.rainAt ?? -99) >= 8) { // Arrow Storm
        this.rainAt = t; const near = enemies.filter(o => o.alive && o.center.distanceToSquared(e.center) < 4);
        for (let k = 0; k < 12 && near.length; k++) projs.push(new Arrow(mz.clone().add(new V3(rand(-.6, .6), 2.5, rand(-.6, .6))), pick(near), st.dmg * .5, false, opts));
      }
      if (sp === 'b') { const more = enemies.filter(o => o !== e && this.canHit(o) && this.inRange(o, st.range)).sort((a, b) => b.d - a.d).slice(0, 1 + this.rank + (skH('arrow.vol') ? 1 : 0)); for (const o of more) projs.push(new Arrow(mz.clone().add(new V3(rand(-.3, .3), 0, rand(-.3, .3))), o, st.dmg, false, opts)); }
      if (this.lvl === 3) { const e2 = enemies.find(o => o !== e && this.canHit(o) && this.inRange(o, st.range)); if (e2) projs.push(new Arrow(mz.clone().add(new V3(rand(-.2, .2), 0, rand(-.2, .2))), e2, st.dmg)); }
    } else if (this.type === 'cannon') {
      const m = this.muzzles[this.alt++ % this.muzzles.length]; m.getWorldPosition(mz);
      this.recoil = 1; fxSmoke(mz, 4, 0x8a8a8a, .3); fxSparks(mz, 0xffc060, 6, 2.5); flashLight(mz, 25);
      if (sp === 'b') { // scattergun: an instant cone blast
        const dir = new V3(e.g.position.x - this.x, 0, e.g.position.z - this.z).normalize(), cosA = ab.wide ? .57 : .82;
        for (let k = 0; k < 18; k++) { const a = Math.atan2(dir.x, dir.z) + rand(-1, 1) * Math.acos(cosA), v = rand(9, 14); glow.spawn(mz.x, mz.y, mz.z, Math.sin(a) * v, rand(-1.5, .5), Math.cos(a) * v, st.range / v, rand(.06, .1), 0xffe0a0, 0, F_SPIN, 0, 0x803000); }
        for (const o of enemies) {
          if (!o.alive || o.def.air) continue;
          const dx = o.g.position.x - this.x, dz = o.g.position.z - this.z, dd = Math.hypot(dx, dz);
          if (dd > st.range + .3 || (dx * dir.x + dz * dir.z) / (dd || 1) < cosA) continue;
          hurt(o, st.dmg, 'phys'); fxSparks(o.center, 0xfff0c0, 3, 2);
          if (o.alive && skH('cannon.knock') && o.type !== 'boss' && o.type !== 'gruk') o.d = Math.max(0, o.d - .6);
        }
        if (skH('cannon.breath')) patches.push({ x: e.g.position.x, z: e.g.position.z, t: 3, tick: 0 });
        if (ab.shrap) shrapnel.push({ x: e.g.position.x, z: e.g.position.z, t: 6, hits: 4, dmg: st.dmg * .4, hit: new Set() });
        return;
      }
      const spl = (sp === 'a' ? 2.8 + .2 * this.rank : this.def.splash + .25 * (Math.min(this.lvl, 3) - 1)) * (skH('cannon.powder') ? 1.12 : 1);
      projs.push(new Cannonball(mz, e, st.dmg, spl, sp === 'a' && skH('cannon.cluster'), sp === 'a' ? 1.8 : 1, { shock: ab.shock && this.shots % 3 === 0, delay: ab.delay, pierce: sp === 'a' ? mortarPierce(this.rank) + (skH('cannon.sapper') ? .1 : 0) : 0, conc: skH('cannon.conc'), iron: skH('cannon.iron'), boss: sp === 'a' && skH('cannon.bunker') }));
    } else if (this.type === 'frost') {
      this.muzzle.getWorldPosition(mz); projs.push(new Shard(mz, e, st.dmg, Math.min(this.lvl, 3), sp, this));
      if (skH('frost.mirror')) { const e2 = enemies.find(o => o !== e && this.canHit(o) && this.inRange(o, st.range)); if (e2) projs.push(new Shard(mz.clone(), e2, st.dmg * .4, Math.min(this.lvl, 3), sp, this)); }
    } else if (this.type === 'tesla') {
      this.muzzle.getWorldPosition(mz);
      if (sp === 'b') {
        if (e !== this.lastBeam) this.charge = ab.resid && this.lastBeam && !this.lastBeam.alive ? Math.max(1, this.charge * .6) : 1;
        else this.charge = Math.min(overloadCap(this.rank), this.charge + (overloadCap(this.rank) - 1) * st.rate / (skH('tesla.over') ? 2 : 3));
        this.lastBeam = e;
        boltOuter.color.setHex(0xff7af0); seg(mz, e.center, .1 + .05 * this.charge, boltOuter, .13); seg(mz, e.center, .05, boltCore, .13);
        hurt(e, st.dmg * this.charge, 'magic', Math.random() < .6);
        if (skH('tesla.spill')) { let nb = null, nd = 2.2 * 2.2; for (const o of enemies) { if (!o.alive || o === e) continue; const d2 = o.center.distanceToSquared(e.center); if (d2 < nd) { nd = d2; nb = o; } } if (nb) { seg(e.center, nb.center, .05, boltCore, .1); hurt(nb, st.dmg * this.charge * .35, 'magic', true); } }
        if (Math.random() < .5) fxSparks(e.center, 0xffb0f8, 3, 2.5);
        if (Math.random() < .15) flashLight(e.center, 15 + 10 * this.charge, 0xff7af0);
        if (ab.surge && this.charge >= 3.99 && this.cd.surge <= 0 && e.alive) {
          this.cd.surge = 6; const c = e.center.clone();
          hurt(e, st.dmg * 12, 'magic');
          for (const o of enemies) if (o.alive && o !== e && o.center.distanceToSquared(c) < 2.25) hurt(o, st.dmg * 6, 'magic');
          for (let k = 0; k < 6; k++) bolt(c, c.clone().add(new V3(rand(-1.6, 1.6), rand(-.5, 1.2), rand(-1.6, 1.6))), 0xff7af0);
          fxSparks(c, 0xffb0f8, 24, 6); flashLight(c, 90, 0xff7af0); addShake(c, .2);
        }
        return;
      }
      const hit = new Set();
      const chain = (from, cur, n, falloff) => {
        let dmg = st.dmg;
        for (let k = 0; k < n && cur; k++) {
          bolt(from, cur.center, k === 0 ? 0x6ab0ff : 0x9a7bff);
          fxSparks(cur.center, 0xb8e0ff, 6, 3);
          hit.add(cur); if (ab.static) { cur.shockT = 2; cur.shockDmg = st.dmg * .3; } hurt(cur, dmg * (cur.def.air && skH('tesla.rod') ? 1.25 : 1), 'magic'); dmg *= falloff;
          from = cur.center.clone();
          const jr = sp === 'a' && skH('tesla.super') ? 4.5 : 3.2; let nb = null, nd = jr * jr;
          for (const o of enemies) { if (!o.alive || hit.has(o)) continue; const d2 = o.center.distanceToSquared(from); if (d2 < nd) { nd = d2; nb = o; } }
          cur = nb;
        }
      };
      const n = (sp === 'a' ? 7 + this.rank + (skH('tesla.storm') ? 2 : 0) : this.def.chain + this.lvl - 1) + (skH('tesla.cond') ? 1 : 0), fo = sp === 'a' ? (skH('tesla.thunder') ? .92 : .85) : .72;
      chain(mz, e, n, fo);
      if (ab.fork && this.shots % 3 === 0) { const e2 = enemies.find(o => o.alive && !hit.has(o) && this.inRange(o, st.range)); if (e2) chain(mz.clone(), e2, n, fo); }
      flashLight(mz, 30, 0x88bbff);
    } else if (this.type === 'flame') {
      this.muzzle.getWorldPosition(mz);
      const dir = new V3().subVectors(e.center, mz); const dist = dir.length(); dir.normalize();
      const narrow = sp === 'b';
      for (let k = 0; k < 7; k++) {
        const v = rand(5, 8), sp2 = narrow ? .35 : .8;
        glow.spawn(mz.x, mz.y, mz.z, dir.x * v + rand(-sp2, sp2), dir.y * v + rand(-.3, 1), dir.z * v + rand(-sp2, sp2), dist / v * rand(.8, 1.15), rand(.12, .26) * (narrow ? 1.2 : 1), narrow ? 0xfff0a0 : FIRE1, -1.5, F_SPIN | F_GROW, .6, narrow ? 0xc02000 : FIRE2);
      }
      if (Math.random() < .3) smoke.spawn(e.center.x, e.center.y + .4, e.center.z, rand(-.3, .3), 1.4, rand(-.3, .3), 1.2, .25, 0x2a2a2a, 0, F_GROW | F_SPIN, 1, 0x6a6a6a);
      if (sp === 'a') { this.napT -= st.rate; if (this.napT <= 0) { this.napT = .6; patches.push({ x: e.g.position.x + rand(-.3, .3), z: e.g.position.z + rand(-.3, .3), t: 3 + this.rank + (skH('flame.line') ? 2 : 0), tick: 0 }); } }
      const burnT = (ab.brand ? 4 : 1.6) + (skH('flame.fuel') ? 1 : 0), oil = o => { if (o.alive && skH('flame.oil')) { o.slowF = Math.min(o.slow > 0 ? o.slowF : 1, .85); o.slow = Math.max(o.slow, .6); } };
      if (narrow) {
        hurt(e, st.dmg, 'true', Math.random() < .7); e.burn = Math.max(e.burn, burnT); oil(e);
        if (ab.debt && this.cd.debt <= 0) { this.cd.debt = 3; const bonus = st.dmg * 10 * (1 + Math.min(this.holdT, 10) / 5); hurt(e, bonus, 'true'); for (let k = 0; k < 14; k++) glow.spawn(e.center.x, e.center.y, e.center.z, rand(-2, 2), rand(1, 4), rand(-2, 2), .6, .16, 0xffffff, 3, F_SPIN, 1, 0xff4000); flashLight(e.center, 40, 0xff7a20); }
        return;
      }
      const fx = dir.x, fz = dir.z, fl = Math.hypot(fx, fz) || 1;
      for (const o of enemies) {
        if (!o.alive || o.def.air) continue;
        const dx = o.g.position.x - this.x, dz = o.g.position.z - this.z, dd = Math.hypot(dx, dz);
        if (dd > st.range + .3) continue;
        if ((dx * fx + dz * fz) / (fl * (dd || 1)) > (skH('flame.nozzle') ? .77 : .82) || o === e) { hurt(o, st.dmg, 'true', Math.random() < .7); o.burn = Math.max(o.burn, burnT); oil(o); }
      }
    }
  }
  tooClose(e) { const md = mortarDead(); return this.type === 'cannon' && this.spec === 'a' && (e.g.position.x - this.x) ** 2 + (e.g.position.z - this.z) ** 2 < md * md; }
}

// ================================================================ projectiles
let projs = [];
const arrowMats = [M(0x6a4422), M(0xeeeeee), M(0x9a9aa2)];
class Arrow {
  constructor(p, e, dmg, big = false, opts = {}) {
    this.o = opts;
    this.g = new THREE.Group(); P(this.g, 0, 0, 0, .05, .05, .55, 0, arrowMats[0], false); P(this.g, 0, 0, -.24, .1, .02, .12, 0, arrowMats[1], false); P(this.g, 0, 0, .29, .07, .07, .08, 0, arrowMats[2], false);
    this.s = p.clone(); this.e = e; this.dmg = dmg; this.last = e.center.clone();
    const d = p.distanceTo(this.last); this.T = d / (big ? 26 : 17) + .05; this.t = 0; this.arc = d * (big ? .03 : .07);
    if (big) this.g.scale.set(2, 2, 1.6);
    if (opts.gold) this.g.children.forEach(c => c.material = ME(0xffd040, .8));
    this.g.position.copy(p); scene.add(this.g); this.prev = p.clone();
  }
  update(dt) {
    this.t += dt; const s = Math.min(1, this.t / this.T);
    if (this.e.alive) this.last.copy(this.e.center);
    this.prev.copy(this.g.position);
    this.g.position.lerpVectors(this.s, this.last, s); this.g.position.y += this.arc * 4 * s * (1 - s);
    _w.copy(this.g.position).multiplyScalar(2).sub(this.prev); this.g.lookAt(_w);
    if (s >= 1) {
      const e = this.e, o = this.o;
      if (e.alive) {
        let dm = this.dmg * (o.sky && e.def.air ? 1.2 : 1);
        if (o.dead && Math.random() < .12) { if (e.type === 'boss' || e.type === 'gruk') dm *= 3; else { dm = 0; hurt(e, e.hp * 50 + 999, 'true'); fxSparks(e.center, 0xffd040, 14, 4); } }
        if (dm) hurt(e, dm, 'phys', false, o.pierce || 0); fxSparks(this.g.position, o.pierce ? 0xff9a4a : 0xfff0c0, o.pierce ? 8 : 4, 2.5);
        if (e.alive && o.mark) e.markT = 2;
        if (e.alive && o.bleed) e.bleedT = 3;
        if (o.pierce2 && Math.random() < .25) { const o2 = enemies.find(q => q.alive && q !== e && q.center.distanceToSquared(e.center) < 2.25); if (o2) { hurt(o2, this.dmg, 'phys'); fxSparks(o2.center, 0xfff0c0, 4, 2.5); } }
        if (o.pin && e.alive) { e.slow = Math.max(e.slow, 1.5); e.slowF = Math.min(e.slow > 0 ? e.slowF : 1, .5); }
        if (o.flak && e.def.air) { for (const f of enemies) if (f.alive && f !== e && f.def.air && f.center.distanceToSquared(e.center) < 2.25) hurt(f, this.dmg * .4, 'phys', true); for (let k = 0; k < 10; k++) debris.spawn(e.center.x, e.center.y, e.center.z, rand(-3, 3), rand(-1, 2), rand(-3, 3), .5, .05, 0x8a6a4a, 6, F_SPIN, 0); }
      }
      else fxDust(this.g.position, 2, .15);
      scene.remove(this.g); return false;
    }
    return true;
  }
}
const ballMat = M(0x1e1e22);
class Cannonball {
  constructor(p, e, dmg, splash, cluster = false, arcMul = 1, opts = {}) {
    this.cluster = cluster; this.o = opts;
    this.m = P(scene, p.x, p.y, p.z, .3, .3, .3, 0, ballMat, true);
    this.s = p.clone(); this.dmg = dmg; this.splash = splash;
    const d = Math.hypot(e.g.position.x - p.x, e.g.position.z - p.z);
    this.T = .75 + d * .06;
    const fd = e.d + e.def.speed * (e.slow > 0 ? e.slowF : 1) * this.T;
    this.aim = smoothPath(e.path, Math.min(fd, e.path.len - .5), new V3());
    this.aim.x += e.g.position.x - smoothPath(e.path, e.d, _v).x; this.aim.z += e.g.position.z - _v.z;
    this.aim.y = groundY(this.aim.x, this.aim.z) + .2;
    this.arc = (1.6 + d * .35) * arcMul; this.t = 0; if (arcMul > 1) this.T *= 1.25;
    if (splash >= 3) this.m.scale.setScalar(.48);
  }
  update(dt) {
    this.t += dt; const s = Math.min(1, this.t / this.T);
    this.m.position.lerpVectors(this.s, this.aim, s); this.m.position.y += this.arc * 4 * s * (1 - s);
    this.m.rotation.x += dt * 8; this.m.rotation.y += dt * 6;
    if (Math.random() < .7) smoke.spawn(this.m.position.x, this.m.position.y, this.m.position.z, 0, .3, 0, .6, .12, 0x9a9a9a, 0, F_GROW | F_SPIN, 1, 0xcccccc);
    if (s >= 1) {
      scene.remove(this.m);
      fxExplosion(this.aim, .9);
      const r2 = this.splash * this.splash;
      for (const e of enemies) {
        if (!e.alive || e.def.air) continue;
        const dx = e.g.position.x - this.aim.x, dz = e.g.position.z - this.aim.z, d2 = dx * dx + dz * dz;
        if (d2 < r2) { const o = this.o; hurt(e, this.dmg * (1 - .5 * Math.sqrt(d2 / r2)) * (o.iron && e.def.armor > 0 ? 1.15 : 1) * (o.boss && (e.type === 'boss' || e.type === 'gruk') ? 1.25 : 1), 'phys', false, o.pierce || 0); if (o.conc && e.alive) { e.slowF = Math.min(e.slow > 0 ? e.slowF : 1, .8); e.slow = Math.max(e.slow, 1); } }
      }
      if (this.cluster) for (let k = 0; k < 5; k++) projs.push(new Bomblet(this.aim, this.dmg * .4));
      if (this.splash >= 3) { fxExplosion(this.aim, .9); addShake(this.aim, .3); }
      if (this.o.shock) { for (const e of enemies) if (e.alive && !e.def.air && (e.g.position.x - this.aim.x) ** 2 + (e.g.position.z - this.aim.z) ** 2 < 1.44) e.stun = Math.max(e.stun, 1); for (let k = 0; k < 24; k++) { const a = k / 24 * 6.28; glow.spawn(this.aim.x, this.aim.y + .1, this.aim.z, Math.cos(a) * 6, .3, Math.sin(a) * 6, .35, .12, 0xffe8a0, 0, F_SPIN, 1, 0x806000); } }
      if (this.o.delay) { const m = P(scene, this.aim.x, this.aim.y + .1, this.aim.z, .25, .25, .25, 0, chargeMat, false); charges.push({ x: this.aim.x, y: this.aim.y, z: this.aim.z, t: 1.2, dmg: this.dmg * .6, m }); }
      return false;
    }
    return true;
  }
}
class Bomblet {
  constructor(p, dmg) {
    this.s = p.clone(); this.dmg = dmg; this.t = 0; this.T = rand(.35, .6);
    const a = rand(0, 6.28), r = rand(.8, 2); this.aim = new V3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r); this.aim.y = groundY(this.aim.x, this.aim.z) + .1;
    this.m = P(scene, p.x, p.y, p.z, .14, .14, .14, 0, ballMat, false);
  }
  update(dt) {
    this.t += dt; const s = Math.min(1, this.t / this.T);
    this.m.position.lerpVectors(this.s, this.aim, s); this.m.position.y += 1.2 * 4 * s * (1 - s);
    if (s < 1) return true;
    scene.remove(this.m); fxExplosion(this.aim, .4);
    for (const e of enemies) if (e.alive && !e.def.air && (e.g.position.x - this.aim.x) ** 2 + (e.g.position.z - this.aim.z) ** 2 < 1.1) hurt(e, this.dmg, 'phys');
    return false;
  }
}
const shardMat = ME(0x9ff0ff, 1.6);
class Shard {
  constructor(p, e, dmg, lvl, spec = null, tw = null) {
    this.spec = spec; this.tw = tw; this.brittle = false;
    this.m = P(scene, p.x, p.y, p.z, .18, .18, .38, 0, shardMat, false);
    this.e = e; this.dmg = dmg; this.lvl = lvl; this.last = e.center.clone(); this.sp = 11;
  }
  update(dt) {
    if (this.e.alive) this.last.copy(this.e.center);
    _v.subVectors(this.last, this.m.position); const d = _v.length();
    this.m.lookAt(this.last); this.m.rotateZ(game.time * 10);
    if (Math.random() < .8) glow.spawn(this.m.position.x, this.m.position.y, this.m.position.z, rand(-.3, .3), rand(-.3, .3), rand(-.3, .3), .35, .07, 0xbff4ff, 0, 0, 0, 0x3a8aff);
    if (d < this.sp * dt + .1) {
      scene.remove(this.m);
      fxIce(this.last);
      const cold = skH('frost.root') ? .03 : 0, ling = skH('frost.linger') ? .5 : 0, zero = o => { if (o.alive && skH('frost.zero') && Math.random() < .1) freezeEnemy(o, 1, this.tw); };
      const apply = o => { if (this.brittle) o.brittle = 3; o.slowF = Math.min(o.slow > 0 ? o.slowF : 1, .55 - .07 * this.lvl - cold); o.slow = 2 + .5 * this.lvl + ling; };
      const tw = this.tw, ab = tw ? tw.ab : {};
      if (this.spec === 'a') {
        const e = this.e;
        if (e.alive) {
          hurt(e, this.dmg, 'magic');
          zero(e); if (e.alive) { e.slow = 2 + tw.rank + ling + (skH('frost.deep') ? .5 : 0); e.slowF = .25 - cold;
            if (tw.lastHit === e) tw.hitN++; else { tw.lastHit = e; tw.hitN = 1; }
            if (ab.flash && tw.hitN >= 3) { tw.hitN = 0; freezeEnemy(e, 1.2, tw); } }
        }
        return false;
      }
      if (this.spec === 'b') {
        if (this.e.alive) { hurt(this.e, this.dmg, 'magic'); zero(this.e); }
        for (const o of enemies) if (o.alive && o.center.distanceTo(this.last) < (1.3 + .3 * tw.rank + (o.def.air ? 0 : .3)) * (skH('frost.glacier') ? 1.25 : 1)) { o.slowF = Math.min(o.slow > 0 ? o.slowF : 1, .45 - cold); o.slow = Math.max(o.slow, 2.5 + ling); }
        for (let k = 0; k < 16; k++) { const a = k / 16 * 6.28; glow.spawn(this.last.x, this.last.y, this.last.z, Math.cos(a) * 4, 0, Math.sin(a) * 4, .4, .1, 0xe8fbff, 0, F_SPIN, 1, 0x3a8aff); }
        if (ab.trail) { const gy = groundY(this.last.x, this.last.z); if (gy > 0) { const m = new THREE.Mesh(iceGeo, iceMat); m.position.set(this.last.x, gy + .05, this.last.z); scene.add(m); icePatches.push({ x: this.last.x, z: this.last.z, t: 5, tw, m }); } }
        return false;
      }
      if (this.e.alive) { hurt(this.e, this.dmg, 'magic'); if (this.e.alive) apply(this.e); zero(this.e); }
      if (this.lvl >= 2) for (const o of enemies) if (o.alive && o !== this.e && o.center.distanceTo(this.last) < .9 + .4 * this.lvl) apply(o);
      return false;
    }
    this.m.position.addScaledVector(_v, this.sp * dt / d);
    return true;
  }
}

// ================================================================ game state / waves
const game = { mode: 'auto', speed: 1, paused: false, earned: 0, built: 0, countdown: 25, clearPaid: true, time: 0, wave: 0, gold: 0, hp: 100, maxHp: 100, defeated: 0, state: 'play', stateT: 0, spawnQ: [], spawnT: 0, sinceSpawn: 0, waveGap: 0, diff: 1, dotMul: 1, aiT: 0, lastBuild: null, lastBuildT: -99 };
const hud = { w: document.getElementById('hw'), g: document.getElementById('hg'), h: document.getElementById('hh'), b: document.getElementById('hb'), d: document.getElementById('hd'), m: document.getElementById('hm') };
let msgT = 0;
function msg(s) { hud.m.textContent = s; msgT = 5; }
const hpMul = n => MAP.hpBase * Math.pow(MAP.growth[game.mode === 'play' ? 0 : 1], n - 1) * game.diff;
const waveCounts = n => { const o = {}; for (const [k, [st, b, g]] of Object.entries(MAP.units)) o[k] = n >= st ? Math.round(b + g * (n - st + 1)) : 0; o.boss = MAP.bosses[n] || 0; return o; };
const GROUPING = { runner: [3, 5, .35], soldier: [2, 3, .7], knight: [1, 2, .9], shaman: [1, 1, 1], brute: [1, 1, 1], golem: [1, 1, 1.2], flyer: [2, 4, .45], wraith: [2, 3, .5], rider: [2, 3, .6], gruk: [1, 1, 1], sapper: [1, 2, .9] };
function waveGroups(n) {
  const wc = waveCounts(n), groups = [];
  for (const [k, c] of Object.entries(wc)) {
    if (k === 'boss') continue;
    let r = c; while (r > 0) { const [a, b, gap] = GROUPING[k]; const m = Math.min(r, randi(a, b)); groups.push([k, m, gap]); r -= m; }
  }
  for (let i = groups.length - 1; i > 0; i--) { const j = randi(0, i); [groups[i], groups[j]] = [groups[j], groups[i]]; }
  for (let i = 0; i < wc.boss; i++) groups.push(['boss', 1, 4]);
  const q = [];
  for (const [type, c, gap] of groups) { const p = randi(0, PATHS.length - 1); for (let i = 0; i < c; i++) q.push({ type, delay: i === 0 ? 2.0 : gap, p }); }
  return { q, bosses: wc.boss };
}
function startWave() {
  game.wave++; game.clearPaid = false;
  const w = waveGroups(game.wave);
  game.spawnQ = w.q; game.spawnT = 1; game.sinceSpawn = 0;
  const fresh1 = Object.entries(MAP.units).find(([, u]) => u[0] === game.wave && game.wave > 1);
  msg(game.wave === MAP.waves ? `Final wave!${w.bosses ? ` ${w.bosses} Warlord${w.bosses > 1 ? 's' : ''} march` : ''}` : w.bosses ? `Wave ${game.wave}: a Warlord approaches!` : fresh1 ? `Wave ${game.wave}: new enemy, ${ED[fresh1[0]].title}` : `Wave ${game.wave} incoming`);
}
Tower.prototype.refreshSoldiers = function () {
  this.bs = barrStat(this.spec || Math.min(this.lvl, 3), this.spec ? this.rank : 1);
  if (!this.rally) this.rally = defaultRally(this);
  const had = (this.soldiers || []).some(s => s.alive);
  for (const s of this.soldiers || []) s.remove();
  this.soldiers = []; this.resp = [];
  for (let i = 0; i < this.bs.n; i++) { const so = new Soldier(this, i, true); if (had) so.cheer = 1.3; this.soldiers.push(so); }
};
Tower.prototype.drumTick = function (dt) {
  const t = game.time, per = .9;
  if (!this.ghost && this.spot.gx >= 0 && game.state === 'play') {
    const r2 = this.ds.rad * this.ds.rad, inR = e => e.alive && !e.def.air && (e.g.position.x - this.x) ** 2 + (e.g.position.z - this.z) ** 2 <= r2;
    if (skH('drum.thund')) { this.thT = (this.thT ?? 12) - dt; if (this.thT <= 0) { this.thT = 12; let n = 0; for (const e of enemies) if (inR(e)) { e.stun = Math.max(e.stun, .5); n++; } if (n) { drumPulse(this); flashLight(new V3(this.x, 2, this.z), 40, 0xffd060); } } }
    if (this.spec === 'a' && skH('drum.charge')) { this.chT = (this.chT ?? 20) - dt; if (this.chT <= 0) { this.chT = 20; for (const e of enemies) if (inR(e) && e.type !== 'boss' && e.type !== 'gruk') { e.d = Math.max(0, e.d - 1); fxDust(e.g.position, 3, .2); } drumPulse(this); } }
  }
  this.beatT = (this.beatT || 0) + dt;
  if (this.beatT >= per) { this.beatT -= per; this.hit = 1; if (!this.ghost && this.spot.gx >= 0 && game.state === 'play') drumPulse(this); }
  this.hit = Math.max(0, (this.hit || 0) - dt * 4);
  const k = this.hit;
  for (const h of this.beat) h.scale.set(1 + k * .06, 1 + k * 1.5, 1 + k * .06);
  for (const s of this.sticks) s.rotation.x = -(1 - k) * .5 + Math.sin(t * 7) * .04;
  if (this.horn) { this.horn.rotation.y = Math.sin(t * .8 + this.x) * .25; const b = 1 + k * .05; this.horn.scale.set(b, b, b); }
  if (this.rings3) this.rings3.children.forEach((r, i) => { const f = ((this.beatT / per) + i / 3) % 1; r.scale.setScalar(.5 + f * .7); r.material.opacity = .8 * (1 - f); });
  if (this.wisp) { this.wisp.rotation.y += dt * 1.6; this.wisp.children.forEach((w, i) => { w.position.y = Math.sin(t * 2 + i) * .2; w.rotation.y += dt * 3; }); }
};
Tower.prototype.barracksTick = function (dt) {
  for (let i = 0; i < this.bs.n; i++) {
    const so = this.soldiers[i]; if (so && so.alive) continue;
    this.resp[i] = (this.resp[i] ?? this.bs.resp) - dt;
    if (this.resp[i] <= 0) { this.resp[i] = undefined; this.soldiers[i] = new Soldier(this, i, false); }
  }
};
{ const rm0 = Tower.prototype.remove; Tower.prototype.remove = function () { for (const so of this.soldiers || []) so.remove(); rm0.call(this); }; }
function spawnEnemy(type, d = 0, path = PATHS[0]) {
  const e = new Enemy(type, d, hpMul(game.wave), path);
  enemies.push(e);
  const pt = portals.find(p => p.P === path);
  if (d === 0 && pt) { for (let i = 0; i < 8; i++) glow.spawn(pt.pos.x, pt.pos.y + rand(-1, 1), pt.pos.z, -pt.out.x * rand(.5, 2) + rand(-.4, .4), rand(-.5, .5), -pt.out.z * rand(.5, 2) + rand(-.4, .4), .6, .14, 0xc07aff, 0, F_SPIN, 1, 0x2a0a5a); }
  if (type === 'boss') { director.force = { name: 'boss', e }; }
  return e;
}
function castleFalls() {
  game.state = 'fallen'; game.stateT = 0;
  msg('The castle has fallen!');
  director.force = { name: 'castle' };
}
function victory() {
  game.state = 'victory'; game.stateT = 0;
  msg(`Victory! All ${MAP.waves} waves repelled`);
  director.force = { name: 'victoryOrbit' };
}

// ================================================================ AI player
const WANT = { arrow: .22, cannon: .2, frost: .14, tesla: .22, flame: .22, barracks: .1, drum: .05 };
let KS = new Float32Array(SAMPLES.length);
function computeKS() {
  KS.fill(0);
  for (const t of towers) { const r2 = t.st.range ** 2; SAMPLES.forEach((p, i) => { if ((p.x - t.x) ** 2 + (p.z - t.z) ** 2 < r2) KS[i]++; }); }
}
function covDyn(s, r) {
  let c = 0; const r2 = r * r;
  for (let i = 0; i < SAMPLES.length; i++) { const p = SAMPLES[i], dx = p.x - s.x, dz = p.z - s.z; if (dx * dx + dz * dz < r2) c += p.w / (1 + .5 * KS[i]); }
  return c;
}
function bestSpot(type, range) {
  let best = null, bs = -1;
  for (const s of spots) {
    if (s.used || s.block) continue;
    let c = covDyn(s, range);
    if (type === 'flame' || type === 'frost') c *= 1 + coverage(s, 2.2) * .02;
    c *= 1 + rand(-.06, .06);
    if (c > bs) { bs = c; best = s; }
  }
  return best && { s: best, cov: bs };
}
function drumSpot(st) { let best = null, bs = 0; for (const s of spots) { if (s.used || s.block) continue; const v = drumValue(s.x, s.z, st) * rand(.94, 1.06); if (v > bs) { bs = v; best = s; } } return best && { s: best, cov: bs }; }
function aiThink() {
  if (game.state !== 'play') return;
  const lv = {}; let tot = 0;
  for (const t of towers) { lv[t.type] = (lv[t.type] || 0) + t.lvl; tot += t.lvl; }
  const nextAir = game.wave >= 3 ? .25 : 0;
  let ar = 0, mr = 0, wsum = 0;
  for (const [k, c] of Object.entries(waveCounts(game.wave + 1))) { const d = ED[k]; ar += d.armor * d.hp * c; mr += d.mr * d.hp * c; wsum += d.hp * c; }
  ar /= wsum || 1; mr /= wsum || 1;
  const need = type => {
    let n = 1 + (WANT[type] - (lv[type] || 0) / Math.max(1, tot)) * 4;
    n *= DTYPE[type] === 'phys' ? 1 - ar * .9 : DTYPE[type] === 'magic' ? 1 - mr * .9 : 1;
    if (nextAir) n *= TT[type].air ? 1 + nextAir : 1 - nextAir * .6;
    return Math.max(.2, n);
  };
  computeKS();
  const opts = [];
  const costMul = 1 + towers.length * .035;
  for (const type of TYPES) {
    const st = tStat(type, 1), b = type === 'drum' ? drumSpot(st) : bestSpot(type, st.range);
    if (!b) continue;
    const cost = Math.round(TT[type].cost * costMul);
    if (type === 'drum') { opts.push({ kind: 'build', type, spot: b.s, cost, score: b.cov * need(type) * 1.3 / cost }); continue; }
    opts.push({ kind: 'build', type, spot: b.s, cost, score: b.cov * st.dps * need(type) * 1.3 / cost });
  }
  for (const t of towers) {
    if (t.buildT < 1) continue;
    if (t.type === 'drum') {
      const cur = t.st, dv = s2 => drumValue(t.x, t.z, s2) - drumValue(t.x, t.z, cur);
      if (t.lvl === 3 && !t.spec) { for (const k of ['a', 'b']) opts.push({ kind: 'spec', t, k, cost: SPEC.drum[k].cost, score: dv(specStat('drum', k)) * need('drum') * rand(.85, 1.15) / SPEC.drum[k].cost }); continue; }
      if (t.spec) { if (t.rank < 3) { const cost = rankCost('drum', t.spec, t.rank + 1); opts.push({ kind: 'rank', t, cost, score: dv(specStat('drum', t.spec, t.rank + 1)) * need('drum') / cost }); } continue; }
      const cost = upCost(t); opts.push({ kind: 'up', t, cost, score: dv(tStat('drum', t.lvl + 1)) * need('drum') * 1.1 / cost }); continue;
    }
    if (t.lvl === 3 && !t.spec) {
      const a = tStat(t.type, 3);
      for (const k of ['a', 'b']) { const b = specStat(t.type, k), cost = SPEC[t.type][k].cost; opts.push({ kind: 'spec', t, k, cost, score: (coverage(t.spot, b.range) * b.dps - coverage(t.spot, a.range) * a.dps) * need(t.type) * rand(.85, 1.15) / cost }); }
      continue;
    }
    if (t.spec) { if (t.rank < 3) { const a = specStat(t.type, t.spec, t.rank), b = specStat(t.type, t.spec, t.rank + 1), cost = rankCost(t.type, t.spec, t.rank + 1); opts.push({ kind: 'rank', t, cost, score: (coverage(t.spot, b.range) * b.dps - coverage(t.spot, a.range) * a.dps) * need(t.type) * .9 / cost }); } continue; }
    if (t.lvl >= 3) continue;
    const a = tStat(t.type, t.lvl), b = tStat(t.type, t.lvl + 1);
    const cost = upCost(t);
    const cov = coverage(t.spot, b.range);
    opts.push({ kind: 'up', t, cost, score: (cov * b.dps - coverage(t.spot, a.range) * a.dps) * need(t.type) * 1.1 / cost });
  }
  if (!opts.length) return;
  opts.sort((a, b) => b.score - a.score);
  const top = opts[0];
  let choice = null;
  if (top.cost <= game.gold) choice = top;
  else if (game.gold < top.cost * .55 || game.hp < 50) choice = opts.find(o => o.cost <= game.gold && o.score > top.score * .65);
  if (!choice) return;
  game.gold -= choice.cost;
  if (choice.kind === 'build') {
    const t = new Tower(choice.type, choice.spot, false); t.spend = choice.cost; towers.push(t);
    msg(`Built ${TT[choice.type].name}`); game.lastBuild = t; game.lastBuildT = game.time;
  } else if (choice.kind === 'rank') {
    choice.t.rankUp(); choice.t.spend += choice.cost;
    msg(`${SPEC[choice.t.type][choice.t.spec].name} reached rank ${choice.t.rank}`); game.lastBuild = choice.t; game.lastBuildT = game.time;
  } else if (choice.kind === 'spec') {
    choice.t.setSpec(choice.k); choice.t.spend += choice.cost;
    msg(`${TT[choice.t.type].name} became a ${SPEC[choice.t.type][choice.k].name}`); game.lastBuild = choice.t; game.lastBuildT = game.time;
  } else {
    choice.t.upgrade(); choice.t.spend += choice.cost;
    msg(`${TT[choice.t.type].name} upgraded to Lv ${choice.t.lvl}`); game.lastBuild = choice.t; game.lastBuildT = game.time;
  }
}

// ================================================================ camera director
const director = { name: '', t: 0, dur: 6, blend: 1, bd: 1.8, fromP: new V3(), fromL: new V3(), P: new V3(), L: new V3(), curL: new V3(), sp: new V3(), sl: new V3(), d: {}, last: [], force: null };
const aspK = () => Math.max(1, .72 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
function hotSpot(out) {
  let best = null, bs = -1;
  for (const e of enemies) {
    if (!e.alive) continue;
    let c = e.type === 'boss' ? 4 : e.type === 'brute' ? 1.8 : 1, tg = 0;
    for (const o of enemies) if (o !== e && o.alive) { const d2 = o.center.distanceToSquared(e.center); if (d2 < 20) c += .6; }
    for (const t of towers) if (t.target === e || Math.hypot(t.x - e.g.position.x, t.z - e.g.position.z) < 5) tg++;
    c += tg * 2.5; if (!tg) c *= .25;
    if (c > bs) { bs = c; best = e; }
  }
  if (best) out.copy(best.g.position); return best;
}
function chooseShot() {
  if (director.force) { const f = director.force; director.force = null; return f; }
  const alive = enemies.length;
  const firing = towers.filter(t => game.time - t.lastFire < .8 && t.target && t.target.alive);
  const w = { orbit: 1.1, lowOrbit: .9, follow: alive ? 2.6 : 0, tower: firing.length ? 2 : 0, castle: .7, fly: alive ? 1.2 : 0, build: game.lastBuild && game.time - game.lastBuildT < 4 && game.lastBuild.buildT > .2 ? 2.5 : 0 };
  const boss = enemies.find(e => e.type === 'boss' && e.alive);
  if (boss) w.boss = 1.6;
  for (const n of director.last) if (w[n] !== undefined) w[n] *= .15;
  let sum = 0; for (const k in w) sum += w[k];
  let r = Math.random() * sum;
  for (const k in w) { r -= w[k]; if (r <= 0) { const s = { name: k }; if (k === 'tower') s.t = pick(firing); if (k === 'boss') s.e = boss; if (k === 'build') s.t = game.lastBuild; return s; } }
  return { name: 'orbit' };
}
function startShot(shot, cut) {
  const D = director;
  D.name = shot.name; D.t = 0; D.d = { ...shot };
  D.last.push(shot.name); if (D.last.length > 2) D.last.shift();
  D.fromP.copy(camera.position); D.fromL.copy(D.curL);
  D.blend = cut ? 1 : 0; D.bd = rand(1.6, 2.4);
  D.dur = { orbit: rand(7, 10), lowOrbit: rand(6, 8), follow: rand(6, 9), tower: rand(5, 7), castle: rand(5, 7), fly: rand(6, 8), boss: rand(7, 9), build: 4.5, victoryOrbit: 99, fallen: 99 }[shot.name] || 7;
  const d = D.d;
  d.a = rand(0, Math.PI * 2);
  if (shot.name === 'follow') { d.tp = new V3(); hotSpot(d.tp); d.goal = d.tp.clone(); d.re = 0; d.dist = rand(7, 10); d.h = rand(3.5, 6); d.as = rand(-.15, .15); }
  if (shot.name === 'fly') { const lead = enemies.length ? pick(enemies) : null; d.P = lead ? lead.path : pick(PATHS); d.pd = lead ? Math.max(2, lead.d - 6) : rand(10, 60); d.side = Math.random() < .5 ? -1 : 1; }
  if (shot.name === 'tower') { d.side = Math.random() < .5 ? -1 : 1; d.lk = d.t.target ? d.t.target.center.clone() : new V3(d.t.x, 1, d.t.z); }
  if (shot.name === 'castle') { d.side = Math.random() < .5 ? -1 : 1; }
  if (shot.name === 'orbit' || shot.name === 'victoryOrbit') d.a = Math.atan2(camera.position.x, camera.position.z);
  if (shot.name === 'boss') { d.a = rand(0, 6.28); d.tp = shot.e.g.position.clone(); }
  // smoothed values start at current camera so follow shots ease in
  D.sp.copy(camera.position); D.sl.copy(D.curL);
}
function shotTarget(dt) {
  const D = director, d = D.d, t = D.t, k = aspK(), P = D.P, L = D.L;
  switch (D.name) {
    case 'orbit': case 'victoryOrbit': {
      const a = d.a + t * .06, R = 37 * k, h = 26 * Math.sqrt(k);
      if (D.name === 'victoryOrbit') { const r = 16 * k; P.set(CX + Math.sin(a) * r, 11, CZ + Math.cos(a) * r); L.set(CX, 5, CZ); }
      else { P.set(Math.sin(a) * R, h, Math.cos(a) * R); L.set(0, 0, 0); }
      return false;
    }
    case 'lowOrbit': { const a = d.a + t * .09, R = 25 * Math.pow(k, .8); P.set(Math.sin(a) * R, 10, Math.cos(a) * R); L.set(0, 1.5, 0); return false; }
    case 'follow': {
      d.re -= dt; if (d.re <= 0) { if (!hotSpot(d.goal) && D.t > 1) return true; d.re = .6; }
      d.tp.lerp(d.goal, 1 - Math.exp(-1.6 * dt));
      const a = d.a + t * d.as, dist = d.dist * Math.sqrt(k);
      P.set(d.tp.x + Math.sin(a) * dist, d.tp.y + d.h, d.tp.z + Math.cos(a) * dist); L.set(d.tp.x, d.tp.y + .9, d.tp.z);
      return true;
    }
    case 'boss': {
      const e = d.e; if (e && e.alive) d.tp.lerp(e.g.position, 1 - Math.exp(-3 * dt)); else if (t > 1.5) D.t = D.dur;
      const a = d.a + t * .12, dist = 8.5 * Math.sqrt(k);
      P.set(d.tp.x + Math.sin(a) * dist, d.tp.y + 3.6, d.tp.z + Math.cos(a) * dist); L.set(d.tp.x, d.tp.y + 2.2, d.tp.z);
      return true;
    }
    case 'tower': {
      const tw = d.t; if (!towers.includes(tw)) { D.t = D.dur; return false; }
      if (tw.target && tw.target.alive) d.lk.lerp(tw.target.center, 1 - Math.exp(-2.5 * dt));
      const top = new V3(tw.x, 1 + tw.top * TS, tw.z);
      const dir = new V3(d.lk.x - tw.x, 0, d.lk.z - tw.z); if (dir.lengthSq() < .01) dir.set(1, 0, 0); dir.normalize();
      const side = new V3(-dir.z, 0, dir.x).multiplyScalar(d.side * 1.6);
      P.copy(top).addScaledVector(dir, -3.2 * Math.sqrt(k)).add(side); P.y += 1.4;
      L.lerpVectors(top, d.lk, .65);
      return true;
    }
    case 'build': {
      const tw = d.t; const a = d.a + t * .35, r = 6 * Math.sqrt(k);
      P.set(tw.x + Math.sin(a) * r, 4, tw.z + Math.cos(a) * r); L.set(tw.x, 1.8, tw.z); return false;
    }
    case 'castle': case 'fallen': {
      const r = 9 * Math.sqrt(k);
      if (game.state === 'fallen') { const a = 2.6 + t * .1; P.set(CX + Math.sin(a) * r * 1.3, 7, CZ + Math.cos(a) * r * 1.3); L.set(CX, 2.5, CZ); }
      else { P.set(CX + d.side * 3 + Math.sin(t * .1) * 2, 8.5, CZ + 6.5); pathAt(PATHS[0], PATHS[0].len - 13 - t * .8, L); L.y += .5; }
      return false;
    }
    case 'fly': {
      const pd = d.pd + t * 2.4;
      if (pd > d.P.len - 3) { D.t = D.dur; }
      const dir = new V3(); smoothPath(d.P, pd, P, dir);
      P.x += -dir.z * 2.6 * d.side; P.z += dir.x * 2.6 * d.side; P.y += 3.2;
      pathAt(d.P, pd + 7, L); L.y += .7;
      return true;
    }
  }
  return false;
}
function occlusionLift(pos, look) {
  let need = 0;
  for (let k = 1; k <= 8; k++) {
    const f = k / 9, x = lerp(pos.x, look.x, f), y = lerp(pos.y, look.y, f), z = lerp(pos.z, look.z, f);
    let h = obsY(x, z);
    for (const t of towers) if (Math.abs(t.x - x) < 1.1 && Math.abs(t.z - z) < 1.1) h = Math.max(h, 1.3 + t.top * TS);
    if (h > y) need = Math.max(need, (h - y) / (1 - f));
  }
  return Math.min(need, 8);
}
function updateDirector(dt) {
  const D = director;
  D.t += dt;
  if (D.force || D.t > D.dur) {
    const s = chooseShot();
    const cut = s.name === 'boss' || s.name === 'castle' ? Math.random() < .3 : Math.random() < .5;
    startShot(s, cut);
  }
  const smoothIt = shotTarget(dt);
  if (smoothIt) { D.sp.lerp(D.P, 1 - Math.exp(-3 * dt)); D.sl.lerp(D.L, 1 - Math.exp(-4 * dt)); }
  else { D.sp.copy(D.P); D.sl.copy(D.L); }
  if (D.blend === 1 && D.t < dt * 1.5) { D.sp.copy(D.P); D.sl.copy(D.L); }
  const pos = new V3(), look = new V3();
  if (D.blend < 1) {
    D.blend = Math.min(1, D.blend + dt / D.bd);
    const e = ease(D.blend);
    pos.lerpVectors(D.fromP, D.sp, e); look.lerpVectors(D.fromL, D.sl, e);
    pos.y += Math.sin(Math.PI * e) * Math.min(10, D.fromP.distanceTo(D.sp) * .18);
  } else { pos.copy(D.sp); look.copy(D.sl); }
  if (!/rbit/.test(D.name)) { pos.x = clamp(pos.x, -W / 2 + .8, W / 2 - .8); pos.z = clamp(pos.z, -H / 2 + .8, H / 2 - .8); }
  D.lift = lerp(D.lift || 0, occlusionLift(pos, look), 1 - Math.exp(-4 * dt)); pos.y += D.lift;
  const gy = Math.max(obsY(pos.x, pos.z), (CX - 4.5 < pos.x && pos.x < CX + 4.5 && CZ - 4.5 < pos.z && pos.z < CZ + 4.5) ? 7.5 : -9); if (pos.y < gy + .8) pos.y = lerp(pos.y, gy + .8, .5) + .3;
  D.curL.copy(look);
  camera.position.copy(pos);
  if (shake > .001) { camera.position.x += rand(-shake, shake); camera.position.y += rand(-shake, shake) * .6; camera.position.z += rand(-shake, shake); shake *= Math.exp(-6 * dt); }
  camera.lookAt(look);
}

// ================================================================ day / night
const CYCLE = 170;
const KF = [
  [0.00, 0x3f86e0, 0xa9d2f7, 0xfff4e0, 2.5, .9, 0, 58],
  [0.35, 0x387ad8, 0xb4d8f8, 0xffffff, 2.6, .95, 0, 62],
  [0.52, 0x5b6fb8, 0xffc48a, 0xffb070, 2.5, .95, .1, 30],
  [0.64, 0x2a2f6a, 0xff7a50, 0xff6a3a, 1.6, .7, .55, 14],
  [0.76, 0x0d1236, 0x2a3a6a, 0x8aa0ff, .8, .5, 1, 42],
  [0.88, 0x3a4a8a, 0xffa080, 0xffa070, 1.7, .75, .5, 16],
  [1.00, 0x3f86e0, 0xa9d2f7, 0xfff4e0, 2.5, .9, 0, 58],
];
const cA = new THREE.Color(), cB = new THREE.Color();
const lerpHex = (a, b, t, out) => out.setHex(a).lerp(cB.setHex(b), t);
let dayP = .1, night = 0;
function updateSky(dt) {
  dayP = (dayP + dt / CYCLE) % 1;
  let i = 0; while (KF[i + 1][0] < dayP) i++;
  const a = KF[i], b = KF[i + 1], t = (dayP - a[0]) / (b[0] - a[0]);
  lerpHex(a[1], b[1], t, skyMat.uniforms.top.value);
  lerpHex(a[2], b[2], t, skyMat.uniforms.bot.value);
  scene.fog.color.copy(skyMat.uniforms.bot.value);
  lerpHex(a[3], b[3], t, sun.color);
  sun.intensity = lerp(a[4], b[4], t); hemi.intensity = lerp(a[5], b[5], t);
  night = lerp(a[6], b[6], t);
  // the sky still turns, but the battlefield never gets dark enough to hide enemies
  sun.intensity = Math.max(sun.intensity, MAP.theme === 'ember' ? 2.1 : 1.7); hemi.intensity = Math.max(hemi.intensity, MAP.theme === 'ember' ? 1.15 : .95);
  hemi.color.setHex(0xcfe8ff).lerp(cA.setHex(0x7a88b8), night * .6);
  sun.color.lerp(cA.setHex(0xfff0dc), .35);
  const elev = lerp(a[7], b[7], t) * Math.PI / 180, az = dayP * Math.PI * 2 + 1;
  const dir = new V3(Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az));
  sun.position.copy(dir).multiplyScalar(70); sun.target.position.set(0, 0, 0);
  sunDisc.position.copy(camera.position).addScaledVector(dir, 420); sunDisc.lookAt(camera.position);
  sunDisc.material.color.copy(sun.color).multiplyScalar(night > .7 ? .8 : 1.6);
  sunDisc.scale.setScalar(night > .7 ? .6 : 1);
  starMat.opacity = smooth(night, .3, .9);
  nightMat.emissiveIntensity = smooth(night, .05, .6) * 1.6;
  lampMat.emissiveIntensity = .2 + smooth(night, .05, .6) * 2.2;
  cloudMat.emissive.setHex(0x333333).lerp(cA.setHex(0x0a0a20), night);
  if (TH.tint) { cA.setHex(TH.tint[0]); skyMat.uniforms.bot.value.lerp(cA, TH.tint[1]); scene.fog.color.lerp(cA, TH.tint[1]); }
  renderer.toneMappingExposure = .95 + night * .3;
}

// ================================================================ ambient world animation
let ambT = 0;
function updateWorld(dt) {
  const t = game.time;
  updateWater(t);
  const segA = camera.position, segB = director.curL, seg = new V3().subVectors(segB, segA), sl2 = seg.lengthSq() || 1;
  for (const c of clouds) {
    c.position.x += c.userData.v * dt; if (c.position.x > 75) { c.position.x = -75; c.position.z = rand(-45, 45); }
    const u = clamp(new V3().subVectors(c.position, segA).dot(seg) / sl2, 0, 1);
    const near = c.position.distanceTo(new V3().copy(segA).addScaledVector(seg, u)) < 7.5;
    c.scale.setScalar(lerp(c.scale.x, near ? .001 : 1, 1 - Math.exp(-5 * dt)));
  }
  for (const b of birds) { b.a += dt * .25; b.g.position.set(Math.cos(b.a) * b.r - 4, b.h + Math.sin(b.a * 3) * .5, Math.sin(b.a) * b.r * .7); b.g.rotation.y = -b.a; const f = Math.sin(t * 10 + b.ph) * .7; b.w[0].rotation.z = f; b.w[1].rotation.z = -f; }
  if (windmill) windmill.rotation.z += dt * .9;
  for (const v of villagers) {
    v.t += dt * v.sp; if (v.t >= 1) { v.t = 0; v.a.copy(v.b); v.b.copy(v.rp()); }
    v.g.position.lerpVectors(v.a, v.b, v.t);
    v.g.rotation.y = Math.atan2(v.b.x - v.a.x, v.b.z - v.a.z);
    const s = Math.sin(t * 9 + v.ph) * .6; v.legs[0].rotation.x = s; v.legs[1].rotation.x = -s;
  }
  updateFlag(t, game.hp > 0);
  for (const p of portals) p.glow.material.color.setHSL(.76 + Math.sin(t * 3) * .03, 1, .35 + Math.sin(t * 5) * .08);
  ambT += dt;
  if (ambT > .07) {
    ambT = 0;
    for (const c of chimneys) if (Math.random() < .35) smoke.spawn(c.x, c.y, c.z, rand(.1, .4), rand(.6, 1), rand(-.15, .15), rand(2.2, 3), rand(.12, .2), 0xd8d8d8, 0, F_GROW | F_SPIN, .3, 0xb0b0b0);
    for (const c of campfires) { for (let k = 0; k < 2; k++) glow.spawn(c.x + rand(-.15, .15), c.y, c.z + rand(-.15, .15), rand(-.2, .2), rand(1, 2), rand(-.2, .2), rand(.4, .7), rand(.12, .2), FIRE1, -.5, F_SPIN, 1, FIRE2); if (Math.random() < .3) smoke.spawn(c.x, c.y + .6, c.z, 0, 1, 0, 2, .2, 0x4a4a4a, 0, F_GROW | F_SPIN, .5, 0x9a9a9a); }
    for (const p of portals) for (let k = 0; k < 2; k++) { const a = t * 3 + k * 3.1, sx = p.out.x ? 0 : Math.cos(a) * .7, sz = p.out.z ? 0 : Math.cos(a) * .7; glow.spawn(p.pos.x + sx, p.pos.y + Math.sin(a) * 1.2, p.pos.z + sz, -p.out.x * rand(.2, .6), 0, -p.out.z * rand(.2, .6), .6, .1, 0xb070ff, 0, F_SPIN, 1, 0x200040); }
    for (const f of castleFires) { glow.spawn(f.x + rand(-.3, .3), f.y + .2, f.z + rand(-.3, .3), rand(-.2, .2), rand(1.2, 2.2), rand(-.2, .2), rand(.4, .7), rand(.15, .28), FIRE1, -1, F_SPIN, 1, FIRE2); if (Math.random() < .5) smoke.spawn(f.x, f.y + .8, f.z, rand(-.2, .2), rand(1, 1.6), rand(-.2, .2), rand(2, 3), rand(.3, .45), 0x2a2a2a, 0, F_GROW | F_SPIN, .5, 0x7a7a7a); }
    const lk = MAP.liquid && MAP.liquid.kind;
    if (waterTiles.length && lk !== 'lava' && Math.random() < .5) { const w = pick(waterTiles); glow.spawn(w[0] + rand(-.4, .4), .76, w[1] + rand(-.4, .4), 0, .2, 0, .5, .07, lk === 'ice' ? 0xffffff : 0xbfe8ff, 0, F_SPIN); }
    if (lk === 'lava') for (let k = 0; k < 2; k++) { const w = pick(lavaTiles); glow.spawn(w[0] + rand(-.4, .4), .65, w[1] + rand(-.4, .4), rand(-.2, .2), rand(1, 2.5), rand(-.2, .2), rand(.8, 1.4), rand(.06, .12), 0xffa040, -.3, F_SPIN, .5, 0x501000); if (Math.random() < .08) smoke.spawn(w[0], .8, w[1], 0, 1.2, 0, 2.5, .3, 0x3a3030, 0, F_GROW | F_SPIN, .4, 0x7a6a6a); }
    // liquid pouring off the island edge
    for (const e of edgeLiquid) if (Math.random() < .5) debris.spawn(e[0] + rand(-.45, .45) * (e[2] ? 0 : 1) + e[2] * .55, .62, e[1] + rand(-.45, .45) * (e[3] ? 0 : 1) + e[3] * .55, e[2] * rand(.6, 1.2), -.5, e[3] * rand(.6, 1.2), 1.6, rand(.1, .2), lk === 'lava' ? pick([0xff6a1a, 0xffa040, 0xc03a10]) : pick([0x6ab8f0, 0xbfe8ff, 0x4a98e0]), 9, F_SPIN, 0);
  }
  for (const l of flashes) l.intensity *= Math.exp(-dt * 9);
}

// ================================================================ main update
function updateGame(dt) {
  game.time += dt;
  if (game.state === 'play') {
    // spawning
    if (game.spawnQ.length) {
      game.spawnT -= dt;
      if (game.spawnT <= 0) { const s = game.spawnQ.shift(); spawnEnemy(s.type, 0, PATHS[s.p % PATHS.length]); game.spawnT = game.spawnQ.length ? game.spawnQ[0].delay : 0; game.sinceSpawn = 0; if (!game.spawnQ.length) game.countdown = 20; }
    } else if (game.mode === 'play') {
      if (game.wave >= MAP.waves) { if (!enemies.length) victory(); }
      else if (game.wave > 0) { game.countdown -= dt; if (game.countdown <= 0) sendWave(false); } // wave 1 starts only when the player is ready
    } else {
      game.sinceSpawn += dt;
      if (game.wave >= MAP.waves) { if (!enemies.length) victory(); }
      else if (enemies.length < 4 || game.sinceSpawn > 16) { game.waveGap += dt; if (game.waveGap > 2.5) { game.waveGap = 0; startWave(); } }
    }
    if (game.mode === 'play' && game.wave > 0 && !game.clearPaid && !game.spawnQ.length && !enemies.length && game.state === 'play') {
      const b = Math.round((20 + 5 * game.wave) * (skH('kingdom.muster') ? 1.25 : 1)) + (skH('kingdom.interest') ? Math.min(25, Math.round(game.gold * .05)) : 0); game.gold += b; game.earned += b; game.clearPaid = true; msg(`Wave ${game.wave} cleared  +${b} gold`);
      if (skH('kingdom.repair') && game.hp > 0) game.hp = Math.min(game.maxHp, game.hp + 2);
    }
    if (game.mode !== 'play') { game.aiT -= dt; if (game.aiT <= 0) { game.aiT = .7; aiThink(); } }
  } else {
    game.stateT += dt;
    if (game.state === 'fallen') {
      if (game.stateT < 3 && Math.random() < dt * 30) { const left = castleOrder.filter(i => castleBlocks[i].on); if (left.length) removeCastleBlock(pick(left), true); }
      if (game.stateT < 2.5 && Math.random() < dt * 4) fxExplosion(new V3(CX + rand(-3, 3), rand(1.5, 5), CZ + rand(-3, 3)), 1.2);
    }
    if (game.state === 'victory' && Math.random() < dt * 3.5) launchRocket();
    if (game.mode === 'play') { if (game.stateT > (game.state === 'fallen' ? 3.5 : 3) && !ui.endShown) showEnd(); }
    else if (game.stateT > 8 && !game.fading) { game.fading = true; fadeEl.style.opacity = 1; setTimeout(() => { resetGame('auto', (mapIdx + 1) % MAPS.length); fadeEl.style.opacity = 0; }, 950); }
  }
  for (const e of enemies) if (e.alive) e.update(dt);
  for (const so of soldiers) if (so.alive) so.update(dt);
  updateSoldierFx(dt);
  spellsTick(dt);
  soldiers = soldiers.filter(so => so.alive);
  drumPass(dt);
  for (const t of towers) t.update(t.haste && t.buildT >= 1 ? dt * (1 + t.haste) : dt);
  enemies = enemies.filter(e => e.alive);
  projs = projs.filter(p => p.update(dt));
  icePatches = icePatches.filter(p => {
    p.t -= dt;
    for (const o of enemies) if (o.alive && !o.def.air && (o.g.position.x - p.x) ** 2 + (o.g.position.z - p.z) ** 2 < 1.2) { o.slow = Math.max(o.slow, .4); o.slowF = Math.min(o.slow > 0 ? o.slowF : 1, .5); }
    if (Math.random() < dt * 4) glow.spawn(p.x + rand(-.8, .8), p.m.position.y + .1, p.z + rand(-.8, .8), 0, .2, 0, .5, .06, 0xffffff, 0, F_SPIN);
    p.m.scale.setScalar(Math.min(1, p.t * 2));
    if (p.t <= 0) scene.remove(p.m);
    return p.t > 0;
  });
  shrapnel = shrapnel.filter(p => {
    p.t -= dt;
    if (Math.random() < dt * 3) glow.spawn(p.x + rand(-.6, .6), groundY(p.x, p.z) + .1, p.z + rand(-.6, .6), 0, .1, 0, .3, .05, 0xd0d0d8, 0, F_SPIN);
    for (const o of enemies) { if (p.hits <= 0 || !o.alive || o.def.air || p.hit.has(o)) continue; if ((o.g.position.x - p.x) ** 2 + (o.g.position.z - p.z) ** 2 < .9) { p.hit.add(o); p.hits--; hurt(o, p.dmg, 'phys'); fxSparks(o.g.position, 0xd0d0d8, 5, 2); } }
    return p.t > 0 && p.hits > 0;
  });
  charges = charges.filter(c => {
    c.t -= dt; c.m.visible = Math.sin(c.t * 30) > -.3;
    if (c.t > 0) return true;
    scene.remove(c.m); const p = new V3(c.x, c.y, c.z); fxExplosion(p, .8);
    for (const o of enemies) if (o.alive && !o.def.air && (o.g.position.x - c.x) ** 2 + (o.g.position.z - c.z) ** 2 < 4) hurt(o, c.dmg, 'phys');
    return false;
  });
  patches = patches.filter(p => {
    p.t -= dt; p.tick -= dt;
    if (Math.random() < dt * 14) glow.spawn(p.x + rand(-.6, .6), groundY(p.x, p.z) + .1, p.z + rand(-.6, .6), 0, rand(.6, 1.4), 0, rand(.3, .6), rand(.12, .22), FIRE1, -.5, F_SPIN | F_GROW, .5, FIRE2);
    if (p.tick <= 0) { p.tick = .25; for (const o of enemies) if (o.alive && !o.def.air && (o.g.position.x - p.x) ** 2 + (o.g.position.z - p.z) ** 2 < .9) { hurt(o, 6 * (skH('flame.napalm') ? 1.3 : 1), 'true', true); o.burn = Math.max(o.burn, .6); } }
    return p.t > 0;
  });
  for (let i = boltSegs.length - 1; i >= 0; i--) { const b = boltSegs[i]; b.life -= dt; if (b.life <= 0) { scene.remove(b.m); boltFree.push(b.m); boltSegs.splice(i, 1); } }
  updateRockets(dt);
  for (const p of pools) p.update(dt);
  updateWorld(dt);
}
// fireworks
let rockets = [];
function launchRocket() {
  rockets.push({ p: new V3(CX + rand(-4, 4), 4, CZ + rand(-4, 4)), v: new V3(rand(-1.5, 1.5), rand(11, 15), rand(-1.5, 1.5)), t: 0, fuse: rand(.9, 1.4), col: pick([0xff4a6a, 0x4affb0, 0xffd04a, 0x6a9aff, 0xff7aff, 0xffffff]) });
}
function updateRockets(dt) {
  rockets = rockets.filter(r => {
    r.t += dt; r.v.y -= 6 * dt; r.p.addScaledVector(r.v, dt);
    glow.spawn(r.p.x, r.p.y, r.p.z, rand(-.3, .3), -1, rand(-.3, .3), .4, .1, 0xffd8a0, 2, 0, 0, 0x803000);
    if (r.t > r.fuse) {
      for (let i = 0; i < 70; i++) { const v = new V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(4, 7)); glow.spawn(r.p.x, r.p.y, r.p.z, v.x, v.y, v.z, rand(1, 1.6), rand(.1, .18), r.col, 3, F_SPIN, 1.6, 0x101010); }
      flashLight(r.p, 120, r.col); return false;
    }
    return true;
  });
}

// ================================================================ reset
const fadeEl = document.getElementById('fade');
function resetGame(mode, idx) {
  if (typeof tutReset === 'function') tutReset();
  if (mode) game.mode = mode;
  if (typeof closeMenus === 'function') { closeMenus(); hideEnd(); }
  for (const e of enemies) e.remove(); enemies = [];
  for (const p of projs) { if (p.g) scene.remove(p.g); if (p.m) scene.remove(p.m); } projs = [];
  for (const b of boltSegs) scene.remove(b.m); boltSegs.length = 0; rockets = []; patches = []; for (const p of icePatches) scene.remove(p.m); for (const c of charges) scene.remove(c.m); icePatches = []; shrapnel = []; charges = [];
  for (const t of towers) t.remove(); towers = []; for (const so of soldiers) so.remove(); soldiers = []; for (const f of fallenSol) scene.remove(f.s.g); fallenSol = []; for (const f of spellFx || []) scene.remove(f.ring, f.disc); spellFx = []; ui.spell = null; if (spellRing) spellRing.visible = false; for (const w of swooshes) scene.remove(w.m); swooshes = []; clearDrumRings();
  if (idx !== undefined && idx !== mapIdx) { buildMap(idx); decorateBog(); spots = PLOTS.map(p => ({ ...p, used: false, block: 0, cov: {} })); KS = new Float32Array(SAMPLES.length); }
  for (const s of spots) { s.used = false; s.block = 0; }
  for (const p of pools) p.clear();
  castleBlocks.forEach((b, i) => setBlock(i, true)); castleRemoved = 0; castleFires.length = 0;
  game.gate = gateFor(mode);
  SKILL_ACTIVE = game.mode === 'play' ? skCompute(loadSave()) : null;
  Object.assign(game, { standUsed: false, standT: 0, slitT: 0, soulHeal: 0, wave: 0, gold: 0, hp: 100, defeated: 0, state: 'play', stateT: 0, spawnQ: [], spawnT: 0, sinceSpawn: 0, waveGap: 0, diff: game.mode === 'play' ? playDiff : rand(.85, 1.25) / 1.3, aiT: 0, lastBuild: null, lastBuildT: -99, fading: false, earned: 0, built: 0, countdown: 25, clearPaid: true, paused: false, speed: game.mode === 'play' ? (game.speed || 1) : 1 });
  game.maxHp = 100 + (skH('kingdom.walls') ? 10 : 0); game.hp = game.maxHp;
  game.castleP = smoothPath(PATHS[0], PATHS[0].len - .4, new V3());
  spotsDirty = true;
  $('hmap').textContent = MAP.name.toUpperCase();
  game.spells = game.mode === 'play' ? spellsFor(camp.level ?? 0, !!loadSave().dev) : []; game.scd = {}; game.spellUsed = false; renderSpells();
  if (game.mode === 'play') { game.gold = MAP.gold + (skH('kingdom.root') ? 10 : 0) + (skH('kingdom.chest') ? 20 : 0) + (skH('kingdom.treasury') ? 50 : 0); camHome(true); msg(`${MAP.name}: build towers, then send wave 1`); return; }
  // starting defences: one of each kind, already standing
  const order = [...TYPES].sort(() => Math.random() - .5);
  for (const type of order) {
    const st = tStat(type, 1); computeKS();
    const cands = spots.filter(s => !s.used && !s.block).map(s => ({ s, c: covDyn(s, st.range) })).sort((a, b) => b.c - a.c).slice(0, 4);
    if (cands.length) towers.push(new Tower(type, pick(cands).s, true));
  }
  game.gold = 90 + MAP.gold - 250;
  startWave();
  // battle already in progress: put part of wave 1 on the field
  const pre = Math.min(game.spawnQ.length, 7);
  const covered = [];
  SAMPLES.forEach(p => { if (towers.some(t => Math.hypot(t.x - p.x, t.z - p.z) < t.st.range - .5)) covered.push(p); });
  for (let i = 0; i < pre; i++) { const s = game.spawnQ.shift(); const c = covered.length ? pick(covered) : SAMPLES[randi(8, 60)]; spawnEnemy(s.type, c.d, c.P); }
  for (let i = 0; i < 90; i++) updateGame(1 / 30);
  director.force = null;
  const firing = towers.filter(t => t.target && t.target.alive);
  startShot(firing.length ? { name: 'tower', t: pick(firing) } : { name: 'follow' }, true);
  msg('Wave 1 — defend the castle!');
}

// ================================================================ player mode
const $ = id => document.getElementById(id);
const ui = { sel: null, spot: null, pick: null, ghost: null, endShown: false, ptrType: 'mouse', openT: 0 };
const fresh = () => performance.now() - ui.openT < 450; // ignore the click a touch-tap fires right after opening a menu
let spotsDirty = true;

// --- build-spot markers, selection plate, range ring
const spotMat = new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: .35, depthWrite: false });
const spotIM = new THREE.InstancedMesh(boxGeo, spotMat, 32);
spotIM.frustumCulled = false; spotIM.count = 0; scene.add(spotIM);
const selPlate = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffd77a, transparent: true, opacity: .55, depthWrite: false }));
selPlate.scale.set(1.95, .05, 1.95); selPlate.visible = false; scene.add(selPlate);
const badPlate = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0, depthWrite: false }));
badPlate.scale.set(.96, .06, .96); scene.add(badPlate);
const rangeG = new THREE.Group(); rangeG.visible = false; scene.add(rangeG);
{ const ring = new THREE.Mesh(new THREE.RingGeometry(.97, 1, 72), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .7, depthWrite: false, side: THREE.DoubleSide }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = disc.rotation.x = -Math.PI / 2; rangeG.add(disc, ring); }
const deadG = new THREE.Group(); deadG.visible = false; scene.add(deadG);
{ const ring = new THREE.Mesh(new THREE.RingGeometry(.955, 1, 64), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = disc.rotation.x = -Math.PI / 2; ring.renderOrder = disc.renderOrder = 2; deadG.add(disc, ring); }
const MORTAR_DEAD = 3;
const overloadCap = r => 2 + r; // Overload beam build-up limit by rank: 3x / 4x / 5x, reached in 3 seconds
const mortarPierce = r => .3 + .1 * r; // share of armor the Siege Mortar ignores: 40% / 50% / 60% by rank
function showRange(x, z, r, dead = 0) { rangeG.visible = true; rangeG.position.set(x, 1.04, z); rangeG.scale.set(r, 1, r);
  deadG.visible = dead > 0; if (dead) { deadG.position.set(x, 1.05, z); deadG.scale.set(dead, 1, dead); } }
function rebuildSpots() {
  let n = 0;
  for (const s of spots) {
    if (s.used) continue;
    dummy.position.set(s.x, 1.1, s.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1.6, .03, 1.6); dummy.updateMatrix();
    spotIM.setMatrixAt(n++, dummy.matrix);
  }
  spotIM.count = n; spotIM.instanceMatrix.needsUpdate = true; spotsDirty = false;
}

// --- player camera
const pc = { t: new V3(0, 1, 1), tt: new V3(0, 1, 1), yaw: 0, yy: 0, pitch: 1, pp: 1, dist: 36, dd: 36 };
// the farthest zoom is the view that just fits the whole island
function homeDist() {
  const tv = Math.tan(camera.fov * Math.PI / 360), th = tv * camera.aspect;
  return 1.05 * (camera.aspect < 1 ? Math.max(26 / tv, 18 / th) : Math.max(18 / tv, 25 / th));
}
function camHome(snap) {
  pc.tt.set(0, 1, 0); pc.yy = camera.aspect < 1 ? Math.PI / 2 : 0; pc.pp = 1.0; pc.dd = homeDist();
  if (snap) { pc.t.copy(pc.tt); pc.yaw = pc.yy; pc.pitch = pc.pp; pc.dist = pc.dd; }
}
const keys = new Set();
function updatePlayerCam(dt) {
  // keyboard: WASD / arrows pan, Q/E rotate, +/- zoom
  if (keys.size) {
    const sp = pc.dd * .9 * dt, c = Math.cos(pc.yaw), s = Math.sin(pc.yaw);
    let fx = 0, fz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
    pc.tt.x += (c * fx + s * fz) * sp; pc.tt.z += (-s * fx + c * fz) * sp;
    if (keys.has('KeyQ')) pc.yy += 1.6 * dt;
    if (keys.has('KeyE')) pc.yy -= 1.6 * dt;
    if (keys.has('Equal') || keys.has('NumpadAdd')) pc.dd *= Math.exp(-1.5 * dt);
    if (keys.has('Minus') || keys.has('NumpadSubtract')) pc.dd *= Math.exp(1.5 * dt);
  }
  pc.tt.x = clamp(pc.tt.x, -W / 2 + 2, W / 2 - 2); pc.tt.z = clamp(pc.tt.z, -H / 2 + 2, H / 2 - 2);
  pc.dd = clamp(pc.dd, 9, homeDist() * 1.05); pc.pp = clamp(pc.pp, .55, 1.35);
  const k = 1 - Math.exp(-12 * dt);
  pc.t.lerp(pc.tt, k); pc.yaw = lerp(pc.yaw, pc.yy, k); pc.pitch = lerp(pc.pitch, pc.pp, k); pc.dist = lerp(pc.dist, pc.dd, k);
  const cp = Math.cos(pc.pitch);
  camera.position.set(pc.t.x + Math.sin(pc.yaw) * cp * pc.dist, pc.t.y + Math.sin(pc.pitch) * pc.dist, pc.t.z + Math.cos(pc.yaw) * cp * pc.dist);
  const gy = groundY(camera.position.x, camera.position.z); if (camera.position.y < gy + 1) camera.position.y = gy + 1;
  if (shake > .001) { camera.position.x += rand(-shake, shake); camera.position.y += rand(-shake, shake) * .6; camera.position.z += rand(-shake, shake); shake *= Math.exp(-6 * dt); }
  camera.lookAt(pc.t); director.curL.copy(pc.t);
}
// the point on the ground under a screen position
function groundAt(x, y, out) {
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(groundPlane, out);
}
// drag moves the map so the ground under the finger stays under the finger
const _ga = new V3(), _gb = new V3();
function grabPan(x0, y0, x1, y1) {
  if (!groundAt(x0, y0, _ga) || !groundAt(x1, y1, _gb)) return;
  _ga.sub(_gb); _ga.y = 0;
  if (_ga.length() > 20) return;
  pc.tt.add(_ga); pc.t.add(_ga);
  updatePlayerCam(0);
}

// --- pointer input
const cvs = renderer.domElement;
const ptrs = new Map(); let gest = null;
cvs.addEventListener('contextmenu', e => e.preventDefault());
const pinchInfo = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
cvs.addEventListener('pointerdown', e => {
  try { cvs.setPointerCapture(e.pointerId); } catch (_) {}
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), btn: e.button, shift: e.shiftKey, type: e.pointerType });
  if (ptrs.size === 1) gest = { tap: true };
  else if (gest) { gest.tap = false; if (ptrs.size === 2) gest.pinch = pinchInfo(); }
});
cvs.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return;
  const px = p.x, py = p.y, dx = e.clientX - px, dy = e.clientY - py; p.x = e.clientX; p.y = e.clientY;
  if (game.mode !== 'play' || !gest) return;
  if (ptrs.size === 1) {
    if (gest.tap && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8) { gest.tap = false; if (!(p.btn === 2 || p.shift)) grabPan(p.sx, p.sy, e.clientX, e.clientY); return; }
    if (gest.tap) return;
    if (p.btn === 2 || p.shift) { pc.yy -= dx * .006; pc.pp += dy * .004; }
    else grabPan(px, py, e.clientX, e.clientY);
  } else if (ptrs.size === 2 && gest.pinch) {
    const n = pinchInfo(), o = gest.pinch;
    pc.dd *= o.d / n.d;
    let da = n.a - o.a; da = Math.atan2(Math.sin(da), Math.cos(da)); pc.yy -= da;
    grabPan(o.mx, o.my, n.mx, n.my);
    gest.pinch = n;
  }
});
function endPtr(e) {
  const p = ptrs.get(e.pointerId); if (!p) return;
  ptrs.delete(e.pointerId);
  if (ptrs.size === 1 && gest) gest.pinch = null;
  if (e.type === 'pointerup' && gest && gest.tap && ptrs.size === 0 && performance.now() - p.t < 600) handleTap(e.clientX, e.clientY, p.type);
  if (!ptrs.size) gest = null;
}
cvs.addEventListener('pointerup', endPtr); cvs.addEventListener('pointercancel', endPtr);
// scroll zooms toward the point under the cursor
cvs.addEventListener('wheel', e => {
  if (game.mode !== 'play') return; e.preventDefault();
  const before = pc.dd;
  pc.dd = clamp(pc.dd * Math.exp(e.deltaY * .0012), 9, homeDist() * 1.05);
  const f = pc.dd / before;
  if (f < 1 && groundAt(e.clientX, e.clientY, _ga)) { pc.tt.x += (_ga.x - pc.tt.x) * (1 - f); pc.tt.z += (_ga.z - pc.tt.z) * (1 - f); }
}, { passive: false });
const CAM_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'];
addEventListener('keydown', e => {
  if (!$('book').hidden) { if (e.code === 'Escape') closeBook(); return; }
  if (!$('brief').hidden) { if (e.code === 'Escape') $('brief').hidden = true; return; }
  if (game.mode !== 'play') return;
  if (CAM_KEYS.includes(e.code)) { keys.add(e.code); e.preventDefault(); }
  if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); togglePause(); }
  if (e.code === 'Escape') closeMenus();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ================================================================ spells: Militia Call and Catapult Barrage (from 1-2), Frost Nova (from 3-1)
const SPELLS = {
  militia: { name: 'Militia Call', cd: 20, r: 1.2, col: 0x4ad05a, desc: 'Two militiamen rise on the road and block for 12 s.', icon: '<path d="M6 21V9M3 9h6M3 5v4M6 5v4M9 5v4"/><path d="M14 21v-6l3-3 3 3v6"/><circle cx="17" cy="8" r="2.5"/>' },
  catapult: { name: 'Catapult Barrage', cd: 45, r: 2, col: 0xe04a3a, desc: 'After 3 s, five boulders land in a 2-tile circle: 60 damage each and a short stun.', icon: '<circle cx="17" cy="16" r="4"/><path d="M3 20c2-9 7-13 13-13"/><path d="M13 4l3 3-3 3"/>' },
  nova: { name: 'Frost Nova', cd: 60, r: 2.5, col: 0x7ad8ff, desc: 'Freezes ground enemies within 2.5 tiles for 2.5 s. Bosses are slowed instead.', icon: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/><circle cx="12" cy="12" r="3"/>' },
};
const SPELL_KEYS = ['militia', 'catapult', 'nova'];
// painted spell art (src/art/spells/<key>.webp)
const SPELL_ART = Object.fromEntries(Object.entries(import.meta.glob('./art/spells/*.webp', { eager: true, import: 'default' })).map(([p, url]) => [p.split('/').pop().slice(0, -5), url]));
const spellsFor = (i, dev) => SPELL_KEYS.filter(k => dev || (k === 'nova' ? i >= 7 : i >= 1));
const MILITIA = { n: 2, unit: 'militia', hp: 50, dmg: 4, rate: 1, armor: 0, mr: 0, resp: 99, rad: 2.5 };
const rockMat = M(0x8a8478);
var spellFx = [];
var spellRing = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8, depthWrite: false }));
spellRing.visible = false; spellRing.renderOrder = 4; scene.add(spellRing);
class Boulder {
  constructor(from, to, dmg) { this.s = from.clone(); this.aim = to.clone(); this.t = 0; this.T = 1; this.dmg = dmg; this.m = P(scene, from.x, from.y, from.z, .55, .5, .5, 0, rockMat, true); }
  update(dt) {
    this.t += dt; const s = Math.min(1, this.t / this.T);
    this.m.position.lerpVectors(this.s, this.aim, s); this.m.position.y += 8 * 4 * s * (1 - s); this.m.rotation.x += dt * 6; this.m.rotation.z += dt * 4;
    if (s < 1) return true;
    scene.remove(this.m); fxExplosion(this.aim, .7); addShake(this.aim, .12);
    for (let k = 0; k < 6; k++) debris.spawn(this.aim.x, this.aim.y + .2, this.aim.z, rand(-3, 3), rand(2, 5), rand(-3, 3), rand(.8, 1.4), rand(.08, .16), 0x8a8478, 15, F_BOUNCE, .2);
    for (const e of enemies) if (e.alive && !e.def.air && (e.g.position.x - this.aim.x) ** 2 + (e.g.position.z - this.aim.z) ** 2 < 1.2) { hurt(e, this.dmg, 'phys'); if (e.alive) e.stun = Math.max(e.stun, .5); }
    return false;
  }
}
// where a spell lands: militia snaps to the nearest road, the others hit any ground on the map
function spellSpot(k, x, y) {
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const p = ray.ray.intersectPlane(groundPlane, new V3()); if (!p || groundY(p.x, p.z) < -1) return null;
  if (k !== 'militia') return { x: p.x, z: p.z };
  let best = null, bd = 4; for (const sm of SAMPLES) { const d = (sm.x - p.x) ** 2 + (sm.z - p.z) ** 2; if (d < bd) { bd = d; best = sm; } }
  return best && { x: best.x, z: best.z };
}
function spellHover(x, y) {
  const k = ui.spell; if (!k) { spellRing.visible = false; return; }
  const q = spellSpot(k, x, y); if (!q) { spellRing.visible = false; return; }
  spellRing.visible = true; spellRing.position.set(q.x, Math.max(groundY(q.x, q.z), 1) + .08, q.z); spellRing.scale.setScalar(SPELLS[k].r); spellRing.material.color.setHex(SPELLS[k].col);
}
function castSpell(k, q) {
  const S = SPELLS[k]; game.scd[k] = S.cd; game.spellUsed = true; const gy = Math.max(groundY(q.x, q.z), 1);
  if (k === 'militia') {
    const tw = { militia: true, x: q.x, z: q.z, rally: { x: q.x, z: q.z }, bs: MILITIA, resp: [], soldiers: [], spec: null, lvl: 1, rank: 0 };
    for (let i = 0; i < MILITIA.n; i++) { const so = new Soldier(tw, i, true); so.ttl = 12; tw.soldiers.push(so); }
    fxDust(new V3(q.x, gy, q.z), 10, .4); msg('Militia called: two militiamen hold the road for 12 s');
  } else if (k === 'catapult') {
    const ring = new THREE.Mesh(new THREE.RingGeometry(.9, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe04a3a, transparent: true, opacity: .9, depthWrite: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe04a3a, transparent: true, opacity: .25, depthWrite: false }));
    for (const m of [ring, disc]) { m.position.set(q.x, gy + .07, q.z); m.scale.setScalar(S.r); m.renderOrder = 4; scene.add(m); }
    spellFx.push({ kind: 'cat', q, t: 0, ring, disc, fired: false });
    msg('Catapults loading: boulders land in 3 s');
  } else if (k === 'nova') {
    const c = new V3(q.x, gy + .4, q.z); let n = 0;
    for (const e of enemies) {
      if (!e.alive || e.def.air || (e.g.position.x - q.x) ** 2 + (e.g.position.z - q.z) ** 2 > S.r * S.r) continue;
      if (e.type === 'boss' || e.type === 'gruk') { e.slowF = Math.min(e.slow > 0 ? e.slowF : 1, .5); e.slow = Math.max(e.slow, 2.5); } else freezeEnemy(e, 2.5); n++;
    }
    const m = new THREE.Mesh(drumRingGeo, new THREE.MeshBasicMaterial({ color: 0xbff4ff, transparent: true, opacity: .8, depthWrite: false }));
    m.position.set(q.x, gy + .1, q.z); m.scale.setScalar(.3); scene.add(m); drumRings.push({ m, t: 0, r: S.r });
    for (let i = 0; i < 40; i++) { const a = i / 40 * 6.28, v = rand(3, 6); glow.spawn(c.x, c.y, c.z, Math.cos(a) * v, rand(.2, 1.5), Math.sin(a) * v, rand(.4, .7), rand(.08, .16), 0xe8fbff, 0, F_SPIN, 1, 0x3a8aff); }
    fxIce(c); flashLight(c, 50, 0x9ae0ff);
    msg(n ? `Frost Nova froze ${n} ${n === 1 ? 'enemy' : 'enemies'}` : 'Frost Nova');
  }
  renderSpells();
}
function spellsTick(dt) {
  if (game.mode !== 'play') return;
  for (const k in game.scd) if (game.scd[k] > 0) game.scd[k] = Math.max(0, game.scd[k] - dt);
  spellFx = spellFx.filter(f => {
    f.t += dt;
    if (f.kind === 'cat') {
      f.disc.scale.setScalar(SPELLS.catapult.r * Math.min(1, f.t / 3)); f.ring.material.opacity = .5 + .4 * Math.abs(Math.sin(f.t * 6));
      if (!f.fired && f.t >= 2) { // launch from the castle so they land at 3 s
        f.fired = true; const c = game.castleP || new V3(0, 1, 0);
        for (let i = 0; i < 5; i++) { const a = rand(0, 6.28), r = Math.sqrt(Math.random()) * 1.7; const to = new V3(f.q.x + Math.cos(a) * r, 0, f.q.z + Math.sin(a) * r); to.y = groundY(to.x, to.z) + .2; const b = new Boulder(new V3(c.x + rand(-1, 1), c.y + 3, c.z + rand(-1, 1)), to, 60); b.T = 1 + i * .06; projs.push(b); }
      }
      if (f.t >= 3.4) { scene.remove(f.ring, f.disc); f.ring.material.dispose(); f.disc.material.dispose(); return false; }
    }
    return true;
  });
  // cooldown dials on the buttons
  for (const k of game.spells || []) {
    const b = $('sp-' + k); if (!b) continue;
    const left = game.scd[k] || 0, f = left / SPELLS[k].cd;
    const wait = game.wave < 1; b.style.setProperty('--p', wait ? '100%' : (f * 100).toFixed(1) + '%'); b.classList.toggle('cool', left > 0 || wait); b.querySelector('.sp-t').textContent = wait ? '' : left > 0 ? Math.ceil(left) : ''; b.title = wait ? `${SPELLS[k].name}: ready once the first wave is called` : `${SPELLS[k].name}: ${SPELLS[k].desc}`;
  }
  $('spells').hidden = !(game.spells && game.spells.length) || $('ctrl').hidden || game.state !== 'play';
}
function renderSpells() {
  const ks = game.spells || [];
  $('spells').innerHTML = ks.map((k, i) => `<button type="button" id="sp-${k}" class="sp${ui.spell === k ? ' on' : ''}" data-k="${k}" aria-label="${SPELLS[k].name}: ${SPELLS[k].desc} Key ${i + 1}" title="${SPELLS[k].name} (${i + 1}): ${SPELLS[k].desc}"><img src="${SPELL_ART[k]}" alt="" draggable="false"><span class="sp-n">${SPELLS[k].name}</span><span class="sp-t"></span><kbd>${i + 1}</kbd></button>`).join('');
}
function pickSpell(k) {
  if (game.mode !== 'play' || game.state !== 'play' || !(game.spells || []).includes(k)) return;
  if (game.wave < 1) { msg('Spells are ready once you call the first wave'); return; }
  if ((game.scd[k] || 0) > 0) { msg(`${SPELLS[k].name} is ready in ${Math.ceil(game.scd[k])} s`); return; }
  if (ui.spell === k) { ui.spell = null; spellRing.visible = false; renderSpells(); return; }
  closeMenus(); ui.spell = k; renderSpells();
  msg(k === 'militia' ? 'Tap the road to call the militia' : `Tap the map to cast ${SPELLS[k].name}`);
}
$('spells').addEventListener('click', e => { const b = e.target.closest('.sp'); if (b) pickSpell(b.dataset.k); });
cvs.addEventListener('pointermove', e => { if (ui.spell && e.pointerType === 'mouse') spellHover(e.clientX, e.clientY); });
addEventListener('keydown', e => { if (game.mode !== 'play' || !$('book').hidden || !$('skills').hidden) return; const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code); if (n >= 0 && game.spells && game.spells[n]) pickSpell(game.spells[n]); });

// --- tapping the world
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new V3(0, 1, 0), -1);
function towerOf(o) { while (o) { const t = towers.find(t => t.g === o); if (t) return t; o = o.parent; } return null; }
function pickEnemy(x, y) {
  let best = null, bd = 1e9;
  for (const e of enemies) {
    if (!e.alive) continue;
    _sp.copy(e.center).project(camera);
    if (_sp.z > 1) continue;
    const sx = (_sp.x + 1) / 2 * innerWidth, sy = (1 - _sp.y) / 2 * innerHeight;
    const d = Math.hypot(sx - x, sy - y), lim = e.type === 'boss' ? 70 : e.type === 'brute' ? 48 : 36;
    if (d < lim && d < bd) { bd = d; best = e; }
  }
  return best;
}
// rally point: the road sample nearest the pointer, within 3.3 tiles of the barracks
function rallyPick(t, x, y) {
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const p = ray.ray.intersectPlane(groundPlane, new V3()), rng = t.spec === 'b' ? .64 : 2.25; let best = null, bd = rng;
  if (p) for (const sm of SAMPLES) { const d = (sm.x - p.x) ** 2 + (sm.z - p.z) ** 2; if (d < bd && (sm.x - t.x) ** 2 + (sm.z - t.z) ** 2 < 3.3 * 3.3) { bd = d; best = sm; } }
  if (!best && p && t.spec === 'b' && (p.x - t.x) ** 2 + (p.z - t.z) ** 2 < 3.6 * 3.6) { // Rangers may stand off the road: Overwatch
    const gx = Math.floor(p.x + W / 2), gz = Math.floor(p.z + H / 2), ok = gx >= 0 && gz >= 0 && gx < W && gz < H && ![2, 3, 4].includes(T[id(gx, gz)]) && groundY(p.x, p.z) <= 2.1;
    if (ok) best = { x: p.x, z: p.z, over: true };
  }
  return { p, best };
}
function rallyHover(x, y) {
  const t = ui.rally; if (!t) { rallyGhost.visible = false; return; }
  const { p, best } = rallyPick(t, x, y); if (!p) { rallyGhost.visible = false; return; }
  const q = best || p; rallyGhost.visible = true; rallyGhost.position.set(q.x, groundY(q.x, q.z), q.z); rgMat.color.setHex(best ? (best.over ? 0x4aa8ff : 0x4ad05a) : 0xe04a3a);
}
cvs.addEventListener('pointermove', e => { if (ui.rally && e.pointerType === 'mouse') rallyHover(e.clientX, e.clientY); });
function handleTap(x, y, type) {
  if (game.mode !== 'play' || game.state !== 'play') return;
  ui.ptrType = type;
  if (ui.spell) { const k = ui.spell, q = spellSpot(k, x, y); ui.spell = null; spellRing.visible = false; if (q) castSpell(k, q); else { msg(k === 'militia' ? 'Militia need a spot on or near the road' : 'Tap the map to aim'); renderSpells(); } return; }
  if (ui.rally) {
    const t = ui.rally, { best } = rallyPick(t, x, y);
    closeMenus();
    if (best) { t.rally = { x: best.x, z: best.z, over: !!best.over }; for (const so of t.soldiers) { if (so.target && so.target.blocker === so) so.target.blocker = null; if (so.extra && so.extra.blocker === so) so.extra.blocker = null; so.target = so.extra = null; } msg(best.over ? 'Overwatch: the Rangers shoot from here and never block' : t.spec === 'b' ? 'Rally point set: the Rangers block the road' : 'Rally point set'); }
    else msg('Pick a spot on the road within 3 tiles of the barracks');
    return;
  }
  const en = pickEnemy(x, y), sp = pickSoldier(x, y);
  if (sp && en) { _sp.copy(en.center).project(camera); const de = Math.hypot((_sp.x + 1) / 2 * innerWidth - x, (1 - _sp.y) / 2 * innerHeight - y); if (sp.d < de) { selectSoldier(sp.so); return; } }
  else if (sp) { selectSoldier(sp.so); return; }
  if (en) { selectEnemy(en); return; }
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(towers.map(t => t.g), true)[0];
  const ht = hit && towerOf(hit.object);
  if (ht) { selectTower(ht); return; }
  const p = ray.ray.intersectPlane(groundPlane, new V3());
  if (!p) { closeMenus(); return; }
  const gx = Math.floor(p.x + W / 2), gz = Math.floor(p.z + H / 2);
  const s = spots.find(s => gx >= s.gx && gx <= s.gx + 1 && gz >= s.gz && gz <= s.gz + 1);
  if (s) {
    const t2 = towers.find(t => t.spot === s);
    if (t2) { selectTower(t2); return; }
    if (ui.spot === s) closeMenus(); else openBuild(s);
    return;
  }
  const hadMenu = ui.spot || ui.sel || ui.enemy || ui.soldier;
  closeMenus();
  if (!hadMenu && gx >= 0 && gz >= 0 && gx < W && gz < H) { badPlate.position.set(gx2w(gx), groundY(p.x, p.z) + .03, gz2w(gz)); badPlate.material.opacity = .6; }
}

// --- icons and the parchment tooltip shared by both ring menus
const IC = {
  bow: '<path d="M6 3c7 3 7 15 0 18"/><path d="M6 3v18"/><path d="M3 12h16M16 9l3 3-3 3"/>',
  volley: '<path d="M3 6h14M14 3l3 3-3 3M3 12h16M16 9l3 3-3 3M3 18h14M14 15l3 3-3 3"/>',
  bomb: '<circle cx="11" cy="14" r="7"/><path d="M15 8l3-3M18 2v2M22 6h-2"/>',
  mortar: '<circle cx="12" cy="15" r="5"/><path d="M12 10V3M8 6l4-4 4 4M4 22h16"/>',
  scatter: '<path d="M3 12h6M9 12l12-7M9 12h12M9 12l12 7"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  field: '<path d="M12 4v12M7 7l10 6M7 13l10-6"/><ellipse cx="12" cy="18" rx="10" ry="3.5"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  storm: '<path d="M10 2 4 12h5l-1 7 6-9H9zM19 7l-3 5h3l-1 4"/>',
  beam: '<circle cx="7" cy="12" r="4"/><path d="M11 12h11M11 9l9-3M11 15l9 3"/>',
  flame: '<path d="M12 22c-4 0-7-3-7-7 0-5 5-7 5-12 3 2 4 5 3 8 2-1 3-3 3-4 2 2 3 5 3 8 0 4-3 7-7 7z"/>',
  fireline: '<path d="M8 15c-2 0-3-1.5-3-3 0-2.5 2-3.5 2-6 2 1.5 3 3.5 2.5 5M3 21h18M15 17c-1.5 0-2.5-1-2.5-2.5 0-2 1.5-3 1.5-5 1.5 1 2.5 3 2 4.5"/>',
  inferno: '<path d="M12 22c-4 0-7-3-7-7 0-5 5-7 5-12 3 2 4 5 3 8 2-1 3-3 3-4 2 2 3 5 3 8 0 4-3 7-7 7z"/><path d="M1 7l3 2M23 7l-3 2"/>',
  up: '<path d="M12 19V6M6 12l6-6 6 6"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.5h-3a1.8 1.8 0 0 0 0 3.5h4"/>',
  aim: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  dmg: '<path d="M20 4 9 15M14 4h6v6M7 13l4 4M5 19l2-2"/>',
  rng: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>',
  spd: '<path d="M6 3h12M6 21h12M7 3v2a5 5 0 0 0 10 0V3M7 21v-2a5 5 0 0 1 10 0v2"/>',
  max: '<path d="M12 2l3 6.6 7.1.7-5.4 4.8 1.6 7L12 17.5 5.7 21.1l1.6-7L2 9.3l7.1-.7z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  helm: '<path d="M5 20v-8a7 7 0 0 1 14 0v8"/><path d="M5 14h14M12 5v15M9 17h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  flag: '<path d="M5 22V3M5 4h12l-3 4 3 4H5"/>',
  drum: '<ellipse cx="12" cy="9" rx="8" ry="3.2"/><path d="M4 9v7c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V9M4 12l4 6M20 12l-4 6M12 12.2v7M9 3l3 5M15 3l-3 5"/>',
  horn: '<path d="M3 8c3 0 5 3 8 3h6l3-4v10l-3-4h-6c-3 0-5 3-8 3z"/><path d="M20 7c1 1.5 1 8.5 0 10"/>',
  hex: '<path d="M12 2l8.5 5v10L12 22l-8.5-5V7z"/><circle cx="12" cy="12" r="3"/><path d="M12 6v3M12 15v3"/>',
};
// painted round badges (src/art/badges): actions by key, specialisations by their name ("Siege Mortar" → siege-mortar)
const BADGE = Object.fromEntries(Object.entries(import.meta.glob('./art/badges/*.webp', { eager: true, import: 'default' })).map(([p, url]) => [p.split('/').pop().slice(0, -5), url]));
const badge = n => `<img src="${BADGE[n]}" alt="" draggable="false">`;
const specBadge = name => badge(name.toLowerCase().replace(/ /g, '-'));
const hx = c => '#' + c.toString(16).padStart(6, '0');
const TCOL = { arrow: '#2f5a22', cannon: '#3a3f4a', frost: '#1f6a8a', tesla: '#5a3aa0', flame: '#a8401a', barracks: '#2a4a8a', drum: '#a8341a' };
const svg = (n, s = 28, w = 2.4) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
const MODES = ['first', 'last', 'strong', 'close'], MODEN = { first: 'First', last: 'Last', strong: 'Strongest', close: 'Closest' };
const MODED = { first: 'the enemy furthest along the road', last: 'the enemy furthest back', strong: 'the enemy with the most health', close: 'the nearest enemy' };
const starRow = (n, c) => [0, 1, 2].map(i => `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="${IC.max.match(/d="([^"]+)"/)[1]}" fill="${i < n ? c : '#4a3a2a'}" stroke="#2e1b0d" stroke-width="1.8"/></svg>`).join('');
const tipEl = $('ttip');
// stats as three parchment tiles: current value, and the next value in green when an upgrade is hovered
function statTiles(type, a, b, bo) {
  const hs = !b && bo && type !== 'drum' ? bo.haste || 0 : 0, rb = !b && bo && type !== 'barracks' && type !== 'drum' ? bo.rngB || 0 : 0;
  if (hs) a = Object.assign({}, a, { rate: a.rate / (1 + hs) });
  const x = b || a, f = type === 'drum' ? [['Fire rate', 'spd', v => '+' + dpct(v.haste)], ['Radius', 'rng', v => v.range.toFixed(1)], ...(x.rngB ? [['Tower range', 'rng', v => '+' + dpct(v.rngB || 0)]] : x.hex ? [['Damage taken', 'dmg', v => '+' + dpct(v.hex || 0)]] : [])] : type === 'barracks' ? [['Health', 'max', v => Math.round(v.hp)], ['Damage', 'dmg', v => r1(v.dmg)], ['Radius', 'rng', v => v.range.toFixed(1)]] : [[type === 'flame' ? 'Dmg / tick' : 'Damage', 'dmg', v => r1(v.dmg)], ['Range', 'rng', v => v.range.toFixed(1)], ['Fires every', 'spd', v => v.rate.toFixed(2) + 's']];
  return `<div class="tst">${f.map(([lab, ic, fn]) => `<div${(ic === 'spd' && hs) || (ic === 'rng' && rb) ? ' class="bst" title="Boosted by a War Drum"' : ''}><span class="ti">${svg(ic, 20)}</span><b>${fn(a)}</b>${b ? `<em>&rarr; ${fn(b)}</em>` : ''}<small>${lab}</small></div>`).join('')}</div>`;
}
function tipHTML({ title, col = '#3b2412', price, poor, sub, body, stats, foot }) {
  return `<div class="th"><b style="color:${col}">${title}</b>${price != null ? `<span class="tag${poor ? ' poor' : ''}">${price}</span>` : ''}</div>${sub ? `<div class="tsub">${sub}</div>` : ''}${stats || ''}${body ? `<p>${body}</p>` : ''}${foot ? `<div class="tft">${foot}</div>` : ''}`;
}
const dtFoot = type => type === 'drum' ? `<span class="dt" style="background:${DCOL.sup}">Support</span> Boosts towers in its radius` : `<span class="dt" style="background:${DCOL[DTYPE[type]]}">${DNAME[DTYPE[type]]}</span> ${TT[type].air ? 'Hits ground and air' : 'Ground only'}`;
function placeTip(cx, cy, above, below = 120) {
  const w = innerWidth, h = innerHeight, th = tipEl.offsetHeight, tw = tipEl.offsetWidth;
  let top = cy - above - th; if (top < 8) top = Math.min(h - th - 8, cy + below);
  tipEl.style.left = clamp(cx - tw / 2, 8, w - tw - 8) + 'px'; tipEl.style.top = top + 'px';
}

// --- build ring: round buttons around an empty plot
const ringEl = $('ring');
ringEl.innerHTML = TYPES.map(t => `<button class="rb bd" data-t="${t}" style="--c:${hx(TT[t].col)}" aria-label="${TT[t].name}, ${TT[t].cost} gold">${badge('tower-' + t)}</button><span class="tag" data-tag="${t}">${TT[t].cost}</span>`).join('') + `<button class="rb x" aria-label="Close">${svg('x', 18, 3)}</button>`;
const ringBtns = [...ringEl.querySelectorAll('button[data-t]')];
ringBtns.forEach((b, i) => {
  const a = -Math.PI / 2 + i * Math.PI * 2 / TYPES.length, x = Math.cos(a) * 96, y = Math.sin(a) * 96;
  b.style.left = x + 'px'; b.style.top = y + 'px';
  const tg = ringEl.querySelector(`[data-tag="${b.dataset.t}"]`); tg.style.left = x + 'px'; tg.style.top = (y + 30) + 'px';
  b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') preview(b.dataset.t); });
  b.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && ui.pick === b.dataset.t) preview(null); });
  b.addEventListener('pointerdown', e => { ui.ptrType = e.pointerType; });
  b.addEventListener('click', () => {
    if (fresh()) return;
    const t = b.dataset.t;
    if (ui.ptrType === 'mouse' || ui.pick === t) buildHere(t); else preview(t);
  });
});
ringEl.querySelector('.x').addEventListener('click', () => { if (!fresh()) closeMenus(); });
function layoutRing() {
  const ok = (game.gate || UNLOCKS[4]).towers, vis = ringBtns.filter(b => ok.includes(b.dataset.t));
  ringBtns.forEach(b => { const on = ok.includes(b.dataset.t); b.hidden = !on; ringEl.querySelector(`[data-tag="${b.dataset.t}"]`).hidden = !on; });
  vis.forEach((b, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / vis.length, x = Math.cos(a) * 96, y = Math.sin(a) * 96; b.style.left = x + 'px'; b.style.top = y + 'px'; const tg = ringEl.querySelector(`[data-tag="${b.dataset.t}"]`); tg.style.left = x + 'px'; tg.style.top = (y + 30) + 'px'; });
}
function openBuild(s) {
  layoutRing();
  closeMenus(); ui.spot = s; ringEl.hidden = false; ui.openT = performance.now();
  selPlate.visible = true; selPlate.position.set(s.x, 1.1, s.z);
  if (ui.ptrType !== 'mouse') preview(null);
}
function preview(type) {
  if (ui.ghost) { ui.ghost.remove(); ui.ghost = null; }
  ui.pick = type;
  ringBtns.forEach(b => b.classList.toggle('sel', b.dataset.t === type));
  if (!type || !ui.spot) { rangeG.visible = deadG.visible = false; tipEl.hidden = true; return; }
  ui.ghost = new Tower(type, ui.spot, true, true);
  showRange(ui.spot.x, ui.spot.z, tStat(type, 1).range);
  const d = TT[type];
  tipEl.innerHTML = tipHTML({ title: d.name, col: TCOL[type], price: d.cost, poor: game.gold < d.cost, stats: statTiles(type, tStat(type, 1)), body: TINFO[type].desc + (ui.ptrType !== 'mouse' ? ' <b>Tap again to build.</b>' : ''), foot: dtFoot(type) });
  tipEl.hidden = false;
}
function buildHere(type) {
  const s = ui.spot; if (!s) return;
  const cost = TT[type].cost;
  if (game.gold < cost) { msg(`Not enough gold for ${TT[type].name} (${cost})`); return; }
  game.gold -= cost;
  closeMenus();
  const t = new Tower(type, s, false); t.spend = cost; towers.push(t); game.built++;
  spotsDirty = true; msg(`Built ${TT[type].name}`);
}

// --- tower ring: upgrade / specialisations on top, aim left, sell right, rank stars below
const tringEl = $('tring');
const RPOS = { specA: [-84, -100], specB: [84, -100], up: [0, -116], aim: [-112, 6], sell: [112, 6] };
tringEl.innerHTML = Object.entries(RPOS).map(([k, [x, y]]) => `<button class="rb ${k}" data-k="${k}" style="left:${x}px;top:${y}px"></button><span class="tag ${k === 'aim' || k === 'sell' ? 'dark' : ''}" data-tag="${k}" style="left:${x}px;top:${y + (k === 'aim' || k === 'sell' ? 26 : 33)}px"></span>`).join('') + '<div class="rstars" id="rstars"></div>';
const TR = { hover: null, armed: null, cache: '' };
const trBtn = k => tringEl.querySelector(`[data-k="${k}"]`), trTag = k => tringEl.querySelector(`[data-tag="${k}"]`);
function towerActs(t) {
  const g = game.gate || UNLOCKS[2], choose = t.lvl === 3 && !t.spec && g.spec, max = !choose && (t.spec ? t.rank >= 3 : t.lvl >= g.max);
  const upCostNow = choose || max ? 0 : t.spec ? rankCost(t.type, t.spec, t.rank + 1) : upCost(t);
  return { choose, max, upCostNow, refund: Math.round(t.spend * sellRate()) };
}
function selectTower(t) {
  closeMenus(); ui.sel = t; tringEl.hidden = false; ui.openT = performance.now();
  selPlate.visible = true; selPlate.position.set(t.x, 1.1, t.z);
  TR.hover = TR.armed = null; renderRing(true);
}
function renderRing(force) {
  const t = ui.sel; if (!t) return;
  const A = towerActs(t), focus = TR.armed || TR.hover;
  const key = `${t.haste}|${t.rngB}|${t.lvl}|${t.spec}|${t.rank}|${t.mode}|${focus}|${TR.armed}|${game.gold >= A.upCostNow}|${game.gold >= SPEC[t.type].a.cost}|${A.refund}`;
  // range ring previews the next range while an upgrade is focused
  let nextSt = null;
  if (focus === 'up' && !A.max) nextSt = t.spec ? specStat(t.type, t.spec, t.rank + 1) : tStat(t.type, t.lvl + 1);
  if (focus === 'specA' || focus === 'specB') nextSt = specStat(t.type, focus === 'specA' ? 'a' : 'b', 1);
  const deadNow = t.type === 'cannon' && (focus === 'specA' || (t.spec === 'a' && focus !== 'specB')) ? mortarDead() : 0;
  if (t.type === 'barracks') { showRange(t.rally.x, t.rally.z, (nextSt || t.st).range); showRally(t); } else showRange(t.x, t.z, (nextSt || t.st).range, deadNow);
  if (!force && key === TR.cache) return; TR.cache = key;
  // buttons
  for (const k of ['specA', 'specB']) {
    const sk = k === 'specA' ? 'a' : 'b', d = SPEC[t.type][sk], b = trBtn(k), tg = trTag(k);
    b.hidden = tg.hidden = !A.choose;
    b.innerHTML = specBadge(d.name); b.classList.add('bd'); b.setAttribute('aria-label', `${d.name}, ${d.cost} gold`);
    b.classList.toggle('poor', game.gold < d.cost); b.classList.toggle('sel', TR.armed === k);
    tg.textContent = d.cost; tg.classList.toggle('poor', game.gold < d.cost);
  }
  const ub = trBtn('up'), ut = trTag('up');
  ub.hidden = ut.hidden = A.choose;
  ub.innerHTML = A.max ? svg('max', 34, 2.8) : badge('action-upgrade'); ub.classList.toggle('bd', !A.max); ub.disabled = A.max;
  ub.classList.toggle('poor', !A.max && game.gold < A.upCostNow); ub.classList.toggle('sel', TR.armed === 'up');
  ub.setAttribute('aria-label', A.max ? 'Fully upgraded' : `Upgrade for ${A.upCostNow} gold`);
  ut.textContent = A.max ? 'MAX' : A.upCostNow; ut.classList.toggle('poor', !A.max && game.gold < A.upCostNow);
  const ab = trBtn('aim'); ab.innerHTML = badge('action-targeting'); ab.classList.add('bd'); ab.setAttribute('aria-label', `Aim: ${MODEN[t.mode]}`); trTag('aim').textContent = MODEN[t.mode];
  ab.hidden = trTag('aim').hidden = t.type === 'drum';
  if (t.type === 'barracks') { ab.innerHTML = badge('action-rally'); ab.setAttribute('aria-label', 'Move the rally point'); trTag('aim').textContent = 'Rally'; }
  const sb = trBtn('sell'); sb.innerHTML = badge('action-sell'); sb.classList.add('bd'); sb.classList.toggle('sel', TR.armed === 'sell'); sb.setAttribute('aria-label', `Sell for ${A.refund} gold`); trTag('sell').textContent = '+' + A.refund;
  $('rstars').innerHTML = t.spec ? starRow(t.rank, '#d07aff') : starRow(t.lvl, '#f2c14e');
  $('rstars').setAttribute('aria-label', t.spec ? `Rank ${t.rank} of 3` : `Level ${t.lvl} of 3`);
  // tooltip
  const sname = t.spec ? SPEC[t.type][t.spec].name : TT[t.type].name, col = t.spec ? '#7a3aa0' : TCOL[t.type];
  let o;
  if (focus === 'up' && !A.max) o = { title: t.spec ? `Rank ${t.rank + 1}` : `Level ${t.lvl + 1}`, col: '#2f7a2a', price: A.upCostNow, poor: game.gold < A.upCostNow, stats: statTiles(t.type, t.st, nextSt), body: t.spec ? (RANKX[t.type][t.spec](t.rank + 1) || 'Stronger shots.') : NOTE[t.type](t.lvl + 1) };
  else if (focus === 'specA' || focus === 'specB') { const sk = focus === 'specA' ? 'a' : 'b', d = SPEC[t.type][sk]; o = { title: d.name, col: sk === 'a' ? '#2f5a22' : '#6a3a8a', price: d.cost, poor: game.gold < d.cost, stats: statTiles(t.type, t.st, nextSt), body: `${d.desc} Ranks 2 and 3 come after.` }; }
  else if (focus === 'sell') o = { title: 'Sell', col: '#8a2a22', price: '+' + A.refund, body: `Get back ${A.refund} gold, 70% of what you spent on it.` };
  else if (focus === 'aim' && t.type === 'barracks') o = t.spec === 'b' ? { title: 'Rally point', body: `Click, then tap within 3 tiles. On the road (green flag) the Rangers block; off the road (blue flag) they take Overwatch: shoot only, never block. Now: ${t.rally && t.rally.over ? 'Overwatch' : 'Blocking'}.` } : { title: 'Rally point', body: 'Click, then tap the road within 3 tiles of the barracks to move where your soldiers stand.' };
  else if (focus === 'aim') o = { title: `Aim: ${MODEN[t.mode]}`, body: `Shoots ${MODED[t.mode]} in range. Click to switch.` };
  else o = { title: sname, col, sub: t.spec ? `${TT[t.type].name} · rank ${t.rank} of 3` : `Level ${t.lvl} of 3`, stats: statTiles(t.type, t.st, null, t), body: (t.spec ? `${SPEC[t.type][t.spec].now} ${RANKX[t.type][t.spec](t.rank)}`.trim() : NOTE[t.type](t.lvl)) + (t.haste ? ` <b style="color:#2f7a2a">War Drum: ${t.type === 'barracks' ? 'soldiers return' : 'fires'} ${dpct(t.haste)} faster${t.rngB && t.type !== 'barracks' ? `, ${dpct(t.rngB)} more range` : ''}.</b>` : '') + (A.max && t.lvl < 3 || (t.lvl === 3 && !A.choose && !t.spec) ? ' <b>Further upgrades unlock as the campaign goes on.</b>' : ''), foot: dtFoot(t.type) };
  if (TR.armed && TR.armed !== 'aim' && ui.ptrType !== 'mouse') o.body = (o.body || '') + ' <b>Tap again to confirm.</b>';
  tipEl.innerHTML = tipHTML(o); tipEl.hidden = false;
}
function ringAct(k) {
  const t = ui.sel; if (!t) return;
  const A = towerActs(t);
  if (k === 'aim' && t.type === 'barracks') { closeMenus(); ui.rally = t; showRange(t.x, t.z, 3.2); showRally(t); msg('Tap the road to set the rally point: green flag = a valid spot'); return; }
  if (k === 'aim') { t.mode = MODES[(MODES.indexOf(t.mode) + 1) % MODES.length]; t.target = null; }
  else if (k === 'sell') { sellTower(t); return; }
  else if (k === 'up') {
    if (A.max || game.gold < A.upCostNow) { if (!A.max) msg(`Not enough gold (${A.upCostNow})`); return; }
    game.gold -= A.upCostNow; t.spend += A.upCostNow;
    if (t.spec) { t.rankUp(); msg(`${SPEC[t.type][t.spec].name} reached rank ${t.rank}`); } else { t.upgrade(); msg(`${TT[t.type].name} upgraded to Lv ${t.lvl}`); }
  } else {
    const sk = k === 'specA' ? 'a' : 'b', d = SPEC[t.type][sk];
    if (!A.choose || game.gold < d.cost) { msg(`Not enough gold for ${d.name} (${d.cost})`); return; }
    game.gold -= d.cost; t.spend += d.cost; t.setSpec(sk); msg(`${TT[t.type].name} became a ${d.name}`);
  }
  TR.armed = null; renderRing(true);
}
tringEl.querySelectorAll('button[data-k]').forEach(b => {
  const k = b.dataset.k;
  b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { TR.hover = k; renderRing(true); } });
  b.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && TR.hover === k) { TR.hover = null; renderRing(true); } });
  b.addEventListener('pointerdown', e => { ui.ptrType = e.pointerType; });
  b.addEventListener('click', () => {
    if (fresh()) return;
    if (ui.ptrType !== 'mouse' && k !== 'aim' && TR.armed !== k) { TR.armed = k; renderRing(true); return; } // first tap explains, second tap buys
    ringAct(k);
  });
});

function sellTower(t) {
  const refund = Math.round(t.spend * sellRate());
  game.gold += refund; t.remove(); towers.splice(towers.indexOf(t), 1);
  t.spot.used = false;
  for (const s of spots) if (Math.abs(s.gx - t.spot.gx) <= 1 && Math.abs(s.gz - t.spot.gz) <= 1) s.block--;
  fxDust(new V3(t.x, 1, t.z), 14, .4); fxCoins(new V3(t.x, 1.4, t.z), Math.min(10, Math.ceil(refund / 15)));
  msg(`Sold ${TT[t.type].name} for ${refund} gold`); spotsDirty = true; closeMenus();
}
function closeMenus() {
  if (ui.spell) { ui.spell = null; if (spellRing) spellRing.visible = false; renderSpells(); }
  rallyFlag.visible = false; rallyGhost.visible = false; ui.rally = null;
  if (ui.ghost) { ui.ghost.remove(); ui.ghost = null; }
  ui.sel = ui.spot = ui.pick = null; TR.hover = TR.armed = null; TR.cache = '';
  ringEl.hidden = true; tringEl.hidden = true; tipEl.hidden = true; document.body.classList.remove('sel');
  if (typeof einfoEl !== 'undefined') { einfoEl.hidden = true; ui.enemy = null; ui.soldier = null; eRing.visible = false; eRing.material.color.setHex(0xff5a4a); } rangeG.visible = deadG.visible = false; selPlate.visible = false;
  ringBtns.forEach(b => b.classList.remove('sel'));
}

// --- wave controls
const DOT = { runner: '#6cbf4a', soldier: '#8a8f99', knight: '#dde0e6', shaman: '#4aaa6a', brute: '#a99bb4', golem: '#3ae0ff', flyer: '#7a3aa0', wraith: '#a8d8ff', boss: '#ffc830', rider: '#a0643a', gruk: '#6f9a4a', sapper: '#c8302a' };
const NAMES = { runner: ['goblin', 'goblins'], soldier: ['orc', 'orcs'], knight: ['knight', 'knights'], shaman: ['shaman', 'shamans'], brute: ['ogre', 'ogres'], golem: ['golem', 'golems'], flyer: ['bat', 'bats'], wraith: ['wraith', 'wraiths'], boss: ['Warlord', 'Warlords'], rider: ['boar rider', 'boar riders'], gruk: ['Gruk', 'Gruk'], sapper: ['sapper', 'sappers'] };
function sendWave(early) {
  if (game.mode !== 'play' || game.state !== 'play' || game.spawnQ.length || game.wave >= MAP.waves) return;
  const bonus = early && game.wave > 0 ? Math.max(0, Math.round(game.countdown * 2 * (skH('kingdom.early') ? 1.25 : 1))) : 0;
  game.gold += bonus; game.earned += bonus;
  startWave();
  if (bonus) msg(`Wave ${game.wave} sent early  +${bonus} gold`);
}
function togglePause() {
  if (game.mode !== 'play' || game.state !== 'play') return;
  game.paused = !game.paused; msg(game.paused ? 'Paused' : 'Resumed');
}
$('bsend').addEventListener('click', () => sendWave(true));
$('bspeed').addEventListener('click', () => { game.speed = game.speed % 3 + 1; });
$('bpause').addEventListener('click', togglePause);
$('bview').addEventListener('click', () => camHome(false));
$('bquit').addEventListener('click', () => fadeTo(() => { resetGame('auto', mapIdx); if (game.mode === 'play' || camp.level != null) showWorld(); else showTitle(); }));
let ctrlCache = '';
function updateCtrl() {
  const n = game.wave + 1, spawning = game.spawnQ.length > 0, done = game.wave >= MAP.waves;
  const cd = Math.ceil(Math.max(0, game.countdown)), bonus = Math.round(Math.max(0, game.countdown) * 2);
  const key = `${n}|${spawning}|${done}|${cd}|${game.speed}|${game.paused}|${game.state}`;
  if (key === ctrlCache) return; ctrlCache = key;
  const send = $('bsend');
  send.disabled = spawning || done || game.state !== 'play';
  if (done) { $('bsendl').textContent = 'Final wave'; $('bsends').textContent = 'Defeat every enemy to win'; $('bprev').innerHTML = ''; }
  else if (spawning) { $('bsendl').textContent = `Wave ${game.wave} marching`; $('bsends').textContent = `${game.spawnQ.length} still to come`; $('bprev').innerHTML = ''; }
  else {
    $('bsendl').textContent = n === 1 ? 'Start wave 1' : `Send wave ${n}`;
    $('bsends').textContent = n === 1 ? 'Build your defences, then start' : `+${bonus} gold early · starts in ${cd} s`;
    const wc = waveCounts(n);
    $('bprev').innerHTML = Object.entries(wc).filter(([, c]) => c).map(([k, c]) => `<span><i style="background:${DOT[k]}"></i>${c} ${NAMES[k][c > 1 ? 1 : 0]}</span>`).join('');
  }
  $('bspeed').textContent = `${game.speed}×`;
  $('bpause').innerHTML = game.paused ? '&#9654;' : '&#10074;&#10074;';
  $('bpause').setAttribute('aria-label', game.paused ? 'Resume' : 'Pause');
}

// --- screens
const fadeTo = fn => { fadeEl.style.opacity = 1; setTimeout(() => { fn(); fadeEl.style.opacity = 0; }, 900); };
let playDiff = 1, playDmg = 1;
const eDmgMul = () => game.mode === 'play' ? playDmg : 1; // difficulty scales the damage enemies deal to the castle and to soldiers
const PROG_KEY = 'voxelSiege.stars.v1';
function loadStars() { try { return JSON.parse(localStorage.getItem(PROG_KEY) || '{}') || {}; } catch (_) { return {}; } }
function saveStars(key, n) { try { const p = loadStars(); if ((p[key] || 0) < n) { p[key] = n; localStorage.setItem(PROG_KEY, JSON.stringify(p)); } } catch (_) {} if (SAVE_MEM && (SAVE_MEM.stars[key] || 0) < n) SAVE_MEM.stars[key] = n; cloudPush(); }
const starStr = n => '★'.repeat(n) + '<i>' + '★'.repeat(3 - n) + '</i>';
const SWATCH = { meadow: 'linear-gradient(135deg,#5aa84a,#3a7fd0)', alpine: 'linear-gradient(135deg,#7a8a6a,#c8ccd4)', snow: 'linear-gradient(135deg,#dfe9f2,#8ac8e8)', ember: 'linear-gradient(135deg,#3a2a26,#ff6a1a)', mire: 'linear-gradient(135deg,#4f6a34,#8ac04a)', forest: 'linear-gradient(135deg,#2f5a2a,#7ab04a)' };
function showMaps() {
  const p = loadStars();
  $('mlist').innerHTML = MAPS.map((m, i) => {
    const kinds = Object.keys(m.units).map(k => `<span style="color:${DOT[k]}">&#9632;</span>`).join('');
    return `<button class="mcard" data-i="${i}"><div class="sw" style="background:${SWATCH[m.theme]}"><span>${i + 1}. ${m.name}</span><span class="st">${starStr(p[m.key] || 0)}</span></div>
      <div class="mb"><p>${m.blurb}</p><div class="mm"><span>${m.waves} waves</span><span>${m.paths.length} ${m.paths.length > 1 ? 'portals' : 'portal'}</span><span>${m.gold} gold to start</span><span>${kinds}</span></div></div></button>`;
  }).join('');
  $('mlist').querySelectorAll('.mcard').forEach(b => b.addEventListener('click', () => { $('maps').hidden = true; startPlay(+b.dataset.i); }));
  $('title').hidden = true; hideEnd(); $('maps').hidden = false;
}
$('mclose').addEventListener('click', () => { $('maps').hidden = true; if (game.mode !== 'play') $('title').hidden = false; else showEnd(); });
function showTitle() { $('title').hidden = false; $('ctrl').hidden = true; $('bmenu').hidden = true; hideEnd(); }
function startPlay(i = mapIdx) { fadeTo(() => { $('title').hidden = true; $('maps').hidden = true; $('bmenu').hidden = true; $('ctrl').hidden = false; resetGame('play', i); }); }
$('bplay').addEventListener('click', showWorld);
$('bwatch').addEventListener('click', () => { $('title').hidden = true; $('bmenu').hidden = false; });
$('bmenu').addEventListener('click', showTitle);
$('bretry').addEventListener('click', () => startPlay(mapIdx));
$('bnext').addEventListener('click', () => fadeTo(() => { resetGame('auto', mapIdx); showWorld(); }));
$('btitle').addEventListener('click', () => fadeTo(() => { resetGame('auto', mapIdx); showWorld(); }));
function showEnd() {
  ui.endShown = true; closeMenus();
  const won = game.state === 'victory';
  $('etitle').textContent = won ? 'Victory' : 'Defeat';
  $('etitle').classList.toggle('lost', !won);
  const hf = game.hp / (game.maxHp || 100), stars = won ? (hf > .8 ? 3 : hf > .4 ? 2 : 1) : 0;
  let rec = null;
  if (won) { saveStars(MAP.key, stars); if (game.mode === 'play') rec = recordWin(MAP.key, game.diffI ?? 1, stars); }
  const dI = game.diffI ?? 1, sc = DCOLS[dI];
  $('estars').innerHTML = won ? [0, 1, 2].map(k => k < stars ? `<span style="color:${sc.f};-webkit-text-stroke:1px ${sc.e}">\u2605</span>` : '<span><i>\u2605</i></span>').join('') : '';
  let eb = $('ebonus'); if (!eb) { eb = document.createElement('div'); eb.id = 'ebonus'; $('estars').after(eb); }
  eb.innerHTML = rec ? `<span class="eb-d">${crestSVG(dI, 18)} ${DIFFS[dI].name}</span>${rec.gained ? ` <b>+${rec.gained} star${rec.gained > 1 ? 's' : ''}</b>` : ' <span class="eb-m">No new stars: your best here is ' + rec.best + '</span>'}${rec.bounty ? ` <span class="eb-new">First clear</span> <b>+${rec.bounty} skill point${rec.bounty > 1 ? 's' : ''}</b>` : ''}` : '';
  eb.hidden = !rec;
  $('esub').textContent = won ? `${MAP.name}: all ${MAP.waves} waves repelled with ${Math.ceil(game.hp)} castle health left.` : `${MAP.name}: the castle fell on wave ${game.wave} of ${MAP.waves}.`;
  $('bnext').hidden = !won; $('bnext').textContent = 'Continue';
  $('btitle').hidden = won; $('btitle').textContent = 'World map';
  $('bretry').textContent = won ? 'Replay' : 'Retry';
  $('bretry').classList.toggle('primary', !won);
  const st = [['Waves reached', `${game.wave} / ${MAP.waves}`], ['Enemies defeated', game.defeated], ['Towers built', game.built], ['Gold earned', game.earned]];
  $('estats').innerHTML = st.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('');
  $('end').hidden = false; $('ctrl').hidden = true;
}
function recordWin(key, dI, stars) {
  const s = loadSave(), t = trackOf(s, key).slice(), prev = t[dI], first = !t[dI];
  t[dI] = Math.max(t[dI], stars); s.sd[key] = t;
  let bounty = 0; if (first && BOUNTY[dI]) { const c = (s.claims[key] || [0, 0, 0]).slice(); if (!c[dI]) { c[dI] = 1; s.claims[key] = c; bounty = BOUNTY[dI]; } }
  writeSave(s);
  return { gained: Math.max(0, stars - prev), best: t[dI], bounty };
}
function hideEnd() { ui.endShown = false; $('end').hidden = true; }
// ================================================================ campaign: world map, briefing, unlocks (Phase 4)
const AREAS = [
  { name: 'Greenvale', land: 'River lowlands, farms and a bog', col: '#8cc06a', ink: '#3f6a2a' },
  { name: 'Highcrag', land: 'Mountain passes and old copper mines', col: '#b3ab9c', ink: '#5a5248' },
  { name: 'Frostmere Reach', land: 'Snowfields and a frozen lake', col: '#e4eef6', ink: '#5a7a9a' },
  { name: 'Cinderwaste', land: 'Ash plains, lava rivers, the King’s tomb', col: '#6a4a40', ink: '#2a1a14' },
];
// map: key of a built map in MAPS, or null while the level is still planned
const LEVELS = [
  { id: '1-1', area: 0, name: 'Millbrook Fields', map: 'mill', x: 420, y: 805, story: 'Goblin raiders are trampling the farms below the Keep, where the last beacon fire in the March still burns. Learn to build and drive them off.', tut: true },
  { id: '1-2', area: 0, name: 'River Crossing', map: 'river', x: 322, y: 655, story: 'The raiders reach the river, and cave bats fly straight over the water. Hold the bridge.' },
  { id: '1-3', area: 0, name: 'Thornwood', map: 'thorn', x: 150, y: 600, story: 'The road leaves the river and plunges into the Thornwood, where goblin sappers lay their traps.' },
  { id: '1-4', area: 0, name: 'Mire’s Edge', map: 'mire', x: 262, y: 528, story: 'Gruk the Mire-King wades out of the bog with his boar riders. End his raids for good.' },
  { id: '2-1', area: 1, name: 'Highland Pass', map: 'pass', x: 205, y: 395, story: 'Knights who sold their oaths march with the horde up the switchbacks.' },
  { id: '2-2', area: 1, name: 'Copperdeep Mines', map: null, x: 410, y: 300, story: 'Cave trolls burrow through the old mines. Watch the tunnel mouths.' },
  { id: '2-3', area: 1, name: 'Eagle’s Rest', map: null, x: 600, y: 165, story: 'The Stone Warlord storms the cliff-top fortress.' },
  { id: '3-1', area: 2, name: 'Frostmere', map: 'frost', x: 905, y: 215, story: 'Wraiths drift across the frozen lake, and arrows pass straight through them.' },
  { id: '3-2', area: 2, name: 'Whitepine Hollow', map: null, x: 1200, y: 150, story: 'A blizzard hides the Rime Matriarch’s march through the pines.' },
  { id: '4-1', area: 3, name: 'Ember Crater', map: 'crater', x: 1290, y: 470, story: 'Every clan of the horde gathers in the ash fields.' },
  { id: '4-2', area: 3, name: 'Obsidian Road', map: null, x: 1060, y: 640, story: 'Lava surges across the road as the salamanders come.' },
  { id: '4-3', area: 3, name: 'The Ashen Throne', map: null, x: 1400, y: 775, story: 'The Ashen King wakes to snuff out the last light. End the march at his tomb.' },
];
// what the player has unlocked, by furthest level reached (Kingdom Rush style); Watch mode has everything
const UNLOCKS = [
  { towers: ['arrow', 'cannon', 'frost'], max: 2, spec: false, note: '' },
  { towers: ['arrow', 'cannon', 'frost', 'tesla'], max: 3, spec: false, note: 'New tower: Tesla Coil. Every tower can now reach level 3.' },
  { towers: TYPES.filter(k => k !== 'barracks' && k !== 'drum'), max: 3, spec: true, note: 'New tower: Flame Tower. Specialisations and their ranks are open.' },
  { towers: TYPES.filter(k => k !== 'drum'), max: 3, spec: true, note: 'New tower: Barracks. Its soldiers block the road and fight enemies hand to hand.' },
  { towers: TYPES, max: 3, spec: true, note: 'New tower: War Drum. The towers around it fire faster.' },
];
function gateTier(s = loadSave()) { let f = 0; LEVELS.forEach((L, i) => { const st = levelState(s, i); if (st === 'open' || st === 'done') f = i; }); return f >= 7 ? 4 : f >= 3 ? 3 : Math.min(2, f); }
const levelTier = i => i >= 7 ? 4 : i >= 3 ? 3 : Math.min(2, i); // each level has its own tower set, even when replayed later
const gateFor = mode => mode === 'play' ? UNLOCKS[camp.level != null ? levelTier(camp.level) : gateTier()] : UNLOCKS[4];
const DIFFS = [{ k: 'casual', name: 'Casual', mul: 1, dmg: 1, note: 'Enemies at their base health and damage' }, { k: 'normal', name: 'Normal', mul: 1.25, dmg: 1.25, note: 'Enemies have 25% more health and deal 25% more damage' }, { k: 'impossible', name: 'Impossible', mul: 1.5, dmg: 1.5, note: 'Enemies have 50% more health and deal 50% more damage' }];
const SAVE_KEY = 'voxelSiege.save.v2';
let SAVE_MEM = null;
function loadSave() {
  let s = null; try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (_) {}
  if (!s) s = { stars: {}, diff: 'normal', seen: {} };
  if (s.diff && !DIFFS.some(d => d.k === s.diff)) s.diff = 'normal'; // old Veteran is the new Normal
  s.sd = s.sd || {}; s.claims = s.claims || {};
  for (const k in s.stars) if (!s.sd[k] && s.stars[k]) s.sd[k] = [s.stars[k], 0, 0]; // wins from before star tracks count as Casual
  s.stars = s.stars || {};
  const won = loadStars(); for (const k in won) s.stars[k] = Math.max(s.stars[k] || 0, won[k]); // wins are recorded by the battle screen; keep the best
  if (SAVE_MEM) mergeSave(s, SAVE_MEM); // progress loaded from the cloud save
  s.seen = s.seen || {}; s.diff = s.diff || 'normal';
  return s;
}
function writeSave(s) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (_) {} SAVE_MEM = JSON.parse(JSON.stringify(s)); cloudPush(); }
// ---- cloud save: each player's progress is kept in the artifact's own database, so it survives new versions of the page.
// The browser copy above is only a fast local cache; on load the two are merged (best stars win) and written back to both.
function mergeSave(s, o) {
  if ((o.epoch || 0) > (s.epoch || 0)) { // progress was reset: drop the older copy entirely
    try { localStorage.removeItem(PROG_KEY); localStorage.removeItem(SAVE_KEY); } catch (_) {}
    for (const k of Object.keys(s)) delete s[k]; return Object.assign(s, JSON.parse(JSON.stringify(o)));
  }
  if ((s.epoch || 0) > (o.epoch || 0)) return s;
  s.stars = s.stars || {}; for (const k in o.stars || {}) s.stars[k] = Math.max(s.stars[k] || 0, o.stars[k] || 0);
  s.seen = Object.assign({}, o.seen || {}, s.seen || {});
  s.sd = s.sd || {}; for (const k in o.sd || {}) { const a = s.sd[k] || [0, 0, 0]; s.sd[k] = a.map((v, i) => Math.max(v, o.sd[k][i] || 0)); }
  if ((o.treeT || 0) > (s.treeT || 0)) { s.tree = JSON.parse(JSON.stringify(o.tree || {})); s.treeT = o.treeT; } // the newer set of skill picks wins
  s.claims = s.claims || {}; for (const k in o.claims || {}) { const a = s.claims[k] || [0, 0, 0]; s.claims[k] = a.map((v, i) => v || o.claims[k][i] ? 1 : 0); }
  if (s.diff == null && o.diff) s.diff = o.diff; if (s.dev == null && o.dev != null) s.dev = o.dev;
  if (o.tierSeen != null) s.tierSeen = Math.max(s.tierSeen ?? 0, o.tierSeen);
  return s;
}
const cloud = { ref: null, t: 0, last: '' };
function cloudPush() {
  if (!cloud.ref) return; clearTimeout(cloud.t);
  cloud.t = setTimeout(async () => {
    try { // merge with what is stored first, so an older open tab never wipes progress made elsewhere
      const snap = await cloud.ref.get(), s = snap.exists ? mergeSave(loadSave(), snap.data()) : loadSave(), j = JSON.stringify(s);
      SAVE_MEM = JSON.parse(j); if (j === cloud.last) return; cloud.last = j; await cloud.ref.set(JSON.parse(j));
    } catch (_) { cloud.last = ''; }
  }, 600);
}
(async () => {
  try {
    if (!window.claude || !window.claude.use) return;
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); if (!db || !user) return;
    const id = await user.id(); if (!id) return;
    const ref = db.doc('data/users/' + id + '/save'), snap = await ref.get();
    const local = loadSave(), merged = snap.exists ? mergeSave(JSON.parse(JSON.stringify(local)), snap.data()) : local;
    SAVE_MEM = JSON.parse(JSON.stringify(merged));
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(merged)); } catch (_) {}
    cloud.ref = ref; cloud.last = snap.exists ? JSON.stringify(snap.data()) : ''; cloudPush();
    if (typeof wmRefresh === 'function' && typeof WM !== 'undefined' && WM.built) wmRefresh();
  } catch (_) {}
})();
const levelStars = (s, L) => L.map ? (s.stars[L.map] || 0) : 0; // best stars on any difficulty: decides what is unlocked
const DCOLS = [{ f: '#c87a3a', e: '#7a3e14' }, { f: '#a4b4cc', e: '#38445a' }, { f: '#f2c230', e: '#9a6a08' }]; // copper, silver, gold
const BOUNTY = [0, 1, 3]; // skill points for the first win of a level on Normal / Impossible
const trackOf = (s, key) => (s.sd && s.sd[key]) || [0, 0, 0];
const bountyPts = s => Object.values(s.claims || {}).reduce((n, c) => n + c.reduce((a, v, i) => a + (v ? BOUNTY[i] : 0), 0), 0);
const skillPts = s => totalStars(s) + bountyPts(s);
function crestSVG(i, px = 16) {
  const { f, e } = DCOLS[i];
  return i === 2 ? `<svg class="crest" width="${px}" height="${px}" viewBox="0 0 24 26" aria-hidden="true"><path d="M3 9l4.5 4L12 5l4.5 8L21 9l-2 11H5z" fill="${f}" stroke="${e}" stroke-width="1.8" stroke-linejoin="round"/><rect x="5" y="20" width="14" height="3.5" rx="1" fill="${f}" stroke="${e}" stroke-width="1.5"/></svg>`
    : `<svg class="crest" width="${px}" height="${px}" viewBox="0 0 24 26" aria-hidden="true"><path d="M12 2l8.5 3v7.5c0 5.5-4 9.5-8.5 11.5-4.5-2-8.5-6-8.5-11.5V5z" fill="${f}" stroke="${e}" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 7v11M7.5 11.5h9" stroke="${e}" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}
const starsHTML = (n, i) => [0, 1, 2].map(k => k < n ? `<span class="sk" style="color:${DCOLS[i].f};-webkit-text-stroke:.6px ${DCOLS[i].e}">★</span>` : '<span class="sk off">★</span>').join('');
const bestTrack = t => t[2] ? 2 : t[1] ? 1 : t[0] ? 0 : -1;
// a built level is open when it is the first built level or the previous built level was won
function levelState(s, i) {
  const L = LEVELS[i];
  if (L.map && levelStars(s, L) > 0) return 'done'; // a level you have won never locks again, even if a new level is added before it
  if (s.dev) return L.map ? 'open' : 'soon'; // testing switch: every level open
  if (i > 0 && levelStars(s, LEVELS[i - 1]) === 0) return 'locked'; // otherwise the level before must be won first
  if (!L.map) return 'soon';
  return levelStars(s, L) > 0 ? 'done' : 'open';
}
const areaOpen = (s, a) => LEVELS.some((L, i) => L.area === a && levelState(s, i) !== 'locked');
const camp = { level: null, justWon: null };
const totalStars = s => LEVELS.reduce((n, L) => n + (L.map ? trackOf(s, L.map).reduce((a, v) => a + v, 0) : 0), 0);
const mapIndexOf = key => MAPS.findIndex(m => m.key === key);
// enemy types a level throws, and whether each is new at that point of the campaign
function levelEnemies(i) {
  const L = LEVELS[i], m = MAPS[mapIndexOf(L.map)]; if (!m) return [];
  const types = [...Object.keys(m.units), ...(Object.keys(m.bosses).length ? ['boss'] : [])];
  const before = new Set();
  for (let j = 0; j < i; j++) { const q = LEVELS[j]; if (!q.map) continue; const mm = MAPS[mapIndexOf(q.map)]; Object.keys(mm.units).forEach(t => before.add(t)); if (Object.keys(mm.bosses).length) before.add('boss'); }
  return types.map(t => ({ t, isNew: !before.has(t) }));
}

const wmapEl = $('wmap');
const REGION = [
  [[0, 470], [140, 430], [330, 470], [520, 520], [690, 560], [720, 700], [640, 900], [0, 900]],
  [[0, 0], [820, 0], [800, 220], [740, 380], [690, 520], [520, 500], [330, 450], [140, 410], [0, 450]],
  [[840, 0], [1600, 0], [1600, 330], [1420, 360], [1180, 330], [980, 360], [790, 360], [810, 200]],
  [[790, 380], [980, 380], [1180, 350], [1420, 380], [1600, 350], [1600, 900], [660, 900], [740, 700], [710, 560]],
];
let wToastT = 0;
function wToast(t) { const el = $('wtoast'); el.textContent = t; el.hidden = false; clearTimeout(wToastT); wToastT = setTimeout(() => el.hidden = true, 2200); }
// ---- world map: a voxel diorama of the Ashen March, rendered by the game's renderer while it is open
const WMW = 120, WMH = 68, WPX = 1600 / WMW; // tiles across, tiles deep, map pixels per tile
const wmToWorld = (px, py) => [px / 1600 * WMW - WMW / 2, py / 900 * WMH - WMH / 2];
const RIVER = [[0, 612], [150, 640], [230, 602], [330, 650], [430, 712], [520, 760], [620, 742], [700, 720]];
const LAVA = [[690, 830], [800, 790], [880, 690], [940, 600], [1040, 560], [1160, 575], [1300, 620], [1420, 600], [1600, 560]];
const ROAD = [[70, 830], ...LEVELS.map(L => [L.x, L.y])];
function segDist(px, py, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    best = Math.min(best, Math.hypot(px - ax - dx * t, py - ay - dy * t));
  }
  return best;
}
function inPoly(x, y, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function areaAt(px, py) { const wx = px + (fbm(px * .006, py * .006) - .5) * 90, wy = py + (fbm(px * .006 + 9, py * .006 + 4) - .5) * 70; for (let a = 0; a < 4; a++) if (inPoly(wx, wy, REGION[a])) return a; return wx < 760 ? (wy < 470 ? 1 : 0) : (wy < 360 ? 2 : 3); }
const WM = { buildMs: 0, built: false, scene: null, cam: null, T: new V3(), Tt: new V3(), D: 46, Dt: 46, fog: [], flags: [], labels: [], areaLbl: [], H: null, A: null, smoke: [], t: 0 };
function wmBuild() {
  const S = WM.scene = new THREE.Scene();
  S.background = new THREE.Color(0x9cc0e8); S.fog = new THREE.Fog(0x9cc0e8, 120, 260);
  WM.cam = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .5, 600);
  S.add(new THREE.HemisphereLight(0xeaf2ff, 0x6a5a48, 1.25));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4); sun.position.set(-40, 90, 50); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -72, right: 72, top: 50, bottom: -50, near: 1, far: 240 }); sun.shadow.bias = -.0005; sun.shadow.normalBias = .04; S.add(sun, sun.target);
  // ---- height and kind for every tile
  const H = WM.H = new Float32Array(WMW * WMH), A = WM.A = new Int8Array(WMW * WMH), K = new Array(WMW * WMH);
  for (let j = 0; j < WMH; j++) for (let i = 0; i < WMW; i++) {
    const px = (i + .5) * WPX, py = (j + .5) * (900 / WMH), a = areaAt(px, py), n = fbm(i * .09, j * .09), k = j * WMW + i;
    let h = 1, kind = 'grass';
    if (a === 0) { h = 1 + n * 1.4; kind = 'grass'; }
    else if (a === 1) { const m = Math.pow(fbm(i * .07 + 3, j * .07 + 8), 1.4), edge = smooth(Math.min(i, j, WMW - 1 - i) , 0, 9); h = 1.6 + m * 8 * (.35 + .65 * edge) + (hash(i * 1.7, j * 2.3) - .5) * .8; kind = h > 6.6 ? 'snow' : h > 3.4 ? 'rock' : 'hill'; }
    else if (a === 2) { h = 1.2 + n * 1.6; kind = 'snowf'; }
    else { h = 1 + n * 2; kind = 'ash'; }
    // landmarks
    if (a === 0 && Math.hypot((px - 250) / 100, (py - 522) / 42) < 1) { h = .8; kind = 'bog'; }
    if (a === 2 && Math.hypot((px - 1020) / 160, (py - 250) / 66) < 1) { h = 1; kind = 'ice'; }
    if (a === 3) { const dv = Math.hypot(px - 1470, py - 590); if (dv < 130) { h = Math.max(h, 2 + 11 * Math.pow(1 - dv / 130, 1.1)); kind = 'vrock'; if (dv < 22) { h = 10; kind = 'lavat'; } } }
    if (segDist(px, py, RIVER) < 15 && a === 0) { h = .6; kind = 'water'; }
    if (segDist(px, py, LAVA) < 13 && a === 3) { h = .6; kind = 'lava'; }
    if (a === 0 && px > 400 && px < 660 && py > 740 && py < 868 && kind === 'grass') kind = ((i >> 1) + (j >> 1)) % 2 ? 'field1' : 'field2';
    // the road: carve a flat lane and lower the ground beside it
    const dr = segDist(px, py, ROAD);
    if (dr < 40) { const rh = clamp(h, 1, a === 1 ? 4.5 : 2.4); h = lerp(rh, h, smooth(dr, 12, 40)); }
    if (dr < 11) { if (kind === 'water' || kind === 'lava') kind = 'bridge'; else kind = 'road'; h = kind === 'bridge' ? 1.4 : Math.max(1, Math.min(h, a === 1 ? 4.5 : 2.4)); }
    H[k] = Math.round(h * 2) / 2; A[k] = a; K[k] = kind;
  }
  const COL = { grass: 0x7cbf4e, hill: 0x8aa860, rock: 0x8f887c, snow: 0xf2f4f6, snowf: 0xe8eff6, ice: 0xbfe4f6, ash: 0x5a4640, vrock: 0x3e302c, bog: 0x4a6a3a, water: 0x3f8fd8, lava: 0xff6a1a, lavat: 0xff8a2a, road: 0xc9a46a, bridge: 0x8a5a2a, field1: 0xd8c060, field2: 0x9ccf58 };
  const terr = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial(), WMW * WMH), glowT = [], dummy = new THREE.Object3D(), c = new THREE.Color();
  let n = 0;
  for (let j = 0; j < WMH; j++) for (let i = 0; i < WMW; i++) {
    const k = j * WMW + i, kind = K[k], h = H[k], x = i - WMW / 2 + .5, z = j - WMH / 2 + .5;
    if (kind === 'lava' || kind === 'lavat') { glowT.push([x, z, h, kind]); continue; }
    dummy.position.set(x, (h - 3) / 2, z); dummy.scale.set(1, h + 3, 1); dummy.updateMatrix(); terr.setMatrixAt(n, dummy.matrix);
    c.setHex(COL[kind]); c.offsetHSL(0, 0, (hash(i, j) - .5) * (kind === 'road' ? .05 : .07)); terr.setColorAt(n++, c);
  }
  terr.count = n; terr.castShadow = terr.receiveShadow = true; S.add(terr);
  const lavaM = new THREE.InstancedMesh(boxGeo, new THREE.MeshBasicMaterial(), glowT.length);
  glowT.forEach(([x, z, h, kind], q) => { dummy.position.set(x, (h - 3) / 2, z); dummy.scale.set(1, h + 3, 1); dummy.updateMatrix(); lavaM.setMatrixAt(q, dummy.matrix); c.setHex(kind === 'lavat' ? 0xffb040 : 0xff6a1a); c.offsetHSL(0, 0, (hash(x, z) - .5) * .1); lavaM.setColorAt(q, c); });
  S.add(lavaM);
  // diorama base: stone sides under the whole map
  const base = P(S, 0, -2.3, 0, WMW + .6, 1.4, WMH + .6, 0x5a4636); base.receiveShadow = true;
  P(S, 0, -3.4, 0, WMW + 1.6, .8, WMH + 1.6, 0x3a2a20);
  // ---- decoration, instanced by kind
  const inst = (geoBox, col, list, shadow = true) => { const m = new THREE.InstancedMesh(boxGeo, M(col), list.length); list.forEach((t, q) => { dummy.position.set(t[0], t[1], t[2]); dummy.rotation.set(0, t[6] || 0, 0); dummy.scale.set(t[3], t[4], t[5]); dummy.updateMatrix(); m.setMatrixAt(q, dummy.matrix); }); m.castShadow = shadow; m.receiveShadow = true; S.add(m); return m; };
  const trunks = [], leaves = [], leaves2 = [], pines = [], pineSnow = [], rocks = [], ashRocks = [];
  const ground = (i, j) => H[j * WMW + i];
  for (let j = 1; j < WMH - 1; j++) for (let i = 1; i < WMW - 1; i++) {
    const k = j * WMW + i, kind = K[k], h = H[k], x = i - WMW / 2 + .5, z = j - WMH / 2 + .5, r = hash(i * 3.1, j * 7.7);
    const px = (i + .5) * WPX, py = (j + .5) * (900 / WMH);
    if (segDist(px, py, ROAD) < 24) continue;
    if (kind === 'grass' && r < .16) { const s = .7 + hash(i, j * 2) * .5; trunks.push([x, h + .35 * s, z, .22 * s, .7 * s, .22 * s]); leaves.push([x, h + .95 * s, z, .9 * s, .7 * s, .9 * s, r * 6]); leaves2.push([x, h + 1.45 * s, z, .55 * s, .45 * s, .55 * s, r * 6]); }
    else if ((kind === 'snowf' && r < .14) || (kind === 'hill' && r < .1) || (kind === 'rock' && r < .05 && h < 6)) { const s = .8 + hash(i, j * 5) * .6; pines.push([x, h + .55 * s, z, .9 * s, .7 * s, .9 * s, r * 5]); pines.push([x, h + 1.15 * s, z, .62 * s, .6 * s, .62 * s, r * 5]); pineSnow.push([x, h + 1.6 * s, z, .36 * s, .35 * s, .36 * s, r * 5]); trunks.push([x, h + .15, z, .2, .3, .2]); }
    else if (kind === 'rock' && r < .12) rocks.push([x, h + .25, z, .7, .5, .6, r * 9]);
    else if (kind === 'ash' && r < .08) ashRocks.push([x, h + .3, z, .5 + r * 3, .5 + r * 4, .5 + r * 2, r * 9]);
  }
  inst(boxGeo, 0x6a4424, trunks); inst(boxGeo, 0x4f9a34, leaves); inst(boxGeo, 0x62ae42, leaves2);
  inst(boxGeo, 0x3a6a52, pines); inst(boxGeo, 0xf4f8fb, pineSnow); inst(boxGeo, 0x9a9488, rocks); inst(boxGeo, 0x2a1e1c, ashRocks);
  const gy = (px, py) => { const [x, z] = wmToWorld(px, py), i = clamp(Math.floor(x + WMW / 2), 0, WMW - 1), j = clamp(Math.floor(z + WMH / 2), 0, WMH - 1); return [x, ground(i, j), z]; };
  const struct = (px, py, fn) => { const [x, y, z] = gy(px, py), g = new THREE.Group(); g.position.set(x, y, z); fn(g); mergeStatic(g); S.add(g); return g; };
  // castle at the start of the road
  struct(60, 845, g => {
    P(g, 0, 1.2, 0, 4.6, 2.4, 3.6, 0xcfc6b4); for (const [x, z] of [[-2.3, -1.8], [2.3, -1.8], [-2.3, 1.8], [2.3, 1.8]]) { P(g, x, 1.9, z, 1.3, 3.8, 1.3, 0xd8d0be); P(g, x, 4.2, z, 1.6, .9, 1.6, 0x3a6ad0); P(g, x, 4.9, z, .9, .6, .9, 0x3a6ad0); }
    for (let k = -2; k <= 2; k++) P(g, k * .9, 2.7, 1.85, .5, .5, .3, 0xbcb3a0);
    P(g, 0, 3.4, 0, 2.2, 2.2, 2, 0xd8d0be); P(g, 0, 4.9, 0, 2.6, .9, 2.4, 0x2f5ec0); P(g, .5, .7, 1.85, 1, 1.4, .2, 0x5a3a1a);
    P(g, 0, 6.3, 0, .1, 1.8, .1, 0x4a3a2a); P(g, .45, 6.8, 0, .8, .5, .06, 0x3a6ad0);
  });
  // windmill and village
  struct(255, 838, g => { P(g, 0, 1.4, 0, 1.4, 2.8, 1.4, 0xe8d8b0); P(g, 0, 3.1, 0, 1.6, .8, 1.6, 0xb04030); const bl = new THREE.Group(); bl.position.set(0, 2.6, .85); g.add(bl); WM.mill = bl; });
  WM.mill.parent.remove(WM.mill); { const [x, y, z] = gy(255, 838); const bl = WM.mill; bl.position.set(x, y + 2.6, z + .85); for (let k = 0; k < 4; k++) { const a = new THREE.Group(); a.rotation.z = k * Math.PI / 2; bl.add(a); P(a, 0, 1.2, 0, .35, 2.4, .06, 0xf4ead0); } S.add(bl); }
  for (const [px, py, col] of [[150, 760, 0xc04a30], [205, 728, 0x3a6ad0], [300, 770, 0xc04a30], [520, 860, 0x8a5a2a], [110, 700, 0xc04a30]]) struct(px, py, g => { P(g, 0, .6, 0, 1.4, 1.2, 1.1, 0xe8dcc0); P(g, 0, 1.45, 0, 1.6, .5, 1.3, col); P(g, 0, 1.85, 0, 1, .35, 1.3, col); P(g, .3, .45, .56, .3, .5, .05, 0x5a3a1a); });
  // mine entrance and cliff fortress in Highcrag
  struct(405, 330, g => { P(g, 0, 1, 0, 2.6, 2, 1.4, 0x6a5a4a); P(g, 0, .8, .45, 1.4, 1.6, .7, 0x1a120c); P(g, -.8, 1, .75, .25, 2, .25, 0x8a5a2a); P(g, .8, 1, .75, .25, 2, .25, 0x8a5a2a); P(g, 0, 2.05, .75, 2, .3, .3, 0x8a5a2a); P(g, 1.6, .3, 1.4, .8, .5, .5, 0x7a5a3a); });
  struct(690, 120, g => { P(g, 0, 1.6, 0, 3.4, 3.2, 2.6, 0x9a948a); for (const [x, z] of [[-1.7, -1.3], [1.7, -1.3], [-1.7, 1.3], [1.7, 1.3]]) { P(g, x, 2.2, z, .9, 4.4, .9, 0xa8a296); P(g, x, 4.6, z, 1.1, .5, 1.1, 0x6a2a2a); } P(g, 0, 3.8, 0, .1, 1.6, .1, 0x4a3a2a); P(g, .4, 4.3, 0, .7, .45, .06, 0xc0302a); });
  // the tomb at the end
  struct(1500, 812, g => { P(g, 0, 1.4, 0, 5, 2.8, 3.6, 0x2a2024); P(g, 0, 3.3, 0, 4, 1, 3, 0x3a2a30); P(g, 0, 4.2, 0, 2.6, .8, 2, 0x3a2a30); P(g, 0, 1, 1.82, 1.4, 2, .1, 0, ME(0xff7a2a, 1.6), false); for (const x of [-2.2, 2.2]) P(g, x, 2, 1.9, .6, 4, .6, 0x1e161a); });
  // smoke from the volcano
  { const [x, y, z] = gy(1470, 590); for (let k = 0; k < 9; k++) { const m = P(S, x, y + 2 + k, z, 1.6, 1.6, 1.6, 0, new THREE.MeshLambertMaterial({ color: 0x6a6268, transparent: true, opacity: .55, depthWrite: false }), false); WM.smoke.push({ m, k, x, y, z }); } }
  // ---- flags on the road
  LEVELS.forEach((L, idx) => {
    const [x, y, z] = gy(L.x, L.y), g = new THREE.Group(); g.position.set(x, y, z); S.add(g);
    P(g, 0, .25, 0, 1.6, .5, 1.6, 0x8a7a68); P(g, 0, .55, 0, 1.2, .2, 1.2, 0xa89a84);
    P(g, 0, 2.2, 0, .14, 3.4, .14, 0x4a2f14);
    const banner = P(g, .75, 3.3, 0, 1.4, .9, .08, 0xc8302a); const tip = P(g, .2, 3.95, 0, .3, .3, .3, 0xf2c230);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 32), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: .85, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .7; g.add(ring);
    WM.flags[idx] = { g, banner, ring, x, y, z };
  });
  // ---- fog banks, one cloud field per area
  for (let a = 0; a < 4; a++) {
    const grp = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: 0xf2eee8, transparent: true, opacity: .93, flatShading: true }), geo = new THREE.IcosahedronGeometry(1, 1);
    for (let q = 0, tries = 0; q < 150 && tries < 4000; tries++) {
      const px = Math.random() * 1600, py = Math.random() * 900; if (areaAt(px, py) !== a) continue;
      const [x, gyy, z] = gy(px, py), m = new THREE.Mesh(geo, mat), s = 2.4 + Math.random() * 3.4;
      m.position.set(x, Math.max(gyy, a === 1 ? 6 : 3) + 2 + Math.random() * 3, z); m.scale.set(s * 1.4, s * .7, s); m.userData.b = m.position.clone(); m.userData.p = Math.random() * 6; grp.add(m); q++;
    }
    S.add(grp); WM.fog[a] = grp;
  }
  WM.built = true;
}
// ---- labels, camera and input
const wlab = $('wlabels'), wsurf = $('wsurf');
function wmRefresh() {
  const s = loadSave();
  wlab.innerHTML = '';
  WM.labels = LEVELS.map((L, i) => {
    const st = levelState(s, i), n = levelStars(s, L), f = WM.flags[i], open = st !== 'locked', fresh = open && !s.seen[L.id];
    if (fresh) { s.seen[L.id] = 1; f.drop = 1; }
    f.banner.material = M(st === 'done' ? 0xd9a62a : st === 'open' ? 0xc8302a : 0x8a8478); f.ring.visible = st === 'open'; f.g.visible = open;
    const b = document.createElement('button'); b.type = 'button'; b.className = `wl wl-${st}${fresh && i > 0 ? ' wl-new' : ''}`; b.hidden = !open;
    b.setAttribute('aria-label', `${L.id} ${L.name}` + (st === 'soon' ? ', coming soon' : st === 'locked' ? ', locked' : `, ${n} of 3 stars`));
    if (L.map && (st === 'done' || st === 'open')) { const tk2 = trackOf(s, L.map); b.setAttribute('aria-label', `${L.id} ${L.name}, stars: Casual ${tk2[0]}, Normal ${tk2[1]}, Impossible ${tk2[2]} of 3`); }
    const tk = L.map ? trackOf(s, L.map) : [0, 0, 0], bi = bestTrack(tk), tot = tk[0] + tk[1] + tk[2];
    b.innerHTML = `<b>${L.id}</b><span>${L.name}</span>${st === 'done' || st === 'open' ? `<em class="wl-st">${bi >= 0 ? crestSVG(bi, 15) : ''}${starsHTML(bi >= 0 ? tk[bi] : 0, Math.max(0, bi))}</em>${tot ? `<small class="wl-n">${tot} / 9</small>` : ''}` : `<small>${st === 'soon' ? 'Soon' : 'Locked'}</small>`}`;
    b.addEventListener('click', () => { if (st === 'open' || st === 'done') openBrief(i); else wToast(st === 'soon' ? `${L.name} is still being built.` : 'Win the previous level to unlock this one.'); });
    wlab.appendChild(b); return b;
  });
  WM.areaLbl = AREAS.map((A, a) => { const d = document.createElement('div'); d.className = 'wa' + (areaOpen(s, a) ? '' : ' wa-locked'); d.innerHTML = `${A.name}${areaOpen(s, a) ? '' : '<small>Locked</small>'}`; wlab.appendChild(d); return d; });
  WM.fog.forEach((g, a) => g.visible = !areaOpen(s, a));
  writeSave(s);
  $('wstars').textContent = `${totalStars(s)} / ${LEVELS.filter(L => L.map).length * 9}`;
  { const left = skLeft(s); $('wup').innerHTML = 'Upgrades' + (left > 0 ? `<small>${left}</small>` : ''); $('wup').setAttribute('aria-label', `Upgrades, ${left} skill points to spend`); }
}
const AREA_C = [[560, 640], [380, 250], [1180, 200], [1150, 720]];
const _wp = new V3();
function wmUpdate(dt) {
  WM.t += dt;
  const cam = WM.cam, a = innerWidth / innerHeight;
  if (Math.abs(cam.aspect - a) > 1e-3) { cam.aspect = a; cam.fov = a >= 1.2 ? 38 : clamp(38 * Math.pow(1.2 / a, .5), 38, 62); cam.updateProjectionMatrix(); }
  const k = 1 - Math.exp(-8 * dt); WM.T.lerp(WM.Tt, k); WM.D = lerp(WM.D, WM.Dt, k);
  const pitch = .92; cam.position.set(WM.T.x, WM.T.y + Math.sin(pitch) * WM.D, WM.T.z + Math.cos(pitch) * WM.D); cam.lookAt(WM.T);
  if (WM.mill) WM.mill.rotation.z += dt * .8;
  WM.smoke.forEach(sm => { const u = (WM.t * .25 + sm.k / 9) % 1; sm.m.position.set(sm.x + Math.sin(u * 6 + sm.k) * .8 + u * 2, sm.y + 2 + u * 10, sm.z - u * 2); sm.m.scale.setScalar(1 + u * 2.4); sm.m.material.opacity = .6 * (1 - u); });
  WM.fog.forEach(g => { if (g.visible) g.children.forEach(m => { const b = m.userData.b, p = m.userData.p; m.position.set(b.x + Math.sin(WM.t * .25 + p) * .8, b.y + Math.sin(WM.t * .4 + p) * .25, b.z + Math.cos(WM.t * .2 + p) * .5); }); });
  WM.flags.forEach((f, i) => { if (f.ring.visible) { const s = 1 + Math.sin(WM.t * 4) * .12; f.ring.scale.set(s, s, s); f.g.position.y = f.y + Math.abs(Math.sin(WM.t * 3)) * .25; } f.banner.rotation.y = Math.sin(WM.t * 2 + i) * .12; if (f.drop > 0) { f.drop = Math.max(0, f.drop - dt * 1.2); const k = f.drop; f.g.position.y = f.y + k * k * 9; f.g.scale.setScalar(1 + k * .3); } });
  // project labels onto the screen
  const W = innerWidth, Hh = innerHeight;
  WM.labels.forEach((b, i) => { const f = WM.flags[i]; if (b.hidden) return; _wp.set(f.x, f.g.position.y + 4.6, f.z).project(cam); const vis = _wp.z < 1 && Math.abs(_wp.x) < 1.15 && Math.abs(_wp.y) < 1.15; b.style.visibility = vis ? 'visible' : 'hidden'; b.style.transform = `translate(${((_wp.x + 1) / 2 * W).toFixed(1)}px,${((1 - _wp.y) / 2 * Hh).toFixed(1)}px) translate(-50%,-100%)`; });
  WM.areaLbl.forEach((d, a) => { const [x, z] = wmToWorld(...AREA_C[a]); _wp.set(x, a === 1 ? 14 : 9, z).project(cam); d.style.transform = `translate(${((_wp.x + 1) / 2 * W).toFixed(1)}px,${((1 - _wp.y) / 2 * Hh).toFixed(1)}px) translate(-50%,-50%)`; d.style.visibility = _wp.z < 1 ? 'visible' : 'hidden'; });
}
// keep the view on the map: the camera looks down at ~53 degrees, so the visible ground reaches further toward the viewer as it zooms out
const wmClampT = () => { const ex = Math.min(WMW / 2 - 4, WM.Dt * .55), ez = WM.Dt * .32; WM.Tt.x = clamp(WM.Tt.x, -WMW / 2 + ex, WMW / 2 - ex); WM.Tt.z = clamp(WM.Tt.z, -WMH / 2 + ez * .7, WMH / 2 - ez); };
const wmPtr = new Map(); let wmPinch = 0, wmDown = null;
wsurf.addEventListener('pointerdown', e => { wsurf.setPointerCapture(e.pointerId); wmPtr.set(e.pointerId, { x: e.clientX, y: e.clientY }); wmDown = { x: e.clientX, y: e.clientY, t: performance.now() }; if (wmPtr.size === 2) { const [p, q] = [...wmPtr.values()]; wmPinch = Math.hypot(p.x - q.x, p.y - q.y); } });
wsurf.addEventListener('pointermove', e => {
  const p = wmPtr.get(e.pointerId); if (!p) return;
  if (wmPtr.size === 2) { p.x = e.clientX; p.y = e.clientY; const [a, b] = [...wmPtr.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (wmPinch) { WM.Dt = clamp(WM.Dt * wmPinch / d, 20, 84); wmClampT(); } wmPinch = d; return; }
  const k = WM.D * Math.tan(WM.cam.fov * Math.PI / 360) * 2 / innerHeight;
  WM.Tt.x -= (e.clientX - p.x) * k; WM.Tt.z -= (e.clientY - p.y) * k * 1.25; wmClampT(); p.x = e.clientX; p.y = e.clientY;
});
const wmUp = e => { wmPtr.delete(e.pointerId); if (wmPtr.size < 2) wmPinch = 0; };
wsurf.addEventListener('pointerup', wmUp); wsurf.addEventListener('pointercancel', wmUp);
wsurf.addEventListener('wheel', e => { e.preventDefault(); WM.Dt = clamp(WM.Dt * Math.exp(e.deltaY * .0012), 20, 84); wmClampT(); }, { passive: false });
addEventListener('keydown', e => {
  if (wmapEl.hidden || !$('brief').hidden || !$('book').hidden) return;
  const d = { ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4] }[e.key]; if (d) { WM.Tt.x += d[0]; WM.Tt.z += d[1]; wmClampT(); }
  if (e.key === '+' || e.key === '=') WM.Dt = clamp(WM.Dt * .85, 20, 84); if (e.key === '-') WM.Dt = clamp(WM.Dt / .85, 20, 84);
});
function hideWorld() { wmapEl.hidden = true; document.body.classList.remove('wm'); }
function showWorld() {
  $('title').hidden = true; hideEnd(); $('maps').hidden = true; $('brief').hidden = true; $('ctrl').hidden = true; $('bmenu').hidden = true;
  if (!WM.built) { const t0 = performance.now(); wmBuild(); WM.buildMs = Math.round(performance.now() - t0); }
  wmRefresh(); wmapEl.hidden = false; document.body.classList.add('wm');
  { const s = loadSave(), g = gateTier(s); if (s.tierSeen == null) { s.tierSeen = g; writeSave(s); } else if (g > s.tierSeen) { s.tierSeen = g; writeSave(s); setTimeout(() => { wToast(UNLOCKS[g].note); clearTimeout(wToastT); wToastT = setTimeout(() => $('wtoast').hidden = true, 5000); }, 600); } }
  const s = loadSave(), i = Math.max(0, LEVELS.findIndex((q, k) => levelState(s, k) === 'open')), f = WM.flags[i >= 0 ? i : 0];
  WM.Dt = WM.D = innerWidth < innerHeight ? 52 : 44; WM.Tt.set(f.x, f.y, f.z + 2); wmClampT(); WM.T.copy(WM.Tt);
}

// ---- level briefing
function openBrief(i) {
  const L = LEVELS[i], s = loadSave(), m = MAPS[mapIndexOf(L.map)], n = levelStars(s, L);
  camp.level = i;
  const en = levelEnemies(i);
  $('bArea').textContent = `${AREAS[L.area].name} · Level ${L.id}`;
  $('bName').textContent = L.name;
  $('bStory').textContent = L.story;
  $('bStory').textContent = L.story + (L.tut ? ' Tips will guide you through your first battle.' : '') + (L.map === 'thorn' ? ' Unlocks the Flame Tower and specialisations.' : L.map === 'mire' ? ' Unlocks the Barracks.' : L.map === 'frost' ? ' Unlocks the War Drum.' : '');
  $('bFacts').innerHTML = [[m.waves, 'waves'], [m.paths.length, m.paths.length > 1 ? 'portals' : 'portal'], [m.gold, 'gold to start']].map(([a, b]) => `<span><b>${a}</b> ${b}</span>`).join('');
  { const g = UNLOCKS[levelTier(i)], pg = i > 0 ? UNLOCKS[levelTier(i - 1)] : null, newUp = !pg || g.max > pg.max || (g.spec && !pg.spec);
    $('bFacts').innerHTML += `<span>${g.spec ? 'All upgrades and specialisations' : 'Upgrades up to level ' + g.max}${newUp ? '<i class="b-newp">New</i>' : ''}</span>`;
    { const sp = spellsFor(i, false), ps = i > 0 ? spellsFor(i - 1, false) : []; if (sp.length) $('bFacts').innerHTML += `<span>Spells: ${sp.map(k => SPELLS[k].name).join(', ')}${sp.some(k => !ps.includes(k)) ? '<i class="b-newp">New</i>' : ''}</span>`; }
    $('bTowers').innerHTML = g.towers.map(k => `<span class="b-en" title="${TT[k].name}"><img alt="" src="${almArt(k, 1)}">${!pg || !pg.towers.includes(k) ? '<i>New</i>' : ''}<small>${TT[k].name}</small></span>`).join(''); }
  $('bEnemies').innerHTML = en.map(({ t, isNew }) => `<span class="b-en" title="${ED[t].title}"><img alt="" src="${almEArt(t)}">${isNew ? '<i>New</i>' : ''}<small>${ED[t].title}</small></span>`).join('');
  { const tk = trackOf(s, L.map), cl = s.claims[L.map] || [0, 0, 0];
    $('bBest').innerHTML = `<span class="b-trk">${DIFFS.map((D, di) => `<span class="b-tr${tk[di] ? '' : ' off'}" title="${D.name}: ${tk[di]} of 3 stars${BOUNTY[di] ? (cl[di] ? ', first-clear bounty claimed' : `, first clear gives +${BOUNTY[di]} skill point${BOUNTY[di] > 1 ? 's' : ''}`) : ''}">${crestSVG(di, 15)}${starsHTML(tk[di], di)}</span>`).join('')}</span>`; }
  renderDiff(s.diff);
  $('brief').hidden = false; $('bStart').focus();
}
function renderDiff(k) {
  $('bDiff').innerHTML = DIFFS.map(d => `<button type="button" data-k="${d.k}" aria-pressed="${d.k === k}" class="${d.k === k ? 'on' : ''}">${d.name}</button>`).join('');
  $('bDiffNote').textContent = (DIFFS.find(d => d.k === k) || DIFFS[1]).note;
}
$('bDiff').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const s = loadSave(); s.diff = b.dataset.k; writeSave(s); renderDiff(s.diff); });
$('bClose').addEventListener('click', () => { $('brief').hidden = true; });
$('brief').addEventListener('click', e => { if (e.target === $('brief')) $('brief').hidden = true; });
$('bStart').addEventListener('click', () => {
  const L = LEVELS[camp.level], s = loadSave();
  { const D = DIFFS.find(d => d.k === s.diff) || DIFFS[1]; playDiff = D.mul; playDmg = D.dmg; game.diffI = DIFFS.indexOf(D); }
  hideWorld(); $('brief').hidden = true; startPlay(mapIndexOf(L.map));
});
$('wback').addEventListener('click', () => { hideWorld(); showTitle(); });
$('wbook').addEventListener('click', () => openBook());
// hidden testing switch: tap the star counter five times to open every level (and again to turn it off)
{ let taps = 0, tapT = 0; document.querySelector('.w-total').addEventListener('click', () => {
  const now = performance.now(); taps = now - tapT < 800 ? taps + 1 : 1; tapT = now; if (taps < 5) return; taps = 0;
  const s = loadSave(); s.dev = !s.dev; writeSave(s); wmRefresh(); game.gate = gateFor(game.mode);
  wToast(s.dev ? 'Testing mode on: every level is open, with every tower and upgrade.' : 'Testing mode off: normal progression.'); }); }
$('wup').addEventListener('click', () => openSkills());
// ================================================================ War Council: the skill tree (screen, points and saving; effects are wired through skH())
const SKI = {
  dmg: '<path d="M20 4 9 15M14 4h6v6M7 13l4 4M5 19l2-2"/>',
  rng: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  spd: '<path d="M6 2h12M6 22h12M7 2c0 6 10 6 10 10S7 16 7 22M17 2c0 6-10 6-10 10s10 4 10 10"/>',
  arm: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>',
  hp: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  gold: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5h4a1.8 1.8 0 0 1 0 3.5h-3a1.8 1.8 0 0 0 0 3.5h4"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
  fire: '<path d="M12 22c-4 0-7-3-7-7 0-5 5-7 5-12 3 2 4 5 3 8 2-1 3-3 3-4 2 2 3 5 3 8 0 4-3 7-7 7z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  star: '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6-4.9-4.5 6.6-.8z"/>',
  wall: '<path d="M3 21V9h3v3h3V9h3v3h3V9h3v3h3V9v12zM3 15h18"/>',
  bow: '<path d="M6 3c7 3 7 15 0 18"/><path d="M6 3v18"/><path d="M3 12h16M16 9l3 3-3 3"/>',
  volley: '<path d="M3 6h14M14 3l3 3-3 3M3 12h16M16 9l3 3-3 3M3 18h14M14 15l3 3-3 3"/>',
  bomb: '<circle cx="11" cy="14" r="7"/><path d="M15 8l3-3M18 2v2M22 6h-2"/>',
  stun: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  drum: '<ellipse cx="12" cy="9" rx="8" ry="3.2"/><path d="M4 9v7c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V9M12 12.2v7"/>',
  hex: '<path d="M12 2l8.5 5v10L12 22l-8.5-5V7z"/><circle cx="12" cy="12" r="3"/>',
  horn: '<path d="M3 8c3 0 5 3 8 3h6l3-4v10l-3-4h-6c-3 0-5 3-8 3z"/>',
  bird: '<path d="M2 12c4-1 6-5 10-5 2 0 3 1 4 2l5-1-3 3c0 5-4 8-9 8-3 0-5-1-7-3 3 0 5-1 6-2-3 0-5-1-6-2z"/>',
  dodge: '<path d="M5 19c4-2 6-7 6-14M13 5c0 7 2 12 6 14M8 9l3-4 3 4"/>',
  up: '<path d="M12 19V6M6 12l6-6 6 6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
};
const skI = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SKI[k] || SKI.star}</svg>`;
const SK_CASTLE = '<svg class="sk-k" viewBox="0 0 64 64" aria-hidden="true"><path d="M10 58V26h8v6h6v-6h8v6h6v-6h8v6h6v-6h2v32z" fill="#d8c8a8" stroke="#4a2f14" stroke-width="3" stroke-linejoin="round"/><path d="M26 58V44a6 6 0 0 1 12 0v14" fill="#4a2f14"/><path d="M32 6v18M32 6h14l-4 5 4 5H32" fill="#c8302a" stroke="#4a2f14" stroke-width="2.5" stroke-linejoin="round"/></svg>';
// [id, row, col (0-4, halves allowed), cost, name, effect, icon, parents (any one opens it), 1-of-2 group]
// Every tree has its own shape: Kingdom is a wide crown, Archer a tall spine, Cannon a diamond that fans out,
// Frost a snowflake around a hub, Tesla a zigzag bolt, Flame a spreading fan, Barracks splits twice, War Drum crosses over.
const SK = {
  kingdom: { name: 'Kingdom', shape: 'Crown', blurb: 'The castle and your purse. Three lanes from one charter, and one big choice at the bottom.', nodes: [
    ['root', 0, 2, 1, 'Royal Charter', '+10 starting gold in every battle', 'gold', []],
    ['chest', 1, .5, 1, 'War Chest', '+20 more starting gold', 'gold', ['root']],
    ['muster', 1, 2, 1, 'Bounty Board', 'Wave-clear gold +25%', 'gold', ['root']],
    ['walls', 1, 3.5, 1, 'Stone Walls', 'Castle has 110 health instead of 100', 'wall', ['root']],
    ['tax', 2, 0, 2, 'Tax Collectors', '+6% gold for each enemy defeated', 'gold', ['chest']],
    ['early', 2, 1.33, 2, 'Early Bird', 'Calling a wave early pays 25% more', 'spd', ['chest', 'muster']],
    ['qm', 2, 2.67, 2, 'Salvage', 'Selling refunds 80% instead of 70%', 'gold', ['muster', 'walls']],
    ['slits', 2, 4, 2, 'Arrow Slits', 'The castle shoots enemies within 4 tiles: 8 damage every second', 'bow', ['walls']],
    ['interest', 3, .67, 2, 'Interest', 'Between waves, earn 5% of your unspent gold (up to 25)', 'gold', ['tax', 'early']],
    ['repair', 3, 3.33, 2, 'Repair Crews', 'The castle heals 2 health after each wave', 'hp', ['qm', 'slits']],
    ['treasury', 4, 1, 3, 'Royal Treasury', '+50 starting gold, and selling refunds 90%', 'gold', ['interest'], 'K'],
    ['stand', 4, 3, 3, 'Last Stand', 'Once a battle, at 25 castle health every tower fires 30% faster for 10 s', 'star', ['repair'], 'K'],
  ] },
  arrow: { name: 'Archer Tower', shape: 'Spine', blurb: 'A tall spine of marksmanship with twigs off the side. Longbow or Volley comes late.', nodes: [
    ['root', 0, 2, 1, 'Recruit Archers', '+5% damage', 'dmg', []],
    ['tips', 1, 2, 1, 'Sharpened Tips', '+8% damage', 'dmg', ['root']],
    ['draw', 2, .8, 2, 'Quick Draw', 'Fires 10% faster', 'spd', ['tips']],
    ['eye', 2, 2, 1, 'Eagle Eye', '+8% range', 'rng', ['tips']],
    ['sky', 2, 3.2, 2, 'Sky Watch', '+20% damage to flyers', 'bird', ['tips']],
    ['barb', 3, 2, 2, 'Barbed Arrows', 'Every 5th arrow deals double damage', 'dmg', ['eye']],
    ['long', 4, 1, 2, 'Longbow Drills', 'Longbow arrows ignore 25% of armor', 'bow', ['barb', 'draw'], 'A'],
    ['vol', 4, 3, 2, 'Volley Drills', 'Volley shoots 1 more enemy at once', 'volley', ['barb', 'sky'], 'A'],
    ['head', 5, .5, 2, 'Headhunter', 'Longbow: every 4 s, a golden arrow for double damage at an enemy below 40% health', 'dmg', ['long']],
    ['mark', 5, 2, 2, 'Hunter’s Mark', 'Hit enemies take 10% more damage from all towers for 2 s', 'rng', ['long', 'vol']],
    ['bleed', 5, 3.5, 2, 'Barbed Heads', 'Volley arrows make enemies bleed: 4 damage a second for 3 s', 'dmg', ['vol']],
    ['dead', 6, .5, 3, 'Deadeye', 'Longbow: 12% chance to slay a non-boss enemy outright; bosses take triple damage instead', 'star', ['head']],
    ['guild', 6, 2, 3, 'Fletchers’ Guild', 'Every Archer Tower fires 10% faster', 'spd', ['mark']],
    ['storm', 6, 3.5, 3, 'Arrow Storm', 'Volley: every 8 s, 12 arrows rain on a 2-tile circle around the target', 'star', ['bleed']],
  ] },
  cannon: { name: 'Cannon', shape: 'Diamond', blurb: 'Splits early, comes back together at Earthshaker, then fans out into Mortar or Scattergun.', nodes: [
    ['root', 0, 2, 1, 'Powder Kegs', '+5% damage', 'dmg', []],
    ['powder', 1, 1, 1, 'Black Powder', 'Splash radius +12%', 'bomb', ['root']],
    ['heavy', 1, 3, 1, 'Heavy Shells', '+8% damage', 'dmg', ['root']],
    ['conc', 2, 0, 2, 'Concussion', 'Splash slows ground enemies by 20% for 1 s', 'stun', ['powder']],
    ['reload', 2, 2, 2, 'Fast Reload', 'Fires 10% faster', 'spd', ['powder', 'heavy']],
    ['iron', 2, 4, 2, 'Iron Shot', '+15% damage to enemies with armor', 'arm', ['heavy']],
    ['shaker', 3, 2, 2, 'Earthshaker', 'Every 3rd shell stuns ground enemies for 1 s', 'stun', ['conc', 'reload', 'iron']],
    ['mortar', 4, 1, 2, 'Mortar Crews', 'Siege Mortar’s blind spot shrinks from 3 tiles to 2', 'bomb', ['shaker'], 'A'],
    ['scatter', 4, 3, 2, 'Scatter Crews', 'Scattergun’s cone is much wider', 'volley', ['shaker'], 'A'],
    ['sapper', 5, .5, 2, 'Sapper Shells', 'Siege Mortar ignores 10% more armor', 'arm', ['mortar']],
    ['bunker', 5, 1.5, 2, 'Bunker Buster', 'Siege Mortar deals 25% more damage to bosses', 'dmg', ['mortar']],
    ['grape', 5, 2.5, 2, 'Grapeshot', 'Scattergun deals 15% more damage', 'volley', ['scatter']],
    ['knock', 5, 3.5, 2, 'Knockback', 'Scattergun pushes ground enemies back 0.6 tiles (not bosses)', 'stun', ['scatter']],
    ['cluster', 6, 1, 3, 'Cluster Bomb', 'Siege Mortar: each shell bursts into 5 bomblets for 40% damage each', 'star', ['sapper', 'bunker']],
    ['breath', 6, 3, 3, 'Dragon’s Breath', 'Scattergun: blasts leave burning ground for 3 s', 'star', ['grape', 'knock']],
  ] },
  frost: { name: 'Frost Spire', shape: 'Snowflake', blurb: 'Three arms of cold meet at Absolute Zero, then the ice splits into Deep Freeze or Glacier Field.', nodes: [
    ['root', 0, 2, 1, 'Cold Snap', 'Slows 3% more', 'snow', []],
    ['linger', 1, .5, 1, 'Lingering Cold', 'Slows last 0.5 s longer', 'spd', ['root']],
    ['hoar', 1, 2, 1, 'Hoarfrost', 'Frost shards deal 10% more damage', 'dmg', ['root']],
    ['lens', 1, 3.5, 1, 'Crystal Lens', '+10% range', 'rng', ['root']],
    ['brittle', 2, .5, 2, 'Brittle Ice', 'Frozen enemies: the next physical hit ignores half their armor', 'arm', ['linger']],
    ['bite', 2, 2, 2, 'Frostbite', 'Slowed enemies take 2 damage a second', 'snow', ['hoar']],
    ['mirror', 2, 3.5, 2, 'Ice Mirror', 'Each shot sends a second shard at another enemy for 40% damage', 'volley', ['lens']],
    ['zero', 3, 2, 2, 'Absolute Zero', 'Any frost hit has a 10% chance to freeze for 1 s', 'snow', ['brittle', 'bite', 'mirror']],
    ['deep', 4, 1, 2, 'Deep Freeze Rites', 'Deep Freeze holds enemies 0.5 s longer', 'snow', ['zero'], 'A'],
    ['glacier', 4, 3, 2, 'Glacier Rites', 'Glacier Field’s ice patches are 25% larger', 'snow', ['zero'], 'A'],
    ['perma', 5, 1, 2, 'Permafrost', 'Deep Freeze: every 3rd shard on the same enemy freezes it solid for 1.2 s', 'snow', ['deep']],
    ['black', 5, 3, 2, 'Black Ice', 'Glacier Field’s shards leave ice on the road for 5 s', 'snow', ['glacier']],
    ['shatter', 6, 1, 3, 'Shatter', 'Deep Freeze: a non-boss enemy killed while frozen explodes for 30% of its max health', 'star', ['perma']],
    ['aval', 6, 3, 3, 'Avalanche', 'Glacier Field: every 6 s, up to 3 enemies on the ice freeze solid for 1.2 s', 'star', ['black']],
  ] },
  tesla: { name: 'Tesla Coil', shape: 'Bolt', blurb: 'A zigzag like a lightning strike, with sparks off each bend. Storm or Overload at the bottom.', nodes: [
    ['root', 0, 1.2, 1, 'Copper Coils', '+5% damage', 'bolt', []],
    ['cond', 1, 2.6, 1, 'Conductive Coils', 'Lightning chains to 1 more enemy', 'bolt', ['root']],
    ['ground', 1, 4, 1, 'Grounding Rods', '+8% range', 'rng', ['root']],
    ['cap', 2, 1.2, 2, 'Capacitor', 'Fires 10% faster', 'spd', ['cond']],
    ['static', 3, 2.6, 2, 'Static Field', 'Chained enemies carry a charge for 2 s: if they die, they burst for 30% damage to enemies nearby', 'stun', ['cap']],
    ['rod', 3, .2, 2, 'Lightning Rod', '+25% damage to flyers', 'bird', ['cap']],
    ['storm', 4, 1.2, 2, 'Storm Calling', 'Storm chains to 2 more enemies', 'bolt', ['static'], 'A'],
    ['over', 4, 2.8, 2, 'Overload Tuning', 'Overload reaches full charge in 2 s instead of 3', 'bolt', ['static'], 'A'],
    ['ball', 4, 4, 2, 'Forked Lightning', 'Every 3rd shot starts a second chain at another enemy', 'bolt', ['static', 'ground']],
    ['thunder', 5, .4, 2, 'Thunderhead', 'Storm’s lightning loses less damage per jump (15% → 8%)', 'bolt', ['storm']],
    ['spill', 5, 3.6, 2, 'Arc Spill', 'Overload’s beam arcs to one nearby enemy for 35% damage', 'bolt', ['over']],
    ['super', 6, 1.2, 3, 'Supercell', 'Storm’s lightning jumps 40% further between enemies', 'star', ['thunder']],
    ['melt', 6, 2.8, 3, 'Meltdown', 'Overload: at 4x charge or more, the beam erupts every 6 s for 12x damage, 6x to enemies around it', 'star', ['spill']],
  ] },
  flame: { name: 'Flame Tower', shape: 'Fan', blurb: 'Fire spreads: the tree fans out wide before you pick Fireline or Inferno.', nodes: [
    ['root', 0, 2, 1, 'Pilot Light', '+5% damage', 'fire', []],
    ['fuel', 1, 1, 1, 'Hotter Fuel', 'Burning lasts 1 s longer', 'fire', ['root']],
    ['bellows', 1, 3, 1, 'Bellows', '+10% range', 'rng', ['root']],
    ['scorch', 2, 0, 2, 'Scorch', 'Burning enemies lose 15% of their armor', 'arm', ['fuel']],
    ['nozzle', 2, 1.33, 2, 'Wide Nozzle', 'Fire cone 15% wider', 'fire', ['fuel']],
    ['oil', 2, 2.67, 2, 'Oil Slick', 'Enemies standing in fire are slowed 15%', 'stun', ['bellows']],
    ['valve', 2, 4, 2, 'Pressure Valve', 'Fires 10% faster', 'spd', ['bellows']],
    ['line', 3, .67, 2, 'Fireline Doctrine', 'Fireline’s ember patches last 2 s longer', 'fire', ['scorch', 'nozzle'], 'A'],
    ['ash', 3, 2, 2, 'Phoenix Ash', 'Enemies that die burning drop 1 extra gold', 'gold', ['nozzle', 'oil']],
    ['inf', 3, 3.33, 2, 'Inferno Doctrine', 'Inferno: every 1.5 s, fire jumps from a burning enemy to a nearby one for triple damage', 'fire', ['oil', 'valve'], 'A'],
    ['napalm', 4, .67, 2, 'Napalm', 'Fireline’s ember patches deal 30% more damage', 'fire', ['line']],
    ['ever', 4, 2, 3, 'Everburn', 'Shamans can’t heal burning enemies', 'fire', ['ash']],
    ['hungry', 4, 3.33, 2, 'Hungry Flames', 'Inferno: burning lasts 4 s instead of 1.6', 'fire', ['inf']],
    ['wall', 5, .67, 3, 'Firewall', 'Fireline: every 6 s it sets 3 tiles of road ablaze', 'star', ['napalm']],
    ['wild', 5, 3.33, 3, 'Wildfire', 'Inferno: an enemy that dies burning sets everything within 1.5 tiles alight', 'star', ['hungry']],
  ] },
  barracks: { name: 'Barracks', shape: 'Twin fork', blurb: 'Splits twice: Paladins or Rangers, then a second choice inside each side.', nodes: [
    ['root', 0, 2, 1, 'Recruits', 'Soldiers +10% health', 'hp', []],
    ['gamb', 1, 1, 1, 'Padded Gambesons', 'Soldiers +10% armor', 'arm', ['root']],
    ['drill', 1, 3, 1, 'Drill Yard', 'Soldiers +10% damage', 'dmg', ['root']],
    ['medic', 2, 0, 2, 'Field Medic', 'Soldiers heal 3% a second out of combat instead of 2%', 'hp', ['gamb']],
    ['horn', 2, 2, 2, 'Rally Horn', 'Soldiers come back 20% faster', 'spd', ['gamb', 'drill']],
    ['spear', 2, 4, 2, 'Spear Wall', 'A soldier strikes first, for free, when an enemy reaches it', 'dmg', ['drill']],
    ['pala', 3, 1, 2, 'Paladin Vows', 'Paladins +10% health and +10% magic resist', 'sun', ['medic', 'horn'], 'A'],
    ['rang', 3, 3, 2, 'Ranger Training', 'Rangers shoot 0.5 tiles further', 'bow', ['horn', 'spear'], 'A'],
    ['right', 4, 0, 2, 'Righteous', 'Holy strike every 3rd hit instead of every 4th', 'sun', ['pala'], 'P'],
    ['wind', 4, 1, 2, 'Second Wind', '20% chance to heal to full health after defeating an enemy', 'hp', ['pala'], 'P'],
    ['fourth', 4, 2, 3, 'Fourth Man', 'Every Barracks sends one extra soldier', 'up', ['pala', 'rang']],
    ['nimble', 4, 3, 2, 'Nimble', '20% chance to dodge a melee attack', 'dodge', ['rang'], 'R'],
    ['broad', 4, 4, 2, 'Broadheads', 'Arrows have a 25% chance to pierce into a second enemy', 'bow', ['rang'], 'R'],
    ['shield', 5, .5, 3, 'Divine Shield', 'Paladins: once per life, one about to fall turns invulnerable for 3 s and heals half its health', 'star', ['right', 'wind']],
    ['hawk', 5, 3.5, 3, 'Hawk Companions', 'Rangers: each keeps a hawk that dives at flyers for 6 damage a second', 'star', ['nimble', 'broad']],
  ] },
  drum: { name: 'War Drum', shape: 'Crossbeat', blurb: 'Two rhythms cross over and meet at Thunder Beat, then split into War Horn or Hex Totem.', nodes: [
    ['root', 0, 2, 1, 'Drummer Boys', 'Fire rate boost +2%', 'drum', []],
    ['hide', 1, .5, 1, 'Taut Hide', 'Radius +0.5 tiles', 'rng', ['root']],
    ['beat', 1, 3.5, 1, 'Steady Beat', 'Fire rate boost +3%', 'spd', ['root']],
    ['hymn', 2, 3, 2, 'Battle Hymn', 'Soldiers in the radius heal twice as fast', 'hp', ['hide']],
    ['march', 2, 1, 2, 'Marching Pace', 'Soldiers in the radius move 30% faster', 'spd', ['beat']],
    ['thund', 3, 2, 3, 'Thunder Beat', 'Every 12 s the drum stuns ground enemies in its radius for 0.5 s', 'stun', ['hymn', 'march']],
    ['hornm', 4, .5, 2, 'Horn Makers', 'War Horn’s range boost goes from +20% to +30%', 'horn', ['thund'], 'A'],
    ['twin', 4, 2, 2, 'Twin Rhythm', 'A tower near two drums gets the second at half strength', 'drum', ['thund']],
    ['totem', 4, 3.5, 2, 'Totem Carvers', 'Hex Totem’s curse goes from +15% to +22% damage taken', 'hex', ['thund'], 'A'],
    ['rally', 5, .5, 2, 'Rally Cry', 'War Horn: soldiers in the radius deal 20% more damage', 'horn', ['hornm']],
    ['wither', 5, 3.5, 2, 'Withering', 'Hex Totem: cursed enemies lose 10% armor and magic resist', 'hex', ['totem']],
    ['charge', 6, .5, 3, 'Charge!', 'War Horn: every 20 s, a blast pushes every ground enemy in the radius back 1 tile', 'star', ['rally']],
    ['soul', 6, 3.5, 3, 'Soul Harvest', 'Hex Totem: cursed enemies that die give +2 gold and heal the castle 1 (10 a battle at most)', 'star', ['wither']],
  ] },
};
const SK_ORDER = ['kingdom', 'arrow', 'cannon', 'frost', 'tesla', 'flame', 'barracks', 'drum'];
const SK_DEV_BONUS = 150; // testing mode gives extra points so the whole tree can be tried
for (const k of SK_ORDER) { SK[k].by = {}; for (const [id, r, c, cost, name, fx, ic, par, grp] of SK[k].nodes) SK[k].by[id] = { id, r, c, cost, name, fx, ic, par, grp, sig: ic === 'star' || grp === 'K' }; }
const skTree = s => { s.tree = s.tree || {}; for (const k of SK_ORDER) s.tree[k] = s.tree[k] || {}; return s.tree; };
const skSpentIn = (s, k) => Object.keys(skTree(s)[k]).reduce((n, id) => n + (SK[k].by[id] ? SK[k].by[id].cost : 0), 0);
const skSpent = s => SK_ORDER.reduce((n, k) => n + skSpentIn(s, k), 0);
const skHave = s => skillPts(s) + (s.dev ? SK_DEV_BONUS : 0);
const skLeft = s => skHave(s) - skSpent(s);
// which trees are open: Kingdom always; a tower's tree once that tower is unlocked; specialisation nodes once specialisations are
const skGate = s => UNLOCKS[Math.max(gateTier(s), s.dev ? 4 : 0)];
const skOpen = (s, k) => k === 'kingdom' || skGate(s).towers.includes(k);
const SK_WHEN = { arrow: '1-1', cannon: '1-1', frost: '1-1', tesla: '1-2', flame: '1-3', barracks: '1-4', drum: '3-1' };
function skState(s, k, x, left) {
  const o = skTree(s)[k];
  if (o[x.id]) return 'owned';
  if (x.grp && Object.keys(o).some(id => id !== x.id && SK[k].by[id] && SK[k].by[id].grp === x.grp)) return 'lock';
  if (x.par.length && x.par.every(p => skState(s, k, SK[k].by[p], left) === 'lock')) return 'lock';
  if (x.grp && x.grp !== 'K' && !skGate(s).spec) return 'gated';
  const open = !x.par.length || x.par.some(p => o[p]);
  return open && x.cost <= left ? 'avail' : 'cant';
}
function skRefund(s, k, id) {
  const o = skTree(s)[k]; delete o[id];
  let ch = true; while (ch) { ch = false; for (const b of Object.keys(o)) { const x = SK[k].by[b]; if (!x || (x.par.length && !x.par.some(p => o[p]))) { delete o[b]; ch = true; } } }
}
const sk = { cur: 'kingdom', sel: null };
const skEl = $('skills');
const skPic = k => k === 'kingdom' ? SK_CASTLE : `<img alt="" src="${almArt(k, 3)}">`;
function skRender() {
  const s = loadSave(), left = skLeft(s), b = bountyPts(s);
  $('skPts').innerHTML = `<b>${left}</b> of ${skHave(s)} points left`;
  $('skSrc').textContent = `${totalStars(s)} from stars${b ? `, ${b} from first-clear bounties` : ''}${s.dev ? `, ${SK_DEV_BONUS} testing bonus` : ''}`;
  $('skTabs').innerHTML = SK_ORDER.map(k => { const open = skOpen(s, k); return `<button type="button" role="tab" id="skt-${k}" class="sk-tab${open ? '' : ' shut'}" data-k="${k}" aria-selected="${k === sk.cur}">${skPic(k)}<b>${SK[k].name}</b><small>${open ? skSpentIn(s, k) + ' pts' : 'Unlocks at ' + SK_WHEN[k]}</small></button>`; }).join('');
  const t = SK[sk.cur], xs = Object.values(t.by), rows = Math.max(...xs.map(x => x.r)) + 1, open = skOpen(s, sk.cur);
  const CW = 118, RH = 128, PX = 66, PY = 56, W = PX * 2 + CW * 4, H = PY + RH * (rows - 1) + 104;
  const px = x => PX + x.c * CW, py = x => PY + x.r * RH;
  const st = {}; for (const x of xs) st[x.id] = open ? skState(s, sk.cur, x, left) : 'shut';
  let w = '';
  for (const x of xs) for (const p of x.par) {
    const a = t.by[p], on = st[p] === 'owned' && st[x.id] === 'owned', live = st[p] === 'owned' && (st[x.id] === 'avail' || st[x.id] === 'cant');
    const y1 = py(a) + (a.sig ? 70 : 60) + (a.name.length > 13 ? 14 : 0), y2 = py(x) - (x.sig ? 38 : 32), ym = (y1 + y2) / 2;
    w += `<path d="M${px(a)} ${y1} C${px(a)} ${ym} ${px(x)} ${ym} ${px(x)} ${y2}" fill="none" stroke="${on ? '#8fe06a' : live ? '#f2c230' : '#6b4a22'}" stroke-width="${on ? 5 : 4}" stroke-linecap="round"/>`;
  }
  const gs = {}; for (const x of xs) if (x.grp) (gs[x.grp] = gs[x.grp] || []).push(x);
  for (const g of Object.values(gs)) if (g.length === 2) { const [a, c] = g.sort((p, q) => p.c - q.c), y = py(a); w += `<line x1="${px(a) + 40}" y1="${y}" x2="${px(c) - 40}" y2="${y}" stroke="#ff9a7a" stroke-width="2.5" stroke-dasharray="5 5"/><text x="${(px(a) + px(c)) / 2}" y="${y - 7}" text-anchor="middle" class="sk-xl">1 OF 2</text>`; }
  $('skStage').style.width = W + 'px'; $('skStage').style.height = H + 'px';
  $('skStage').innerHTML = `<svg class="sk-w" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${w}</svg>` + xs.map(x => `<button type="button" id="skn-${x.id}" class="sk-nd ${st[x.id]}${x.sig ? ' sig' : ''}${sk.sel === x.id ? ' sel' : ''}" style="left:${px(x)}px;top:${py(x) - (x.sig ? 37 : 31)}px" data-id="${x.id}" aria-label="${x.name}, costs ${x.cost}. ${x.fx}."><span class="orb">${skI(st[x.id] === 'shut' ? 'lock' : x.ic)}<span class="c">${x.cost}</span></span><span class="nm">${x.name}</span></button>`).join('');
  // side card
  const head = `<div class="sk-hd">${skPic(sk.cur)}<div><h3>${t.name}</h3><small>${t.shape} · ${skSpentIn(s, sk.cur)} points spent</small></div></div><p class="sk-bl">${t.blurb}</p>`;
  if (!open) { $('skSide').innerHTML = head + `<p class="sk-req">This tree opens when the ${t.name} unlocks at ${SK_WHEN[sk.cur]}.</p>`; return; }
  const x = sk.sel && t.by[sk.sel];
  if (!x) { $('skSide').innerHTML = head + `<p class="sk-req">Tap a node to see what it does. Tap it again to buy it.</p>`; return; }
  const sx = st[x.id], partner = x.grp && xs.find(y => y.grp === x.grp && y.id !== x.id);
  const lbl = { owned: 'Bought', avail: 'Ready to buy', cant: x.par.length && !x.par.some(p => st[p] === 'owned') ? 'Needs a node above it' : 'Not enough points', lock: 'Locked by ' + (partner && st[partner.id] === 'owned' ? partner.name : 'a choice above'), gated: 'Opens with specialisations at 1-3' }[sx];
  $('skSide').innerHTML = head + `<div class="sk-card"><span class="sk-cost">${x.sig ? 'Capstone · ' : ''}${x.cost} point${x.cost > 1 ? 's' : ''}</span><h4>${x.name}</h4><p class="sk-fx">${x.fx}</p><p class="sk-req">${x.par.length ? 'Needs ' + x.par.map(p => t.by[p].name).join(' or ') : 'The root of this tree'}.${partner ? ` <b>1 of 2 with ${partner.name}:</b> buying one locks the other.` : ''}</p><span class="sk-st ${sx}">${lbl}</span>${sx === 'owned' ? '<button type="button" class="sk-go ref" id="skAct" data-a="ref">Refund</button>' : `<button type="button" class="sk-go" id="skAct" data-a="buy"${sx === 'avail' ? '' : ' disabled'}>Buy for ${x.cost}</button>`}</div>`;
}
function skBuy(id) {
  const s = loadSave(), x = SK[sk.cur].by[id]; if (skState(s, sk.cur, x, skLeft(s)) !== 'avail') return false;
  skTree(s)[sk.cur][id] = 1; s.treeT = Date.now(); writeSave(s); return true;
}
function openSkills() {
  const s = loadSave(); if (!skOpen(s, sk.cur)) sk.cur = 'kingdom';
  skEl.hidden = false; skRender(); $('skt-' + sk.cur)?.focus();
}
$('skTabs').addEventListener('click', e => { const b = e.target.closest('.sk-tab'); if (!b) return; sk.cur = b.dataset.k; sk.sel = null; skRender(); $('skt-' + sk.cur)?.focus(); });
$('skStage').addEventListener('click', e => {
  const b = e.target.closest('.sk-nd'); if (!b || b.classList.contains('shut')) return;
  const id = b.dataset.id;
  if (sk.sel === id && b.classList.contains('avail')) skBuy(id);
  sk.sel = id; skRender(); $('skn-' + id)?.focus();
});
$('skSide').addEventListener('click', e => {
  const b = e.target.closest('#skAct'); if (!b || !sk.sel) return;
  if (b.dataset.a === 'buy') skBuy(sk.sel);
  else { const s = loadSave(); skRefund(s, sk.cur, sk.sel); s.treeT = Date.now(); writeSave(s); }
  skRender(); $('skAct')?.focus();
});
$('skReset').addEventListener('click', () => {
  const s = loadSave(), btn = $('skReset');
  if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Tap again to refund all'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Refund all'; }, 2500); return; }
  btn.dataset.armed = ''; btn.textContent = 'Refund all'; s.tree = {}; s.treeT = Date.now(); writeSave(s); sk.sel = null; skRender();
});
$('skClose').addEventListener('click', () => { skEl.hidden = true; wmRefresh(); });
skEl.addEventListener('click', e => { if (e.target === skEl) { skEl.hidden = true; wmRefresh(); } });


// ================================================================ in-game patch notes (League of Legends style). Colours are from the player's side: green helps you, red makes it harder.
// item: [name, icon, tag, summary, lines]; line: [stat, old, new, kind] or [text, kind]; kind b = buff (green), n = nerf (red), c = change, new = new
// PATCHES: see patches.json (item: [name, icon, tag, summary, lines])
const PN_TAG = { new: ['New', '#f2c230', '#3b2412'], buff: ['Buff', '#4cc04a', '#0c2a08'], nerf: ['Nerf', '#e5483a', '#fff'], change: ['Change', '#5aa0e8', '#08203a'], fix: ['Fix', '#a0a0a0', '#1a1a1a'] };
const PN_GLYPH = { snow: SKI.snow, skill: SKI.up, star: SKI.star, map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>', cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>', brush: '<path d="M14 4l6 6-9 9H5v-6z"/><path d="M12 6l6 6"/>', book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7"/>', bug: '<path d="M9 6a3 3 0 0 1 6 0M7 9h10v6a5 5 0 0 1-10 0zM3 13h4M17 13h4M4 7l3 3M20 7l-3 3M5 20l3-3M19 20l-3-3"/>' };
function pnIcon(k) {
  if (k.startsWith('tw:')) { const [t, l] = k.slice(3).split('-'); return `<img alt="" src="${almArt(t, l || 3)}">`; }
  if (k.startsWith('en:')) return `<img alt="" src="${almEArt(k.slice(3))}">`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PN_GLYPH[k] || SKI.star}</svg>`;
}
const pnEsc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
function pnLine(l) {
  if (l.length === 4) { const [stat, a, b, k] = l; return `<li class="pl-${k}"><b>${pnEsc(stat)}:</b> ${a ? `<span class="pn-old">${pnEsc(a)}</span> <span class="pn-arr">⇒</span> ` : ''}<span class="pn-new">${pnEsc(b)}</span></li>`; }
  const [t, k] = l; return `<li class="pl-${k}">${k === 'new' ? '<i class="pn-nt">New</i> ' : ''}${pnEsc(t)}</li>`;
}
const pn = { v: PATCHES[0].v };
function pnRender() {
  const P = PATCHES.find(p => p.v === pn.v);
  $('pnSide').innerHTML = PATCHES.map(p => `<button type="button" id="pnv-${p.v.replace('.', '-')}" class="pn-ver${p.v === pn.v ? ' on' : ''}" data-v="${p.v}" aria-pressed="${p.v === pn.v}"><b>Patch ${p.v}</b><small>${pnEsc(p.title)}</small></button>`).join('');
  const item = ([name, icon, tag, sum, lines]) => { const [tl, bg, fg] = PN_TAG[tag]; return `<article class="pn-it"><div class="pn-ic">${pnIcon(icon)}</div><div class="pn-bd"><h4>${pnEsc(name)} <span class="pn-tag" style="background:${bg};color:${fg}">${tl}</span></h4><p class="pn-sum">${pnEsc(sum)}</p>${lines.length ? `<ul>${lines.map(pnLine).join('')}</ul>` : ''}</div></article>`; };
  $('pnMain').innerHTML = `<header class="pn-ban"><span class="pn-k">Patch</span><h2>${P.v}</h2><h3>${pnEsc(P.title)}</h3><p>${pnEsc(P.blurb)}</p></header>
    ${P.hi.length ? `<section><h3 class="pn-h">Patch highlights</h3><div class="pn-hi">${P.hi.map(([n, ic, t]) => `<div class="pn-hc"><div class="pn-ic">${pnIcon(ic)}</div><b>${pnEsc(n)}</b><span>${pnEsc(t)}</span></div>`).join('')}</div></section>` : ''}
    ${P.sec.map(([h, items]) => `<section><h3 class="pn-h">${pnEsc(h)}</h3>${items.map(item).join('')}</section>`).join('')}
    <p class="pn-key"><span class="pl-b">Green</span> makes things easier for you · <span class="pl-n">red</span> makes them harder · old ⇒ new</p>`;
  $('pnMain').scrollTop = 0;
}
function openNotes() {
  $('notes').hidden = false; pn.v = PATCHES[0].v; pnRender(); $('pnClose').focus();
  const s = loadSave(); if (s.seenPatch !== PATCHES[0].v) { s.seenPatch = PATCHES[0].v; writeSave(s); }
  pnDots();
}
function pnDots() { const fresh = loadSave().seenPatch !== PATCHES[0].v; for (const id of ['tnotes', 'wnotes']) { const b = $(id); if (b) b.classList.toggle('pn-dot', fresh); } }
$('pnSide').addEventListener('click', e => { const b = e.target.closest('.pn-ver'); if (!b) return; pn.v = b.dataset.v; pnRender(); $('pnv-' + pn.v.replace('.', '-'))?.focus(); });
$('pnClose').addEventListener('click', () => { $('notes').hidden = true; });
$('notes').addEventListener('click', e => { if (e.target === $('notes')) $('notes').hidden = true; });
$('tnotes').addEventListener('click', openNotes);
$('tnotes').querySelector('small').textContent = PATCHES[0].v;
$('wnotes').addEventListener('click', openNotes);
pnDots();

// --- enemy info card
const hex = c => '#' + c.toString(16).padStart(6, '0');
const ECOL = { runner: 0x6cbf4a, soldier: 0x8a8f99, knight: 0xdde0e6, shaman: 0x4aaa6a, brute: 0xa99bb4, golem: 0x3ae0ff, flyer: 0x7a3aa0, wraith: 0xa8d8ff, boss: 0xffc830, rider: 0xa0643a, gruk: 0x6f9a4a, sapper: 0xc8302a };
const pct = v => v ? Math.round(v * 100) + '%' : 'None';
const firstSeen = k => { for (const m of MAPS) { const w = k === 'boss' ? Math.min(...Object.keys(m.bosses).map(Number)) : m.units[k] && m.units[k][0]; if (w) return `${m.name}, wave ${w}`; } return '—'; };
const speedWord = v => v >= 2.5 ? 'Fast' : v >= 1.5 ? 'Medium' : v >= .9 ? 'Slow' : 'Very slow';
const einfoEl = $('einfo');
const eRing = new THREE.Mesh(new THREE.RingGeometry(.62, .78, 40), new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide }));
eRing.rotation.x = -Math.PI / 2; eRing.visible = false; scene.add(eRing);
function selectEnemy(e) {
  closeMenus(); ui.enemy = e; ui.enemyGone = 0; einfoEl.hidden = false; ui.openT = performance.now(); document.body.classList.add('sel');
  const d = e.def;
  $('edot').style.background = hex(ECOL[e.type]);
  $('ename').textContent = d.title;
  $('edesc').textContent = d.desc;
  updateEnemyCard(0, true);
}
let ecache = '';
function updateEnemyCard(dt, force) {
  const e = ui.enemy; if (!e) return;
  if (!e.alive) {
    if (!ui.enemyGone) { ui.enemyGone = performance.now(); $('ehp').style.width = '0%'; $('ekv').innerHTML = `<span>Status</span><div>${e.hp <= 0 ? 'Defeated' : 'Reached the castle'}</div>`; eRing.visible = false; }
    else if (performance.now() - ui.enemyGone > 1300) closeMenus();
    return;
  }
  const s = e.type === 'boss' ? 2.4 : e.type === 'brute' ? 1.5 : e.type === 'soldier' ? 1.05 : .85;
  eRing.visible = true; eRing.position.set(e.g.position.x, groundY(e.g.position.x, e.g.position.z) + .06, e.g.position.z); eRing.scale.setScalar(s);
  const f = Math.max(0, e.hp / e.maxHp), slowed = e.slow > 0, burning = e.burn > 0;
  const key = `${Math.ceil(e.hp)}|${slowed}|${burning}`;
  if (!force && key === ecache) return; ecache = key;
  $('ehp').style.width = f * 100 + '%';
  $('ehp').style.background = f > .6 ? 'var(--go)' : f > .3 ? '#f2c94c' : 'var(--bad)';
  const d = e.def, rew = Math.round(d.reward * 1.6 * (1 + .05 * (game.wave - 1)));
  const st = [slowed && 'slowed', burning && 'burning'].filter(Boolean).join(', ');
  $('ekv').innerHTML = [
    ['Health', `${Math.ceil(e.hp)} / ${Math.ceil(e.maxHp)}`],
    ['Speed', `${speedWord(d.speed)} (${d.speed} tiles/s)${st ? ' · ' + st : ''}`],
    ['Moves', d.air ? 'Flying' : 'On the ground'],
    ['Reward', `${rew} gold`],
    ['Castle damage', d.dmg],
    ['Attack', atkText(e.type)],
    ['Armor', pct(d.armor) + (d.armor ? ' less physical damage' : '')],
    ['Magic resist', pct(d.mr) + (d.mr ? ' less magic damage' : '')],
    ['Weak to', d.weak],
  ].map(([a, b]) => `<span>${a}</span><div>${b}</div>`).join('');
}
$('eclose').addEventListener('click', () => { if (!fresh()) closeMenus(); });
// --- soldier info card (same card as enemies, blue ring)
function pickSoldier(x, y) {
  let best = null, bd = 34;
  for (const so of soldiers) {
    if (!so.alive) continue; _sp.copy(so.center).project(camera); if (_sp.z > 1) continue;
    const d = Math.hypot((_sp.x + 1) / 2 * innerWidth - x, (1 - _sp.y) / 2 * innerHeight - y); if (d < bd) { bd = d; best = so; }
  }
  return best && { so: best, d: bd };
}
const tw0 = so => !!(so.tw && so.tw.militia);
function selectSoldier(so) {
  closeMenus(); ui.soldier = so; ui.enemyGone = 0; einfoEl.hidden = false; ui.openT = performance.now(); document.body.classList.add('sel');
  eRing.material.color.setHex(0x4aa8ff);
  $('edot').style.background = '#2a52c8'; $('ename').textContent = so.name;
  const tw = so.tw, lvl = tw.spec ? `${SPEC.barracks[tw.spec].name} barracks, rank ${tw.rank}` : `level ${Math.min(tw.lvl, 3)} Barracks`;
  $('edesc').textContent = SOL_INFO[so.type][1] + (tw.militia ? ' Called by Militia Call; heads home after 12 s.' : ' Serves at a ' + lvl + '.');
  updateSoldierCard(0, true);
}
let scache = '';
function updateSoldierCard(dt, force) {
  const so = ui.soldier; if (!so) return;
  if (!so.alive) {
    if (!ui.enemyGone) { ui.enemyGone = performance.now(); $('ehp').style.width = '0%'; $('ekv').innerHTML = `<span>Status</span><div>Fell in battle. A new soldier comes out in ${so.tw.bs.resp}s.</div>`; eRing.visible = false; }
    else if (performance.now() - ui.enemyGone > 1800) closeMenus();
    return;
  }
  eRing.visible = true; eRing.position.set(so.g.position.x, groundY(so.g.position.x, so.g.position.z) + .06, so.g.position.z); eRing.scale.setScalar(.75);
  const st = so.st, f = Math.max(0, so.hp / so.maxHp), e = so.target && so.target.alive ? so.target : null;
  const doing = e ? (st.ranged && (e.def.air || so.center.distanceTo(e.center) > 1.2) ? 'Shooting ' : 'Fighting ') + e.def.title : 'Guarding the rally point';
  const key = `${Math.ceil(so.hp)}|${doing}`; if (!force && key === scache) return; scache = key;
  $('ehp').style.width = f * 100 + '%'; $('ehp').style.background = f > .6 ? 'var(--go)' : f > .3 ? '#f2c94c' : 'var(--bad)';
  $('ekv').innerHTML = [
    ['Unit', SOL_INFO[so.type][0]],
    ['Health', `${Math.ceil(so.hp)} / ${so.maxHp}`],
    ['Damage', `${+st.dmg.toFixed(1)} per hit, every ${st.rate}s`],
    ...(st.ranged ? [['Range', `Arrows up to ${st.ranged} tiles, ground and air`]] : []),
    ...(st.holy ? [['Holy strike', `${st.holy} true damage every ${st.holyN === 3 ? '3rd' : '4th'} hit`]] : []),
    ['Armor', pct(st.armor) + (st.armor ? ' less physical damage' : '')],
    ['Magic resist', pct(st.mr) + (st.mr ? ' less magic damage' : '')],
    ['Heals', `${Math.round((st.heal || st.regen || SOL_REGEN) * 100)}% health per second out of combat`],
    tw0(so) ? ['Leaves in', `${Math.ceil(so.ttl || 0)} s`] : ['Respawn', `${st.resp}s after falling`],
    ['Now', doing],
  ].map(([a, b]) => `<span>${a}</span><div>${b}</div>`).join('');
}

// --- almanac: towers and enemies, with a turning 3D preview
const TINFO = {
  arrow: { kind: 'phys', desc: 'A wooden lookout with a sharp-eyed archer. Cheap and quick to fire, and one of the few towers that can shoot down bats.', tip: 'Build a couple early. Set one to Strongest when ogres arrive.' },
  cannon: { kind: 'phys', desc: 'A stone tower with a turning cannon. Its shells arc over the battlefield and burst among packed enemies.', tip: 'Place it where the path bends back on itself so each blast catches more enemies.' },
  frost: { kind: 'magic', desc: 'A floating crystal that fires ice shards. Enemies it hits slow down and freeze over.', tip: 'Pair it with Cannons and Flame Towers: slowed enemies stay in their range longer.' },
  tesla: { kind: 'magic', desc: 'A copper coil that throws lightning from enemy to enemy, hitting several at once.', tip: 'Strong against crowds and bats. Expensive, so upgrade one before building a second.' },
  flame: { kind: 'true', desc: 'A brick furnace with a nozzle that sprays a cone of fire and leaves enemies burning.', tip: 'Short range: put it right next to the path, ideally at a corner.' },
  barracks: { kind: 'phys', desc: 'A barracks that sends soldiers to block the road and fight enemies hand to hand.', tip: 'Put the rally point inside your towers\u2019 range, so enemies held by soldiers are shot while they fight.' },
  drum: { kind: 'sup', desc: 'A war drum that makes the towers around it fire faster. It deals no damage itself.', tip: 'Build it in the middle of your strongest towers. A tower near two drums gets only the stronger boost, so spread drums out.' },
};
const bookEl = $('book'), bkB = $('bkb'), bkCv = $('bkcv');
const bk = { tab: 'towers', id: 'arrow', lvl: 1, rank: 1, filter: 'All', wasPaused: false, titleWas: false };
const pr = new THREE.WebGLRenderer({ canvas: bkCv, antialias: true, alpha: true });
pr.setPixelRatio(Math.min(devicePixelRatio, 2)); pr.toneMapping = THREE.ACESFilmicToneMapping;
const litScene = () => { const s = new THREE.Scene(); s.add(new THREE.HemisphereLight(0xeaf4ff, 0x4a5a3a, 1.6)); const l = new THREE.DirectionalLight(0xffffff, 2.4); l.position.set(3, 6, 5); s.add(l); return s; };
const pScene = litScene();
const pCam = new THREE.PerspectiveCamera(32, 1, .1, 100);
const pv = { obj: null, tw: null, parts: null, t: 0 };
// one model, either a tower at a level ('a'/'b' = level 4 specialisation) or an enemy
function makeModel(tab, id, lvl) {
  if (tab === 'towers') {
    const tw = new Tower(id, { x: 0, z: 0, gx: -99, gz: -99, used: false, block: 0 }, true);
    if (typeof lvl === 'number') tw.lvl = lvl; else { tw.lvl = 4; tw.spec = lvl; } tw.build(); scene.remove(tw.g); tw.g.scale.setScalar(1); tw.g.position.set(0, 0, 0);
    return { obj: tw.g, tw, parts: null };
  }
  const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
  const parts = BUILD[id](b); if (id === 'flyer') b.position.y = .2;
  return { obj: g, tw: null, parts };
}
function aimAt(obj, cam) {
  obj.rotation.y = .6;
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new V3()), c = box.getCenter(new V3());
  const r = Math.max(size.x, size.y, size.z);
  cam.position.set(c.x, c.y + r * .35, c.z + r * 2.4); cam.lookAt(c);
}
// card portraits: each model rendered once to an image
const tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
tr.setPixelRatio(1); tr.setSize(200, 200, false); tr.toneMapping = THREE.ACESFilmicToneMapping;
const tScene = litScene(), tCam = new THREE.PerspectiveCamera(32, 1, .1, 100), thumbs = {};
function thumb(tab, id, lvl = 1) {
  const key = tab + id + lvl; if (thumbs[key]) return thumbs[key];
  const m = makeModel(tab, id, lvl); tScene.add(m.obj); aimAt(m.obj, tCam);
  tr.render(tScene, tCam); thumbs[key] = tr.domElement.toDataURL();
  tScene.remove(m.obj); if (m.tw) m.tw.remove();
  return thumbs[key];
}
function setPreview() {
  if (pv.obj) { pScene.remove(pv.obj); if (pv.tw) pv.tw.remove(); }
  const m = makeModel(bk.tab, bk.id, bk.lvl);
  pv.obj = m.obj; pv.tw = m.tw; pv.parts = m.parts;
  pScene.add(pv.obj); aimAt(pv.obj, pCam);
}
function renderPreview(dt) {
  if (bookEl.hidden || !pv.obj || bkCv.hidden) return;
  const w = bkCv.clientWidth, h = bkCv.clientHeight, k = pr.getPixelRatio();
  if (!w || !h) return;
  if (bkCv.width !== Math.round(w * k) || bkCv.height !== Math.round(h * k)) { pr.setSize(w, h, false); pCam.aspect = w / h; pCam.updateProjectionMatrix(); }
  pv.t += dt; pv.obj.rotation.y += dt * .7;
  const p = pv.parts;
  if (p) {
    const s = Math.sin(pv.t * 6);
    if (p.legs.length) { p.legs[0].rotation.x = s * .6; p.legs[1].rotation.x = -s * .6; }
    if (p.arms.length) { p.arms[0].rotation.x = -s * .4; p.arms[1].rotation.x = s * .4; }
    if (p.wings) { const f = Math.sin(pv.t * 10) * .8; p.wings[0].rotation.z = f; p.wings[1].rotation.z = -f; }
  }
  pr.render(pScene, pCam);
}
// level helpers: 1, 2, 3, then 'a' or 'b' (level 4)
const lvStat = (t, l) => typeof l === 'number' ? tStat(t, l) : specStat(t, l);
const lvCost = (t, l) => l === 1 ? TT[t].cost : l === 2 ? UPC[t][0] : l === 3 ? UPC[t][1] : SPEC[t][l].cost;
const lvName = (t, l) => typeof l === 'number' ? 'Level ' + l : SPEC[t][l].name;
const lvPrev = l => l === 1 ? null : typeof l === 'number' ? l - 1 : 3;
const lvTotal = (t, l) => { let s = 0; for (let k = l; k != null; k = lvPrev(k)) s += lvCost(t, k); return s; };
const MX = { dmg: 0, range: 0, spd: 0, dps: 0 };
for (const t of TYPES) for (const l of [1, 2, 3, 'a', 'b']) { const s = lvStat(t, l); MX.dmg = Math.max(MX.dmg, s.dmg); MX.range = Math.max(MX.range, s.range); MX.spd = Math.max(MX.spd, 1 / s.rate); MX.dps = Math.max(MX.dps, s.dps); }
// share of a tower's damage that gets through an enemy's defences; null = cannot reach it
const effOf = (t, d) => d.air && !TT[t].air ? null : DTYPE[t] === 'phys' ? 1 - d.armor : DTYPE[t] === 'magic' ? 1 - d.mr : 1;
const effCol = v => `hsl(${Math.round(v * 125)} 62% ${48 + v * 8}%)`;
const r1 = v => Math.round(v * 10) / 10;
const dl = (a, b, low) => { if (b == null) return ''; const d = a - b; if (Math.abs(d) < .005) return ''; const good = low ? d < 0 : d > 0; return `<span class="${good ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${Math.abs(d) < 1 ? d.toFixed(2) : r1(d)}</span>`; };
const ringH = (lab, v, col, big) => `<span class="ring${big ? ' big' : ''}"><i style="--p:${Math.round(v * 100)};--rc:${col}"><span>${Math.round(v * 100)}%</span></i>${lab}</span>`;
const EFILT = { All: () => true, Flying: d => d.air, Armoured: d => d.armor >= .5, 'Magic resist': d => d.mr >= .5, Fast: d => d.speed >= 2, Boss: (d, k) => k === 'boss' };
const KIND = { phys: 'Reduced by armour', magic: 'Reduced by magic resist', true: 'Ignores armour and magic resist' };
const ALM_ART = Object.fromEntries(Object.entries(import.meta.glob('./art/almanac/*.webp', { eager: true, import: 'default' })).map(([p, url]) => [p.split('/').pop().slice(0, -5).replace('_', ':'), url]));
// ---- almanac: art, one-sentence descriptions and per-form mechanics
const ALM_DESC = {
  arrow: { 1: 'A wooden lookout whose archer fires quick, cheap arrows at ground and air.', 2: 'Sturdier timbers and a sharper eye make every arrow hit harder.', 3: 'A second archer joins, so each shot strikes two enemies.', a: 'One master marksman fires huge, slow shots at the strongest enemy.', b: 'Three archers each pick a different target with every volley.' },
  cannon: { 1: 'A turning cannon lobs shells that burst among packed enemies.', 2: 'A reinforced barrel hits harder with a wider blast.', 3: 'Twin barrels take turns firing for twice the pressure.', a: 'A huge mortar shells the far road and punches through armor, but cannot hit anything close.', b: 'A flared barrel blasts a short cone of shot at everything in front.' },
  frost: { 1: 'A floating crystal fires ice shards that slow whatever they hit.', 2: 'Its shards now chill nearby enemies too.', 3: 'Colder, faster shards slow crowds for longer.', a: 'Heavy shards nearly stop the strongest enemy in its tracks.', b: 'Shards shatter on impact and slow every enemy around them.' },
  tesla: { 1: 'A copper coil throws lightning that jumps from enemy to enemy.', 2: 'More coils mean stronger bolts and one more jump.', 3: 'A reinforced coil chains through five enemies at once.', a: 'Lightning arcs through eight enemies and barely weakens as it jumps.', b: 'A constant beam grows stronger the longer it holds one target.' },
  flame: { 1: 'A brick furnace sprays a cone of fire that leaves enemies burning.', 2: 'Hotter flames reach further and burn harder.', 3: 'A reinforced furnace scorches everything in a long cone.', a: 'Leaves pools of burning napalm on the road for enemies to walk through.', b: 'A white-hot jet melts the strongest enemy in front of it.' },
  barracks: { 1: 'Three footmen guard a rally point on the road and fight anything that comes close.', 2: 'Shieldbearers in mail hold the line longer.', 3: 'Armored knights block the road and hit hard.', a: 'Holy Paladins heal between fights and smite with every fourth blow.', b: 'Three Rangers shoot ground and air. On the road they block; off it they stand on Overwatch.' },
  drum: { 1: 'A battle drum on a draped stage. Towers nearby fire faster.', 2: 'Two drums and braziers: a bigger, stronger beat.', 3: 'A sun drum atop a stone tower, heard across the field.', a: 'A great war horn. Boosted towers fire faster and shoot further.', b: 'A cursed totem. Enemies near it take extra damage from everything.' },
};
// extra stats that used to live in the description (values from the game's own formulas)
function almExtra(t, l, r = 1) {
  const n = typeof l === 'number' ? l : 0, N = (k, v, u = '', dp = 0) => ({ k, n: v, u, dp }), S = (k, v) => ({ k, s: v });
  if (t === 'arrow') return l === 'a' ? [N('Arrows per shot', 1), S('Targets', 'Strongest')] : [N('Arrows per shot', l === 'b' ? 2 + r : n >= 3 ? 2 : 1)];
  if (t === 'cannon') return l === 'a' ? [N('Splash radius', 2.8 + .2 * r, ' tiles', 1), N('Armor ignored', Math.round(mortarPierce(r) * 100), '%'), N('Blind spot', mortarDead(), ' tiles')]
    : l === 'b' ? [S('Blast cone', '70°')] : [N('Splash radius', 1.8 + .25 * (n - 1), ' tiles', 2)];
  if (t === 'frost') return l === 'a' ? [N('Slow', 75, '%'), N('Slow time', 2 + r, 's'), S('Targets', 'Strongest')]
    : l === 'b' ? [N('Slow', 55, '%'), N('Slow time', 2.5, 's', 1), N('Slow area', 1.3 + .3 * r, ' tiles', 1)]
    : [N('Slow', 100 - Math.round((.55 - .07 * n) * 100), '%'), N('Slow time', 2 + .5 * n, 's', 1), ...(n >= 2 ? [S('Slow area', 'Nearby enemies')] : [])];
  if (t === 'tesla') return l === 'a' ? [N('Enemies chained', 7 + r)] : l === 'b' ? [N('Beam build-up', overloadCap(r), 'x', 2)] : [N('Enemies chained', 2 + n)];
  return l === 'a' ? [N('Napalm pools', 3 + r, 's')] : l === 'b' ? [S('Targets', 'Strongest')] : [S('Area', 'Cone')];
}
// every number on a tower card, so the previous level or rank can be compared against it
function almStats(t, l, r = 1) {
  if (t === 'drum') { const b = drumStat(l, typeof l === 'number' ? 1 : r);
    return [{ k: 'Fire rate boost', pre: '+', n: Math.round(b.haste * 100), u: '%' }, { k: 'Radius', n: b.rad, u: ' tiles', dp: 1 },
      ...(b.rngB ? [{ k: 'Tower range boost', pre: '+', n: Math.round(b.rngB * 100), u: '%' }] : []), ...(b.hex ? [{ k: 'Enemy damage taken', pre: '+', n: Math.round(b.hex * 100), u: '%' }] : []),
      { k: 'Stacking', s: 'Strongest drum only' }, { k: 'Damage', s: 'None' }, { k: 'Type', s: 'Support' }]; }
  if (t === 'barracks') { const b = barrStat(l, typeof l === 'number' ? 1 : r);
    return [{ k: 'Soldiers', n: b.n }, { k: 'Soldier health', n: b.hp, dp: 0 }, { k: 'Damage', n: b.dmg, u: ' per hit', dp: 1 }, { k: 'Attack speed', pre: 'every ', n: b.rate, u: 's', dp: 1, low: true },
      { k: 'Armor', n: Math.round(b.armor * 100), u: '%' }, ...(b.mr ? [{ k: 'Magic resist', n: Math.round(b.mr * 100), u: '%' }] : []), { k: 'Respawn', n: b.resp, u: 's', low: true }, { k: 'Detection radius', n: b.rad, u: ' tiles', dp: 1 },
      ...(b.ranged ? [{ k: 'Arrow range', n: b.ranged, u: ' tiles' }] : []), { k: 'Heals', s: Math.round((b.heal || b.regen || SOL_REGEN) * 100) + '% health/s out of combat' }, ...(b.holy ? [{ k: 'Holy strike', n: b.holy, u: ` true damage, every ${b.holyN === 3 ? '3rd' : '4th'} hit` }] : []),
      { k: 'Hits', s: b.ranged ? 'Ground and air' : 'Ground only, blocks' }, { k: 'Type', s: 'Physical' }]; }
  const s = typeof l === 'number' ? tStat(t, l) : specStat(t, l, r), sk = typeof l === 'number' ? null : l, tg = v => v ? `+${Math.round(v * 100)}%` : '';
  return [{ k: 'Damage', n: s.dmg, u: ' per hit', dp: s.dmg < 10 || (s.dmg < 100 && Math.abs(s.dmg - Math.round(s.dmg)) > .05) ? 1 : 0, sk: tg(skMod(t, 'dmg', sk)) }, { k: 'Fire rate', pre: 'every ', n: s.rate, u: 's', dp: 2, low: true, sk: tg(skMod(t, 'rate', sk)) },
    { k: 'Range', n: s.range, u: ' tiles', dp: 1, sk: tg(skMod(t, 'rng', sk)) }, { k: 'Damage per sec', n: s.dps, dp: 0 }, ...almExtra(t, l, r),
    { k: 'Hits', s: TT[t].air ? 'Ground and air' : 'Ground only' }, { k: 'Type', s: DNAME[DTYPE[t]] }];
}
const almFmt = (v, dp) => (+v.toFixed(dp)).toString();
function almStatHTML(cur, prev) {
  return cur.map(c => {
    if (c.s) return `<div><em>${c.k}:</em> ${c.s}</div>`;
    const p = prev && prev.find(q => q.k === c.k && q.n != null);
    let d = '';
    if (p) { const v = +(+c.n.toFixed(c.dp) - +p.n.toFixed(c.dp)).toFixed(c.dp); if (v) { const good = c.low ? v < 0 : v > 0; d = ` <span class="${good ? 'al-up' : 'al-dn'}">(${v > 0 ? '+' : ''}${almFmt(v, c.dp)})</span>`; } }
    return `<div><em>${c.k}:</em> ${c.pre || ''}${almFmt(c.n, c.dp)}${c.u || ''}${d}${c.sk ? ` <span class="al-sk" title="From your skill tree">${c.sk} tree</span>` : ''}</div>`;
  }).join('');
}
const almArt = (t, l) => ALM_ART[t + '-' + l];
const almEArt = k => ALM_ART['e:' + k] || thumb('enemies', k);
const ALM_SHORT = { 'Siege Mortar': 'Mortar', Scattergun: 'Scatter', 'Deep Freeze': 'Freeze', 'Glacier Field': 'Glacier' };
const KCOL = { phys: '#8f561a', magic: '#6a3fc6', true: '#b4380e', sup: '#a8701a' };
const almNum = v => v < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v));
const coinI = '<i class="al-coin" aria-hidden="true"></i>';
function renderBook() { SKILL_VIEW = skCompute(loadSave()); try { renderBook0(); } finally { SKILL_VIEW = null; } }
function renderBook0() {
  bookEl.querySelectorAll('.tabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === bk.tab); b.setAttribute('aria-pressed', b.dataset.tab === bk.tab); });
  if (bk.tab === 'towers') {
    const t = bk.id, l = bk.lvl, dk = DTYPE[t], spec = typeof l !== 'number', rk = spec ? bk.rank || 1 : 1;
    const cur = almStats(t, l, rk), prev = spec ? (rk > 1 ? almStats(t, l, rk - 1) : null) : (l > 1 ? almStats(t, l - 1) : null);
    const rcost = r => r === 1 ? lvCost(t, l) : rankCost(t, l, r);
    const pk = (k, lv) => { const on = k === t && lv === l, sp = typeof lv !== 'number';
      return `<button class="pk${on ? ' on' : ''}" data-id="${k}" data-lv="${lv}" aria-pressed="${on}" aria-label="${lvName(k, lv)}, ${lvCost(k, lv)} gold">
        <span class="st${sp ? ' sp' : ''}"><b>${lvName(k, lv)}</b><b>${sp ? ALM_SHORT[SPEC[k][lv].name] || SPEC[k][lv].name : 'Lv ' + lv}</b></span><img alt="" src="${almArt(k, lv)}"><span class="cs">${coinI}${lvCost(k, lv)}</span></button>`; };
    const cmp = spec ? (rk > 1 ? `Compared with rank ${rk - 1}` : 'Rank 1 is the baseline') : l > 1 ? `Compared with level ${l - 1}` : '';
    bkB.innerHTML = `<div class="al-l">${TYPES.map(k => `<div class="al-row"><div class="al-rn"><b>${TT[k].name}</b><span class="al-kd" style="background:${KCOL[DTYPE[k]]}">${DNAME[DTYPE[k]]}</span></div>${[1, 2, 3, 'a', 'b'].map(lv => pk(k, lv)).join('')}</div>`).join('')}</div>
      <section class="al-r" aria-live="polite"><div class="al-stage"><img alt="${lvName(t, l)}" src="${almArt(t, l)}">${t === 'barracks' && ALM_ART['u:' + BARR[l].unit] ? `<img class="al-unit" alt="${BARR[l].unit}" src="${ALM_ART['u:' + BARR[l].unit]}">` : ''}
        <div class="al-ban"><span>${spec ? SPEC[t][l].name + ' · Rank ' + rk : TT[t].name + ' · Level ' + l}</span><span class="al-cost">${coinI}${spec ? rcost(rk) : lvCost(t, l)}</span></div></div>
        <div class="al-body"><p>${ALM_DESC[t][l]}</p>
          ${spec ? `<div class="al-ranks" role="group" aria-label="Rank">${[1, 2, 3].map(r => `<button data-rank="${r}" class="${r === rk ? 'on' : ''}" aria-pressed="${r === rk}"><span class="al-stars">${'★'.repeat(r)}${'☆'.repeat(3 - r)}</span>Rank ${r}<small>${r === 1 ? '' : '+'}${rcost(r)} gold</small></button>`).join('')}</div>` : ''}
          ${cmp ? `<div class="al-cmp">${cmp}</div>` : ''}<div class="al-st">${almStatHTML(cur, prev)}</div>
          ${(() => { const has = SK[t] ? SK[t].nodes.filter(n => skH(t + '.' + n[0])).map(n => n[4]) : []; return has.length ? `<div class="al-skl"><b>Skill tree:</b> ${has.join(', ')}</div>` : ''; })()}
          <div class="al-tip">${TINFO[t].tip}</div></div></section>`;
  } else {
    const k = bk.id, d = ED[k], FM = MAPS.find(m => m.units[k] || (k === 'boss' && Object.keys(m.bosses).length)) || MAP, g = FM.growth[0]; // health on the map where it first appears
    const res = (lab, v, what, col) => `<div title="${v > 0 ? `Blocks ${Math.round(v * 100)}% of ${what} damage` : `No ${what} resistance`}"><em>${lab}</em>${v > 0
      ? `<span class="al-bars" style="--rc:${col}" role="img" aria-label="${lab} ${Math.round(v * 100)}%">${[0, 1, 2, 3, 4].map(i => `<i${v >= (i + 1) * .2 - .001 ? ' class="on"' : ''}></i>`).join('')}</span>` : '<span>None</span>'}</div>`;
    bkB.innerHTML = `<div class="al-l"><div class="al-eg">${Object.keys(ED).map(id => `<button class="ek${id === k ? ' on' : ''}" data-id="${id}" aria-pressed="${id === k}"><img alt="" src="${almEArt(id)}"><span>${ED[id].title}</span></button>`).join('')}</div></div>
      <section class="al-r" aria-live="polite"><div class="al-stage en"><img alt="${d.title}" src="${almEArt(k)}">
        <div class="al-ban"><span>${d.title}</span><span class="al-tag">${d.air ? 'Flying' : 'Ground'}</span></div></div>
        <div class="al-body"><p>${d.desc.replace(/armour/g, 'armor')}</p>
          <div class="al-st"><div><em>Health:</em> ${d.hp}</div><div><em>Speed:</em> ${d.speed} tiles/s</div><div><em>Bounty:</em> ${Math.round(d.reward * 1.6)} gold</div><div><em>Castle damage:</em> ${d.dmg}</div><div style="grid-column:1/-1"><em>Attack:</em> ${atkText(k)}</div><div><em>First seen:</em> ${firstSeen(k)}</div></div>
          <div class="al-res">${res('Armor', d.armor, 'physical', '#8f561a')}${res('Magic resist', d.mr, 'magic', '#6a3fc6')}</div>
          <div class="al-waves"><em>Health by wave:</em>${[1, 5, 10].map(w => `<span>Wave ${w} · ${Math.round(d.hp * FM.hpBase * Math.pow(g, w - 1))}</span>`).join('')}<small>+${Math.round((g - 1) * 100)}% per wave on ${FM.name}</small></div>
          <div class="al-tip"><em>Weak to:</em> ${d.weak}</div></div></section>`;
  }
}
bkB.addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b || !bkB.contains(b)) return;
  const ds = b.dataset;
  if (ds.rank) { bk.rank = +ds.rank; renderBook(); return; }
  if (!ds.id) return;
  bk.id = ds.id; bk.rank = 1; if (ds.lv) bk.lvl = isNaN(+ds.lv) ? ds.lv : +ds.lv;
  renderBook();
  if (matchMedia('(max-width:860px)').matches) bkB.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
});
function openBook() {
  bk.titleWas = !$('title').hidden; $('title').hidden = true;
  if (game.mode === 'play' && game.state === 'play') { bk.wasPaused = game.paused; game.paused = true; }
  closeMenus(); bookEl.hidden = false; renderBook();
}
function closeBook() {
  bookEl.hidden = true;
  if (bk.titleWas) $('title').hidden = false;
  if (game.mode === 'play' && game.state === 'play') game.paused = bk.wasPaused;
}
bookEl.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { bk.tab = b.dataset.tab; bk.id = bk.tab === 'towers' ? 'arrow' : 'runner'; bk.lvl = 1; bkB.scrollTop = 0; renderBook(); }));
$('bkclose').addEventListener('click', closeBook);
bookEl.addEventListener('click', e => { if (e.target === bookEl) closeBook(); });
$('bbook2').addEventListener('click', openBook);

// --- per-frame UI
const _sp = new V3();
function updatePlayUI(dt) {
  const playing = game.mode === 'play' && game.state === 'play';
  if (spotsDirty) rebuildSpots();
  spotIM.visible = playing;
  spotMat.opacity = .3 + .12 * Math.sin(performance.now() / 380);
  if (badPlate.material.opacity > 0) badPlate.material.opacity = Math.max(0, badPlate.material.opacity - dt * 1.5);
  if (!playing && (ui.spot || ui.sel || ui.enemy || ui.soldier)) closeMenus();
  updateEnemyCard(dt); updateSoldierCard(dt);
  if (ui.spot) {
    _sp.set(ui.spot.x, 1.3, ui.spot.z).project(camera);
    const x = clamp((_sp.x + 1) / 2 * innerWidth, 140, innerWidth - 140), y = clamp((1 - _sp.y) / 2 * innerHeight, 140, innerHeight - 140);
    ringEl.style.transform = `translate(${x}px,${y}px)`; if (!tipEl.hidden) placeTip(x, y, 140, 158);
    ringBtns.forEach(b => { const poor = game.gold < TT[b.dataset.t].cost; b.classList.toggle('poor', poor); ringEl.querySelector(`[data-tag="${b.dataset.t}"]`).classList.toggle('poor', poor); });
  }
  if (ui.sel) {
    if (!towers.includes(ui.sel)) closeMenus();
    else {
      const t = ui.sel; _sp.set(t.x, 1 + t.top * TS * .45, t.z).project(camera);
      const x = clamp((_sp.x + 1) / 2 * innerWidth, 150, innerWidth - 150), y = clamp((1 - _sp.y) / 2 * innerHeight, 160, innerHeight - 120);
      tringEl.style.transform = `translate(${x}px,${y}px)`; renderRing(false); placeTip(x, y, 160, 104);
    }
  }
  if (game.mode === 'play') updateCtrl();
}

// ================================================================ HUD
let hudCache = '';
function updateHUD(dt) {
  const s = `${game.wave}|${game.gold}|${game.hp}|${game.defeated}`;
  if (s !== hudCache) {
    hudCache = s;
    hud.w.textContent = `${game.wave} / ${MAP.waves}`;
    hud.g.textContent = game.gold;
    hud.h.textContent = game.hp > 0 ? `${Math.ceil(game.hp)} / ${game.maxHp}` : 'Fallen';
    hud.b.style.width = (game.hp / game.maxHp * 100) + '%';
    hud.b.style.background = game.hp > 60 ? '#5fd36a' : game.hp > 30 ? '#f2c94c' : '#eb5757';
    hud.d.textContent = game.defeated;
  }
  if (msgT > 0) { msgT -= dt; hud.m.style.opacity = clamp(msgT, 0, 1) * .95; }
}


// ---- tutorial tips, Millbrook Fields only
const TUTS = {};
const TUT = TUTS.mill = [
  { when: () => true, text: 'Tap a glowing stone plot to build a tower. Archer Towers are cheap, and they can hit flying enemies too.', done: () => game.built > 0 },
  { when: () => game.built > 0, text: 'Good. Press Start wave 1 when you are ready. From wave 2 on, calling a wave early pays bonus gold.', done: () => game.wave > 0 },
  { when: () => game.wave >= 2, text: 'Tap one of your towers to upgrade it. Each level adds damage, range and fire rate.', done: () => towers.some(t => t.lvl > 1) },
  { when: () => towers.some(t => t.lvl >= 2) && game.gate && game.gate.max === 2, text: 'Level 2 is the limit for now. Level 3 and more towers unlock as you push the horde back.', done: null },
  { when: () => game.wave >= 2 && enemies.some(e => e.type === 'soldier'), text: 'Orcs carry shields that blunt arrows. Cannons hit harder, and Frost Spire magic goes straight through armor.', done: null },
  { when: () => enemies.some(e => e.type === 'brute'), text: 'An ogre! It is slow but very tough. A Frost Spire slows it down so your towers get more time to hit it.', done: null },
];
TUTS.river = [
  { when: () => game.spells && game.spells.includes('militia'), text: 'New: spells, bottom left. Militia Call puts two militiamen on the road. Catapult Barrage lands 3 seconds after you aim, so aim ahead of the enemies. They wake up once you call the first wave. Keys 1 and 2 work too.', done: () => game.spellUsed },
];
TUTS.thorn = [
  { when: () => true, text: 'New tower: the Flame Tower. Short range but huge damage that ignores armor. Build it right beside a bend in the road.', done: () => towers.some(t => t.type === 'flame') },
  { when: () => enemies.some(e => e.type === 'sapper'), text: 'Goblin Sappers stop beside the first tower they reach and knock it out for 5 seconds. Kill them early with archers.', done: null },
  { when: () => towers.some(t => t.lvl >= 3), text: 'Level 3 towers can now specialise. Tap one to choose between its two upgrades.', done: () => towers.some(t => t.spec) },
];
TUTS.frost = [
  { when: () => game.spells && game.spells.includes('nova'), text: 'New spell: Frost Nova freezes every ground enemy in a circle for 2.5 seconds. Bosses are only slowed.', done: () => (game.scd.nova || 0) > 0 },
  { when: () => game.gate && game.gate.towers.includes('drum'), text: 'New tower: the War Drum. It deals no damage, but towers inside its radius fire faster. Build it among your best towers.', done: () => towers.some(t => t.type === 'drum') },
];
TUTS.mire = [
  { when: () => game.gate && game.gate.towers.includes('barracks'), text: 'New tower: the Barracks. Its soldiers block the road and fight. Tap a Barracks, then its flag button, to move the rally point.', done: () => towers.some(t => t.type === 'barracks') },
  { when: () => towers.some(t => t.type === 'barracks') && enemies.some(e => e.type === 'shaman'), text: 'Goblin Shamans strike soldiers from range, so your soldiers have to walk over to them.', done: null },
];
const tut = { i: 0, shown: -1, t: 0 };
function tutReset() { tut.i = 0; tut.shown = -1; tut.t = 0; $('tut').hidden = true; }
function tutTick(dt) {
  const TL = TUTS[MAP.key], on = TL && game.mode === 'play' && game.state === 'play' && !game.paused;
  if (!on) { if (!$('tut').hidden && game.state !== 'play') $('tut').hidden = true; return; }
  const step = TL[tut.i]; if (!step) return;
  if (tut.shown !== tut.i) { if (step.when()) { tut.shown = tut.i; tut.t = 0; $('tutT').textContent = step.text; $('tut').hidden = false; } return; }
  tut.t += dt;
  if ((step.done && step.done()) || (!step.done && tut.t > 11)) { tut.i++; $('tut').hidden = true; }
}
$('tutOk').addEventListener('click', () => { tut.i++; $('tut').hidden = true; });
// ================================================================ loop
resetGame('auto');
updateSky(0);
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (!wmapEl.hidden && WM.built) { wmUpdate(dt); renderer.render(WM.scene, WM.cam); return; } // world map open: the battle waits
  const sub = game.paused ? 0 : game.mode === 'play' ? game.speed : 1;
  for (let k = 0; k < sub; k++) updateGame(dt);
  updateSky(dt * Math.min(sub, 1));
  if (game.mode === 'play') updatePlayerCam(dt); else updateDirector(dt);
  updateHUD(dt);
  updatePlayUI(dt);
  if (bogBubbles.length && Math.random() < dt * 4) { const b = pick(bogBubbles); glow.spawn(b.x + rand(-.3, .3), b.y, b.z + rand(-.3, .3), 0, .5, 0, .8, .07, 0x9ac05a, 0, F_SPIN, 1, 0x203010); }
  tutTick(dt);
  renderPreview(dt);
  sky.position.copy(camera.position); stars.position.copy(camera.position);
  renderer.render(scene, camera);
}
requestAnimationFrame(t => { last = t; frame(t); });

// headless balance probe (no effect on normal play)
window.__reset = resetGame;
window.__specAll = () => { let i = 0; for (const ty of TYPES) for (const k of ['a', 'b']) { const sp = spots.filter(s => !s.used)[0]; if (!sp) break; const t = new Tower(ty, sp, true); t.lvl = 3; t.setSpec(k); t.rankUp(); t.rankUp(); towers.push(t); i++; } spotsDirty = true; return towers.map(t => towerName(t)).join(', '); };
window.__setGold = n => { game.gold = n; };
window.__enemyOf = k => { const e = enemies.find(e => e.alive && e.type === k); if (!e) return null; const v = e.center.clone().project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
window.__win = () => { game.wave = MAP.waves; game.spawnQ = []; for (const e of enemies) e.remove(); enemies = []; game.hp = 90; };
window.__enemyXY = () => { const e = enemies.find(e => e.alive && e.type === 'soldier') || enemies[0]; if (!e) return null; const v = e.center.clone().project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
window.__spotXY = i => { const fr = spots.filter(s => !s.used); const s = fr[i % fr.length]; const v = new V3(s.x, 1, s.z).project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
window.__towerXY = i => { const t = towers[i]; const v = new V3(t.x, 1.3, t.z).project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
document.body.classList.add('ready');
// geometry of map i as built by buildMap (rebuilds the world): the engine's map test compares against this
window.__mapInfo = i => { buildMap(i); return { plots: PLOTS.map(p => [p.gx, p.gz]), lens: PATHS.map(P => P.len), samples: SAMPLES.map(s => [s.x, s.z]), tiles: Array.from(T).join('') }; };
// each enemy type's centre height above its feet (from its 3D model, scaled): the engine's enemies use it for 3D ranges
window.__enemyDims = () => Object.fromEntries(Object.keys(ED).map(t => { const e = new Enemy(t, 0, 1, PATHS[0]); e.remove(); return [t, e.cy]; }));
// muzzle height above the ground for each attacking tower form (level 1-3, specialisation a/b at rank 1-3), from the
// models: the engine fires projectiles from that height
window.__muzzles = () => { const out = {}; for (const type of ['arrow', 'cannon', 'frost', 'tesla', 'flame']) { const t = new Tower(type, { x: 0, z: 0, gx: -1, gz: -1 }, true, true), r = {};
  const y = () => { t.g.updateMatrixWorld(true); const ms = t.muzzles || [t.muzzle]; return ms.reduce((a, m) => a + m.getWorldPosition(new V3()).y, 0) / ms.length - 1; };
  for (const L of [1, 2, 3]) { t.lvl = L; t.build(); r[L] = y(); }
  for (const k of ['a', 'b']) for (const R of [1, 2, 3]) { t.spec = k; t.lvl = 4; t.rank = R; t.build(); r[k + R] = y(); }
  t.remove(); out[type] = r; } return out; };
// stats of every attacking tower form, with the given War Council picks (none by default), plus upgrade and rank
// costs: the engine's tower test compares against this
window.__towerStats = (ids = []) => { SKILL_VIEW = { has: new Set(ids) }; const out = {};
  for (const type of ['arrow', 'cannon', 'frost', 'tesla', 'flame']) { const r = out[type] = { up: UPC[type], rank: {} };
    for (const L of [1, 2, 3]) r[L] = tStat(type, L);
    for (const k of ['a', 'b']) for (const R of [1, 2, 3]) { r[k + R] = specStat(type, k, R); if (R > 1) r.rank[k + R] = rankCost(type, k, R); } }
  out.sell = sellRate(); out.mortarDead = mortarDead(); SKILL_VIEW = null; return out; };
// Barracks soldier stats for every level, specialisation and rank with the given War Council picks
window.__barrStats = (ids = []) => { SKILL_VIEW = { has: new Set(ids) }; const out = {}; for (const k of [1, 2, 3]) out[k] = barrStat(k); for (const k of ['a', 'b']) for (const R of [1, 2, 3]) out[k + R] = barrStat(k, R); SKILL_VIEW = null; return out; };
// War Drum stats for every level, specialisation and rank with the given War Council picks
window.__drumStats = (ids = []) => { SKILL_VIEW = { has: new Set(ids) }; const out = {}; for (const k of [1, 2, 3]) out[k] = drumStat(k); for (const k of ['a', 'b']) for (const R of [1, 2, 3]) out[k + R] = drumStat(k, R); SKILL_VIEW = null; return out; };
// plays one whole Watch mode battle on map i as fast as possible and reports how it ended: the simulator baseline
window.__watchRun = (i, maxSec = 1500) => { resetGame('auto', i); const d = game.diff, t0 = game.time - 3; let n = 0; // game.time runs on across battles; the opening plays 3 s
  while (game.state === 'play' && n < maxSec * 30) { updateGame(1 / 30); n++; }
  return { state: game.state, hp: game.hp, wave: game.wave, t: Math.round(game.time - t0), towers: towers.length, diff: d,
    left: game.state === 'play' ? enemies.map(e => ({ type: e.type, d: +e.d.toFixed(2), len: +e.path.len.toFixed(1), hp: Math.round(e.hp), fighting: e.fighting, stun: +e.stun.toFixed(2), freeze: +e.freeze.toFixed(2), plantT: +(e.plantT || 0).toFixed(2), spawnQ: game.spawnQ.length })) : undefined }; }; // left: what was still on the field when the cap hit
window.__g = () => ({ gold: game.gold, wave: game.wave, towers: towers.map(t => t.type + t.lvl).join(' '), hp: game.hp, state: game.state, en: enemies.length });
window.__step = n => { for (let i = 0; i < n; i++) { updateGame(1 / 30); updateDirector(1 / 30); updateSky(1 / 30); } return game.state + ' ' + game.wave + ' ' + game.hp; };
window.__shot = n => { startShot({ name: n, e: enemies.find(e => e.type === 'boss'), t: towers.find(t => t.target) || towers[0] }, true); for (let i = 0; i < 60; i++) { updateGame(1 / 30); updateDirector(1 / 30); } };
window.__probe = secs => { const s = performance.now(); for (let i = 0; i < secs * 30; i++) { updateGame(1 / 30); if (game.state !== 'play') break; } return { wave: game.wave, hp: game.hp, gold: game.gold, towers: towers.map(t => t.type[0] + t.lvl).join(' '), defeated: game.defeated, enemies: enemies.length, state: game.state, ms: performance.now() - s }; };
