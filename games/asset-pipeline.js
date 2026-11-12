// Pixel Acre Arcade — AssetPipeline: one THREE.LoadingManager for a page's assets, a real 0–100 %
// figure for the loading bar, and glTF/texture loaders with DRACO and KTX2 support.
//
//   const pipe = new AssetPipeline(THREE, renderer, { onProgress: (pct, label) => bar(pct, label) });
//   const build = pipe.stage("Building the valley", 2);      // non-network work, weighted
//   const tex = await pipe.texture("img/thumb-farm.jpg");    // byte progress; picks the manifest variant
//   const gltf = await pipe.gltf("models/cab.glb");          // DRACO / KTX2 inside the file just work
//   await pipe.compile(scene, camera);                       // shader warm-up as the last step
//
// How the percentage is computed: every part (a file, or a named stage) has a weight. Files weigh
// their byte size (from assets.json when known, else a guess) and report bytes as they stream in;
// stages report a fraction. pct = Σ weight·fraction / Σ weight, never moving backwards. Parts are
// registered as soon as they are known, so the denominator settles early instead of jumping.
//
// DRACO and KTX2 decoders are only downloaded when a file actually needs them: the GLTFLoader gets a
// DRACOLoader + KTX2Loader up front, but those fetch their WASM (≈75 KB / ≈260 KB gzipped) on first
// use. assets.json (written by tools/compress-assets.mjs) says which variant of each asset to serve —
// the tool only picks a DRACO/KTX2 variant when it saves more bytes than its decoder costs.

const ADDONS = new URL("../lib/addons/", import.meta.url).href;

export class LoadProgress {
  constructor(onChange) { this.parts = new Map(); this.onChange = onChange; this.shown = 0; this.label = ""; }
  /** Register a part; returns { set(fraction), done(), fail() }. */
  add(key, weight, label = key) {
    const part = this.parts.get(key) || { weight: 0, frac: 0, label };
    part.weight = Math.max(1e-6, weight); part.label = label;
    this.parts.set(key, part);
    const api = {
      set: (f) => { part.frac = Math.max(part.frac, Math.min(1, f)); this.label = label; this.emit(); },
      done: () => { part.frac = 1; this.emit(); },
      fail: () => { part.frac = 1; part.failed = true; this.emit(); },
      reweigh: (w) => { part.weight = Math.max(1e-6, w); this.emit(); },
    };
    this.emit();
    return api;
  }
  remove(key) { this.parts.delete(key); this.emit(); }
  get value() {
    let w = 0, d = 0;
    for (const p of this.parts.values()) { w += p.weight; d += p.weight * p.frac; }
    return w ? d / w : 0;
  }
  emit() {
    const v = Math.max(this.shown, this.value); // monotonic: new parts never pull the bar back
    this.shown = v;
    if (this.onChange) this.onChange(Math.round(v * 100), this.label, v);
  }
}

export class AssetPipeline {
  constructor(THREE, renderer, { onProgress, manifest = null, base = document.baseURI, progress } = {}) {
    this.THREE = THREE; this.r = renderer; this.base = base; this.manifest = manifest || {};
    this.progress = progress || new LoadProgress(onProgress);
    this.manager = new THREE.LoadingManager();
    this.items = { started: 0, loaded: 0, failed: [] };
    // item-level bookkeeping for every loader on this manager (decoders included)
    this.manager.onStart = (url, loaded, total) => { this.items.started = total; };
    this.manager.onProgress = (url, loaded, total) => { this.items.loaded = loaded; this.items.started = total; };
    this.manager.onError = (url) => { this.items.failed.push(url); console.warn("[assets] failed:", url); };
    this.prefer = new URLSearchParams(location.search).get("assets"); // ?assets=ktx2|draco|plain (testing)
  }

  /** Non-network work as a progress part. */
  stage(label, weight = 1) { return this.progress.add("stage:" + label, weight * 60e3, label); } // 1 ≈ 60 KB of download

  /** The manifest entry for a URL: { url, bytes, kind } of the variant to load. */
  resolve(url, kinds = null) {
    const e = this.manifest[url];
    if (!e) return { url, bytes: 0, kind: "plain" };
    let pick = e.use || "plain";
    if (this.prefer && e.variants && e.variants[this.prefer]) pick = this.prefer;
    if (kinds && !kinds.includes(pick)) pick = "plain";
    const v = pick === "plain" ? { url, bytes: e.bytes } : e.variants[pick];
    return { url: v.url, bytes: v.bytes || e.bytes || 0, kind: pick };
  }
  abs(url) { return new URL(url, this.base).href; }

  /** Lazily build the GLTF/DRACO/KTX2 loaders (their decoders download only when used). */
  async loaders() {
    if (this._loaders) return this._loaders;
    this._loaders = (async () => {
      const [{ GLTFLoader }, { DRACOLoader }, { KTX2Loader }] = await Promise.all([
        import(ADDONS + "loaders/GLTFLoader.js"), import(ADDONS + "loaders/DRACOLoader.js"), import(ADDONS + "loaders/KTX2Loader.js"),
      ]);
      const draco = new DRACOLoader(this.manager).setDecoderPath(ADDONS + "libs/draco/gltf/").setDecoderConfig({ type: "wasm" });
      const ktx2 = new KTX2Loader(this.manager).setTranscoderPath(ADDONS + "libs/basis/").detectSupport(this.r);
      const gltf = new GLTFLoader(this.manager).setDRACOLoader(draco).setKTX2Loader(ktx2);
      return { gltf, draco, ktx2 };
    })();
    return this._loaders;
  }

  /** Register files before loading them, so the percentage has its full denominator from the start. */
  expect(urls) { for (const u of urls) this.part(u); }
  part(url, guess = 120e3) {
    if (!this._parts) this._parts = new Map();
    if (!this._parts.has(url)) { const r = this.resolve(url); this._parts.set(url, this.progress.add("file:" + url, r.bytes || guess, url.split("/").pop())); }
    return this._parts.get(url);
  }

  /** glTF / GLB with DRACO and KTX2 support; byte progress from the loader. */
  async gltf(url) {
    const { gltf } = await this.loaders(), r = this.resolve(url, ["plain", "draco", "meshopt"]), part = this.part(url);
    try {
      const out = await gltf.loadAsync(this.abs(r.url), (e) => { if (e.total || r.bytes) part.set(e.loaded / (e.total || r.bytes)); });
      part.done(); return out;
    } catch (err) { part.fail(); throw err; }
  }

  /** A colour texture. KTX2 variant → KTX2Loader (GPU-compressed, transcoded in a worker);
   *  otherwise the image is streamed with byte progress and decoded off the main thread
   *  (createImageBitmap). Returns a THREE.Texture ready to assign. */
  async texture(url, { srgb = true, anisotropy = 4 } = {}) {
    const T = this.THREE, r = this.resolve(url, ["plain", "webp", "ktx2"]), part = this.part(url);
    try {
      let tex;
      if (r.kind === "ktx2") {
        const { ktx2 } = await this.loaders();
        tex = await ktx2.loadAsync(this.abs(r.url), (e) => part.set(e.loaded / (e.total || r.bytes || 1)));
      } else {
        this.manager.itemStart(r.url);
        const blob = await fetchWithProgress(this.abs(r.url), r.bytes, (f) => part.set(f));
        const bmp = await createImageBitmap(blob, { imageOrientation: "flipY", premultiplyAlpha: "none" });
        tex = new T.Texture(bmp); tex.flipY = false; tex.needsUpdate = true;
        tex.addEventListener("dispose", () => bmp.close && bmp.close());
        this.manager.itemEnd(r.url);
      }
      if (srgb) tex.colorSpace = T.SRGBColorSpace;
      tex.anisotropy = anisotropy;
      tex.userData.source = r; // { url, bytes, kind }
      part.done();
      return tex;
    } catch (err) { this.manager.itemError(r.url); part.fail(); throw err; }
  }

  /** Last step: compile every material the scene needs now (parallel where KHR_parallel_shader_compile
   *  exists), so the first frames after the loader do not stall on shader compilation. */
  async compile(scene, camera, label = "Warming up shaders", weight = 1.5) {
    const part = this.stage(label, weight);
    part.set(0.1);
    try { await (this.r.compileAsync ? this.r.compileAsync(scene, camera) : this.r.compile(scene, camera)); } catch {}
    part.done();
  }
}

/** fetch() with byte progress. `expected` = decoded size when the server hides it (gzip/chunked). */
export async function fetchWithProgress(url, expected, onFrac) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const enc = res.headers.get("content-encoding"), len = +res.headers.get("content-length") || 0;
  const total = !enc && len ? len : expected || len;
  if (!res.body || !total) { const b = await res.blob(); onFrac(1); return b; }
  const reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.byteLength; onFrac(Math.min(0.99, got / total));
  }
  onFrac(1);
  return new Blob(chunks, { type: res.headers.get("content-type") || "" });
}

/** Load assets.json (if present) — the build tool's choice of variant + byte size per asset. */
export async function loadManifest(url) {
  try { const r = await fetch(url); return r.ok ? await r.json() : {}; } catch { return {}; }
}
