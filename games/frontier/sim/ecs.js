// Frontier Crown — Entity store (ECS, Structure-of-Arrays).
// An entity is an index. Hot fields live in typed arrays; rare variable-size data in Maps.

import { DEF_LIST } from "../data/defs.js";

export const MAX = 8192;

// Component bits
export const CM = {
  UNIT: 1, BUILDING: 2, RESOURCE: 4, MOVER: 8, HEALTH: 16, ATTACKER: 32, GATHERER: 64,
  PRODUCER: 128, DROPSITE: 256, FOOTPRINT: 512, VISION: 1024, TREASURE: 2048,
};

// Unit order states
export const S = { IDLE: 0, MOVE: 1, GATHER: 2, RETURN: 3, BUILD: 4, ATTACK: 5, AMOVE: 6, CLAIM: 7 };

export class Store {
  constructor() {
    this.alive = new Uint8Array(MAX);
    this.gen = new Uint16Array(MAX);
    this.mask = new Uint32Array(MAX);
    this.def = new Int16Array(MAX).fill(-1);
    this.owner = new Uint8Array(MAX);     // 0 = player, 1 = AI, 2 = gaia
    this.x = new Float32Array(MAX); this.z = new Float32Array(MAX);
    this.px = new Float32Array(MAX); this.pz = new Float32Array(MAX);
    this.rot = new Float32Array(MAX); this.prot = new Float32Array(MAX);
    this.hp = new Float32Array(MAX); this.maxHp = new Float32Array(MAX);
    // orders
    this.state = new Uint8Array(MAX);
    this.tgt = new Int32Array(MAX).fill(-1); this.tgtGen = new Uint16Array(MAX);
    this.tx = new Float32Array(MAX); this.tz = new Float32Array(MAX);
    this.gx = new Float32Array(MAX); this.gz = new Float32Array(MAX);   // guard point (idle chase leash)
    this.amove = new Uint8Array(MAX);
    this.cd = new Float32Array(MAX);       // attack cooldown
    this.scan = new Uint8Array(MAX);       // ticks until next target scan
    this.repath = new Uint8Array(MAX);     // ticks until a chase path refresh
    // movement
    this.vx = new Float32Array(MAX); this.vz = new Float32Array(MAX);     // actual velocity last tick (animation, others' avoidance)
    this.svx = new Float32Array(MAX); this.svz = new Float32Array(MAX);   // steering velocity (persists, acceleration-limited)
    this.moving = new Uint8Array(MAX);
    this.stuck = new Uint16Array(MAX);
    this.tries = new Uint8Array(MAX);      // failed approach attempts
    this.group = new Uint16Array(MAX);     // move-order id shared by units ordered together (flocking)
    // economy
    this.carry = new Float32Array(MAX); this.ctype = new Uint8Array(MAX);
    this.lastNode = new Int32Array(MAX).fill(-1); this.lastNodeGen = new Uint16Array(MAX);
    this.lastType = new Uint8Array(MAX);  // gtype index of last gathered node
    this.amount = new Float32Array(MAX);   // resource remaining
    this.dead = new Uint8Array(MAX);       // hunted animal is down
    this.prog = new Float32Array(MAX);     // construction progress 0..1
    this.workers = new Uint8Array(MAX);    // gatherers on a node this tick
    this.unreach = new Uint8Array(MAX);    // bit per player: node proved unreachable
    this.eco = new Uint8Array(MAX);        // villager economy sub-state (economy/villager-fsm.js ECO)
    this.pulse = new Float32Array(MAX);    // harvest / unload timer (s)
    // physics
    this.kx = new Float32Array(MAX); this.kz = new Float32Array(MAX);      // knockback velocity (tiles/s)
    this.knockT = new Float32Array(MAX);   // seconds of knockback left (unit is not steering)
    this.bx = new Float32Array(MAX); this.bz = new Float32Array(MAX);      // last blast centre that hit this entity
    this.blastT = new Float32Array(MAX).fill(-99); // sim time of that blast
    // view hints (not gameplay)
    this.act = new Float32Array(MAX);      // attack/gather animation pulse
    this.hitT = new Float32Array(MAX);     // time since last damage
    this.lastAttacker = new Int32Array(MAX).fill(-1);
    // cold data
    this.path = new Map();   // id -> { pts:[x,z,...], i, pending, goal }
    this.queue = new Map();  // id -> { items:[defIdx], t }
    this.rally = new Map();  // id -> { x, z, tgt }
    this.free = [];
    this.top = 0;
    this.count = 0;
  }

  create(defIdx, owner, x, z) {
    let e = this.free.length ? this.free.pop() : this.top++;
    if (e >= MAX) throw new Error("entity limit");
    const d = DEF_LIST[defIdx];
    this.alive[e] = 1; this.gen[e] = (this.gen[e] + 1) & 0xffff;
    this.def[e] = defIdx; this.owner[e] = owner;
    this.x[e] = this.px[e] = x; this.z[e] = this.pz[e] = z;
    this.rot[e] = this.prot[e] = 0;
    let m = 0;
    if (d.kind === "unit") {
      m |= CM.UNIT | CM.MOVER | CM.HEALTH | CM.VISION;
      if (d.atk) m |= CM.ATTACKER;
      if (d.gather) m |= CM.GATHERER;
      if (d.res != null) m |= CM.RESOURCE; // huntable animal
    } else if (d.kind === "building") {
      m |= CM.BUILDING | CM.HEALTH | CM.FOOTPRINT | CM.VISION;
      if (d.atk) m |= CM.ATTACKER;
      if (d.trains) m |= CM.PRODUCER;
      if (d.drop) m |= CM.DROPSITE;
    } else if (d.kind === "treasure") {
      m |= CM.TREASURE | CM.FOOTPRINT;
    } else {
      m |= CM.RESOURCE | CM.FOOTPRINT;
    }
    this.mask[e] = m;
    this.hp[e] = this.maxHp[e] = d.hp || 1;
    this.state[e] = 0; this.tgt[e] = -1; this.amove[e] = 0; this.cd[e] = 0; this.scan[e] = e % 10; this.repath[e] = 0;
    this.vx[e] = this.vz[e] = 0; this.svx[e] = this.svz[e] = 0; this.moving[e] = 0; this.stuck[e] = 0; this.tries[e] = 0; this.group[e] = 0;
    this.carry[e] = 0; this.ctype[e] = 0; this.lastNode[e] = -1; this.amount[e] = d.amount || 0; this.dead[e] = 0;
    this.prog[e] = 1; this.workers[e] = 0; this.unreach[e] = 0; this.eco[e] = 0; this.pulse[e] = 0; this.kx[e] = this.kz[e] = 0; this.knockT[e] = 0; this.blastT[e] = -99; this.act[e] = 0; this.hitT[e] = 99; this.lastAttacker[e] = -1;
    this.gx[e] = x; this.gz[e] = z; this.tx[e] = x; this.tz[e] = z;
    this.count++;
    return e;
  }

  destroy(e) {
    if (!this.alive[e]) return;
    this.alive[e] = 0; this.mask[e] = 0; this.def[e] = -1;
    this.path.delete(e); this.queue.delete(e); this.rally.delete(e);
    this.free.push(e); this.count--;
  }

  // Generation-checked reference
  valid(e, g) { return e >= 0 && this.alive[e] === 1 && this.gen[e] === g; }
  setTarget(e, t) { this.tgt[e] = t; this.tgtGen[e] = t >= 0 ? this.gen[t] : 0; }
  targetOk(e) { const t = this.tgt[e]; return t >= 0 && this.alive[t] === 1 && this.gen[t] === this.tgtGen[e]; }

  // Iterate live entities that have all bits in `q`.
  *query(q) { for (let e = 0; e < this.top; e++) if (this.alive[e] && (this.mask[e] & q) === q) yield e; }
}
