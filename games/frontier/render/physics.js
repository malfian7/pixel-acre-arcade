// Frontier Crown — cosmetic rigid-body physics with cannon-es (view only; the sim stays deterministic).
//
//  · Ragdolls: a unit killed by a blast becomes a rigid body thrown by an impulse away from the
//    explosion (plus lift and spin). Its own instanced mesh follows the body while the vertex
//    shader plays a flailing pose; once the body settles it is handed back as an ordinary corpse.
//  · Building collapse: the intact mesh is swapped for N box debris pieces (planks, stones, roof
//    tiles in the building's own colours, sampled from its geometry) that burst outward, fall under
//    gravity, bounce and tumble on the real terrain, puff dust on hard impacts, then sink away.
//  · Ground: one static Heightfield built from the same 129×129 height grid the terrain mesh uses.
//
// Gameplay never reads any of this: if physics is off (low quality) nothing about the match changes.

import * as CANNON from "cannon-es";

const STEP = 1 / 60;
const RAGDOLL_LIFE = 2.6, DEBRIS_LIFE = 6.5, SINK = 1.2;
// box half-extents per unit body (x, y, z) — rough silhouettes
const BODY = { horse: [0.22, 0.95, 0.55], cannon: [0.45, 0.4, 0.75], beast: [0.16, 0.38, 0.38], human: [0.2, 0.68, 0.14] };

export function createPhysics(THREE, { grid, W, H, quality = "high", inst, fx }) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -16, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.55;
  world.defaultContactMaterial.restitution = 0.22;

  // ground: Heightfield in local XY (z up) rotated onto XZ; data[i][k] = height at x = i, z = H - k
  const S = W + 1, data = [];
  for (let i = 0; i <= W; i++) { const col = []; for (let k = 0; k <= H; k++) col.push(grid.hv[(H - k) * S + i]); data.push(col); }
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Heightfield(data, { elementSize: 1 }) });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  ground.position.set(0, 0, H);
  world.addBody(ground);

  const maxDebris = quality === "high" ? 320 : quality === "low" ? 0 : 160;
  const ragdolls = [], debris = [];
  let acc = 0;

  // ---------------------------------------------------------------- debris rendering (one InstancedMesh)
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.setAttribute("aTeam", new THREE.Float32BufferAttribute(new Float32Array(boxGeo.attributes.position.count).fill(1), 1));
  const debrisMat = inst.patch(new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, metalness: 0 }));
  const pool = new inst.InstancePool(boxGeo, debrisMat, Math.max(1, maxDebris), { name: "debris" });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3();

  // palette of a building = its vertex colours weighted by triangle area (cached per type)
  const palettes = new Map();
  function palette(id, geo) {
    if (palettes.has(id)) return palettes.get(id);
    const pos = geo.attributes.position.array, col = geo.attributes.color.array, buckets = new Map();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < pos.length / 9; t++) {
      a.fromArray(pos, t * 9); b.fromArray(pos, t * 9 + 3); c.fromArray(pos, t * 9 + 6);
      const area = b.sub(a).cross(c.sub(a)).length() * 0.5;
      const k = `${col[t * 9].toFixed(2)},${col[t * 9 + 1].toFixed(2)},${col[t * 9 + 2].toFixed(2)}`;
      buckets.set(k, (buckets.get(k) || 0) + area);
    }
    const list = [...buckets].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, w]) => ({ c: k.split(",").map(Number), w }));
    const tot = list.reduce((s, x) => s + x.w, 0); list.forEach((x) => (x.w /= tot));
    palettes.set(id, list);
    return list;
  }
  const pick = (list, r) => { for (const x of list) { r -= x.w; if (r <= 0) return x.c; } return list[0].c; };

  function puff(body) {
    body.addEventListener("collide", (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v > 4.5 && body.puffs++ < 2) fx.dust(body.position.x, body.position.y - 0.1, body.position.z, 0.15, 2);
    });
  }

  return {
    get count() { return ragdolls.length + debris.length; },
    /**
     * Throw a unit: defKind ∈ BODY, (x, y, z) feet position, rot = facing, blast = {x, z} centre.
     * Returns the record the view draws from (r.body.position / quaternion).
     */
    ragdoll(def, owner, kind, x, y, z, rot, blast, strength = 1) {
      if (quality === "low") return null;
      const he = BODY[kind] || BODY.human;
      const body = new CANNON.Body({ mass: kind === "horse" ? 6 : kind === "cannon" ? 10 : 1, shape: new CANNON.Box(new CANNON.Vec3(he[0], he[1], he[2])), linearDamping: 0.05, angularDamping: 0.25 });
      body.position.set(x, y + he[1] + 0.02, z);
      body.quaternion.setFromEuler(0, rot, 0);
      body.sleepSpeedLimit = 0.25; body.sleepTimeLimit = 0.4; body.puffs = 0;
      let dx = x - blast.x, dz = z - blast.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      const k = strength * Math.max(0.35, 1.4 - d * 0.4);
      const m = body.mass;
      // impulse at a point above the centre of mass → the body flips over as it flies
      body.applyImpulse(new CANNON.Vec3(dx * 5.5 * k * m, (6.5 + 2.5 * k) * m, dz * 5.5 * k * m), new CANNON.Vec3(0, he[1] * 0.6, 0));
      world.addBody(body); puff(body);
      const r = { body, def, owner, kind, t: 0, h: he[1] };
      ragdolls.push(r);
      return r;
    },
    /** Shatter a building: geo = its model geometry (for the palette), height h, footprint size. */
    collapse(id, geo, x, y, z, size, h, blast) {
      if (!maxDebris) return;
      const pal = palette(id, geo);
      const n = Math.min(maxDebris - debris.length, Math.round((10 + size * size * 1.6) * (quality === "high" ? 1 : 0.6)));
      let bx = 0, bz = 0;
      if (blast) { bx = x - blast.x; bz = z - blast.z; const L = Math.hypot(bx, bz) || 1; bx /= L; bz /= L; }
      for (let i = 0; i < n; i++) {
        const plank = Math.random() < 0.35;
        const sx = plank ? 0.08 + Math.random() * 0.08 : 0.16 + Math.random() * 0.3, sy = plank ? 0.08 + Math.random() * 0.06 : 0.12 + Math.random() * 0.24, sz = plank ? 0.5 + Math.random() * 0.7 : 0.16 + Math.random() * 0.3;
        const body = new CANNON.Body({ mass: sx * sy * sz * 20 + 0.05, shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)), angularDamping: 0.15 });
        const px = (Math.random() - 0.5) * size * 0.8, pz = (Math.random() - 0.5) * size * 0.8, py = 0.2 + Math.random() * h * 0.9;
        body.position.set(x + px, y + py, z + pz);
        body.quaternion.setFromEuler(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        const out = 1.2 + Math.random() * 3.2, L = Math.hypot(px, pz) || 1;
        body.velocity.set(px / L * out + bx * 2.2, 1.5 + Math.random() * 5 + py * 0.6, pz / L * out + bz * 2.2);
        body.angularVelocity.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
        body.sleepSpeedLimit = 0.2; body.sleepTimeLimit = 0.5; body.puffs = 0;
        world.addBody(body); puff(body);
        const c = pick(pal, Math.random()), shade = 0.85 + Math.random() * 0.25;
        debris.push({ body, t: Math.random() * 0.4, size: [sx, sy, sz], col: [c[0] * shade, c[1] * shade, c[2] * shade] });
      }
    },
    /** Fixed 60 Hz substeps; returns ragdolls that just finished (hand them over as corpses). */
    step(dt) {
      acc = Math.min(acc + dt, 0.1);
      while (acc >= STEP) { world.step(STEP); acc -= STEP; }
      const done = [];
      for (let i = ragdolls.length - 1; i >= 0; i--) {
        const r = ragdolls[i]; r.t += dt;
        if (r.t > RAGDOLL_LIFE || (r.t > 0.8 && r.body.sleepState === CANNON.Body.SLEEPING)) { world.removeBody(r.body); ragdolls.splice(i, 1); done.push(r); }
      }
      pool.begin();
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i], b = d.body; d.t += dt;
        if (d.t > DEBRIS_LIFE + SINK) { world.removeBody(b); debris.splice(i, 1); continue; }
        if (d.t > DEBRIS_LIFE && b.type !== CANNON.Body.KINEMATIC) { b.type = CANNON.Body.KINEMATIC; b.velocity.set(0, -0.25, 0); b.angularVelocity.set(0, 0, 0); } // sink into the ground
        if (d.t < 1.5 && b.velocity.lengthSquared() > 9 && Math.random() < dt * 6) fx.dust(b.position.x, b.position.y, b.position.z, 0.05, 1); // smoke trail
        M.compose(V.set(b.position.x, b.position.y, b.position.z), Q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w), SC.set(d.size[0], d.size[1], d.size[2]));
        pool.pushMatrix(M, d.col[0], d.col[1], d.col[2]);
      }
      pool.end();
      return done;
    },
    /** Matrix of a ragdoll's mesh: the body centre is half a body above the model's feet. */
    ragdollMatrix(r, out) {
      const b = r.body;
      Q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      V.set(0, -r.h, 0).applyQuaternion(Q).add(SC.set(b.position.x, b.position.y, b.position.z));
      return out.compose(V, Q, SC.set(1, 1, 1));
    },
    mesh: pool.mesh,
    dispose() { boxGeo.dispose(); debrisMat.dispose(); for (const r of ragdolls) world.removeBody(r.body); for (const d of debris) world.removeBody(d.body); },
  };
}
