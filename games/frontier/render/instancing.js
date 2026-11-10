// Frontier Crown — shared material patching (team tint, vertex-shader limbs, fog of war)
// and InstancePool, a thin wrapper that streams per-frame instances into one InstancedMesh.

export function createInstancing(THREE, { fogTex, mapSize }) {
  const shared = { uFog: { value: fogTex }, uMap: { value: mapSize }, uTime: { value: 0 } };

  function patch(mat, { anim = false, fog = true } = {}) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFog = shared.uFog; sh.uniforms.uMap = shared.uMap; sh.uniforms.uTime = shared.uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>
attribute float aTeam; attribute float aPart; attribute float aPivot;
#ifdef USE_INSTANCING
attribute vec3 iAnim;
#endif
uniform float uMap; varying vec2 vFogUv;`)
        .replace("#include <color_vertex>", `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor = mix( vColor, vColor * instanceColor.xyz, aTeam );
#endif`)
        .replace("#include <begin_vertex>", `vec3 transformed = vec3( position );
${anim ? `#ifdef USE_INSTANCING
  float ph = iAnim.x, mv = iAnim.y, ac = iAnim.z;
  if ( aPart > 0.5 && aPart < 2.5 ) {
    float s = sin( ph + ( aPart > 1.5 ? 3.14159 : 0.0 ) ) * 0.6 * mv;
    float yy = transformed.y - aPivot, zz = transformed.z;
    transformed.y = aPivot + yy * cos( s ) - zz * sin( s );
    transformed.z = yy * sin( s ) + zz * cos( s );
  } else if ( aPart > 2.5 && aPart < 3.5 ) {
    float s = -ac * 0.95 + sin( ph ) * 0.25 * mv;
    float yy = transformed.y - aPivot, zz = transformed.z;
    transformed.y = aPivot + yy * cos( s ) - zz * sin( s );
    transformed.z = yy * sin( s ) + zz * cos( s );
  }
  transformed.y += abs( sin( ph ) ) * 0.045 * mv;
#endif` : ""}`)
        .replace("#include <project_vertex>", `#include <project_vertex>
  vec4 fcw = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  fcw = instanceMatrix * fcw;
#endif
  fcw = modelMatrix * fcw;
  vFogUv = fcw.xz / uMap;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
uniform sampler2D uFog; varying vec2 vFogUv;`)
        .replace("#include <dithering_fragment>", `#include <dithering_fragment>
${fog ? "gl_FragColor.rgb *= texture2D( uFog, vFogUv ).r;" : ""}`);
    };
    mat.customProgramCacheKey = () => (anim ? "fc-anim" : "fc") + (fog ? "f" : "");
    return mat;
  }

  const tmpC = new THREE.Color();

  class InstancePool {
    constructor(geo, mat, cap, { anim = false, shadow = true, receive = true, name = "" } = {}) {
      this.geo = geo.clone();
      this.cap = cap; this.anim = anim;
      if (anim) { this.animArr = new Float32Array(cap * 3); this.animAttr = new THREE.InstancedBufferAttribute(this.animArr, 3); this.animAttr.setUsage(THREE.DynamicDrawUsage); this.geo.setAttribute("iAnim", this.animAttr); }
      this.mesh = new THREE.InstancedMesh(this.geo, mat, cap);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.setColorAt(0, tmpC.set(1, 1, 1));
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.mesh.castShadow = shadow; this.mesh.receiveShadow = receive;
      this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.name = name;
      this.m = this.mesh.instanceMatrix.array; this.c = this.mesh.instanceColor.array;
      this.n = 0;
    }
    begin() { this.n = 0; }
    // Fast path: Y rotation + uniform scale (+ optional y scale).
    push(x, y, z, rot, s, r = 1, g = 1, b = 1, sy = s) {
      if (this.n >= this.cap) return -1;
      const k = this.n++, o = k * 16, c = Math.cos(rot), sn = Math.sin(rot), m = this.m;
      m[o] = c * s; m[o + 1] = 0; m[o + 2] = -sn * s; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = sn * s; m[o + 9] = 0; m[o + 10] = c * s; m[o + 11] = 0;
      m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
      const q = k * 3; this.c[q] = r; this.c[q + 1] = g; this.c[q + 2] = b;
      if (this.anim) { this.animArr[q] = 0; this.animArr[q + 1] = 0; this.animArr[q + 2] = 0; }
      return k;
    }
    pushMatrix(mat4, r = 1, g = 1, b = 1) {
      if (this.n >= this.cap) return -1;
      const k = this.n++; mat4.toArray(this.m, k * 16);
      const q = k * 3; this.c[q] = r; this.c[q + 1] = g; this.c[q + 2] = b;
      if (this.anim) { this.animArr[q] = 0; this.animArr[q + 1] = 0; this.animArr[q + 2] = 0; }
      return k;
    }
    setAnim(k, ph, mv, ac) { if (k < 0 || !this.anim) return; const q = k * 3; this.animArr[q] = ph; this.animArr[q + 1] = mv; this.animArr[q + 2] = ac; }
    end() {
      this.mesh.count = this.n;
      if (this.n) {
        this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16); this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.instanceColor.clearUpdateRanges(); this.mesh.instanceColor.addUpdateRange(0, this.n * 3); this.mesh.instanceColor.needsUpdate = true;
        if (this.anim) { this.animAttr.clearUpdateRanges(); this.animAttr.addUpdateRange(0, this.n * 3); this.animAttr.needsUpdate = true; }
      }
    }
  }

  return { patch, InstancePool, shared };
}
