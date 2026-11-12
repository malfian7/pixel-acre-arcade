// Little Furrow — the day/night palette. Pure (no three.js), tested in node with the other farm tests.
//
// One key per moment of the day; everything between two keys is blended, so light changes gradually
// minute by minute rather than snapping:
//   dawn mist (pink, fog close)  →  bright morning  →  noon  →  golden afternoon  →  sunset
//   →  violet dusk (first stars)  →  deep blue night (moonlight, full stars)  →  pre-dawn
// Each key: hour, sky/fog colour, light colour, light intensity, hemisphere intensity, fog near, fog far,
// star alpha, warmth (0–1, tints the hemisphere ground colour and the lamps).
const KEYS = [
  [4.0,  "#141331", "#7f8cff", 0.42, 0.34, 18, 52, 1.0, 0],
  [5.4,  "#38325f", "#9c9cff", 0.40, 0.40, 16, 48, 0.7, 0],
  [6.3,  "#f0b6a4", "#ffb08a", 0.95, 0.70, 12, 42, 0.0, 0.5],
  [7.6,  "#cfe5f2", "#fff0dc", 2.00, 0.95, 20, 56, 0, 0.2],
  [9.0,  "#9fd3ff", "#fff8ec", 2.60, 1.05, 30, 68, 0, 0],
  [14.5, "#a6d6ff", "#fff3d8", 2.55, 1.00, 30, 68, 0, 0.1],
  [16.4, "#f6d494", "#ffd38c", 2.30, 0.95, 26, 62, 0, 0.7],
  [18.0, "#f3a56f", "#ffa05a", 1.60, 0.85, 22, 58, 0, 1],
  [19.2, "#a8628c", "#ff8466", 0.70, 0.62, 20, 54, 0.2, 0.8],
  [20.4, "#2e2a5c", "#8a96ff", 0.45, 0.42, 18, 52, 0.8, 0.2],
  [22.0, "#16153a", "#8193ff", 0.42, 0.34, 18, 52, 1.0, 0],
  [28.0, "#141331", "#7f8cff", 0.42, 0.34, 18, 52, 1.0, 0],
];
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const K = KEYS.map(([h, sky, light, li, hi, fn, ff, st, warm]) => ({ h, sky: hex(sky), light: hex(light), li, hi, fn, ff, st, warm }));
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const ease = (t) => t * t * (3 - 2 * t);

/**
 * hour: 0–28 (the day runs past midnight to the 2 AM pass-out). weather: "sun" | "rain" | "snow".
 * Returns colours as [r,g,b] 0–255 and the sun/moon direction (unit vector toward the light).
 */
export function skyAt(hour, weather = "sun") {
  let h = hour < 4 ? hour + 24 : hour;
  let i = 0; while (i < K.length - 2 && h > K[i + 1].h) i++;
  const a = K[i], b = K[i + 1], t = ease(Math.max(0, Math.min(1, (h - a.h) / (b.h - a.h))));
  const o = {
    sky: mix3(a.sky, b.sky, t), light: mix3(a.light, b.light, t), lightI: mix(a.li, b.li, t), hemiI: mix(a.hi, b.hi, t),
    fogNear: mix(a.fn, b.fn, t), fogFar: mix(a.ff, b.ff, t), stars: mix(a.st, b.st, t), warm: mix(a.warm, b.warm, t),
  };
  if (weather === "rain") { o.sky = mix3(o.sky, [125, 134, 152], 0.55); o.lightI *= 0.45; o.hemiI *= 0.9; o.fogNear *= 0.7; o.fogFar *= 0.8; o.stars *= 0.15; o.warm *= 0.3; }
  if (weather === "snow") { o.sky = mix3(o.sky, [207, 216, 230], 0.45); o.lightI *= 0.65; o.fogNear *= 0.8; o.fogFar *= 0.85; o.stars *= 0.3; }
  // the sun crosses east → west from 5:30 to 19:30; after that the moon does from 19:30 to 5:30
  const day = h >= 5.5 && h < 19.5;
  const p = day ? (h - 5.5) / 14 : ((h - 19.5 + 24) % 24) / 10;
  const ang = Math.max(0.08, Math.min(Math.PI - 0.08, p * Math.PI));
  const elev = day ? 0.25 + Math.sin(ang) * 0.95 : 0.55 + Math.sin(ang) * 0.6;
  const d = [Math.cos(ang), elev, 0.55]; const L = Math.hypot(...d);
  o.dir = [d[0] / L, d[1] / L, d[2] / L];
  // the light swaps from sun to moon at 5:30 and 19:30 — fade it out and back in around the swap so shadows never jump
  const edge = day ? Math.min(h - 5.5, 19.5 - h) : Math.min(((h - 19.5) + 24) % 24, ((29.5 - h) + 24) % 24);
  o.lightI *= Math.min(1, edge / 0.6);
  o.night = day ? 0 : 1;
  // how dark it is (lamps, windows, fireflies): 0 by day, 1 deep night
  o.dark = Math.max(0, Math.min(1, (o.stars - 0.05) / 0.8));
  return o;
}

export const toHex = (c) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
