// Frontier Crown — UnitAnimator: one AnimationMixer per model copy, four states, cross-faded.
//
//   Idle ──► Walk ──► Attack ──► Die
//     ▲        │  ▲       │
//     └────────┘  └───────┘        (any state may go to any other; Die is final)
//
// setState(next) fades the new action IN and the current one OUT over the same duration
// (AnimationAction.fadeIn / fadeOut), so the pose blends instead of snapping. Details:
//   • Attack and Die play once and hold their last frame (LoopOnce + clampWhenFinished).
//     Attack's last frame is the "ready" pose (musket levelled / pike lowered), so a unit waiting
//     between volleys holds it, and restart() on the next shot starts the clip again seamlessly.
//   • A state must be asked for on two consecutive frames to start (except Attack/Die): one-frame
//     flickers in the simulation never reach the mixer, so fades are not interrupted half-way.
//   • Walk's timeScale follows ground speed, so feet do not slide.
//   • Die cannot be left (only reset(), when the model returns to the pool).

import * as THREE from "three";

export const STATE = { IDLE: "Idle", WALK: "Walk", ATTACK: "Attack", DIE: "Die" };
const ONCE = new Set([STATE.ATTACK, STATE.DIE]);
// fade durations (seconds) by [from → to]; default otherwise
const FADE = { default: 0.25, "Idle>Walk": 0.2, "Walk>Idle": 0.3, ">Attack": 0.12, "Attack>": 0.3, ">Die": 0.12 };
const fadeFor = (a, b) => FADE[`${a}>${b}`] ?? FADE[`>${b}`] ?? FADE[`${a}>`] ?? FADE.default;

export class UnitAnimator {
  /** root: the cloned model; clips: { Idle, Walk, Attack, Die } AnimationClips (shared, read-only). */
  constructor(root, clips, { walkSpeed = 1 } = {}) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    for (const name of Object.values(STATE)) {
      const clip = clips[name];
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (ONCE.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[name] = a;
    }
    this.walkSpeed = walkSpeed;   // ground speed (tiles/s) at which Walk plays at timeScale 1
    this.state = null; this.current = null;
    this.pending = null;          // requested state waiting for its second frame
    this.fading = 0;              // seconds left in the current cross-fade (debug)
    this.log = [];                // recent transitions [time, from, to, fade] (debug / tests)
    this.t = 0;
  }

  has(name) { return !!this.actions[name]; }
  get dead() { return this.state === STATE.DIE; }

  /** Ask for a state. opts.now skips the two-frame confirmation; opts.at starts the clip at a time;
   *  opts.fade overrides the duration. Returns true if a transition started. */
  setState(name, opts = {}) {
    if (this.dead || !this.actions[name]) return false;
    if (name === this.state) { this.pending = null; return false; }
    const urgent = opts.now || name === STATE.ATTACK || name === STATE.DIE || this.state === null;
    if (!urgent && this.pending !== name) { this.pending = name; return false; }
    this.pending = null;
    return this.transition(name, opts);
  }

  /** Play the current one-shot again from the start (Attack: a new volley / thrust). */
  restart(at = 0) {
    const a = this.current;
    if (!a || this.dead) return;
    a.reset(); a.time = at; a.play();
  }

  transition(name, { at = 0, fade } = {}) {
    const next = this.actions[name], prev = this.current, from = this.state;
    const dur = fade ?? (prev ? fadeFor(from, name) : 0);
    next.reset();                       // weight 1, time 0, enabled, fades cancelled
    next.time = Math.min(at, next.getClip().duration);
    next.setEffectiveTimeScale(name === STATE.WALK ? next.timeScale : 1);
    if (prev && prev !== next && dur > 0) {
      next.fadeIn(dur);                 // weight 0 → 1
      prev.fadeOut(dur);                // weight 1 → 0, then the mixer stops it
    } else if (prev && prev !== next) prev.stop();
    next.play();
    this.log.push([+this.t.toFixed(2), from, name, dur]); if (this.log.length > 12) this.log.shift();
    this.state = name; this.current = next; this.fading = dur;
    return true;
  }

  /** Walk cadence from ground speed (call every frame while walking). */
  setSpeed(speed) {
    const w = this.actions[STATE.WALK];
    if (w) w.timeScale = THREE.MathUtils.clamp(speed / this.walkSpeed, 0.35, 2.2);
  }

  update(dt) {
    this.t += dt; this.fading = Math.max(0, this.fading - dt);
    this.mixer.update(dt);
  }

  /** Weights of the running actions (debug overlay / tests). */
  weights() {
    const out = {};
    for (const [n, a] of Object.entries(this.actions)) if (a.isScheduled() && a.getEffectiveWeight() > 0.001) out[n] = +a.getEffectiveWeight().toFixed(2);
    return out;
  }

  /** Back to the bind pose, no state (before a pooled model is reused). */
  reset() {
    this.mixer.stopAllAction();
    this.state = null; this.current = null; this.pending = null; this.fading = 0; this.log.length = 0; this.t = 0;
  }

  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}
