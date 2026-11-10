// Frontier Crown — Heightmap: elevation data from an array or a grayscale image.
// Pure data (no Three.js) so the simulation can use it in Node, a Worker, or the browser.
//
//   const hm = Heightmap.fromArray(129, 129, floatArray);            // heights in world units
//   const hm = await Heightmap.fromImage("maps/highland-pass.png", { min: -1.6, max: 3.6, size: 129 });
//   hm.sample(x, z)  -> bilinear height at any point in vertex space
//   hm.data          -> Float32Array (w*h), row-major, row = z

export class Heightmap {
  constructor(w, h, data) {
    if (data.length !== w * h) throw new Error(`Heightmap: expected ${w * h} values, got ${data.length}`);
    this.w = w; this.h = h; this.data = data instanceof Float32Array ? data : Float32Array.from(data);
  }

  // From any numeric array. `scale`/`offset` remap raw values (e.g. 0..255 bytes) to world units.
  static fromArray(w, h, arr, { scale = 1, offset = 0 } = {}) {
    const d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = arr[i] * scale + offset;
    return new Heightmap(w, h, d);
  }

  // From a grayscale image (URL, HTMLImageElement, ImageBitmap or canvas). Black = min, white = max.
  // `size` resamples to a square vertex grid (e.g. 129 for a 128×128-tile map).
  static async fromImage(src, { min = 0, max = 1, size = 0, blur = 0 } = {}) {
    let img = src;
    if (typeof src === "string") {
      img = new Image(); img.decoding = "async"; img.src = src;
      await img.decode();
    }
    const w = size || img.width, h = size || img.height;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    if (blur) g.filter = `blur(${blur}px)`;
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data, d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) {
      const lum = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
      d[i] = min + lum * (max - min);
    }
    return new Heightmap(w, h, d);
  }

  get(i, j) { return this.data[Math.min(this.h - 1, Math.max(0, j)) * this.w + Math.min(this.w - 1, Math.max(0, i))]; }

  sample(x, z) {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    const a = this.get(i, j), b = this.get(i + 1, j), c = this.get(i, j + 1), d = this.get(i + 1, j + 1);
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  // Resample to a new vertex grid (bilinear).
  resample(w, h) {
    const d = new Float32Array(w * h), sx = (this.w - 1) / (w - 1), sz = (this.h - 1) / (h - 1);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) d[j * w + i] = this.sample(i * sx, j * sz);
    return new Heightmap(w, h, d);
  }

  range() { let lo = Infinity, hi = -Infinity; for (const v of this.data) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; }
}
