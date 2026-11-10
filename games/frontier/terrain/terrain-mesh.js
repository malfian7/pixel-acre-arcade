// Frontier Crown — heightmap terrain mesh: THREE.PlaneGeometry whose vertices take the grid's heights,
// with per-vertex splat weights (grass, dirt, sand, rock) derived from terrain type, slope and water level.
//
//   const geo = buildTerrainGeometry(THREE, grid);          // geo.attributes.aSplat = vec4 weights
//   const tint = buildTintTexture(THREE, grid, seed);       // low-frequency colour variation
//   const mini = buildMinimapImage(grid);                    // 128×128 canvas for the minimap

import { W, H, T, WATER_Y } from "../sim/map.js";

const smooth = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export function buildTerrainGeometry(THREE, grid) {
  const S = W + 1;
  // A PlaneGeometry with one segment per tile; rotate to XZ and move its corner to the origin.
  const geo = new THREE.PlaneGeometry(W, H, W, H);
  geo.rotateX(-Math.PI / 2); geo.translate(W / 2, 0, H / 2);
  const pos = geo.attributes.position, n = pos.count;
  const splat = new Float32Array(n * 4);
  // tile terrain around each vertex (up to 4 tiles)
  const tileAt = (i, j) => grid.terrain[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  for (let v = 0; v < n; v++) {
    const i = Math.round(pos.getX(v)), j = Math.round(pos.getZ(v));
    const h = grid.hv[j * S + i];
    pos.setY(v, h);
    // vertex slope from central differences
    const hx = grid.hv[j * S + Math.min(W, i + 1)] - grid.hv[j * S + Math.max(0, i - 1)];
    const hz = grid.hv[Math.min(H, j + 1) * S + i] - grid.hv[Math.max(0, j - 1) * S + i];
    const slope = Math.hypot(hx, hz) * 0.5;
    let g = 0, d = 0, s = 0, r = 0;
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const t = tileAt(i + di, j + dj);
      if (t === T.DIRT) d += 1; else if (t === T.FOREST) { d += 0.45; g += 0.55; }
      else if (t === T.SAND) s += 1; else if (t === T.SHALLOW || t === T.DEEP) { s += 0.5; d += 0.5; }
      else if (t === T.ROCK) r += 1; else g += 1;
    }
    g /= 4; d /= 4; s /= 4; r /= 4;
    // slope → rock, low ground near water → sand
    const rk = smooth(0.6, 1.05, slope);
    r = Math.max(r, rk);
    const shore = smooth(WATER_Y + 0.55, WATER_Y + 0.05, h);
    s = Math.max(s, shore * (1 - r));
    const sum = g + d + s + r || 1;
    splat.set([g / sum * (1 - rk * 0.6), d / sum * (1 - rk * 0.6), s / sum * (1 - rk * 0.6), r / sum + rk * 0.6], v * 4);
  }
  geo.setAttribute("aSplat", new THREE.BufferAttribute(splat, 4));
  geo.computeVertexNormals();
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return geo;
}

// Macro colour variation (meadows lighter, forest floor darker), sampled once per world unit, blurred.
export function buildTintTexture(THREE, grid, seed = 1) {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), img = g.createImageData(W, H);
  let s = seed * 9301 + 49297; const R = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let k = 0; k < W * H; k++) {
    const t = grid.terrain[k];
    let rgb = [128, 128, 128];
    if (t === T.MEADOW) rgb = [142, 140, 112]; else if (t === T.FOREST) rgb = [104, 114, 100];
    const v = 0.96 + R() * 0.08;
    img.data[k * 4] = rgb[0] * v; img.data[k * 4 + 1] = rgb[1] * v; img.data[k * 4 + 2] = rgb[2] * v; img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const c2 = document.createElement("canvas"); c2.width = W * 2; c2.height = H * 2;
  const g2 = c2.getContext("2d"); g2.filter = "blur(3px)"; g2.drawImage(c, -2, -2, W * 2 + 4, H * 2 + 4);
  const t = new THREE.CanvasTexture(c2);
  t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Minimap base: tile colours with simple hillshade from the heights.
export function buildMinimapImage(grid) {
  const COL = { [T.GRASS]: [104, 140, 60], [T.MEADOW]: [130, 158, 72], [T.DIRT]: [150, 122, 84], [T.SAND]: [205, 186, 136],
    [T.SHALLOW]: [86, 140, 160], [T.DEEP]: [52, 98, 128], [T.FOREST]: [52, 84, 40], [T.ROCK]: [128, 122, 114] };
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), img = g.createImageData(W, H), S = W + 1;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, col = COL[grid.terrain[k]] || COL[T.GRASS];
    const dx = grid.hv[j * S + i + 1] - grid.hv[j * S + i], dz = grid.hv[(j + 1) * S + i] - grid.hv[j * S + i];
    const l = Math.max(0.65, Math.min(1.3, 1 - dx * 0.35 + dz * 0.45));
    img.data[k * 4] = col[0] * l; img.data[k * 4 + 1] = col[1] * l; img.data[k * 4 + 2] = col[2] * l; img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
