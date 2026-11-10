// Frontier Crown — procedural low-poly models. Each model is ONE merged BufferGeometry with
// vertex colours + per-vertex attributes (aTeam: tint by team, aPart/aPivot: vertex-shader limbs),
// so every model type draws as a single InstancedMesh.

export function createModels(THREE) {
  const V = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S3 = new THREE.Vector3(), M = new THREE.Matrix4();
  const col = new THREE.Color();

  class MB {
    constructor() { this.pos = []; this.col = []; this.team = []; this.part = []; this.piv = []; }
    add(geo, color, o = {}) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      E.set(o.rx || 0, o.ry || 0, o.rz || 0); Q.setFromEuler(E);
      V.set(o.x || 0, o.y || 0, o.z || 0); S3.set(o.sx || 1, o.sy || 1, o.sz || 1);
      M.compose(V, Q, S3); g.applyMatrix4(M);
      const p = g.attributes.position.array; col.set(color);
      const n = p.length / 3;
      for (let i = 0; i < n; i++) {
        this.pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        this.col.push(col.r, col.g, col.b);
        this.team.push(o.team || 0); this.part.push(o.part || 0); this.piv.push(o.pivot || 0);
      }
      g.dispose();
      return this;
    }
    box(w, h, d, c, o = {}) { return this.add(new THREE.BoxGeometry(w, h, d), c, o); }
    cyl(rt, rb, h, seg, c, o = {}) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), c, o); }
    cone(r, h, seg, c, o = {}) { return this.add(new THREE.ConeGeometry(r, h, seg), c, o); }
    ball(r, c, o = {}, det = 0) { return this.add(new THREE.IcosahedronGeometry(r, det), c, o); }
    dodec(r, c, o = {}) { return this.add(new THREE.DodecahedronGeometry(r, 0), c, o); }
    roof(w, h, d, c, o = {}) { return this.add(prism(w, h, d), c, o); }
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
      g.setAttribute("aTeam", new THREE.Float32BufferAttribute(this.team, 1));
      g.setAttribute("aPart", new THREE.Float32BufferAttribute(this.part, 1));
      g.setAttribute("aPivot", new THREE.Float32BufferAttribute(this.piv, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
  }
  // Gable roof: ridge along x, width w (x), height h, depth d (z), base at y=0.
  function prism(w, h, d) {
    const x = w / 2, z = d / 2;
    const v = [
      -x, 0, z, x, 0, z, x, h, 0, -x, 0, z, x, h, 0, -x, h, 0,   // front slope
      x, 0, -z, -x, 0, -z, -x, h, 0, x, 0, -z, -x, h, 0, x, h, 0, // back slope
      -x, 0, -z, -x, 0, z, -x, h, 0,                              // left gable
      x, 0, z, x, 0, -z, x, h, 0,                                 // right gable
    ];
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); return g;
  }

  // ------------------------------------------------------------------ palette
  const P = {
    skin: "#e2b48c", skin2: "#c99470", team: "#ffffff", teamD: "#d8d8d8", cloth: "#6b5440", trousers: "#4e4436", boot: "#2a221c",
    white: "#ece6d6", black: "#1d1b1b", steel: "#b8bec6", wood: "#6a4628", woodD: "#4a3020", straw: "#cfa55a", brass: "#c9a04a",
    plaster: "#eadfc8", stone: "#a0978a", stoneD: "#7e766b", roofR: "#9a4330", roofS: "#4f5763", brick: "#a5573f", thatch: "#c49a4f",
  };

  // ------------------------------------------------------------------ units
  function legs(b, col, len, hipY, sep, w = 0.13) {
    b.box(w, len, 0.14, col, { x: -sep, y: hipY - len / 2, part: 1, pivot: hipY });
    b.box(w, len, 0.14, col, { x: sep, y: hipY - len / 2, part: 2, pivot: hipY });
    b.box(w + 0.01, 0.08, 0.2, P.boot, { x: -sep, y: 0.04, z: 0.03, part: 1, pivot: hipY });
    b.box(w + 0.01, 0.08, 0.2, P.boot, { x: sep, y: 0.04, z: 0.03, part: 2, pivot: hipY });
  }
  function villager(lod) {
    const b = new MB();
    if (lod) { b.box(0.3, 0.42, 0.18, P.trousers, { y: 0.21 }); b.box(0.36, 0.38, 0.22, P.team, { y: 0.6, team: 1 }); b.ball(0.12, P.skin, { y: 0.9 }); b.cyl(0.17, 0.17, 0.04, 8, P.straw, { y: 0.99 }); return b.geometry(); }
    legs(b, P.trousers, 0.4, 0.42, 0.085);
    b.box(0.34, 0.36, 0.2, P.team, { y: 0.6, team: 1 });
    b.box(0.35, 0.05, 0.21, P.woodD, { y: 0.44 });
    b.box(0.09, 0.32, 0.1, P.team, { x: -0.215, y: 0.62, team: 1 });
    b.box(0.09, 0.32, 0.1, P.team, { x: 0.215, y: 0.62, team: 1, part: 3, pivot: 0.76 });
    b.ball(0.06, P.skin, { x: 0.215, y: 0.44, part: 3, pivot: 0.76 });
    b.ball(0.115, P.skin, { y: 0.9 }, 1);
    b.cyl(0.18, 0.18, 0.03, 10, P.straw, { y: 0.98 });
    b.cyl(0.095, 0.11, 0.1, 8, P.straw, { y: 1.03 });
    b.box(0.035, 0.42, 0.035, P.wood, { x: 0.23, y: 0.5, z: 0.12, rx: 0.5, part: 3, pivot: 0.76 });
    b.box(0.03, 0.08, 0.13, P.steel, { x: 0.23, y: 0.33, z: 0.24, rx: 0.5, part: 3, pivot: 0.76 });
    return b.geometry();
  }
  function musketeer(lod) {
    const b = new MB();
    if (lod) { b.box(0.3, 0.42, 0.18, P.white, { y: 0.21 }); b.box(0.38, 0.44, 0.24, P.team, { y: 0.64, team: 1 }); b.ball(0.12, P.skin, { y: 0.95 }); b.cone(0.18, 0.12, 3, P.black, { y: 1.06 }); b.box(0.04, 1.0, 0.04, P.wood, { x: 0.22, y: 0.7 }); return b.geometry(); }
    legs(b, P.white, 0.42, 0.44, 0.085);
    b.box(0.13, 0.16, 0.15, P.black, { x: -0.085, y: 0.12, part: 1, pivot: 0.44 });
    b.box(0.13, 0.16, 0.15, P.black, { x: 0.085, y: 0.12, part: 2, pivot: 0.44 });
    b.box(0.36, 0.44, 0.22, P.team, { y: 0.66, team: 1 });
    b.box(0.34, 0.2, 0.06, P.teamD, { y: 0.42, z: -0.1, team: 1 });
    b.box(0.37, 0.04, 0.23, P.white, { y: 0.66, rz: 0.75 });
    b.box(0.37, 0.04, 0.23, P.white, { y: 0.66, rz: -0.75 });
    b.box(0.09, 0.34, 0.1, P.team, { x: -0.225, y: 0.67, team: 1 });
    b.box(0.09, 0.34, 0.1, P.team, { x: 0.225, y: 0.67, team: 1, part: 3, pivot: 0.83 });
    b.ball(0.115, P.skin, { y: 0.97 }, 1);
    b.cone(0.2, 0.13, 3, P.black, { y: 1.09, ry: 0.5 });
    b.box(0.04, 1.05, 0.045, P.wood, { x: 0.25, y: 0.78, z: 0.07, rx: 0.12, part: 3, pivot: 0.83 });
    b.box(0.022, 0.5, 0.022, P.steel, { x: 0.25, y: 1.25, z: 0.13, rx: 0.12, part: 3, pivot: 0.83 });
    return b.geometry();
  }
  function pikeman(lod) {
    const b = new MB();
    if (lod) { b.box(0.3, 0.42, 0.18, P.trousers, { y: 0.21 }); b.box(0.38, 0.44, 0.24, P.steel, { y: 0.64 }); b.ball(0.13, P.steel, { y: 0.96 }); b.box(0.03, 2.3, 0.03, P.wood, { x: 0.22, y: 1.1 }); return b.geometry(); }
    legs(b, P.team, 0.42, 0.44, 0.085);
    b.box(0.36, 0.42, 0.22, P.team, { y: 0.65, team: 1 });
    b.box(0.38, 0.3, 0.24, P.steel, { y: 0.72 });
    b.box(0.09, 0.34, 0.1, P.team, { x: -0.225, y: 0.67, team: 1 });
    b.box(0.09, 0.34, 0.1, P.team, { x: 0.225, y: 0.67, team: 1, part: 3, pivot: 0.83 });
    b.ball(0.11, P.skin, { y: 0.97 }, 1);
    b.ball(0.13, P.steel, { y: 1.04, sy: 0.75 });
    b.cyl(0.2, 0.2, 0.03, 10, P.steel, { y: 1.0 });
    b.box(0.03, 2.35, 0.03, P.wood, { x: 0.25, y: 1.15, z: 0.06, part: 3, pivot: 0.83 });
    b.cone(0.04, 0.2, 4, P.steel, { x: 0.25, y: 2.42, z: 0.06, part: 3, pivot: 0.83 });
    return b.geometry();
  }
  function horse(b, lod) {
    const brown = "#6b4a2e", dark = "#3d2a1b";
    b.box(0.34, 0.36, 0.95, brown, { y: 0.8 });
    b.box(0.22, 0.42, 0.24, brown, { y: 1.05, z: 0.5, rx: -0.5 });
    b.box(0.17, 0.18, 0.36, brown, { y: 1.22, z: 0.7, rx: 0.3 });
    b.box(0.05, 0.3, 0.12, dark, { y: 1.12, z: 0.42, rx: -0.5 });
    b.box(0.08, 0.36, 0.08, dark, { y: 0.72, z: -0.52, rx: 0.4 });
    b.box(0.36, 0.12, 0.5, P.team, { y: 1.0, team: 1 });
    const L = (x, z, part) => { b.box(0.09, 0.6, 0.1, brown, { x, y: 0.32, z, part, pivot: 0.62 }); b.box(0.1, 0.06, 0.12, dark, { x, y: 0.03, z, part, pivot: 0.62 }); };
    if (lod) { b.box(0.3, 0.6, 0.85, brown, { y: 0.3 }); return; }
    L(-0.12, 0.36, 1); L(0.12, -0.36, 1); L(0.12, 0.36, 2); L(-0.12, -0.36, 2);
  }
  function hussar(lod) {
    const b = new MB();
    horse(b, lod);
    b.box(0.32, 0.42, 0.22, P.team, { y: 1.3, team: 1 });
    b.box(0.1, 0.32, 0.12, P.white, { x: -0.16, y: 1.0, z: 0.08 });
    b.box(0.1, 0.32, 0.12, P.white, { x: 0.16, y: 1.0, z: 0.08 });
    b.ball(0.11, P.skin, { y: 1.62 }, lod ? 0 : 1);
    b.cyl(0.12, 0.11, 0.2, 8, P.black, { y: 1.76 });
    if (!lod) {
      b.box(0.04, 0.18, 0.04, P.team, { x: 0.06, y: 1.9, team: 1 });
      b.box(0.08, 0.3, 0.1, P.team, { x: -0.2, y: 1.32, team: 1 });
      b.box(0.08, 0.3, 0.1, P.team, { x: 0.2, y: 1.32, team: 1, part: 3, pivot: 1.46 });
      b.box(0.025, 0.7, 0.05, P.steel, { x: 0.22, y: 1.5, z: 0.15, rx: 0.6, part: 3, pivot: 1.46 });
    }
    return b.geometry();
  }
  function falconet(lod) {
    const b = new MB();
    const wheel = (x) => b.cyl(0.33, 0.33, 0.07, lod ? 8 : 12, P.woodD, { x, y: 0.33, rz: Math.PI / 2 });
    wheel(-0.32); wheel(0.32);
    b.box(0.5, 0.12, 0.12, P.woodD, { y: 0.33 });
    b.box(0.3, 0.16, 0.9, P.wood, { y: 0.42, z: -0.18, rx: -0.12 });
    b.box(0.12, 0.08, 0.7, P.wood, { y: 0.15, z: -0.75, rx: -0.3 });
    b.cyl(0.07, 0.1, 1.05, 10, "#b88a3e", { y: 0.6, z: 0.18, rx: Math.PI / 2 - 0.12, part: 3, pivot: 0.6 });
    b.ball(0.1, "#b88a3e", { y: 0.62, z: -0.32, part: 3, pivot: 0.6 });
    if (!lod) {
      // gunner
      b.box(0.11, 0.38, 0.13, P.white, { x: 0.55, y: 0.19, z: -0.55 });
      b.box(0.11, 0.38, 0.13, P.white, { x: 0.72, y: 0.19, z: -0.55 });
      b.box(0.32, 0.4, 0.2, P.team, { x: 0.635, y: 0.58, z: -0.55, team: 1 });
      b.ball(0.1, P.skin, { x: 0.635, y: 0.88, z: -0.55 });
      b.cone(0.17, 0.12, 3, P.black, { x: 0.635, y: 0.99, z: -0.55 });
      b.box(0.03, 0.8, 0.03, P.wood, { x: 0.82, y: 0.6, z: -0.45, rx: 0.3 });
    }
    return b.geometry();
  }
  function deer() {
    const b = new MB(), tan = "#a87b4f", pale = "#e3cfae";
    b.box(0.26, 0.3, 0.72, tan, { y: 0.65 });
    b.box(0.22, 0.12, 0.5, pale, { y: 0.52 });
    b.box(0.13, 0.32, 0.14, tan, { y: 0.88, z: 0.36, rx: -0.4 });
    b.box(0.12, 0.13, 0.24, tan, { y: 1.02, z: 0.48 });
    b.box(0.02, 0.22, 0.02, "#d9c9a8", { x: -0.06, y: 1.18, z: 0.44, rz: 0.4 });
    b.box(0.02, 0.22, 0.02, "#d9c9a8", { x: 0.06, y: 1.18, z: 0.44, rz: -0.4 });
    b.box(0.06, 0.08, 0.04, pale, { y: 0.72, z: -0.37 });
    const L = (x, z, part) => b.box(0.06, 0.5, 0.06, "#7c5838", { x, y: 0.25, z, part, pivot: 0.5 });
    L(-0.09, 0.26, 1); L(0.09, -0.26, 1); L(0.09, 0.26, 2); L(-0.09, -0.26, 2);
    return b.geometry();
  }

  // ------------------------------------------------------------------ resources
  function pine() {
    const b = new MB();
    b.cyl(0.08, 0.12, 0.7, 6, "#5a3d27", { y: 0.35 });
    b.cone(0.62, 1.1, 7, "#2f5a36", { y: 1.05, team: 1 });
    b.cone(0.5, 0.95, 7, "#33633a", { y: 1.6, team: 1 });
    b.cone(0.34, 0.8, 7, "#3a6e40", { y: 2.1, team: 1 });
    return b.geometry();
  }
  function oak() {
    const b = new MB();
    b.cyl(0.09, 0.14, 1.0, 6, "#5d4129", { y: 0.5 });
    b.ball(0.62, "#4a7a36", { y: 1.45, team: 1 });
    b.ball(0.45, "#548740", { x: 0.32, y: 1.75, z: 0.1, team: 1 });
    b.ball(0.42, "#43703a", { x: -0.3, y: 1.62, z: -0.18, team: 1 });
    return b.geometry();
  }
  function stump() { const b = new MB(); b.cyl(0.13, 0.15, 0.22, 7, "#6a4a2e", { y: 0.11 }); b.cyl(0.12, 0.12, 0.01, 7, "#c9a575", { y: 0.225 }); return b.geometry(); }
  function bush() {
    const b = new MB();
    b.ball(0.42, "#3f6b33", { y: 0.32, sy: 0.75, team: 1 });
    b.ball(0.3, "#4a7a3a", { x: 0.22, y: 0.4, z: 0.1, team: 1 });
    for (let k = 0; k < 9; k++) { const a = k * 2.4, r = 0.28 + (k % 3) * 0.06; b.ball(0.06, "#c3263c", { x: Math.cos(a) * r, y: 0.3 + (k % 4) * 0.08, z: Math.sin(a) * r }); }
    return b.geometry();
  }
  function goldmine() {
    const b = new MB();
    b.dodec(1.15, "#7d7468", { y: 0.35, sy: 0.6 });
    b.dodec(0.8, "#8c8276", { x: -0.6, y: 0.5, z: -0.4, sy: 0.8 });
    b.dodec(0.7, "#6f675d", { x: 0.7, y: 0.4, z: -0.5, sy: 0.75 });
    for (let k = 0; k < 12; k++) { const a = k * 2.2, r = 0.5 + (k % 4) * 0.2; b.dodec(0.12 + (k % 3) * 0.04, "#efc443", { x: Math.cos(a) * r, y: 0.55 + (k % 3) * 0.15, z: Math.sin(a) * r }); }
    b.box(0.1, 0.8, 0.1, P.wood, { x: -0.35, y: 0.4, z: 0.95 }); b.box(0.1, 0.8, 0.1, P.wood, { x: 0.35, y: 0.4, z: 0.95 }); b.box(0.85, 0.1, 0.12, P.wood, { y: 0.82, z: 0.95 });
    b.box(0.55, 0.6, 0.1, "#1a1512", { y: 0.33, z: 0.9 });
    return b.geometry();
  }

  // ------------------------------------------------------------------ buildings
  const flag = (b, x, y, z, h = 1.4, w = 0.6) => {
    b.cyl(0.03, 0.03, h, 5, P.woodD, { x, y: y + h / 2, z });
    b.box(w, w * 0.6, 0.03, P.team, { x: x + w / 2 + 0.03, y: y + h - w * 0.3 - 0.05, z, team: 1 });
  };
  function towncenter() {
    const b = new MB();
    b.box(4.7, 0.35, 4.7, P.stone, { y: 0.17 });
    b.box(4.2, 0.12, 4.2, P.stoneD, { y: 0.41 });
    b.box(3.2, 1.7, 2.4, P.plaster, { y: 1.3, z: -0.3 });
    for (const x of [-1.6, -0.55, 0.55, 1.6]) b.box(0.1, 1.7, 0.1, P.woodD, { x, y: 1.3, z: 0.92 });
    b.box(3.3, 0.12, 0.12, P.woodD, { y: 1.55, z: 0.92 });
    b.roof(3.6, 1.3, 2.9, P.roofR, { y: 2.15, z: -0.3 });
    b.box(3.7, 0.14, 0.14, P.team, { y: 2.2, z: 1.1, team: 1 });
    b.box(1.1, 1.2, 1.5, P.plaster, { x: -1.75, y: 1.0, z: 0.9 });
    b.roof(1.3, 0.75, 1.7, P.roofR, { x: -1.75, y: 1.6, z: 0.9, ry: Math.PI / 2 });
    b.box(1.1, 1.2, 1.5, P.plaster, { x: 1.75, y: 1.0, z: 0.9 });
    b.roof(1.3, 0.75, 1.7, P.roofR, { x: 1.75, y: 1.6, z: 0.9, ry: Math.PI / 2 });
    b.box(1.0, 3.3, 1.0, P.stone, { x: 1.4, y: 2.05, z: -1.35 });
    b.box(1.1, 0.2, 1.1, P.stoneD, { x: 1.4, y: 3.7, z: -1.35 });
    b.cone(0.85, 1.1, 4, P.roofS, { x: 1.4, y: 4.35, z: -1.35, ry: Math.PI / 4 });
    flag(b, 1.4, 4.85, -1.35, 1.3, 0.75);
    b.box(0.7, 0.95, 0.06, "#4a2e1c", { y: 0.9, z: 0.93 });
    b.box(0.3, 1.2, 0.3, P.brick, { x: -0.9, y: 2.9, z: -0.6 });
    for (const x of [-0.8, 0.8]) b.box(0.5, 0.4, 0.04, "#2c3540", { x, y: 1.55, z: 0.95 });
    b.box(0.9, 0.5, 0.06, P.team, { x: -1.75, y: 1.1, z: 1.66, team: 1 });
    b.box(0.9, 0.5, 0.06, P.team, { x: 1.75, y: 1.1, z: 1.66, team: 1 });
    return b.geometry();
  }
  function house() {
    const b = new MB();
    b.box(1.75, 0.15, 1.6, P.stoneD, { y: 0.07 });
    b.box(1.55, 1.0, 1.25, P.plaster, { y: 0.65 });
    for (const x of [-0.77, 0.77]) b.box(0.08, 1.0, 0.08, P.woodD, { x, y: 0.65, z: 0.63 });
    b.box(1.6, 0.08, 0.08, P.woodD, { y: 1.1, z: 0.63 });
    b.roof(1.85, 0.85, 1.6, "#6b4636", { y: 1.15 });
    b.box(0.35, 0.6, 0.05, P.team, { y: 0.45, z: 0.64, team: 1 });
    b.box(0.3, 0.3, 0.04, "#2c3540", { x: 0.45, y: 0.75, z: 0.64 });
    b.box(0.2, 0.55, 0.2, P.brick, { x: 0.5, y: 1.65, z: -0.3 });
    return b.geometry();
  }
  function mill() {
    const b = new MB();
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; b.box(0.7, 0.06, 0.4, k % 2 ? "#d8b553" : "#c9a346", { x: Math.cos(a) * 1.15, y: 0.03, z: Math.sin(a) * 1.15, ry: -a }); }
    b.cyl(0.62, 0.75, 2.2, 10, P.plaster, { y: 1.1 });
    b.cyl(0.66, 0.66, 0.1, 10, P.woodD, { y: 2.2 });
    b.cone(0.75, 0.8, 10, "#7a4a33", { y: 2.65 });
    b.box(0.4, 0.62, 0.06, "#4a2e1c", { y: 0.32, z: 0.72 });
    b.box(0.08, 0.08, 0.5, P.woodD, { y: 2.05, z: 0.75 });
    b.cyl(0.08, 0.08, 0.03, 8, P.team, { y: 3.1, team: 1 }); flag(b, 0, 2.95, 0, 0.7, 0.35);
    return b.geometry();
  }
  function millBlades() {
    const b = new MB();
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      b.box(0.06, 1.35, 0.04, P.woodD, { x: Math.sin(a) * 0.68, y: Math.cos(a) * 0.68, rz: -a });
      b.box(0.28, 1.05, 0.02, "#efe6d2", { x: Math.sin(a) * 0.78 + Math.cos(a) * 0.15, y: Math.cos(a) * 0.78 - Math.sin(a) * 0.15, rz: -a });
    }
    b.ball(0.09, P.woodD, {});
    return b.geometry();
  }
  function barracks() {
    const b = new MB();
    b.box(3.8, 0.15, 3.8, "#8c7d62", { y: 0.07 });
    b.box(3.3, 1.3, 1.9, P.brick, { y: 0.8, z: -0.8 });
    b.roof(3.6, 0.9, 2.3, P.roofS, { y: 1.45, z: -0.8 });
    b.box(1.1, 0.95, 0.06, "#3a2618", { y: 0.62, z: 0.16 });
    b.box(3.4, 0.22, 0.1, P.team, { y: 1.33, z: 0.19, team: 1 });
    for (let k = 0; k < 7; k++) b.box(0.08, 0.5, 0.08, P.woodD, { x: -1.7 + k * 0.57, y: 0.3, z: 1.75 });
    b.box(3.5, 0.06, 0.06, P.woodD, { y: 0.45, z: 1.75 });
    b.box(0.8, 0.06, 0.1, P.woodD, { x: 1.1, y: 0.62, z: 0.95 });
    for (let k = 0; k < 4; k++) b.box(0.03, 0.9, 0.03, P.wood, { x: 0.8 + k * 0.2, y: 0.5, z: 0.92, rx: 0.15 });
    flag(b, -1.5, 0.15, 1.2, 2.0, 0.85);
    return b.geometry();
  }
  function stable() {
    const b = new MB();
    b.box(3.8, 0.12, 3.8, "#8a7a5a", { y: 0.06 });
    b.box(3.0, 1.4, 2.2, "#8a5a34", { y: 0.82, z: -0.6 });
    b.roof(3.3, 1.0, 2.6, "#5b3c2a", { y: 1.52, z: -0.6 });
    b.box(1.0, 1.0, 0.06, "#4a2e1c", { y: 0.62, z: 0.52 });
    b.box(1.0, 0.06, 0.07, P.white, { y: 0.62, z: 0.56, rz: 0.75 }); b.box(1.0, 0.06, 0.07, P.white, { y: 0.62, z: 0.56, rz: -0.75 });
    b.box(3.2, 0.2, 0.08, P.team, { y: 1.45, z: 0.52, team: 1 });
    b.cyl(0.32, 0.32, 0.6, 10, P.straw, { x: 1.3, y: 0.32, z: 1.1, rz: Math.PI / 2 });
    b.cyl(0.32, 0.32, 0.6, 10, P.straw, { x: 1.2, y: 0.32, z: 1.6, rz: Math.PI / 2, ry: 0.5 });
    for (let k = 0; k < 5; k++) b.box(0.08, 0.45, 0.08, P.woodD, { x: -1.7, y: 0.27, z: 0.6 + k * 0.32 });
    flag(b, -1.4, 0.12, 1.6, 1.7, 0.7);
    return b.geometry();
  }
  function foundry() {
    const b = new MB();
    b.box(3.8, 0.14, 3.8, "#6e665c", { y: 0.07 });
    b.box(2.8, 1.6, 2.2, "#7b4a3a", { x: -0.3, y: 0.94, z: -0.5 });
    b.roof(3.0, 0.8, 2.5, P.roofS, { x: -0.3, y: 1.74, z: -0.5 });
    b.box(0.6, 3.6, 0.6, P.brick, { x: 1.3, y: 1.9, z: -1.1 });
    b.box(0.7, 0.15, 0.7, P.stoneD, { x: 1.3, y: 3.75, z: -1.1 });
    b.box(1.0, 0.8, 0.06, "#2a1a12", { x: -0.3, y: 0.55, z: 0.62 });
    b.box(1.0, 0.25, 0.05, "#ff8a3a", { x: -0.3, y: 0.3, z: 0.63 });
    b.box(2.6, 0.18, 0.08, P.team, { x: -0.3, y: 1.6, z: 0.63, team: 1 });
    b.cyl(0.11, 0.15, 1.2, 10, "#b88a3e", { x: 0.6, y: 0.3, z: 1.2, rz: Math.PI / 2 - 0.1, ry: 0.4 });
    for (let k = 0; k < 5; k++) b.ball(0.1, "#2b2b2b", { x: -1.4 + (k % 3) * 0.2, y: 0.2 + (k > 2 ? 0.16 : 0), z: 1.2 + (k > 2 ? 0.1 : 0) });
    flag(b, -1.6, 0.14, 1.5, 1.8, 0.7);
    return b.geometry();
  }
  function outpost() {
    const b = new MB();
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) b.box(0.14, 2.6, 0.14, P.woodD, { x, y: 1.3, z });
    b.box(1.5, 0.12, 1.5, P.wood, { y: 2.4 });
    b.box(1.5, 0.4, 0.06, P.wood, { y: 2.65, z: 0.72 }); b.box(1.5, 0.4, 0.06, P.wood, { y: 2.65, z: -0.72 });
    b.box(0.06, 0.4, 1.5, P.wood, { x: 0.72, y: 2.65 }); b.box(0.06, 0.4, 1.5, P.wood, { x: -0.72, y: 2.65 });
    b.cone(1.15, 0.8, 4, P.thatch, { y: 3.55, ry: Math.PI / 4 });
    for (const x of [-0.4, 0.4]) b.box(0.08, 0.8, 0.08, P.woodD, { x, y: 3.0, z: 0.68 });
    b.box(1.4, 0.06, 0.06, P.woodD, { y: 1.2, z: 0.6, rz: 0.9 }); b.box(1.4, 0.06, 0.06, P.woodD, { y: 1.2, z: 0.6, rz: -0.9 });
    flag(b, 0.55, 3.55, 0.55, 1.0, 0.5);
    return b.geometry();
  }
  function scaffold(size) {
    const b = new MB(), s = size / 2 - 0.15;
    b.box(size - 0.1, 0.08, size - 0.1, "#9a8a6a", { y: 0.04 });
    for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]]) b.box(0.1, 1.6, 0.1, "#b08a58", { x, y: 0.8, z });
    for (const z of [-s, s]) b.box(size - 0.2, 0.07, 0.07, "#b08a58", { y: 1.2, z });
    for (const x of [-s, s]) b.box(0.07, 0.07, size - 0.2, "#b08a58", { x, y: 0.6 });
    return b.geometry();
  }
  function rubble(size) {
    const b = new MB();
    for (let k = 0; k < 8 + size * 2; k++) { const a = k * 2.39, r = (k % 5) / 5 * size * 0.42; b.dodec(0.2 + (k % 3) * 0.1, k % 2 ? "#5a524a" : "#3c3631", { x: Math.cos(a) * r, y: 0.1, z: Math.sin(a) * r, sy: 0.6 }); }
    return b.geometry();
  }

  return {
    MB,
    units: { villager, musketeer, pikeman, hussar, falconet, deer },
    resources: { pine, oak, stump, bush, goldmine },
    buildings: { towncenter, house, mill, barracks, stable, foundry, outpost },
    millBlades, scaffold, rubble,
  };
}
