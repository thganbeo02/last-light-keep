// Map geometry for the engine: the tile grid, each road as a world-space polyline, the sample points along the
// roads (the AI scores plots by them) and the build plots. Ported from main.js buildMap / makePath / pathAt /
// smoothPath, minus everything that only draws (terrain meshes, decor, castle blocks).
// World space: x across, z down; tile (gx, gz) has its centre at (gx - W/2 + .5, gz - H/2 + .5).
import { MAPS } from '../content/maps.ts';
import { clamp, fbm, smooth, type Vec2 } from './math.ts';

export const W = 46, H = 32;
export const gx2w = (g: number) => g - W / 2 + 0.5;
export const gz2w = (g: number) => g - H / 2 + 0.5;
const id = (x: number, z: number) => z * W + x;

/** Tile kinds, as main.js numbers them. */
export const TILE = { grass: 0, road: 1, liquid: 2, bridge: 3, castle: 4, village: 5, camp: 6, plot: 7 } as const;

export interface Path { pts: Vec2[]; seg: number[]; cum: number[]; len: number }
export interface Sample { x: number; z: number; w: number; path: number; d: number }
export interface Plot { gx: number; gz: number; x: number; z: number }
export interface MapGeo {
  index: number; key: string;
  tiles: Uint8Array; heights: Float32Array; dist: Int16Array;
  paths: Path[]; samples: Sample[]; plots: Plot[];
  castle: Vec2;
}

export function makePath(wp: readonly (readonly number[])[]): Path {
  const pts = wp.map(([x, z]) => ({ x: gx2w(x), z: gz2w(z) }));
  const seg: number[] = [], cum = [0];
  for (let i = 0; i < pts.length - 1; i++) { // lengths as Three.js distanceTo computes them, so samples match bit for bit
    const dx = pts[i + 1].x - pts[i].x, dz = pts[i + 1].z - pts[i].z;
    seg.push(Math.sqrt(dx * dx + dz * dz)); cum.push(cum[i] + seg[i]);
  }
  return { pts, seg, cum, len: cum[cum.length - 1] };
}

/** The point at distance d along a path (clamped to its ends). */
export function pathAt(P: Path, d: number, out: Vec2 = { x: 0, z: 0 }): Vec2 {
  d = clamp(d, 0, P.len); let i = 0;
  while (i < P.seg.length - 1 && P.cum[i + 1] < d) i++;
  const t = (d - P.cum[i]) / P.seg[i], a = P.pts[i], b = P.pts[i + 1];
  out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
  return out;
}

/** The road's centre with corners rounded (the midpoint of ±.55 along the path), and optionally its unit direction. */
export function smoothPath(P: Path, d: number, out: Vec2 = { x: 0, z: 0 }, dir?: Vec2): Vec2 {
  const a = pathAt(P, d - 0.55), b = pathAt(P, d + 0.55);
  if (dir) { const dx = b.x - a.x, dz = b.z - a.z, k = 1 / (Math.sqrt(dx * dx + dz * dz) || 1); dir.x = dx * k; dir.z = dz * k; } // as Three.js normalize
  out.x = (a.x + b.x) * 0.5; out.z = (a.z + b.z) * 0.5;
  return out;
}

/** Chebyshev-distance flood fill (8 neighbours) from every tile `src` accepts; unreached tiles stay 99. */
function bfs(src: (i: number) => boolean, out: Int16Array) {
  out.fill(99); const q: number[] = [];
  for (let i = 0; i < W * H; i++) if (src(i)) { out[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % W, z = (i / W) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const j = id(nx, nz); if (out[j] > out[i] + 1) { out[j] = out[i] + 1; q.push(j); }
    }
  }
}

export function buildMap(index: number): MapGeo {
  const M = MAPS[index], L = M.liquid as null | { lake?: number[]; axis?: string; c?: (n: number) => number; w?: number; maxX?: number };
  const T = new Uint8Array(W * H), HT = new Float32Array(W * H).fill(1), DIST = new Int16Array(W * H), LDIST = new Int16Array(W * H);
  // road tiles
  for (const wp of M.paths) for (let i = 0; i < wp.length - 1; i++) {
    let [x0, z0] = wp[i]; const [x1, z1] = wp[i + 1];
    const sx = Math.sign(x1 - x0), sz = Math.sign(z1 - z0);
    for (;;) { T[id(x0, z0)] = TILE.road; if (x0 === x1 && z0 === z1) break; x0 += sx; z0 += sz; }
  }
  // liquid: a river along an axis, or a lake; a road over it is a bridge
  const isLiquid = (x: number, z: number) => {
    if (!L) return false;
    if (L.lake) { const [cx, cz, rx, rz] = L.lake; return ((x + 0.5 - cx) / rx) ** 2 + ((z + 0.5 - cz) / rz) ** 2 < 1; }
    if (L.axis === 'z') return Math.abs(x + 0.5 - L.c!(z)) < L.w!;
    return x <= (L.maxX ?? W) && Math.abs(z + 0.5 - L.c!(x)) < L.w!;
  };
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (isLiquid(x, z)) T[id(x, z)] = T[id(x, z)] === TILE.road ? TILE.bridge : TILE.liquid;
  bfs(i => T[i] === TILE.road || T[i] === TILE.bridge, DIST);
  bfs(i => T[i] === TILE.liquid || T[i] === TILE.bridge, LDIST);
  // reserved zones around the castle, the village and each path's start
  const [cgx, cgz] = M.castle, [vx0, vz0, vx1, vz1] = M.village, starts = M.paths.map(p => p[0]);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = id(x, z); if (T[i] !== TILE.grass) continue;
    if (Math.abs(x - cgx) <= 4 && Math.abs(z - cgz) <= 4) T[i] = TILE.castle;
    else if (x >= vx0 && x <= vx1 && z >= vz0 && z <= vz1 && DIST[i] >= 2) T[i] = TILE.village;
    else if (DIST[i] >= 2 && starts.some(([sx, sz]) => Math.max(Math.abs(x - sx), Math.abs(z - sz)) <= 5)) T[i] = TILE.camp;
  }
  // heights: only flat grass (height 1) can hold a plot, so hills decide where plots can go
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = id(x, z), t = T[i];
    if (t === TILE.liquid || t === TILE.bridge) { HT[i] = 0.25; continue; }
    if (t !== TILE.grass) { HT[i] = 1; continue; }
    const n = fbm(x * 0.13 + index * 17, z * 0.13 + index * 9);
    const edge = Math.max(0, 1 - Math.min(x, W - 1 - x, z, H - 1 - z) / 6);
    let hill = (Math.max(0, (n - 0.45) * 8) * smooth(DIST[i], 2, 6) + edge * 3 * smooth(DIST[i], 2, 5)) * M.hills;
    if (L) hill *= smooth(LDIST[i], 1, 4);
    HT[i] = 1 + Math.min(5, Math.floor(hill));
  }
  // paths and samples every .5 along them (later samples weigh more: they are closer to the castle)
  const paths = M.paths.map(makePath), samples: Sample[] = [];
  paths.forEach((P, pi) => { for (let d = 0; d < P.len; d += 0.5) { const p = smoothPath(P, d); samples.push({ x: p.x, z: p.z, w: 1 + 0.6 * d / P.len, path: pi, d }); } });
  // build plots: 2x2 flat pads 1–2 tiles off the road, picked greedily so they cover the road evenly
  const plots: Plot[] = [];
  {
    const ok = (x: number, z: number) => x >= 1 && z >= 1 && x < W - 1 && z < H - 1 && T[id(x, z)] === TILE.grass && HT[id(x, z)] === 1;
    const cands: Plot[] = [];
    for (let z = 1; z < H - 2; z++) for (let x = 1; x < W - 2; x++) {
      if (!(ok(x, z) && ok(x + 1, z) && ok(x, z + 1) && ok(x + 1, z + 1))) continue;
      const dmin = Math.min(DIST[id(x, z)], DIST[id(x + 1, z)], DIST[id(x, z + 1)], DIST[id(x + 1, z + 1)]);
      if (dmin >= 1 && dmin <= 2) cands.push({ gx: x, gz: z, x: gx2w(x) + 0.5, z: gz2w(z) + 0.5 });
    }
    const ks = new Float32Array(samples.length);
    for (let n = 0; n < M.plots; n++) {
      let best: Plot | null = null, bs = 0;
      for (const c of cands) {
        if (plots.some(p => Math.max(Math.abs(p.gx - c.gx), Math.abs(p.gz - c.gz)) < 4)) continue;
        let v = 0; samples.forEach((p, i) => { if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 < 36) v += 1 / (1 + 1.3 * ks[i]); });
        if (v > bs) { bs = v; best = c; }
      }
      if (!best) break;
      plots.push(best);
      const b = best; samples.forEach((p, i) => { if ((p.x - b.x) ** 2 + (p.z - b.z) ** 2 < 36) ks[i]++; });
    }
    for (const p of plots) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) T[id(p.gx + dx, p.gz + dz)] = TILE.plot;
  }
  return { index, key: M.key, tiles: T, heights: HT, dist: DIST, paths, samples, plots, castle: { x: gx2w(cgx), z: gz2w(cgz) } };
}
