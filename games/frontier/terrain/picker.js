// Frontier Crown — exact mouse picking on the heightmap terrain.
// Walks the ray cell by cell (Amanatides–Woo DDA on the XZ grid) and intersects the two triangles of each
// cell (the same triangulation THREE.PlaneGeometry renders), so the hit is exact even on cliffs,
// and costs O(cells crossed) instead of testing 32k triangles with THREE.Raycaster.
//
//   const picker = new TerrainPicker(grid);
//   const hit = picker.intersect(ray.origin, ray.direction);   // {x, y, z, i, j, nx, ny, nz, t} or null
//   const hit = picker.fromScreen(THREE, camera, ndcX, ndcY);

export class TerrainPicker {
  constructor(grid) {
    this.g = grid; this.W = grid.W; this.H = grid.H; this.S = grid.W + 1;
    let lo = Infinity, hi = -Infinity; for (const v of grid.hv) { if (v < lo) lo = v; if (v > hi) hi = v; }
    this.minY = lo; this.maxY = hi;
    this._ray = null;
  }

  // Möller–Trumbore against triangle (a,b,c); returns t or -1.
  static tri(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-9) return -1;
    const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv; if (u < -1e-6 || u > 1 + 1e-6) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < -1e-6 || u + v > 1 + 1e-6) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t >= 0 ? t : -1;
  }

  // Ray-cell test: the two triangles (i,j)-(i,j+1)-(i+1,j) and (i,j+1)-(i+1,j+1)-(i+1,j).
  cell(i, j, ox, oy, oz, dx, dy, dz) {
    const hv = this.g.hv, S = this.S;
    const h00 = hv[j * S + i], h10 = hv[j * S + i + 1], h01 = hv[(j + 1) * S + i], h11 = hv[(j + 1) * S + i + 1];
    const t1 = TerrainPicker.tri(ox, oy, oz, dx, dy, dz, i, h00, j, i, h01, j + 1, i + 1, h10, j);
    const t2 = TerrainPicker.tri(ox, oy, oz, dx, dy, dz, i, h01, j + 1, i + 1, h11, j + 1, i + 1, h10, j);
    if (t1 < 0) return t2 < 0 ? null : [t2, 2, h01, h11, h10];
    if (t2 < 0 || t1 <= t2) return [t1, 1, h00, h01, h10];
    return [t2, 2, h01, h11, h10];
  }

  intersect(o, d) {
    const W = this.W, H = this.H;
    let ox = o.x, oy = o.y, oz = o.z;
    const dx = d.x, dy = d.y, dz = d.z;
    // clip the ray to the terrain's bounding box (slabs)
    let t0 = 0, t1 = Infinity;
    const slab = (oo, dd, lo, hi) => {
      if (Math.abs(dd) < 1e-12) return oo >= lo && oo <= hi;
      let a = (lo - oo) / dd, b = (hi - oo) / dd; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); return t0 <= t1;
    };
    if (!slab(ox, dx, 0, W) || !slab(oz, dz, 0, H) || !slab(oy, dy, this.minY - 0.01, this.maxY + 0.01)) return null;
    // DDA from the entry point
    const sx = ox + dx * t0, sz = oz + dz * t0;
    let i = Math.min(W - 1, Math.max(0, Math.floor(sx))), j = Math.min(H - 1, Math.max(0, Math.floor(sz)));
    const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-12 ? Math.abs(1 / dx) : Infinity, tdz = Math.abs(dz) > 1e-12 ? Math.abs(1 / dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-12 ? ((dx > 0 ? i + 1 : i) - ox) / dx : Infinity;
    let tmz = Math.abs(dz) > 1e-12 ? ((dz > 0 ? j + 1 : j) - oz) / dz : Infinity;
    for (let n = 0; n < (W + H) * 2; n++) {
      const hit = this.cell(i, j, ox, oy, oz, dx, dy, dz);
      if (hit) {
        const t = hit[0], x = ox + dx * t, z = oz + dz * t;
        // face normal of the hit triangle (pointing up)
        let nx, ny, nz;
        if (hit[1] === 1) { const [, , h00, h01, h10] = hit; nx = h00 - h10; ny = 1; nz = h00 - h01; }
        else { const [, , h01, h11, h10] = hit; nx = h01 - h11; ny = 1; nz = h10 - h11; }
        const L = Math.hypot(nx, ny, nz);
        return { x, y: oy + dy * t, z, i: Math.min(W - 1, Math.floor(x)), j: Math.min(H - 1, Math.floor(z)), nx: nx / L, ny: ny / L, nz: nz / L, t };
      }
      if (tmx < tmz) { if (tmx > t1) break; i += stepI; tmx += tdx; }
      else { if (tmz > t1) break; j += stepJ; tmz += tdz; }
      if (i < 0 || j < 0 || i >= W || j >= H) break;
    }
    return null;
  }

  fromScreen(THREE, camera, ndcX, ndcY) {
    if (!this._ray) { this._ray = new THREE.Raycaster(); this._v = new THREE.Vector2(); }
    this._v.set(ndcX, ndcY); this._ray.setFromCamera(this._v, camera);
    return this.intersect(this._ray.ray.origin, this._ray.ray.direction);
  }
}
