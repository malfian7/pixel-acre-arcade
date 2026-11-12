// Frontier Crown — AssetManager: loads rigged .glb unit models once, keeps them cached, and hands out
// independent copies.
//
//   preload(list, onProgress)  every file is fetched + parsed once, up front (the loading screen),
//                              with byte-level progress; a failed file is reported, never fatal
//   instantiate(name)          SkeletonUtils.clone() of the cached scene: each copy gets its OWN bones
//                              and skeleton, so dozens of soldiers made from one file animate
//                              independently, while geometry (vertex buffers) stays shared on the GPU
//   release(name, root)        returns a copy to a free list; the next instantiate() reuses it
//   clips(name)                the file's AnimationClips by name (shared by every copy — clips are data)
//
// Nothing here knows about the game: the view decides which units become models (render/unit-actors.js),
// and render/unit-animator.js plays the clips.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

/** Unit types that have a rigged model, and the file each one loads. */
export const UNIT_MODELS = { musketeer: "musketeer.glb", pikeman: "pikeman.glb" };
export const MODEL_BASE = new URL("../models/", import.meta.url).href;

export class AssetManager {
  constructor({ base = MODEL_BASE } = {}) {
    this.base = base;
    this.loader = new GLTFLoader();
    this.cache = new Map();   // name → Promise<template>   (one request per file, ever)
    this.ready = new Map();   // name → template            (resolved entries, for sync access)
    this.free = new Map();    // name → [root]              (released copies waiting for reuse)
    this.failed = new Map();  // name → Error
    this.stats = { requests: 0, clones: 0, reused: 0 };
  }

  /** Use another GLTFLoader (e.g. the AssetPipeline's, with DRACO + KTX2) and a URL resolver that
   *  picks the compressed variant named in assets.json. */
  useLoader(loader, resolve) { this.loader = loader; this.resolveUrl = resolve; }

  /** Load one model (cached: a second call for the same name returns the same promise). */
  load(name, file = UNIT_MODELS[name], onBytes) {
    if (this.cache.has(name)) return this.cache.get(name);
    this.stats.requests++;
    const url = this.resolveUrl ? this.resolveUrl(file) : new URL(file, this.base).href;
    const p = this.loader.loadAsync(url, (e) => onBytes && onBytes(e.loaded, e.total || 0))
      .then((gltf) => {
        const t = prepare(name, gltf);
        this.ready.set(name, t);
        return t;
      })
      .catch((err) => { this.failed.set(name, err); this.cache.delete(name); throw err; });
    this.cache.set(name, p);
    return p;
  }

  /** Load every model in `list` ({ name: file }) in parallel. onProgress(0..1, label) for the loading bar. */
  async preload(list = UNIT_MODELS, onProgress) {
    const names = Object.keys(list), bytes = new Map();
    const report = () => {
      if (!onProgress) return;
      let got = 0, total = 0;
      for (const [l, t] of bytes.values()) { got += l; total += t; }
      const done = names.filter((n) => this.ready.has(n) || this.failed.has(n)).length;
      onProgress(total > 0 ? Math.min(1, (got / total) * 0.9 + (done / names.length) * 0.1) : done / names.length);
    };
    const res = await Promise.allSettled(names.map((n) => this.load(n, list[n], (l, t) => { bytes.set(n, [l, t]); report(); }).finally(report)));
    const failed = names.filter((_, i) => res[i].status === "rejected");
    for (const n of failed) console.warn(`[assets] ${n}: ${this.failed.get(n)?.message || "failed"} — falling back to the instanced model`);
    return { ok: names.filter((n) => this.ready.has(n)), failed };
  }

  has(name) { return this.ready.has(name); }
  clips(name) { return this.ready.get(name)?.clips || {}; }
  info(name) { return this.ready.get(name) || null; }

  /** An independent copy: its own Object3D tree and skeleton, shared geometry, the template's materials
   *  (the caller usually swaps those for per-team ones). Reuses a released copy when one is free. */
  instantiate(name) {
    const t = this.ready.get(name);
    if (!t) return null;
    const pool = this.free.get(name);
    if (pool && pool.length) { this.stats.reused++; return pool.pop(); }
    this.stats.clones++;
    const root = SkeletonUtils.clone(t.scene);
    root.userData.asset = name;
    return root;
  }

  /** Give a copy back for reuse (detached from the scene, pose left as is — the animator resets it). */
  release(name, root) {
    if (root.parent) root.parent.remove(root);
    if (!this.free.has(name)) this.free.set(name, []);
    this.free.get(name).push(root);
  }

  /** Free GPU buffers of every cached model (only when the whole game shuts down). */
  dispose() {
    for (const t of this.ready.values()) t.scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.ready.clear(); this.cache.clear(); this.free.clear();
  }
}

/** Template prep, done once per file: shadow flags, culling, clip lookup by name. */
function prepare(name, gltf) {
  const scene = gltf.scene, meshes = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    // skinned bounds come from the bind pose; a falling body leaves them — the view culls per unit instead
    o.frustumCulled = false;
    meshes.push(o.name);
  });
  const clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  let bones = 0; scene.traverse((o) => { if (o.isBone) bones++; });
  return { name, scene, clips, meshes, bones };
}

/** The single shared instance (models are cached for the whole page, across matches). */
export const assets = new AssetManager();
