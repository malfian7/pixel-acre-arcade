// Frontier Crown — procedural low-poly models. Each model is ONE merged BufferGeometry with
// vertex colours + per-vertex attributes (aTeam: tint by team; aPart/aPivot/aPivot2: articulated
// body parts posed in the vertex shader, see anim.js), so every model type is a single InstancedMesh.

import { PART } from "./anim.js";

export function createModels(THREE) {
  const V = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S3 = new THREE.Vector3(), M = new THREE.Matrix4();
  const col = new THREE.Color();

  class MB {
    constructor() { this.pos = []; this.col = []; this.team = []; this.part = []; this.piv = []; this.piv2 = []; this.rigged = false; }
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
        this.team.push(o.team || 0); this.part.push(o.part || 0);
        const pv = o.pivot || [0, 0, 0], p2 = o.pivot2 || [0, 0, 0, 0];
        this.piv.push(pv[0], pv[1], pv[2]); this.piv2.push(p2[0], p2[1], p2[2], p2[3]);
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
      if (this.part.some((v) => v !== 0)) {
        g.setAttribute("aPivot", new THREE.Float32BufferAttribute(this.piv, 3));
        g.setAttribute("aPivot2", new THREE.Float32BufferAttribute(this.piv2, 4));
      }
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

  // ------------------------------------------------------------------ units (articulated)
  // Human rig helper: hip height, shoulder height/width. Parts: legs pivot at the hip; torso (with head)
  // pivots at the hip; arms at the shoulders; hand-held items at the grip and chain through the arm.
  function rig(hipY, shY, shX) {
    const hip = [0, hipY, 0], sR = [shX, shY, 0], sL = [-shX, shY, 0];
    return {
      torso: (o = {}) => ({ part: PART.TORSO, pivot: hip, pivot2: [0, 0, 0, hipY], ...o }),
      legL: (x) => ({ part: PART.LEG_L, pivot: [x, hipY, 0] }), legR: (x) => ({ part: PART.LEG_R, pivot: [x, hipY, 0] }),
      armR: (o = {}) => ({ part: PART.ARM_R, pivot: sR, pivot2: [0, 0, 0, hipY], ...o }),
      armL: (o = {}) => ({ part: PART.ARM_L, pivot: sL, pivot2: [0, 0, 0, hipY], ...o }),
      inR: (part, grip, o = {}) => ({ part, pivot: grip, pivot2: [sR[0], sR[1], sR[2], hipY], ...o }),
      inL: (part, grip, o = {}) => ({ part, pivot: grip, pivot2: [sL[0], sL[1], sL[2], hipY], ...o }),
      onTorso: (part, o = {}) => ({ part, pivot: hip, pivot2: [0, 0, 0, hipY], ...o }),
    };
  }
  function humanLegs(b, R, col, hipY, sep, w = 0.13) {
    b.box(w, hipY - 0.02, 0.14, col, { x: -sep, y: hipY / 2 + 0.01, ...R.legL(-sep) });
    b.box(w, hipY - 0.02, 0.14, col, { x: sep, y: hipY / 2 + 0.01, ...R.legR(sep) });
    b.box(w + 0.01, 0.08, 0.2, P.boot, { x: -sep, y: 0.04, z: 0.03, ...R.legL(-sep) });
    b.box(w + 0.01, 0.08, 0.2, P.boot, { x: sep, y: 0.04, z: 0.03, ...R.legR(sep) });
  }
  function villager(lod) {
    const b = new MB(), R = rig(0.42, 0.77, 0.215);
    if (lod) { humanLegs(b, R, P.trousers, 0.42, 0.085, 0.14); b.box(0.36, 0.38, 0.22, P.team, { y: 0.6, team: 1 }); b.ball(0.12, P.skin, { y: 0.9 }); b.cyl(0.17, 0.17, 0.04, 8, P.straw, { y: 0.99 }); return b.geometry(); }
    humanLegs(b, R, P.trousers, 0.42, 0.085);
    b.box(0.35, 0.05, 0.21, P.woodD, { y: 0.44 });
    b.box(0.34, 0.34, 0.2, P.team, { y: 0.61, team: 1, ...R.torso() });
    b.ball(0.115, P.skin, { y: 0.9, ...R.torso() }, 1);
    b.cyl(0.18, 0.18, 0.03, 10, P.straw, { y: 0.98, ...R.torso() });
    b.cyl(0.095, 0.11, 0.1, 8, P.straw, { y: 1.03, ...R.torso() });
    b.box(0.09, 0.3, 0.1, P.team, { x: 0.215, y: 0.63, team: 1, ...R.armR() });
    b.ball(0.055, P.skin, { x: 0.215, y: 0.46, ...R.armR() });
    b.box(0.09, 0.3, 0.1, P.team, { x: -0.215, y: 0.63, team: 1, ...R.armL() });
    b.ball(0.055, P.skin, { x: -0.215, y: 0.46, ...R.armL() });
    const gR = [0.215, 0.45, 0.02], gL = [-0.215, 0.45, 0.02];
    // tools hang from the right hand as an extension of the arm (shown only while working)
    b.box(0.035, 0.44, 0.035, P.wood, { x: 0.215, y: 0.24, z: 0.03, ...R.inR(PART.AXE, gR) });
    b.box(0.03, 0.1, 0.15, P.steel, { x: 0.215, y: 0.06, z: 0.1, ...R.inR(PART.AXE, gR) });
    b.box(0.03, 0.46, 0.03, P.wood, { x: 0.215, y: 0.23, z: 0.02, ...R.inR(PART.PICK, gR) });
    b.box(0.035, 0.045, 0.36, P.steel, { x: 0.215, y: 0.03, z: 0.02, rx: 0.15, ...R.inR(PART.PICK, gR) });
    b.box(0.03, 0.26, 0.03, P.wood, { x: 0.215, y: 0.33, z: 0.02, ...R.inR(PART.HAMMER, gR) });
    b.box(0.06, 0.06, 0.13, "#5d5f63", { x: 0.215, y: 0.21, z: 0.04, ...R.inR(PART.HAMMER, gR) });
    b.box(0.03, 0.62, 0.03, P.wood, { x: 0.215, y: 0.15, z: 0.02, ...R.inR(PART.HOE, gR) });
    b.box(0.13, 0.02, 0.12, P.steel, { x: 0.215, y: -0.16, z: 0.07, ...R.inR(PART.HOE, gR) });
    b.cyl(0.11, 0.08, 0.13, 8, P.straw, { x: -0.215, y: 0.37, z: 0.06, ...R.inL(PART.BASKET, gL) });
    b.ball(0.05, "#c3263c", { x: -0.2, y: 0.44, z: 0.06, ...R.inL(PART.BASKET, gL) });
    // carried loads ride on the torso
    b.cyl(0.07, 0.07, 0.62, 7, "#7a5432", { x: 0.18, y: 0.86, z: 0.0, rx: Math.PI / 2, ...R.onTorso(PART.LOG) });
    b.ball(0.13, "#b8a070", { x: 0.0, y: 0.72, z: -0.17, sy: 1.2, ...R.onTorso(PART.SACK) });
    b.ball(0.04, "#efc443", { x: 0.0, y: 0.86, z: -0.17, ...R.onTorso(PART.SACK) });
    return b.geometry();
  }
  function musketeer(lod) {
    const b = new MB(), R = rig(0.44, 0.83, 0.225);
    if (lod) { humanLegs(b, R, P.white, 0.44, 0.085, 0.14); b.box(0.38, 0.44, 0.24, P.team, { y: 0.66, team: 1 }); b.ball(0.12, P.skin, { y: 0.97 }); b.cone(0.18, 0.12, 3, P.black, { y: 1.08 }); b.box(0.04, 1.0, 0.04, P.wood, { x: 0.23, y: 0.76 }); return b.geometry(); }
    humanLegs(b, R, P.white, 0.44, 0.085);
    b.box(0.13, 0.16, 0.15, P.black, { x: -0.085, y: 0.12, ...R.legL(-0.085) });
    b.box(0.13, 0.16, 0.15, P.black, { x: 0.085, y: 0.12, ...R.legR(0.085) });
    b.box(0.34, 0.2, 0.06, P.teamD, { y: 0.42, z: -0.1, team: 1 });
    b.box(0.36, 0.42, 0.22, P.team, { y: 0.66, team: 1, ...R.torso() });
    b.box(0.37, 0.04, 0.23, P.white, { y: 0.66, rz: 0.75, ...R.torso() });
    b.box(0.37, 0.04, 0.23, P.white, { y: 0.66, rz: -0.75, ...R.torso() });
    b.ball(0.115, P.skin, { y: 0.97, ...R.torso() }, 1);
    b.cone(0.2, 0.13, 3, P.black, { y: 1.09, ry: 0.5, ...R.torso() });
    b.box(0.09, 0.32, 0.1, P.team, { x: 0.225, y: 0.68, team: 1, ...R.armR() });
    b.ball(0.05, P.skin, { x: 0.225, y: 0.51, ...R.armR() });
    b.box(0.09, 0.32, 0.1, P.team, { x: -0.225, y: 0.68, team: 1, ...R.armL() });
    b.ball(0.05, P.skin, { x: -0.225, y: 0.51, ...R.armL() });
    // musket: grip in the right hand, stock below, barrel above (rest = upright at the side)
    const g = [0.225, 0.5, 0.06];
    b.box(0.045, 0.42, 0.06, P.wood, { x: 0.225, y: 0.42, z: 0.06, ...R.inR(PART.WEAPON, g) });
    b.box(0.03, 0.62, 0.03, P.wood, { x: 0.225, y: 0.92, z: 0.06, ...R.inR(PART.WEAPON, g) });
    b.box(0.02, 0.6, 0.02, P.steel, { x: 0.225, y: 1.05, z: 0.08, ...R.inR(PART.WEAPON, g) });
    b.box(0.012, 0.16, 0.012, "#d6dbe0", { x: 0.225, y: 1.42, z: 0.08, ...R.inR(PART.WEAPON, g) });
    return b.geometry();
  }
  // Grenadier: mitre cap, musket slung across the back, a fused grenade appears in the right hand to throw.
  function grenadier(lod) {
    const b = new MB(), R = rig(0.44, 0.83, 0.225);
    if (lod) { humanLegs(b, R, P.white, 0.44, 0.085, 0.14); b.box(0.38, 0.44, 0.24, P.team, { y: 0.66, team: 1 }); b.ball(0.12, P.skin, { y: 0.97 }); b.cone(0.13, 0.36, 4, P.team, { y: 1.22, team: 1 }); return b.geometry(); }
    humanLegs(b, R, P.white, 0.44, 0.085);
    b.box(0.13, 0.16, 0.15, P.black, { x: -0.085, y: 0.12, ...R.legL(-0.085) });
    b.box(0.13, 0.16, 0.15, P.black, { x: 0.085, y: 0.12, ...R.legR(0.085) });
    b.box(0.36, 0.42, 0.22, P.team, { y: 0.66, team: 1, ...R.torso() });
    b.box(0.37, 0.05, 0.23, P.white, { y: 0.66, rz: 0.75, ...R.torso() });
    b.box(0.37, 0.05, 0.23, P.white, { y: 0.66, rz: -0.75, ...R.torso() });
    b.box(0.13, 0.12, 0.08, "#3a2a1c", { x: -0.17, y: 0.47, z: -0.07, ...R.torso() });          // grenade pouch
    b.ball(0.115, P.skin, { y: 0.97, ...R.torso() }, 1);
    b.cone(0.13, 0.38, 4, P.team, { y: 1.24, ry: Math.PI / 4, team: 1, ...R.torso() });          // mitre cap
    b.box(0.2, 0.2, 0.02, P.brass, { y: 1.16, z: 0.08, rx: -0.2, ...R.torso() });                 // brass front plate
    b.ball(0.035, P.white, { y: 1.44, ...R.torso() });
    // musket slung across the back
    b.box(0.03, 1.15, 0.03, P.wood, { y: 0.78, z: -0.14, rz: 0.55, ...R.torso() });
    b.box(0.018, 0.5, 0.018, P.steel, { x: -0.22, y: 1.1, z: -0.15, rz: 0.55, ...R.torso() });
    b.box(0.09, 0.32, 0.1, P.team, { x: 0.225, y: 0.68, team: 1, ...R.armR() });
    b.ball(0.05, P.skin, { x: 0.225, y: 0.51, ...R.armR() });
    b.box(0.09, 0.32, 0.1, P.team, { x: -0.225, y: 0.68, team: 1, ...R.armL() });
    b.ball(0.05, P.skin, { x: -0.225, y: 0.51, ...R.armL() });
    const g = [0.225, 0.48, 0.05];
    b.ball(0.075, "#26292c", { x: 0.225, y: 0.43, z: 0.06, ...R.inR(PART.GRENADE, g) }, 1);
    b.box(0.015, 0.07, 0.015, "#d9a441", { x: 0.225, y: 0.52, z: 0.06, ...R.inR(PART.GRENADE, g) });
    return b.geometry();
  }
  // Skirmisher: dark-green coat with team sash and cuffs, long rifle, cocked hat.
  function skirmisher(lod) {
    const b = new MB(), R = rig(0.44, 0.83, 0.225), coat = "#3f5a35";
    if (lod) { humanLegs(b, R, "#6a5a40", 0.44, 0.085, 0.14); b.box(0.38, 0.44, 0.24, coat, { y: 0.66 }); b.box(0.39, 0.1, 0.25, P.team, { y: 0.55, team: 1 }); b.ball(0.12, P.skin, { y: 0.97 }); b.cone(0.18, 0.12, 3, P.black, { y: 1.08 }); b.box(0.04, 1.1, 0.04, P.woodD, { x: 0.23, y: 0.8 }); return b.geometry(); }
    humanLegs(b, R, "#6a5a40", 0.44, 0.085);
    b.box(0.36, 0.42, 0.22, coat, { y: 0.66, ...R.torso() });
    b.box(0.37, 0.07, 0.23, P.team, { y: 0.52, team: 1, ...R.torso() });                         // sash
    b.box(0.37, 0.04, 0.23, P.team, { y: 0.7, rz: 0.75, team: 1, ...R.torso() });
    b.box(0.08, 0.1, 0.06, "#3a2a1c", { x: 0.15, y: 0.5, z: -0.12, ...R.torso() });             // powder horn
    b.ball(0.115, P.skin, { y: 0.97, ...R.torso() }, 1);
    b.cone(0.21, 0.13, 3, P.black, { y: 1.09, ry: 0.5, ...R.torso() });
    b.box(0.2, 0.025, 0.02, P.team, { y: 1.06, z: 0.12, team: 1, ...R.torso() });
    b.box(0.09, 0.32, 0.1, coat, { x: 0.225, y: 0.68, ...R.armR() });
    b.box(0.095, 0.06, 0.105, P.team, { x: 0.225, y: 0.55, team: 1, ...R.armR() });
    b.ball(0.05, P.skin, { x: 0.225, y: 0.51, ...R.armR() });
    b.box(0.09, 0.32, 0.1, coat, { x: -0.225, y: 0.68, ...R.armL() });
    b.box(0.095, 0.06, 0.105, P.team, { x: -0.225, y: 0.55, team: 1, ...R.armL() });
    b.ball(0.05, P.skin, { x: -0.225, y: 0.51, ...R.armL() });
    const g = [0.225, 0.5, 0.06];
    b.box(0.045, 0.4, 0.06, P.woodD, { x: 0.225, y: 0.43, z: 0.06, ...R.inR(PART.WEAPON, g) });
    b.box(0.03, 0.75, 0.03, P.woodD, { x: 0.225, y: 0.98, z: 0.06, ...R.inR(PART.WEAPON, g) });
    b.box(0.022, 0.78, 0.022, "#5d6066", { x: 0.225, y: 1.12, z: 0.08, ...R.inR(PART.WEAPON, g) });
    return b.geometry();
  }
  function pikeman(lod) {
    const b = new MB(), R = rig(0.44, 0.83, 0.225);
    if (lod) { humanLegs(b, R, P.team, 0.44, 0.085, 0.14); b.box(0.38, 0.44, 0.24, P.steel, { y: 0.66 }); b.ball(0.13, P.steel, { y: 0.98 }); b.box(0.03, 2.3, 0.03, P.wood, { x: 0.23, y: 1.25 }); return b.geometry(); }
    b.box(0.13, 0.42, 0.14, P.team, { x: -0.085, y: 0.23, team: 1, ...R.legL(-0.085) });
    b.box(0.13, 0.42, 0.14, P.team, { x: 0.085, y: 0.23, team: 1, ...R.legR(0.085) });
    b.box(0.14, 0.08, 0.2, P.boot, { x: -0.085, y: 0.04, z: 0.03, ...R.legL(-0.085) });
    b.box(0.14, 0.08, 0.2, P.boot, { x: 0.085, y: 0.04, z: 0.03, ...R.legR(0.085) });
    b.box(0.36, 0.42, 0.22, P.team, { y: 0.65, team: 1, ...R.torso() });
    b.box(0.38, 0.3, 0.24, P.steel, { y: 0.72, ...R.torso() });
    b.ball(0.11, P.skin, { y: 0.97, ...R.torso() }, 1);
    b.ball(0.13, P.steel, { y: 1.04, sy: 0.75, ...R.torso() });
    b.cyl(0.2, 0.2, 0.03, 10, P.steel, { y: 1.0, ...R.torso() });
    b.box(0.09, 0.32, 0.1, P.team, { x: 0.225, y: 0.68, team: 1, ...R.armR() });
    b.ball(0.05, P.skin, { x: 0.225, y: 0.51, ...R.armR() });
    b.box(0.09, 0.32, 0.1, P.team, { x: -0.225, y: 0.68, team: 1, ...R.armL() });
    b.ball(0.05, P.skin, { x: -0.225, y: 0.51, ...R.armL() });
    const g = [0.225, 0.5, 0.05];
    b.box(0.03, 2.4, 0.03, P.wood, { x: 0.225, y: 1.2, z: 0.05, ...R.inR(PART.WEAPON, g) });
    b.cone(0.04, 0.22, 4, P.steel, { x: 0.225, y: 2.5, z: 0.05, ...R.inR(PART.WEAPON, g) });
    return b.geometry();
  }
  function horse(b, lod) {
    const brown = "#6b4a2e", dark = "#3d2a1b";
    const neck = { part: PART.NECK, pivot: [0, 0.98, 0.42] };
    b.box(0.34, 0.36, 0.95, brown, { y: 0.8 });
    b.box(0.22, 0.42, 0.24, brown, { y: 1.05, z: 0.5, rx: -0.5, ...neck });
    b.box(0.17, 0.18, 0.36, brown, { y: 1.22, z: 0.7, rx: 0.3, ...neck });
    b.box(0.05, 0.3, 0.12, dark, { y: 1.12, z: 0.42, rx: -0.5, ...neck });
    b.box(0.08, 0.36, 0.08, dark, { y: 0.72, z: -0.52, rx: 0.4 });
    b.box(0.36, 0.12, 0.5, P.team, { y: 1.0, team: 1 });
    if (lod) { b.box(0.3, 0.6, 0.85, brown, { y: 0.3 }); return; }
    const L = (x, z, part) => { const pv = { part, pivot: [x, 0.64, z] }; b.box(0.09, 0.6, 0.1, brown, { x, y: 0.32, z, ...pv }); b.box(0.1, 0.06, 0.12, dark, { x, y: 0.03, z, ...pv }); };
    L(-0.12, 0.36, PART.HFL); L(0.12, 0.36, PART.HFR); L(-0.12, -0.36, PART.HBL); L(0.12, -0.36, PART.HBR);
  }
  function hussar(lod) {
    const b = new MB(), R = rig(1.12, 1.47, 0.2);
    horse(b, lod);
    b.box(0.1, 0.32, 0.12, P.white, { x: -0.16, y: 1.0, z: 0.08 });
    b.box(0.1, 0.32, 0.12, P.white, { x: 0.16, y: 1.0, z: 0.08 });
    b.box(0.32, 0.4, 0.22, P.team, { y: 1.3, team: 1, ...R.torso() });
    b.ball(0.11, P.skin, { y: 1.6, ...R.torso() }, lod ? 0 : 1);
    b.cyl(0.12, 0.11, 0.2, 8, P.black, { y: 1.74, ...R.torso() });
    if (!lod) {
      b.box(0.04, 0.18, 0.04, P.team, { x: 0.06, y: 1.88, team: 1, ...R.torso() });
      b.box(0.08, 0.3, 0.1, P.team, { x: -0.2, y: 1.33, team: 1, ...R.armL() });
      b.box(0.08, 0.3, 0.1, P.team, { x: 0.2, y: 1.33, team: 1, ...R.armR() });
      b.ball(0.045, P.skin, { x: 0.2, y: 1.17, ...R.armR() });
      const g = [0.2, 1.17, 0.04];
      b.box(0.025, 0.7, 0.05, P.steel, { x: 0.2, y: 1.52, z: 0.04, ...R.inR(PART.WEAPON, g) });
      b.box(0.08, 0.025, 0.06, P.brass, { x: 0.2, y: 1.18, z: 0.04, ...R.inR(PART.WEAPON, g) });
    }
    return b.geometry();
  }
  function falconet(lod) {
    const b = new MB();
    const wheel = (x) => {
      const pv = { part: PART.WHEEL, pivot: [x, 0.33, 0] };
      b.cyl(0.33, 0.33, 0.07, lod ? 8 : 12, P.woodD, { x, y: 0.33, rz: Math.PI / 2, ...pv });
      if (!lod) for (let k = 0; k < 3; k++) b.box(0.075, 0.6, 0.04, P.wood, { x, y: 0.33, rx: k * Math.PI / 3, ...pv });
    };
    wheel(-0.32); wheel(0.32);
    b.box(0.5, 0.12, 0.12, P.woodD, { y: 0.33 });
    b.box(0.3, 0.16, 0.9, P.wood, { y: 0.42, z: -0.18, rx: -0.12 });
    b.box(0.12, 0.08, 0.7, P.wood, { y: 0.15, z: -0.75, rx: -0.3 });
    const brl = { part: PART.BARREL, pivot: [0, 0.6, -0.05] };
    b.cyl(0.07, 0.1, 1.05, 10, "#b88a3e", { y: 0.6, z: 0.18, rx: Math.PI / 2 - 0.12, ...brl });
    b.ball(0.1, "#b88a3e", { y: 0.62, z: -0.32, ...brl });
    if (!lod) {
      const R = rig(0.4, 0.74, 0.18), off = (o) => { o.pivot = [o.pivot[0] + 0.635, o.pivot[1], o.pivot[2] - 0.55]; if (o.pivot2) o.pivot2 = [o.pivot2[0] + 0.635, o.pivot2[1], o.pivot2[2] - 0.55, o.pivot2[3]]; return o; };
      b.box(0.11, 0.38, 0.13, P.white, { x: 0.55, y: 0.19, z: -0.55 });
      b.box(0.11, 0.38, 0.13, P.white, { x: 0.72, y: 0.19, z: -0.55 });
      b.box(0.32, 0.4, 0.2, P.team, { x: 0.635, y: 0.58, z: -0.55, team: 1 });
      b.ball(0.1, P.skin, { x: 0.635, y: 0.88, z: -0.55 });
      b.cone(0.17, 0.12, 3, P.black, { x: 0.635, y: 0.99, z: -0.55 });
      b.box(0.08, 0.3, 0.09, P.team, { x: 0.815, y: 0.6, z: -0.55, team: 1, ...off(R.armR()) });
      b.box(0.03, 0.8, 0.03, P.wood, { x: 0.83, y: 0.6, z: -0.45, rx: 0.3 });
    }
    return b.geometry();
  }
  function deer() {
    const b = new MB(), tan = "#a87b4f", pale = "#e3cfae";
    const neck = { part: PART.NECK, pivot: [0, 0.76, 0.3] };
    b.box(0.26, 0.3, 0.72, tan, { y: 0.65 });
    b.box(0.22, 0.12, 0.5, pale, { y: 0.52 });
    b.box(0.13, 0.32, 0.14, tan, { y: 0.88, z: 0.36, rx: -0.4, ...neck });
    b.box(0.12, 0.13, 0.24, tan, { y: 1.02, z: 0.48, ...neck });
    b.box(0.02, 0.22, 0.02, "#d9c9a8", { x: -0.06, y: 1.18, z: 0.44, rz: 0.4, ...neck });
    b.box(0.02, 0.22, 0.02, "#d9c9a8", { x: 0.06, y: 1.18, z: 0.44, rz: -0.4, ...neck });
    b.box(0.06, 0.08, 0.04, pale, { y: 0.72, z: -0.37 });
    const L = (x, z, part) => b.box(0.06, 0.5, 0.06, "#7c5838", { x, y: 0.25, z, part, pivot: [x, 0.5, z] });
    L(-0.09, 0.26, PART.HFL); L(0.09, 0.26, PART.HFR); L(-0.09, -0.26, PART.HBL); L(0.09, -0.26, PART.HBR);
    return b.geometry();
  }

  // Wolf: low grey quadruped on the deer rig (same leg/neck parts → same gait + a bite clip).
  function wolf() {
    const b = new MB(), fur = "#7a7670", dark = "#4f4b47", pale = "#b9b2a6";
    const neck = { part: PART.NECK, pivot: [0, 0.55, 0.28] };
    b.box(0.24, 0.24, 0.66, fur, { y: 0.5 });
    b.box(0.2, 0.08, 0.5, pale, { y: 0.39 });
    b.box(0.26, 0.22, 0.2, fur, { y: 0.58, z: 0.26 });                       // shoulders / ruff
    b.box(0.17, 0.17, 0.2, fur, { y: 0.66, z: 0.42, ...neck });              // head
    b.box(0.1, 0.09, 0.18, pale, { y: 0.62, z: 0.58, ...neck });             // snout
    b.box(0.05, 0.04, 0.04, "#1d1b1b", { y: 0.65, z: 0.67, ...neck });       // nose
    b.cone(0.045, 0.1, 4, dark, { x: -0.06, y: 0.79, z: 0.38, ...neck });    // ears
    b.cone(0.045, 0.1, 4, dark, { x: 0.06, y: 0.79, z: 0.38, ...neck });
    b.box(0.015, 0.03, 0.02, "#f0d070", { x: -0.05, y: 0.7, z: 0.52, ...neck });  // eyes
    b.box(0.015, 0.03, 0.02, "#f0d070", { x: 0.05, y: 0.7, z: 0.52, ...neck });
    b.box(0.08, 0.08, 0.36, dark, { y: 0.52, z: -0.46, rx: 0.5 });          // tail
    const L = (x, z, part) => b.box(0.06, 0.38, 0.07, dark, { x, y: 0.19, z, part, pivot: [x, 0.38, z] });
    L(-0.08, 0.24, PART.HFL); L(0.08, 0.24, PART.HFR); L(-0.08, -0.24, PART.HBL); L(0.08, -0.24, PART.HBR);
    return b.geometry();
  }
  // Bandit: patched coat, red bandana, wide hat, sabre.
  function bandit(lod) {
    const b = new MB(), R = rig(0.44, 0.83, 0.225), coat = "#5a4636";
    if (lod) { humanLegs(b, R, "#3f3a33", 0.44, 0.085, 0.14); b.box(0.38, 0.44, 0.24, coat, { y: 0.66 }); b.ball(0.12, P.skin2, { y: 0.97 }); b.cyl(0.22, 0.22, 0.04, 8, "#2d2621", { y: 1.07 }); return b.geometry(); }
    humanLegs(b, R, "#3f3a33", 0.44, 0.085);
    b.box(0.36, 0.42, 0.22, coat, { y: 0.66, ...R.torso() });
    b.box(0.37, 0.06, 0.23, P.team, { y: 0.48, team: 1, ...R.torso() });                       // sash (wild colour)
    b.box(0.12, 0.12, 0.02, "#7a6650", { x: 0.08, y: 0.72, z: 0.115, ...R.torso() });           // patch
    b.ball(0.115, P.skin2, { y: 0.97, ...R.torso() }, 1);
    b.box(0.24, 0.07, 0.03, "#b8352c", { y: 0.93, z: 0.1, ...R.torso() });                      // bandana
    b.cyl(0.23, 0.23, 0.03, 10, "#2d2621", { y: 1.06, ...R.torso() });
    b.cyl(0.12, 0.13, 0.12, 8, "#2d2621", { y: 1.12, ...R.torso() });
    b.box(0.09, 0.32, 0.1, coat, { x: 0.225, y: 0.68, ...R.armR() });
    b.ball(0.05, P.skin2, { x: 0.225, y: 0.51, ...R.armR() });
    b.box(0.09, 0.32, 0.1, coat, { x: -0.225, y: 0.68, ...R.armL() });
    b.ball(0.05, P.skin2, { x: -0.225, y: 0.51, ...R.armL() });
    const g = [0.225, 0.5, 0.05];
    b.box(0.03, 0.08, 0.06, P.brass, { x: 0.225, y: 0.5, z: 0.05, ...R.inR(PART.WEAPON, g) });
    b.box(0.02, 0.62, 0.05, P.steel, { x: 0.225, y: 0.84, z: 0.05, ...R.inR(PART.WEAPON, g) });
    return b.geometry();
  }
  // Explorer: long team coat, cocked hat with a feather, pistol, spyglass on the belt.
  function explorer(lod) {
    const b = new MB(), R = rig(0.45, 0.85, 0.225);
    if (lod) { humanLegs(b, R, "#d8c9a8", 0.45, 0.085, 0.14); b.box(0.4, 0.5, 0.26, P.team, { y: 0.62, team: 1 }); b.ball(0.12, P.skin, { y: 0.99 }); b.cone(0.2, 0.13, 3, "#2b2622", { y: 1.11 }); return b.geometry(); }
    humanLegs(b, R, "#d8c9a8", 0.45, 0.085);
    b.box(0.13, 0.2, 0.15, "#3a2a1c", { x: -0.085, y: 0.12, ...R.legL(-0.085) });                // riding boots
    b.box(0.13, 0.2, 0.15, "#3a2a1c", { x: 0.085, y: 0.12, ...R.legR(0.085) });
    b.box(0.38, 0.46, 0.23, P.team, { y: 0.66, team: 1, ...R.torso() });
    b.box(0.4, 0.26, 0.25, P.team, { y: 0.4, team: 1, ...R.torso() });                          // coat skirt
    b.box(0.39, 0.05, 0.24, "#6a4628", { y: 0.5, ...R.torso() });                               // belt
    b.cyl(0.03, 0.03, 0.22, 6, P.brass, { x: -0.16, y: 0.47, z: 0.1, rz: 1.3, ...R.torso() });  // spyglass
    b.box(0.2, 0.18, 0.02, "#efe3c4", { y: 0.72, z: 0.12, ...R.torso() });                      // shirt front
    b.ball(0.115, P.skin, { y: 0.99, ...R.torso() }, 1);
    b.cone(0.21, 0.13, 3, "#2b2622", { y: 1.11, ry: 0.5, ...R.torso() });
    b.box(0.02, 0.26, 0.06, "#f2ecdf", { x: -0.12, y: 1.2, z: -0.04, rz: 0.5, ...R.torso() });  // feather
    b.box(0.09, 0.32, 0.1, P.team, { x: 0.225, y: 0.7, team: 1, ...R.armR() });
    b.ball(0.05, P.skin, { x: 0.225, y: 0.53, ...R.armR() });
    b.box(0.09, 0.32, 0.1, P.team, { x: -0.225, y: 0.7, team: 1, ...R.armL() });
    b.ball(0.05, P.skin, { x: -0.225, y: 0.53, ...R.armL() });
    const g = [0.225, 0.52, 0.05];
    b.box(0.04, 0.1, 0.05, P.woodD, { x: 0.225, y: 0.5, z: 0.05, ...R.inR(PART.WEAPON, g) });
    b.box(0.025, 0.28, 0.025, "#5d6066", { x: 0.225, y: 0.66, z: 0.06, ...R.inR(PART.WEAPON, g) });
    return b.geometry();
  }

  // ------------------------------------------------------------------ resources
  // Treasure chest: iron-bound, lid ajar, coins and a gem spilling out.
  function chest() {
    const b = new MB(), wood = "#7a4f2c", iron = "#3e3f44", gold = "#efc443";
    b.box(0.7, 0.36, 0.46, wood, { y: 0.18 });
    for (const x of [-0.26, 0.26]) b.box(0.06, 0.38, 0.48, iron, { x, y: 0.19 });
    b.box(0.7, 0.16, 0.46, wood, { y: 0.45, z: -0.12, rx: -0.55 });          // lid, propped open
    b.box(0.6, 0.06, 0.38, gold, { y: 0.37 });
    for (let k = 0; k < 5; k++) b.cyl(0.05, 0.05, 0.02, 8, gold, { x: -0.22 + k * 0.11, y: 0.41 + (k % 2) * 0.02, z: 0.05 * (k % 3) });
    b.dodec(0.06, "#4ad1e0", { x: 0.12, y: 0.45, z: 0.08 });
    b.cyl(0.05, 0.05, 0.02, 8, gold, { x: 0.45, y: 0.01, z: 0.2 });
    b.cyl(0.05, 0.05, 0.02, 8, gold, { x: -0.42, y: 0.01, z: 0.28 });
    b.box(0.08, 0.1, 0.03, P.brass, { y: 0.24, z: 0.24 });                   // lock
    return b.geometry();
  }
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
  // Shipment crate (one per resource): planked box with iron bands, the cargo peeking out of the top.
  function crate(res) {
    const b = new MB(), plank = "#9c7445", dark = "#6e4e2c", band = "#4a4d52";
    b.box(0.72, 0.56, 0.72, plank, { y: 0.28 });
    for (const y of [0.1, 0.46]) { b.box(0.74, 0.05, 0.74, band, { y }); }
    for (const x of [-0.37, 0.37]) for (const z of [-0.37, 0.37]) b.box(0.06, 0.58, 0.06, dark, { x, y: 0.29, z });
    b.box(0.74, 0.04, 0.12, dark, { y: 0.28, z: 0.37, rz: 0.62 });
    b.box(0.74, 0.04, 0.12, dark, { y: 0.28, z: -0.37, rz: -0.62 });
    if (res === 0) { b.ball(0.16, "#cfb27a", { x: -0.12, y: 0.62, z: 0.05, sy: 0.8 }); b.ball(0.14, "#d9483b", { x: 0.15, y: 0.6, z: -0.08 }); b.ball(0.12, "#e0a33a", { x: 0.05, y: 0.62, z: 0.17 }); }
    else if (res === 1) { for (let k = 0; k < 3; k++) b.cyl(0.07, 0.07, 0.68, 7, "#8a5d36", { x: -0.16 + k * 0.16, y: 0.62, rz: Math.PI / 2 }); }
    else { b.box(0.5, 0.06, 0.5, "#e9b93a", { y: 0.59 }); for (let k = 0; k < 4; k++) b.cyl(0.06, 0.06, 0.04, 8, "#f3cf55", { x: -0.15 + (k % 2) * 0.3, y: 0.64, z: -0.12 + (k >> 1) * 0.24 }); }
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
    units: { villager, musketeer, pikeman, grenadier, skirmisher, explorer, bandit, hussar, falconet, deer, wolf },
    resources: { pine, oak, stump, bush, goldmine, crate, chest },
    buildings: { towncenter, house, mill, barracks, stable, foundry, outpost },
    millBlades, scaffold, rubble,
  };
}
