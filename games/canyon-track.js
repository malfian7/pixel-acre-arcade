// Canyon Circuit — track data and sampling. Pure math (no three.js) so it can be tested in Node.
// Map coordinates: X east, Y north. In the 3D world x = X, z = -Y.
//
// Each segment is a uniform Catmull-Rom spline through `pts`; the first and last points are phantom
// tangent controls (the drivable curve runs from pts[1] to pts[n-2]). Segments that meet share the
// neighbouring points, so tangents match at every junction, forks share their first stretch and
// merges share their last stretch.

export const SEGMENTS = [
  { id: "A", name: "Sunrise Straight", hw: 8, next: ["B1", "B2"],
    pts: [[0, -75], [0, 0], [0, 80], [5, 165], [25, 250], [65, 330], [125, 395], [195, 435], [270, 450], [345, 452]],
    h: [[0, 0], [0.3, 3], [0.62, 13], [0.82, 12], [1, 10]],
    pads: [0.16], wallride: [{ f0: 0.5, f1: 0.8, side: -1, R: 10 }] },
  { id: "B1", name: "Mesa Rim", hw: 8, next: ["C"], safe: true,
    pts: [[195, 435], [270, 450], [345, 452], [415, 480], [475, 535], [550, 570], [630, 565], [690, 520], [718, 455], [725, 385], [727, 315], [727, 245]],
    h: [[0, 10], [0.22, 10], [0.43, 19], [0.6, 21], [0.79, 6], [1, 6]],
    wallride: [{ f0: 0.3, f1: 0.66, side: -1, R: 11 }],
    rocks: [[0.42, 5.2, 1.6], [0.58, -5, 1.4], [0.74, 4.8, 1.5]] },
  { id: "B2", name: "Arch Gap", hw: 6.5, next: ["C"], shortcut: true,
    pts: [[195, 435], [270, 450], [345, 452], [425, 448], [505, 440], [585, 438], [650, 440], [695, 425], [725, 385], [727, 315], [727, 245]],
    h: [[0, 10], [0.255, 10], [0.31, 12], [0.5, 6], [0.62, 4], [0.78, 6], [1, 6]],
    jumps: [{ f: 0.33, ramp: 26, lift: 3.4, gap: 30 }], arch: 0.37 },
  { id: "C", name: "Rock Tunnel", hw: 8, next: ["D1", "D2"],
    pts: [[725, 385], [727, 315], [727, 245], [727, 165], [725, 85], [715, 10], [690, -55], [640, -100], [575, -115], [515, -110], [455, -95]],
    h: [[0, 6], [0.4, 6], [0.62, -2], [0.74, -3], [0.8, -1.2], [0.86, -3.5], [1, -6]],
    tunnel: [0.1, 0.36], pads: [0.04],
    wallride: [{ f0: 0.66, f1: 0.95, side: -1, R: 10 }] },
  { id: "D1", name: "Dry Riverbed", hw: 11, next: ["E"], safe: true, surface: "sand",
    pts: [[575, -115], [515, -110], [455, -95], [400, -125], [350, -170], [292, -205], [230, -200], [170, -172], [120, -170], [65, -178]],
    h: [[0, -6], [0.27, -6], [0.5, -16], [0.64, -15], [0.77, -10], [1, -10]],
    pads: [0.55], rocks: [[0.3, -4.5, 1.7], [0.4, 5, 1.8], [0.5, 0.5, 1.5], [0.62, -5.5, 1.9], [0.72, 3.5, 1.6]] },
  { id: "D2", name: "Cliff Ledge", hw: 6.5, next: ["E"], shortcut: true,
    pts: [[575, -115], [515, -110], [455, -95], [400, -76], [338, -70], [276, -92], [218, -138], [170, -172], [120, -170], [65, -178]],
    h: [[0, -6], [0.23, -6], [0.5, 6], [0.62, 4], [0.83, -10], [1, -10]],
    wallride: [{ f0: 0.24, f1: 0.74, side: 1, R: 13 }], open: [{ f0: 0.28, f1: 0.76, side: -1 }] },
  { id: "E", name: "Wash Jump", hw: 8, next: ["A"],
    pts: [[170, -172], [120, -170], [65, -178], [22, -160], [2, -120], [0, -75], [0, 0], [0, 80]],
    h: [[0, -10], [0.3, -13], [0.56, -11], [0.78, -5], [1, 0]],
    jumps: [{ f: 0.6, ramp: 24, lift: 2.6, gap: 16 }], pads: [0.47] },
];

// Checkpoints in race order; index 0 is the start/finish line. Only on segments every route uses.
export const CHECKPOINTS = [
  { seg: "A", f: 0.05, name: "Start / Finish" },
  { seg: "A", f: 0.78, name: "Mesa Fork" },
  { seg: "C", f: 0.55, name: "Tunnel Exit" },
  { seg: "E", f: 0.06, name: "Dry Wash" },
];


// ---------------------------------------------------------------- map 2: Dusk Mesa
// A sweeping start, a fork between the high Switchback Mesa and the Narrows Gap jump under a second
// arch, a long tunnel, and a sandy hairpin wash with a crest jump home.
const SEGMENTS2 = [
  { id: "A", name: "Dune Sprint", hw: 8, next: ["B1", "B2"],
    pts: [[0, -140], [0, -60], [0, 40], [12, 140], [45, 230], [110, 300], [200, 335], [290, 345], [370, 350]],
    h: [[0, 0], [0.35, 3], [0.72, 12], [0.86, 14], [1, 14]],
    pads: [0.2], wallride: [{ f0: 0.52, f1: 0.82, side: -1, R: 10 }] },
  { id: "B1", name: "Switchback Mesa", hw: 8, next: ["C"], safe: true,
    pts: [[200, 335], [290, 345], [370, 350], [440, 390], [485, 455], [550, 505], [630, 505], [685, 455], [702, 390], [702, 330], [700, 250], [692, 170]],
    h: [[0, 14], [0.2, 14], [0.42, 26], [0.6, 28], [0.8, 8], [1, 8]],
    wallride: [{ f0: 0.36, f1: 0.6, side: 1, R: 11 }],
    rocks: [[0.5, -4.8, 1.5], [0.66, 5, 1.5]] },
  { id: "B2", name: "Narrows Gap", hw: 6.5, next: ["C"], shortcut: true,
    pts: [[200, 335], [290, 345], [370, 350], [450, 346], [530, 342], [605, 350], [650, 366], [702, 330], [700, 250], [692, 170]],
    h: [[0, 14], [0.3, 14], [0.4, 15], [0.6, 7], [0.75, 8], [1, 8]],
    jumps: [{ f: 0.44, ramp: 24, lift: 3.2, gap: 26 }], arch: 0.47 },
  { id: "C", name: "Ember Tunnel", hw: 8, next: ["D"],
    pts: [[702, 330], [700, 250], [692, 170], [684, 80], [662, -10], [620, -90], [555, -150], [475, -180], [395, -185], [315, -175]],
    h: [[0, 8], [0.42, 8], [0.62, 0], [0.82, -4], [1, -6]],
    tunnel: [0.12, 0.38], pads: [0.05], wallride: [{ f0: 0.56, f1: 0.86, side: -1, R: 11 }] },
  { id: "D", name: "Hairpin Wash", hw: 10, next: ["A"], surface: "sand",
    pts: [[475, -180], [395, -185], [315, -175], [250, -140], [190, -160], [140, -220], [80, -268], [25, -245], [3, -195], [0, -140], [0, -60], [0, 40]],
    h: [[0, -6], [0.3, -10], [0.5, -12], [0.72, -6], [1, 0]],
    jumps: [{ f: 0.4, ramp: 22, lift: 2.4, gap: 14 }], pads: [0.62],
    rocks: [[0.22, -4.6, 1.7], [0.27, 5, 1.6], [0.56, -5, 1.8], [0.8, 4.5, 1.6]] },
];
const CHECKPOINTS2 = [
  { seg: "A", f: 0.05, name: "Start / Finish" },
  { seg: "A", f: 0.8, name: "Mesa Fork" },
  { seg: "C", f: 0.5, name: "Tunnel Exit" },
  { seg: "D", f: 0.3, name: "Wash" },
];

// Each map: its road network, checkpoints, medal times (seconds for 3 laps), and its light.
export const MAPS = [
  { id: "red-rock", name: "Red Rock Run", blurb: "Golden-hour canyon · 2 forks · Arch Gap · Cliff Ledge", segments: SEGMENTS, checkpoints: CHECKPOINTS,
    medals: [115, 124, 136],
    look: { sky: ["#d98c6a", "#ffc59a", "#f6b49a", "#d9a4b4", "#8d9fd6", "#4a68b8"], glow: "#fff1cf", fog: "#efb48f", clear: 0xf2c79a,
      hemi: [0xd9d4ff, 0xb5603a, 1.05], sunAz: 2.35, sunEl: 0.3, sunDrop: 0.06, sun: [1, 0.84, 0.64], sunEnd: [1, 0.76, 0.54], sunI: 3.3, exposure: 1.0 } },
  { id: "dusk-mesa", name: "Dusk Mesa", blurb: "Violet dusk · switchbacks · Narrows jump · hairpin wash", segments: SEGMENTS2, checkpoints: CHECKPOINTS2,
    medals: [105, 113, 124],
    look: { sky: ["#b0607a", "#ffad78", "#f5928a", "#c387ac", "#7266b0", "#34397a"], glow: "#ffe0b0", fog: "#e3a3a0", clear: 0xe3a3a0,
      hemi: [0xd6c4ff, 0xb0604e, 1.4], sunAz: 4.3, sunEl: 0.21, sunDrop: 0.05, sun: [1, 0.7, 0.5], sunEnd: [1, 0.6, 0.42], sunI: 3.2, exposure: 1.12 } },
];

export const SP = 2;                      // sample spacing (m)
export const BANK_R = 5;                  // default quarter-pipe radius at the road edge
export const BANK_MAX = 0.94;             // usable fraction of the radius (roll ~70°) before the hard wall
export const NO_GROUND = -1e4;

const smooth = (t) => t * t * (3 - 2 * t);
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}
function heightAt(keys, f) {
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [f0, h0] = keys[i], [f1, h1] = keys[i + 1];
    if (f <= f1) return h0 + (h1 - h0) * smooth((f - f0) / (f1 - f0));
  }
  return keys[keys.length - 1][1];
}

// Builds the sampled track: per segment, arrays of position, heading, height, width and bank radii.
export function buildTrack(list = SEGMENTS) {
  const segs = {};
  for (const def of list) {
    // dense polyline along the spline
    const dense = [];
    for (let i = 1; i < def.pts.length - 2; i++) {
      for (let k = 0; k < 40; k++) dense.push(catmull(def.pts[i - 1], def.pts[i], def.pts[i + 1], def.pts[i + 2], k / 40));
    }
    dense.push(def.pts[def.pts.length - 2]);
    const acc = [0];
    for (let i = 1; i < dense.length; i++) acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const len = acc[acc.length - 1], n = Math.floor(len / SP) + 1;
    const X = new Float64Array(n), Z = new Float64Array(n), Y = new Float64Array(n), TH = new Float64Array(n);
    const RL = new Float64Array(n), RR = new Float64Array(n), OPEN = new Int8Array(n), TUN = new Int8Array(n), HW = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.min(len, i * SP);
      while (j < acc.length - 2 && acc[j + 1] < s) j++;
      const t = (s - acc[j]) / Math.max(1e-6, acc[j + 1] - acc[j]);
      X[i] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * t;
      Z[i] = -(dense[j][1] + (dense[j + 1][1] - dense[j][1]) * t);
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      TH[i] = Math.atan2(X[b] - X[a], Z[b] - Z[a]);
      const f = i / (n - 1);
      Y[i] = heightAt(def.h, f);
      HW[i] = def.hw;
      RL[i] = RR[i] = BANK_R;
      for (const w of def.wallride || []) {
        const k = smooth(Math.min(1, Math.max(0, Math.min((f - w.f0) / 0.05, (w.f1 - f) / 0.05))));
        if (k > 0) { if (w.side < 0) RL[i] = BANK_R + (w.R - BANK_R) * k; else RR[i] = BANK_R + (w.R - BANK_R) * k; }
      }
      for (const o of def.open || []) if (f >= o.f0 && f <= o.f1) OPEN[i] = o.side;
      if (def.tunnel && f >= def.tunnel[0] && f <= def.tunnel[1]) TUN[i] = 1;
    }
    // jumps: a kicker ramp that ends in a gap (no ground), landing beyond
    const gaps = [];
    for (const jmp of def.jumps || []) {
      const lip = jmp.f * len, gap0 = lip, gap1 = lip + jmp.gap;
      for (let i = 0; i < n; i++) {
        const s = i * SP;
        if (s > lip - jmp.ramp && s <= lip) { const u = (s - (lip - jmp.ramp)) / jmp.ramp; Y[i] += jmp.lift * u * u; }
      }
      gaps.push({ s0: gap0, s1: gap1, land: gap1 + 12 });
    }
    segs[def.id] = { def, id: def.id, len, n, X, Y, Z, TH, RL, RR, OPEN, TUN, HW, gaps, next: [], prev: [], sib: [], mergeSib: [] };
  }
  for (const s of Object.values(segs)) {
    s.next = s.def.next.map((id) => segs[id]);
    for (const nx of s.next) nx.prev.push(s);
  }
  for (const s of Object.values(segs)) {
    // siblings share a start (fork) or an end (merge)
    for (const p of s.prev) for (const o of p.next) if (o !== s && !s.sib.includes(o)) s.sib.push(o);
    for (const nx of s.next) for (const o of nx.prev) if (o !== s && !s.mergeSib.includes(o)) s.mergeSib.push(o);
  }
  return segs;
}

// Height of the drivable surface at arc length s (no lateral profile); NO_GROUND inside a gap.
export function centerHeight(seg, s) {
  for (const g of seg.gaps) if (s > g.s0 && s < g.s1) return NO_GROUND;
  const f = Math.max(0, Math.min(seg.n - 1.0001, s / SP)), i = Math.floor(f), t = f - i;
  return seg.Y[i] + (seg.Y[i + 1] - seg.Y[i]) * t;
}
