// Pixel Acre Arcade — SceneCleaner: frees everything a Three.js game put on the GPU.
//
// Three.js never frees GPU memory by itself: geometries, materials (their compiled programs),
// textures and render targets stay allocated until someone calls dispose() on each of them.
// The arcade moves between pages (hub ⇄ game), and a page kept in the browser's back/forward
// cache keeps its WebGL context alive too. SceneCleaner makes the cleanup explicit and complete:
//
//   const cleaner = new SceneCleaner(renderer);    // starts tracking automatically:
//                                                    //   every scene passed to renderer.render(),
//                                                    //   every render target passed to setRenderTarget()
//   cleaner.track(composer, pmrem, cachedTexture);   // anything outside the scene graph with dispose()
//   cleaner.disposeObject(group);                    // one subtree (e.g. a level), returns counts
//   cleaner.disposeAll();                            // every tracked scene + target + extra
//   cleaner.shutdown();                              // disposeAll + renderer.dispose + forceContextLoss
//   cleaner.installPageLifecycle();                  // shutdown on pagehide; reload on a bfcache return
//
// It disposes each resource once (shared geometry/material/texture are de-duplicated), covers every
// texture slot of every material (map, normalMap, envMap… and ShaderMaterial uniforms, arrays too),
// skeleton bone textures, InstancedMesh/BatchedMesh buffers, shadow maps (light.dispose), scene
// background/environment, and render targets (including PMREM and post-processing ones). The report
// it returns is read from renderer.info.memory before/after, so a leak shows up as a number.
//
// No import of three: everything is duck-typed (isTexture, isMaterial…), so the hub and every game
// can share this file whatever path they load three.js from.

const TEX_KEYS_SKIP = new Set(["userData"]);

export class SceneCleaner {
  constructor(renderer, { autoTrack = true, name = location.pathname.split("/").pop() || "page" } = {}) {
    this.r = renderer; this.name = name;
    this.scenes = new Set();          // WeakRef<Scene>
    this.targets = new Set();         // WeakRef<RenderTarget>
    this.extra = new Set();           // strong refs to things with dispose()
    this.onShutdown = [];             // callbacks (stop loops, audio…)
    this.dead = false;
    if (autoTrack && renderer) this.autoTrack();
  }

  /** Wrap renderer.render / setRenderTarget so every scene and target used is remembered (weakly). */
  autoTrack() {
    const r = this.r, seenS = new WeakSet(), seenT = new WeakSet();
    const render = r.render.bind(r), setRT = r.setRenderTarget.bind(r);
    r.render = (scene, camera) => {
      if (scene && !seenS.has(scene)) { seenS.add(scene); this.scenes.add(new WeakRef(scene)); }
      return render(scene, camera);
    };
    r.setRenderTarget = (target, ...rest) => {
      if (target && !seenT.has(target)) { seenT.add(target); this.targets.add(new WeakRef(target)); }
      return setRT(target, ...rest);
    };
  }

  watch(scene) { this.scenes.add(new WeakRef(scene)); return scene; }
  track(...things) { for (const t of things) if (t) this.extra.add(t); return things[0]; }
  untrack(thing) { this.extra.delete(thing); }
  /** Run on shutdown (stop requestAnimationFrame loops, close audio, workers…). */
  onLeave(fn) { this.onShutdown.push(fn); }

  // ---------------------------------------------------------------- disposal
  /** Dispose every GPU resource below `root` (inclusive). `keep` = Set of resources to leave alone.
   *  Returns { geometries, materials, textures, targets, skeletons, lights } counts. */
  disposeObject(root, { keep = null, detach = false, done = new Set() } = {}) {
    const c = { geometries: 0, materials: 0, textures: 0, targets: 0, skeletons: 0, lights: 0 };
    if (!root) return c;
    const once = (res, kind, fn) => {
      if (!res || done.has(res) || (keep && keep.has(res))) return;
      done.add(res); c[kind]++; fn(res);
    };
    const tex = (t) => once(t, "textures", (x) => x.dispose());
    const mat = (m) => once(m, "materials", (x) => { this.texturesOf(x, tex); x.dispose(); });
    const visit = (o) => {
      if (o.geometry) once(o.geometry, "geometries", (g) => g.dispose());
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(mat);
      if (o.customDepthMaterial) mat(o.customDepthMaterial);
      if (o.customDistanceMaterial) mat(o.customDistanceMaterial);
      if (o.skeleton) once(o.skeleton, "skeletons", (s) => s.dispose());
      if ((o.isInstancedMesh || o.isBatchedMesh) && typeof o.dispose === "function") o.dispose(); // instance + morph textures
      if (o.isLight) once(o, "lights", (l) => { if (l.shadow && l.shadow.map) c.targets++; l.dispose(); });
      if (o.isScene) {
        for (const k of ["background", "environment"]) if (o[k] && o[k].isTexture) tex(o[k]);
        if (o.overrideMaterial) mat(o.overrideMaterial);
      }
      if (o.isSprite || o.isPoints || o.isLine) {/* covered by geometry/material above */}
    };
    root.traverse(visit);
    if (detach) { if (root.parent) root.parent.remove(root); if (root.clear) root.clear(); }
    return c;
  }

  /** Every texture a material references: any property holding a Texture (all map slots, envMap,
   *  lightMap, gradientMap…) plus ShaderMaterial uniforms (single values and arrays). */
  texturesOf(m, fn) {
    for (const k in m) {
      if (TEX_KEYS_SKIP.has(k)) continue;
      const v = m[k];
      if (v && v.isTexture) fn(v);
    }
    if (m.uniforms) for (const u of Object.values(m.uniforms)) {
      const v = u && u.value;
      if (v && v.isTexture) fn(v);
      else if (Array.isArray(v)) for (const x of v) if (x && x.isTexture) fn(x);
    }
  }

  /** Dispose every scene rendered so far, every render target used, and every tracked extra. */
  disposeAll() {
    const before = this.snapshot(), done = new Set(), total = { geometries: 0, materials: 0, textures: 0, targets: 0, skeletons: 0, lights: 0, extra: 0 };
    const add = (c) => { for (const k in c) total[k] += c[k]; };
    for (const ref of this.scenes) { const s = ref.deref(); if (s) add(this.disposeObject(s, { done })); }
    for (const ref of this.targets) { const t = ref.deref(); if (t && !done.has(t)) { done.add(t); t.dispose(); total.targets++; } }
    for (const x of this.extra) {
      if (done.has(x)) continue; done.add(x);
      if (x.isObject3D) add(this.disposeObject(x, { done }));
      else if (x.isMaterial) { this.texturesOf(x, (t) => { if (!done.has(t)) { done.add(t); t.dispose(); total.textures++; } }); x.dispose(); total.materials++; }
      else if (typeof x.dispose === "function") { x.dispose(); total.extra++; }
    }
    if (this.r && this.r.renderLists) this.r.renderLists.dispose();
    this.scenes.clear(); this.targets.clear(); this.extra.clear();
    const after = this.snapshot();
    return { disposed: total, before, after };
  }

  /** Leave for good: dispose everything, stop the renderer, and drop the WebGL context so the driver
   *  frees whatever might be left (forceContextLoss). Safe to call twice. */
  shutdown({ loseContext = true, removeCanvas = false } = {}) {
    if (this.dead) return this.lastReport;
    const first = this.snapshot();
    for (const fn of this.onShutdown) { try { fn(); } catch (e) { console.warn("[SceneCleaner] onLeave", e); } }
    const report = this.disposeAll();
    const r = this.r;
    if (r) {
      r.setAnimationLoop(null);
      r.dispose();
      if (loseContext) r.forceContextLoss();
      if (removeCanvas && r.domElement.parentNode) r.domElement.remove();
    }
    this.dead = true;
    report.before = first; report.page = this.name; report.at = new Date().toISOString(); report.contextLost = loseContext;
    this.lastReport = report;
    try { sessionStorage.setItem("pa:lastCleanup", JSON.stringify(report)); } catch {}
    return report;
  }

  /** Page lifecycle: free the GPU when the page is hidden for navigation (pagehide fires both on a
   *  real unload and when the page enters the back/forward cache). If the browser later restores the
   *  page from that cache its context is gone, so the page reloads itself. */
  installPageLifecycle({ reloadOnRestore = true } = {}) {
    addEventListener("pagehide", () => this.shutdown());
    addEventListener("pageshow", (e) => { if (e.persisted && this.dead && reloadOnRestore) location.reload(); });
    return this;
  }

  /** GPU resource counts as three.js tracks them. */
  snapshot() {
    const r = this.r;
    if (!r) return null;
    const m = r.info.memory;
    return { geometries: m.geometries, textures: m.textures, programs: r.info.programs ? r.info.programs.length : 0 };
  }
}

/** One cleaner per renderer, shared by whoever asks (PA.renderer, the hub, Frontier's views). */
const registry = new WeakMap();
export function cleanerFor(renderer, opts) {
  let c = registry.get(renderer);
  if (!c) { c = new SceneCleaner(renderer, opts); registry.set(renderer, c); }
  return c;
}
