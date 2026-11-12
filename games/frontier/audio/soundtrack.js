// Frontier Crown — soundtrack director: which recorded track plays when, with crossfades.
//
//   menu       Main Menu           title, skirmish setup, deck, settings, how-to (and the attract match behind them)
//   explore    Early Exploration   in a match, Discovery Age, no fighting
//   age        Age 2-3             starts fresh the moment you reach a new Age; the peaceful theme of Ages II–III
//   war        War                 your units/buildings are fighting the Rival Crown (combat "heat", with hysteresis)
//   victory    Finish or Victory   the result screen (plays once, then the menu theme returns)
//
// Files are streamed with <audio> elements routed through WebAudio (MediaElementSource → per-voice
// gain → the soundtrack bus), so settings' music volume and the pause duck apply. Looping tracks
// cross-fade into a second copy of themselves a few seconds before the end — no gap, no click.

import { audioContext, trackBus, music as proceduralMusic } from "./audio.js";

const BASE = new URL("./music/", import.meta.url).href;
// Each track tries its files in order: the game's own name first, then the names the tracks were
// delivered with — so dropping the original files into audio/music/ works without renaming them.
export const TRACKS = {
  menu: { files: ["main-menu.mp3", "Main Menu.mp3"], loop: true },
  explore: { files: ["early-exploration.mp3", "Early Exploration.mp3"], loop: true },
  age: { files: ["age-2-3.mp3", "Age 2-3 or Newly upgrade Age.mp3", "Age 2-3.mp3"], loop: true },
  war: { files: ["war.mp3", "War.mp3"], loop: true },
  victory: { files: ["victory.mp3", "Finish or Victory Match.mp3", "Victory.mp3"], loop: false, then: "menu" },
};
for (const t of Object.values(TRACKS)) t.file = t.files[0];
const urlOf = (f) => BASE + encodeURIComponent(f);
const XFADE = 2.5;          // seconds, track → track
const LOOP_XFADE = 3.0;     // seconds, end of a loop → its start
// war heat: points from combat events, decaying each second
const HEAT = { attacked: 25, shot: 1.2, died: 5, decay: 3.5, enter: 28, exit: 6, minWar: 30 };

class Voice {
  constructor(ac, dest, url) {
    this.el = new Audio(); this.el.src = url; this.el.preload = "auto";
    this.src = ac.createMediaElementSource(this.el);
    this.g = ac.createGain(); this.g.gain.value = 0;
    this.src.connect(this.g); this.g.connect(dest);
    this.ac = ac;
  }
  play(from = 0) { try { this.el.currentTime = from; } catch {} return this.el.play(); }
  fade(to, sec) {
    const t = this.ac.currentTime, p = this.g.gain;
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(to, t + Math.max(0.01, sec));
  }
}

export class Soundtrack {
  constructor() {
    this.want = null; this.cur = null; this.voices = {}; this.active = null; this.failed = false; this.seq = 0;
    this.heat = 0; this.warSince = -1; this.peace = "explore"; this.inMatch = false;
    this.status = "idle"; this.error = null; this.onFallback = null; // "playing" once a file plays; "fallback" = procedural tune
    this.timer = setInterval(() => this.tick(1), 1000);
    this.loopTimer = setInterval(() => this.loopWatch(), 200);
    // a hidden tab is silent: pause the stream, resume where it left off
    this.onVis = () => { const a = this.active; if (!a) return; if (document.hidden) a.v.el.pause(); else a.v.el.play().catch(() => {}); };
    document.addEventListener("visibilitychange", this.onVis);
  }
  /** Lazily build the WebAudio graph (needs the AudioContext, which needs a user gesture). */
  ready() {
    if (this.failed) return false;
    const ac = audioContext(), bus = trackBus();
    if (!ac || !bus) return false;
    this.ac = ac; this.bus = bus;
    return true;
  }
  voice(name, slot) {
    const key = name + slot;
    if (!this.voices[key]) {
      const T = TRACKS[name], start = T.found ?? 0;
      const v = new Voice(this.ac, this.bus, urlOf(T.files[start]));
      v.tryIdx = start;
      // a failed file → the next candidate name; the last one is retried once with a fresh URL
      // (stale cache / interrupted download) before the built-in tune takes over
      v.el.addEventListener("error", () => {
        const code = v.el.error ? v.el.error.code : 0, tried = T.files[v.tryIdx];
        console.warn(`[soundtrack] ${urlOf(tried)}: media error ${code}`);
        if (v.tryIdx < T.files.length - 1) v.el.src = urlOf(T.files[++v.tryIdx]);
        else if (!v.retried) { v.retried = true; v.tryIdx = start; v.el.src = urlOf(T.files[start]) + "?r=" + Date.now(); }
        else return this.fail(`${T.files.join(" / ")} (media error ${code}: ${["", "aborted", "network", "decode", "not found / unsupported"][code] || "unknown"})`);
        v.el.load();
        if (this.cur === name && this.active?.v !== v) { this.cur = null; this.play(name); }
      });
      v.el.addEventListener("loadedmetadata", () => { T.found = v.tryIdx; T.loaded = T.files[v.tryIdx]; });
      if (!TRACKS[name].loop) v.el.addEventListener("ended", () => { if (this.cur === name && TRACKS[name].then) this.play(TRACKS[name].then, true); });
      this.voices[key] = v;
    }
    return this.voices[key];
  }
  fail(reason = "unknown") { // files unavailable (offline build, blocked) → the old procedural tune keeps the game musical
    if (this.failed) return;
    this.failed = true; this.status = "fallback"; this.error = reason;
    for (const v of Object.values(this.voices)) v.el.pause();
    console.warn(`[soundtrack] recorded music unavailable — ${reason}. Expected files in ${BASE}. Playing the built-in tune instead.`);
    if (location.protocol === "file:") console.warn("[soundtrack] the page is opened from file:// — serve the folder over http (e.g. `npx serve` or `python -m http.server`).");
    proceduralMusic(true);
    if (this.onFallback) this.onFallback(reason);
  }

  /** Switch to a track; restart = play from the top even if it is already playing (new Age).
   *  The old track keeps playing until the new one has actually started — no silent gap while it loads. */
  play(name, restart = false) {
    this.want = name;
    if (!this.ready()) return;            // retried by kick() after audioInit()
    if (this.cur === name && !restart && this.active) return;
    const old = this.active;
    const slot = old && old.name === name ? (old.slot === "a" ? "b" : "a") : "a";
    const v = this.voice(name, slot), token = ++this.seq;
    this.cur = name;
    v.fade(0, 0.001);
    v.play(0).then(() => {
      if (token !== this.seq) { v.el.pause(); return; }   // superseded while loading
      const prev = this.active;                             // (may be a loop twin started meanwhile)
      v.fade(1, prev ? XFADE : 0.6);
      if (prev && prev.v !== v) { prev.v.fade(0, XFADE); const ov = prev.v; setTimeout(() => { if (!this.active || this.active.v !== ov) ov.el.pause(); }, XFADE * 1000 + 100); }
      this.active = { name, slot, v }; this.status = "playing";
      if (TRACKS[name].loop) this.voice(name, slot === "a" ? "b" : "a").el.load(); // buffer the loop twin now
    }).catch(() => { if (token === this.seq) this.cur = old ? old.name : null; }); // autoplay blocked: kick() retries
  }
  /** Start downloading tracks that are likely next, so a switch is instant. */
  prefetch(...names) { if (!this.ready()) return; for (const n of names) this.voice(n, "a").el.load(); }
  /** Seamless loop: start the twin copy just before the end and cross-fade (the old copy plays out underneath). */
  loopWatch() {
    const a = this.active;
    if (!a || document.hidden || !TRACKS[a.name].loop || !a.v.el.duration) return;
    if (a.v.el.currentTime > a.v.el.duration - LOOP_XFADE - 1.5) { // 1.5 s head start for the twin to begin
      if (this.looping) return;
      const slot = a.slot === "a" ? "b" : "a", v = this.voice(a.name, slot), old = a.v;
      this.looping = true; v.fade(0, 0.001);
      v.play(0).then(() => {
        this.looping = false;
        if (this.active !== a) { v.el.pause(); return; }           // a track switch happened meanwhile
        v.fade(1, LOOP_XFADE); old.fade(0, LOOP_XFADE);
        // after the fade: stop the old copy and rewind/re-buffer it for the next lap
        setTimeout(() => { if (!this.active || this.active.v !== old) { old.el.pause(); old.el.load(); } }, LOOP_XFADE * 1000 + 100);
        this.active = { name: a.name, slot, v };
      }).catch(() => { this.looping = false; });
    }
  }
  /** After the first user gesture: start whatever was requested before audio existed. */
  kick() { if (this.want && this.cur !== this.want) this.play(this.want); }

  // ---------------------------------------------------------------- game states
  menu() { this.inMatch = false; this.heat = 0; this.warSince = -1; this.play("menu"); this.prefetch("explore"); }
  matchStart(age = 0) { this.inMatch = true; this.heat = 0; this.warSince = -1; this.peace = age > 0 ? "age" : "explore"; this.play(this.peace, true); this.prefetch("war", "age", "victory"); }
  ageReached() { this.peace = "age"; if (this.cur !== "war") this.play("age", true); }
  finish() { this.inMatch = false; this.warSince = -1; this.play("victory", true); }

  /** Feed the match's events (me = the human player's id). Only fights against the Rival Crown count. */
  events(list, sim, me) {
    if (!this.inMatch) return;
    const st = sim.st, foe = (o) => o !== me && o < 2;
    for (const ev of list) {
      if (ev.type === "attacked" && ev.p === me) this.heat += HEAT.attacked;
      else if (ev.type === "shot" && ev.e >= 0 && ev.t >= 0) {
        const a = st.owner[ev.e], b = st.owner[ev.t];
        if ((a === me && foe(b)) || (foe(a) && b === me)) this.heat += HEAT.shot;
      } else if (ev.type === "died" && ev.owner < 2 && ev.by >= 0 && ev.by < 2 && ev.by !== ev.owner && (ev.owner === me || ev.by === me)) this.heat += HEAT.died;
    }
  }
  tick() {
    if (!this.inMatch) return;
    this.heat = Math.max(0, this.heat - HEAT.decay);
    const now = performance.now() / 1000;
    if (this.cur !== "war" && this.heat >= HEAT.enter) { this.warSince = now; this.play("war"); }
    else if (this.cur === "war" && this.heat < HEAT.exit && now - this.warSince > HEAT.minWar) this.play(this.peace);
    else if (this.want && this.cur !== this.want) this.kick();
  }
  dispose() { document.removeEventListener("visibilitychange", this.onVis); clearInterval(this.timer); clearInterval(this.loopTimer); for (const v of Object.values(this.voices)) v.el.pause(); }
}
