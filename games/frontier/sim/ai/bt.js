// Frontier Crown — a tiny Behavior Tree runtime for the computer opponent.
//
// A node is a plain object with tick(bb) → SUCCESS | FAILURE | RUNNING. Composites:
//   sel(name, ...kids)   Selector: tries children in order, stops at the first that does not fail
//   seq(name, ...kids)   Sequence: runs children in order, stops at the first that does not succeed
//   par(name, ...kids)   Parallel: ticks every child every time (independent concerns side by side)
// Decorators / leaves:
//   when(name, fn)       Condition: SUCCESS if fn(bb) is truthy, else FAILURE
//   act(name, fn)        Action: fn(bb) returns true/undefined → SUCCESS, false → FAILURE, "running" → RUNNING
//   every(sec, kid)      Throttle: ticks the child at most once per `sec` simulated seconds
//
// The tree holds no game state; everything lives on the blackboard `bb` (the AI's scan of the
// world plus its memory), so the same tree drives every difficulty with different numbers.
// Each tick records the names of the nodes that succeeded → bb.trace (shown by the F4 overlay).

export const SUCCESS = 1, FAILURE = 0, RUNNING = 2;

const res = (v) => (v === false ? FAILURE : v === "running" ? RUNNING : SUCCESS);
const mark = (bb, name, s) => { if (s === SUCCESS && name && bb.trace) bb.trace.push(name); return s; };

export const sel = (name, ...kids) => ({ name, kids, tick(bb) {
  for (const k of kids) { const s = k.tick(bb); if (s !== FAILURE) return mark(bb, name, s); }
  return FAILURE;
} });

export const seq = (name, ...kids) => ({ name, kids, tick(bb) {
  for (const k of kids) { const s = k.tick(bb); if (s !== SUCCESS) return s; }
  return mark(bb, name, SUCCESS);
} });

export const par = (name, ...kids) => ({ name, kids, tick(bb) {
  let any = false;
  for (const k of kids) if (k.tick(bb) !== FAILURE) any = true;
  return any ? SUCCESS : FAILURE;
} });

export const when = (name, fn) => ({ name, tick: (bb) => (fn(bb) ? SUCCESS : FAILURE) });

export const act = (name, fn) => ({ name, tick: (bb) => mark(bb, name, res(fn(bb))) });

export const every = (sec, kid) => {
  let next = -1;
  return { name: kid.name, kids: [kid], tick(bb) {
    if (bb.time < next) return FAILURE;
    next = bb.time + sec;
    return kid.tick(bb);
  } };
};

/** Indented outline of a tree (for docs and the debug overlay). */
export function outline(node, depth = 0, out = []) {
  out.push("  ".repeat(depth) + node.name);
  for (const k of node.kids || []) outline(k, depth + 1, out);
  return out;
}
