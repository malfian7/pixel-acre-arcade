// Frontier Crown — GPU character animation for instanced units.
// Each model vertex carries a body-part id and its joint pivots; each instance carries
// iAnim = (kind*32 + clip, clipTime, moveBlend, walkPhase). The vertex shader poses the
// part hierarchy (tool → arm → torso, legs, horse legs/neck, cannon barrel/wheels), so
// hundreds of units animate independently in one draw call per model — no SkinnedMesh,
// no AnimationMixer, no per-unit CPU skinning.

export const PART = {
  BODY: 0, LEG_L: 1, LEG_R: 2, ARM_R: 3, ARM_L: 4, TORSO: 5, WEAPON: 6,
  AXE: 10, PICK: 11, HAMMER: 12, BASKET: 13, HOE: 14, LOG: 15, SACK: 16, GRENADE: 17,
  HFL: 20, HFR: 21, HBL: 22, HBR: 23, NECK: 24,
  BARREL: 30, WHEEL: 31,
};
export const CLIP = {
  IDLE: 0, CHOP: 2, MINE: 3, FORAGE: 4, FARM: 5, BUILD: 6, AIM: 7, THRUST: 8, SLASH: 9, FIRE: 10, THROW: 11, BITE: 12, FLAIL: 13,
  CARRY_FOOD: 14, CARRY_WOOD: 15, CARRY_COIN: 16,
};
export const KIND = { HUMAN: 0, HORSE: 1, CANNON: 2, BEAST: 3 };

// GLSL injected into the vertex shader (after <common>); `animate(position)` returns the posed position.
export const ANIM_GLSL = /* glsl */ `
attribute float aPart; attribute vec3 aPivot; attribute vec4 aPivot2;
#ifdef USE_INSTANCING
attribute vec4 iAnim;
#endif
mat3 rx( float a ) { float c = cos( a ), s = sin( a ); return mat3( 1.0, 0.0, 0.0,  0.0, c, s,  0.0, -s, c ); }
mat3 ry( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, 0.0, -s,  0.0, 1.0, 0.0,  s, 0.0, c ); }
mat3 rz( float a ) { float c = cos( a ), s = sin( a ); return mat3( c, s, 0.0,  -s, c, 0.0,  0.0, 0.0, 1.0 ); }
float cyc( float t, float period ) { return fract( t / period ); }
float sstep( float a, float b, float x ) { return smoothstep( a, b, x ); }

vec3 animate( vec3 p ) {
#ifdef USE_INSTANCING
  float code = iAnim.x, t = iAnim.y, mv = iAnim.z, ph = iAnim.w;
  float kind = floor( code / 32.0 + 0.01 ), clip = code - kind * 32.0;
  int part = int( aPart + 0.5 );
  // ---------------- pose for this instance
  float legL = sin( ph ) * 0.62 * mv, legR = -legL;
  vec3 aR = vec3( -sin( ph ) * 0.45 * mv, 0.0, 0.0 ), aL = vec3( sin( ph ) * 0.45 * mv, 0.0, 0.0 );
  float bend = 0.025 * sin( t * 1.7 ) * ( 1.0 - mv ), twist = 0.0, wR = 0.0, bob = abs( sin( ph ) ) * 0.045 * mv;
  float recoil = 0.0, neck = 0.0, pitch = 0.0;
  bool still = mv < 0.35;
  if ( clip > 1.5 && clip < 2.5 && still ) {                // CHOP: wind up over the shoulder, strike
    float u = cyc( t, 1.0 );
    float up = sstep( 0.05, 0.6, u ) * ( 1.0 - sstep( 0.62, 0.72, u ) ), hit = sstep( 0.62, 0.72, u ) * ( 1.0 - sstep( 0.82, 1.0, u ) );
    aR = vec3( -0.45 - 2.3 * up, 0.0, -0.25 * up ); aL = vec3( -0.6 - 1.4 * up, 0.0, 0.25 );
    twist = 0.4 * up - 0.15 * hit; bend = 0.08 + 0.25 * hit;
  } else if ( clip > 2.5 && clip < 3.5 && still ) {         // MINE: two-handed overhead pick strike
    float u = cyc( t, 1.15 );
    float up = sstep( 0.05, 0.55, u ) * ( 1.0 - sstep( 0.6, 0.7, u ) ), hit = sstep( 0.6, 0.7, u ) * ( 1.0 - sstep( 0.85, 1.0, u ) );
    aR = vec3( -0.5 - 2.5 * up, 0.0, 0.0 ); aL = vec3( -0.5 - 2.5 * up, 0.0, 0.35 );
    bend = 0.05 + 0.45 * hit - 0.1 * up;
  } else if ( clip > 3.5 && clip < 4.5 && still ) {         // FORAGE: bend, pick with the right hand, basket in the left
    float u = cyc( t, 1.3 );
    bend = 0.6 + 0.08 * sin( u * 6.283 );
    aR = vec3( -0.75 + 0.55 * sin( u * 6.283 ), 0.0, 0.15 * cos( u * 6.283 ) ); aL = vec3( -0.55, 0.0, 0.1 );
  } else if ( clip > 4.5 && clip < 5.5 && still ) {         // FARM: hoe chops the soil
    float u = cyc( t, 1.4 );
    float up = sstep( 0.0, 0.5, u ) * ( 1.0 - sstep( 0.55, 0.68, u ) );
    aR = vec3( -0.5 - 1.3 * up, 0.0, 0.0 ); aL = vec3( -0.45 - 1.2 * up, 0.0, 0.4 ); bend = 0.3 + 0.15 * ( 1.0 - up );
  } else if ( clip > 5.5 && clip < 6.5 && still ) {         // BUILD: quick hammer blows
    float u = cyc( t, 0.45 );
    float up = sstep( 0.0, 0.55, u ) * ( 1.0 - sstep( 0.6, 0.75, u ) );
    aR = vec3( -0.7 - 1.3 * up, 0.0, 0.0 ); aL = vec3( -0.9, 0.0, 0.2 ); bend = 0.35;
  } else if ( clip > 6.5 && clip < 7.5 ) {                  // AIM: shoulder the musket, fire, reload, aim again
    float k = exp( -t * 10.0 );
    float aim = 1.0 - sstep( 0.35, 0.6, t ) + sstep( 1.7, 2.1, t );
    aim = clamp( aim, 0.0, 1.0 );
    float ram = ( 1.0 - aim ) * sin( t * 9.0 );
    aR = vec3( mix( -0.55 + 0.3 * ram, -1.45 + 0.28 * k, aim ), 0.0, 0.0 );
    aL = vec3( mix( -0.6, -1.3, aim ), 0.0, mix( 0.1, 0.55, aim ) );
    wR = aim * ( 1.5708 - aR.x );                           // keep the barrel level while the arm rises
    bend = -0.12 * k + 0.05; twist = 0.12 * aim;
  } else if ( clip > 7.5 && clip < 8.5 ) {                  // THRUST: level the pike / bayonet and lunge
    float k = exp( -t * 7.0 );
    aR = vec3( -1.15 - 0.25 * k, 0.0, 0.0 ); aL = vec3( -1.1 - 0.2 * k, 0.0, 0.5 );
    wR = 1.5708 - aR.x; bend = 0.1 + 0.32 * k; twist = 0.15;
    legL = 0.35 * k; legR = -0.2 * k;
  } else if ( clip > 8.5 && clip < 9.5 ) {                  // SLASH: sabre from overhead down across
    float u = clamp( t / 0.5, 0.0, 1.0 );
    float up = 1.0 - sstep( 0.15, 0.45, u );
    aR = vec3( mix( -0.5, -2.6, up ), 0.0, -0.3 * up ); wR = mix( 2.7, 2.1, up );
    twist = 0.3 * up - 0.2; bend = 0.15 * ( 1.0 - up );
  } else if ( clip > 9.5 && clip < 10.5 ) {                 // FIRE: barrel recoil
    recoil = exp( -t * 6.0 ) * sstep( 0.0, 0.03, t );
  } else if ( clip > 10.5 && clip < 11.5 ) {                // THROW: grenade over the shoulder, whip, follow through
    float u = clamp( t / 0.75, 0.0, 1.0 );
    float back = sstep( 0.0, 0.38, u ) * ( 1.0 - sstep( 0.4, 0.52, u ) ), fwd = sstep( 0.4, 0.52, u ) * ( 1.0 - sstep( 0.75, 1.0, u ) );
    aR = vec3( -0.4 - 2.9 * back - 0.9 * fwd, 0.0, -0.2 * back ); aL = vec3( -0.9 * back - 0.3, 0.0, 0.25 );
    twist = 0.45 * back - 0.35 * fwd; bend = -0.12 * back + 0.3 * fwd;
    legL = 0.25 * back; legR = -0.15 * back;
  } else if ( clip > 12.5 && clip < 13.5 ) {                // FLAIL: thrown by a blast — arms and legs flung out
    float w = min( 1.0, t * 4.0 ), d = exp( -t * 0.9 );
    aR = vec3( -2.3 + 0.6 * sin( t * 13.0 ) * d, 0.0, -0.9 * w ); aL = vec3( -2.0 + 0.6 * cos( t * 11.0 ) * d, 0.0, -0.9 * w );
    legL = 0.55 * sin( t * 12.0 ) * d + 0.3 * w; legR = -0.55 * sin( t * 12.0 + 1.3 ) * d - 0.25 * w;
    bend = -0.35 * w; twist = 0.2 * sin( t * 7.0 ) * d; wR = 1.2 * w;
  } else if ( clip > 13.5 ) {                               // CARRY: load on the shoulder or in the basket
    if ( clip < 14.5 ) { aL = vec3( -0.6, 0.0, 0.1 ); }
    else { aR = vec3( -2.5, 0.0, -0.15 ); }
  }
  if ( kind > 0.5 && kind < 1.5 ) {                         // rider leans into the gallop
    bend += 0.22 * mv; legL = 0.0; legR = 0.0; bob = 0.0;
  }
  // horse / deer legs: walk → gallop; neck nods; idle grazing
  float g = sstep( 0.55, 0.9, mv );
  float hph = ph * mix( 1.0, 1.25, g );
  float hamp = 0.55 * mv;
  float fl = sin( hph ) * hamp, fr = sin( hph + mix( 3.1416, 0.6, g ) ) * hamp;
  float bl = sin( hph + mix( 1.57, 3.1416, g ) ) * hamp, br = sin( hph + mix( 4.71, 3.75, g ) ) * hamp;
  if ( clip > 12.5 && clip < 13.5 ) {                       // FLAIL (horses, wolves): legs kick
    float d = exp( -t * 0.9 );
    fl = 0.9 * sin( t * 14.0 ) * d + 0.4; fr = 0.9 * sin( t * 14.0 + 2.0 ) * d + 0.4; bl = -0.8 * sin( t * 13.0 + 1.0 ) * d - 0.3; br = -0.8 * sin( t * 13.0 + 3.0 ) * d - 0.3;
  }
  if ( kind > 0.5 && ( kind < 1.5 || kind > 2.5 ) ) {
    float graze = ( 1.0 - sstep( 0.05, 0.2, mv ) ) * sstep( 0.55, 0.75, sin( t * 0.35 + ph ) * 0.5 + 0.5 );
    if ( clip > 11.5 && clip < 12.5 ) graze = 0.0;
    neck = -0.18 * sin( hph * 2.0 ) * mv + 0.95 * graze;
    if ( clip > 11.5 && clip < 12.5 ) {                     // BITE: crouch, lunge the head forward, snap back
      float k = exp( -t * 9.0 ) * sstep( 0.0, 0.05, t );
      neck += 0.55 * k - 0.1; pitch = 0.12 * k - 0.04;
    } else pitch = 0.07 * sin( hph * 2.0 ) * g;
    bob = abs( sin( hph ) ) * 0.09 * mv;
  }
  // ---------------- apply to this vertex
  vec3 q = p;
  bool hidden = ( part == 10 && !( clip > 1.5 && clip < 2.5 ) ) || ( part == 11 && !( clip > 2.5 && clip < 3.5 ) ) ||
    ( part == 12 && !( clip > 5.5 && clip < 6.5 ) ) || ( part == 13 && !( ( clip > 3.5 && clip < 4.5 ) || ( clip > 13.5 && clip < 14.5 ) ) ) ||
    ( part == 14 && !( clip > 4.5 && clip < 5.5 ) ) || ( part == 15 && !( clip > 14.5 && clip < 15.5 ) ) || ( part == 16 && !( clip > 15.5 ) ) ||
    ( part == 17 && !( clip > 10.5 && clip < 11.5 && t < 0.46 ) );           // grenade leaves the hand at release
  if ( hidden ) return aPivot;
  mat3 torso = ry( twist ) * rx( bend );
  vec3 hip = vec3( 0.0, aPivot2.w, 0.0 );
  if ( part == 1 || part == 2 ) {
    q = aPivot + rx( part == 1 ? legL : legR ) * ( q - aPivot );
  } else if ( part == 3 || part == 4 ) {
    vec3 a = part == 3 ? aR : aL;
    q = aPivot + rx( a.x ) * rz( part == 3 ? -a.z : a.z ) * ( q - aPivot );   // a.z > 0 = toward the body
    q = hip + torso * ( q - hip );
  } else if ( part == 6 || ( part >= 10 && part <= 14 ) || part == 17 ) {
    bool left = aPivot2.x < 0.0;
    vec3 a = left ? aL : aR;
    q = aPivot + rx( part == 6 ? wR : 0.0 ) * ( q - aPivot );
    q = aPivot2.xyz + rx( a.x ) * rz( left ? a.z : -a.z ) * ( q - aPivot2.xyz );
    q = hip + torso * ( q - hip );
  } else if ( part == 5 || part == 15 || part == 16 ) {
    q = aPivot + torso * ( q - aPivot );
  } else if ( part >= 20 && part <= 23 ) {
    float a = part == 20 ? fl : part == 21 ? fr : part == 22 ? bl : br;
    q = aPivot + rx( a ) * ( q - aPivot );
  } else if ( part == 24 ) {
    q = aPivot + rx( neck ) * ( q - aPivot );
  } else if ( part == 30 ) {
    q = aPivot + rx( -0.18 * recoil ) * ( q - aPivot ); q.z -= 0.3 * recoil;
  } else if ( part == 31 ) {
    q = aPivot + rx( ph ) * ( q - aPivot );
  }
  if ( kind > 0.5 ) { vec3 c = vec3( 0.0, 0.75, 0.0 ); q = c + rx( pitch ) * ( q - c ); }
  if ( kind > 1.5 && kind < 2.5 ) q.z -= 0.12 * recoil;
  q.y += bob;
  return q;
#else
  return p;
#endif
}
`;

// ---------------------------------------------------------------- CPU side: which clip a unit plays
const GT_CLIP = { wood: CLIP.CHOP, coin: CLIP.MINE, berries: CLIP.FORAGE, hunt: CLIP.FORAGE, mill: CLIP.FARM, crate: CLIP.BUILD };
const CARRY = [CLIP.CARRY_FOOD, CLIP.CARRY_WOOD, CLIP.CARRY_COIN];
export const KIND_OF = { villager: KIND.HUMAN, musketeer: KIND.HUMAN, pikeman: KIND.HUMAN, grenadier: KIND.HUMAN, skirmisher: KIND.HUMAN, explorer: KIND.HUMAN, bandit: KIND.HUMAN, wolf: KIND.BEAST, hussar: KIND.HORSE, falconet: KIND.CANNON, deer: KIND.BEAST };
// where the strike lands inside each work cycle (fraction) and the cycle length (s): the view
// phase-locks these clips to the sim's harvest pulse so chips fly exactly when the axe bites
export const WORK_SYNC = { [CLIP.CHOP]: [0.67, 1.0], [CLIP.MINE]: [0.65, 1.15], [CLIP.FARM]: [0.6, 1.4], [CLIP.FORAGE]: [0.25, 1.3] };

/**
 * Pick the animation clip for a unit from simulation state.
 * st: entity store, e: entity, d: def, S: state enum, GT: gather-type names, ctx: { moving, sinceShot, shotKind, attacking }
 */
export function chooseClip(st, e, d, S, GT, ctx) {
  const s = st.state[e];
  if (d.id === "villager") {
    if (ctx.moving) return st.carry[e] > 0.5 ? CARRY[st.ctype[e]] : CLIP.IDLE;
    if (s === S.GATHER && st.eco[e] === 2 /* ECO.GATHERING */) return GT_CLIP[GT[st.lastType[e]]] ?? CLIP.CHOP;
    if (s === S.RETURN && st.carry[e] > 0.5) return CARRY[st.ctype[e]];   // unloading: keep the load in view
    if (s === S.BUILD) return CLIP.BUILD;
    if (s === S.ATTACK && ctx.sinceShot < 1.6) return CLIP.CHOP;
    return CLIP.IDLE;
  }
  if (s !== S.ATTACK || ctx.moving) return CLIP.IDLE;
  if (d.id === "musketeer") return ctx.shotKind === "melee" && ctx.sinceShot < 2 ? CLIP.THRUST : ctx.sinceShot < 4 ? CLIP.AIM : CLIP.IDLE;
  if (d.id === "pikeman") return ctx.sinceShot < 2 ? CLIP.THRUST : CLIP.IDLE;
  if (d.id === "explorer") return ctx.shotKind === "melee" && ctx.sinceShot < 2 ? CLIP.THRUST : ctx.sinceShot < 3 ? CLIP.AIM : CLIP.IDLE;
  if (d.id === "bandit") return ctx.sinceShot < 0.6 ? CLIP.SLASH : CLIP.IDLE;
  if (d.id === "wolf") return ctx.sinceShot < 0.7 ? CLIP.BITE : CLIP.IDLE;
  if (d.id === "skirmisher") return ctx.shotKind === "melee" && ctx.sinceShot < 2 ? CLIP.THRUST : ctx.sinceShot < 4 ? CLIP.AIM : CLIP.IDLE;
  if (d.id === "grenadier") return ctx.shotKind === "melee" && ctx.sinceShot < 2 ? CLIP.THRUST : ctx.sinceShot < 0.9 ? CLIP.THROW : CLIP.IDLE;
  if (d.id === "hussar") return ctx.sinceShot < 0.6 ? CLIP.SLASH : CLIP.IDLE;
  if (d.id === "falconet") return ctx.sinceShot < 3 ? CLIP.FIRE : CLIP.IDLE;
  return CLIP.IDLE;
}
