// Frontier Crown — hybrid unit LOD: the nearest soldiers on screen are drawn as rigged glTF models
// (AssetManager + UnitAnimator); everyone else stays in the instanced pools (one draw call per type).
//
// Each frame the view walks its units as usual and, for a type that has a model, calls
//   actors.draw(e, …)   → true  : the unit is an actor this frame (pose + transform updated here)
//                       → false : draw it instanced as before (it may be promoted next frame)
// end(dt) then frees actors that were not drawn (dead, out of view, fogged, too far), promotes the
// closest candidates into the free slots (budget per quality), swaps a far actor for a much closer
// unit, and advances every mixer. Promotion takes one frame, so the decision never needs a sort
// inside the hot loop.
//
// A unit that dies while it is an actor keeps its model: Die plays, the body rests, then sinks.

import * as THREE from "three";
import { UnitAnimator, STATE } from "./unit-animator.js";

const BUDGET = { high: 40, medium: 20, low: 0 };   // two skinned draws (+ shadow) per actor
const ENGAGE = 28, RELEASE = 32;            // tiles from the camera
const SWAP_MARGIN = 6;                      // a candidate must be this much closer to evict an actor
// ground speed at which Walk plays at timeScale 1 (matches the instanced gait: 2π per 1.26 tiles / 0.9 s)
const WALK_SPEED = 1.4;
// the musketeer's Attack clip is volley (0–0.75 s) then bayonet thrusts: a melee hit starts at the thrusts
const meleeStart = (id, melee) => (melee && id === "musketeer" ? 0.8 : 0);
const CORPSE = { rest: 9, sink: 5 };        // seconds lying down, seconds sinking into the ground

export class UnitActors {
  constructor(scene, assets, { patch, teamRGB, quality = "high", budget } = {}) {
    this.assets = assets;
    this.group = new THREE.Group(); this.group.name = "unit-actors"; scene.add(this.group);
    this.patch = patch; this.teamRGB = teamRGB;
    this.budget = budget ?? BUDGET[quality] ?? 24;
    this.live = new Map();     // entity → actor
    this.dying = [];           // actors playing Die / lying / sinking
    this.cands = [];           // [dist, e] units that want a model (filled during the frame)
    this.mats = new Map();     // `${srcMaterial.uuid}|${owner}|${dark}` → patched material (shared by every copy)
    this.stats = { live: 0, dying: 0, promoted: 0, released: 0 };
    this.enabled = this.budget > 0;
  }

  /** Does this unit type have a model? */
  supports(id) { return this.enabled && this.assets.has(id); }

  /** One material per (source material, team): the Team mesh takes the team colour, every material gets
   *  the fog-of-war patch. Shared by all copies, so the shader compiles once per team. */
  material(src, owner, dark = false) {
    const key = `${src.uuid}|${owner}|${dark ? 1 : 0}`;
    let m = this.mats.get(key);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({ vertexColors: !!src.vertexColors, flatShading: true, roughness: src.roughness ?? 0.82, metalness: src.metalness ?? 0.02 });
    const team = src.name === "Team", tc = this.teamRGB[owner] || [1, 1, 1], k = dark ? 0.75 : 1;
    if (team) m.color.setRGB(tc[0] * k, tc[1] * k, tc[2] * k); else m.color.setScalar(k);
    m.name = `${src.name}#${owner}${dark ? "d" : ""}`;
    if (this.patch) this.patch(m);
    this.mats.set(key, m);
    return m;
  }

  acquire(id, owner) {
    const root = this.assets.instantiate(id);
    if (!root) return null;
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.userData.src) o.userData.src = o.material; // the template material (never rendered)
      o.material = this.material(o.userData.src, owner);
    });
    const anim = root.userData.anim || (root.userData.anim = new UnitAnimator(root, this.assets.clips(id), { walkSpeed: WALK_SPEED }));
    anim.reset();
    root.visible = true;
    this.group.add(root);
    this.stats.promoted++;
    return { id, owner, root, anim, shot: -1, seen: false, gen: -1, dist: 0 };
  }

  release(a) {
    a.anim.reset();
    this.assets.release(a.id, a.root);
    this.stats.released++;
  }

  // ---------------------------------------------------------------- per frame
  begin() {
    for (const a of this.live.values()) a.seen = false;
    this.cands.length = 0;
  }

  /** Called for every visible unit whose type has a model. u = { x, y, z, rot, dist, state, speed, shot, melee, gen } */
  draw(e, id, owner, u) {
    let a = this.live.get(e);
    if (a && (a.gen !== u.gen || a.id !== id || a.owner !== owner)) { this.live.delete(e); this.release(a); a = null; }
    if (!a) {
      if (u.dist < ENGAGE) this.cands.push([u.dist, e, id, owner, u.gen]);
      return false;
    }
    if (u.dist > RELEASE) return false;      // left unseen → freed in end()
    a.seen = true; a.dist = u.dist;
    a.root.position.set(u.x, u.y, u.z);
    a.root.rotation.y = u.rot;
    const anim = a.anim;
    if (u.state === STATE.ATTACK) {
      const fresh = u.shot !== a.shot && u.shot > 0;
      if (anim.state !== STATE.ATTACK) {
        // a fresh shot plays the whole volley; otherwise hold the clip's last ("ready") frame
        anim.setState(STATE.ATTACK, { at: fresh ? meleeStart(id, u.melee) : anim.actions[STATE.ATTACK].getClip().duration });
      } else if (fresh) anim.restart(meleeStart(id, u.melee));
      a.shot = u.shot;
    } else {
      anim.setState(u.state);
      if (u.state === STATE.WALK) anim.setSpeed(u.speed);
    }
    return true;
  }

  /** The unit died: if it is an actor, play Die and keep the body; returns true if handled. */
  kill(e) {
    const a = this.live.get(e);
    if (!a) return false;
    this.live.delete(e);
    // darker uniform on the fallen
    a.root.traverse((o) => { if (o.isMesh) o.material = this.material(o.userData.src, a.owner, true); });
    a.anim.setState(STATE.DIE, { now: true });
    a.t = 0; a.y0 = a.root.position.y;
    this.dying.push(a);
    return true;
  }

  end(dt) {
    // free actors that were not drawn this frame
    for (const [e, a] of this.live) if (!a.seen) { this.live.delete(e); this.release(a); }
    // promote the closest candidates into free slots; evict a far actor for a much closer unit
    if (this.cands.length) {
      this.cands.sort((p, q) => p[0] - q[0]);
      for (const [dist, e, id, owner, gen] of this.cands) {
        if (this.live.size >= this.budget) {
          let far = null, fe = -1;
          for (const [k, a] of this.live) if (!far || a.dist > far.dist) { far = a; fe = k; }
          if (!far || far.dist < dist + SWAP_MARGIN) break;
          this.live.delete(fe); this.release(far);
        }
        const a = this.acquire(id, owner);
        if (!a) continue;
        a.gen = gen; a.dist = dist;
        a.root.visible = false; // shown from next frame, when draw() places and poses it
        this.live.set(e, a);
      }
    }
    for (const a of this.live.values()) { if (a.seen) a.root.visible = true; a.anim.update(dt); }
    // the fallen: Die (held on its last frame), rest, sink, then back to the pool
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const a = this.dying[i]; a.t += dt;
      if (a.t > CORPSE.rest + CORPSE.sink) { this.dying.splice(i, 1); this.release(a); continue; }
      if (a.t > CORPSE.rest) a.root.position.y = a.y0 - (a.t - CORPSE.rest) * 0.12;
      a.anim.update(dt);
    }
    this.stats.live = this.live.size; this.stats.dying = this.dying.length;
  }

  /** Debug / tests: what each actor is doing. */
  debug() {
    const out = [];
    for (const [e, a] of this.live) out.push({ e, id: a.id, owner: a.owner, state: a.anim.state, weights: a.anim.weights(), dist: +a.dist.toFixed(1), log: a.anim.log.slice() });
    for (const a of this.dying) out.push({ e: -1, id: a.id, owner: a.owner, state: a.anim.state, weights: a.anim.weights(), t: +a.t.toFixed(2) });
    return out;
  }

  dispose() {
    for (const a of this.live.values()) this.release(a);
    for (const a of this.dying) this.release(a);
    this.live.clear(); this.dying.length = 0;
    this.group.removeFromParent();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}
