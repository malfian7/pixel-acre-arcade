// Frontier Crown — shared material patching (team tint, vertex-shader limbs, fog of war,
// construction reveal), the hologram material (placement ghost + unbuilt part of a site) and
// InstancePool, a thin wrapper that streams per-frame instances into one InstancedMesh.

import { ANIM_GLSL } from "./anim.js";
import { FOG_GLSL } from "./fog-canvas.js";

export function createInstancing(THREE, { fogTex, mapSize }) {
  const shared = { uFog: { value: fogTex }, uMap: { value: mapSize }, uTime: { value: 0 } };

  // GLSL for construction sites. iBuild = (progress 0..1, model height, completion flash 0..1).
  // Everything above progress × height is discarded; a hot band glows along the cut line; the
  // inside of the walls (back faces) shows darker, like an unroofed frame. At progress 1 the
  // test is skipped and the mesh is whole.
  const BUILD_VERT = `
#ifdef USE_INSTANCING
attribute vec3 iBuild;
#endif
varying vec3 vBuild; varying float vBuildY;`;
  const BUILD_SET = `
#ifdef USE_INSTANCING
  vBuild = iBuild;
#else
  vBuild = vec3( 1.0, 1.0, 0.0 );
#endif
  vBuildY = position.y;`;
  const BUILD_DISCARD = `
  float fcCut = vBuild.x * vBuild.y;
  if ( vBuild.x < 0.999 && vBuildY > fcCut ) discard;`;

  function patch(mat, { anim = false, fog = true, build = false } = {}) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFog = shared.uFog; sh.uniforms.uMap = shared.uMap; sh.uniforms.uTime = shared.uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>
attribute float aTeam;
${anim ? ANIM_GLSL : ""}
${build ? BUILD_VERT : ""}
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
        .replace("#include <begin_vertex>", (anim ? "vec3 transformed = animate( vec3( position ) );" : "#include <begin_vertex>") + (build ? BUILD_SET : ""))
        .replace("#include <project_vertex>", `#include <project_vertex>
  vec4 fcw = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  fcw = instanceMatrix * fcw;
#endif
  fcw = modelMatrix * fcw;
  vFogUv = fcw.xz / uMap;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
uniform sampler2D uFog; varying vec2 vFogUv;
${FOG_GLSL}
${build ? "varying vec3 vBuild; varying float vBuildY;" : ""}`)
        .replace("#include <dithering_fragment>", `#include <dithering_fragment>
${fog ? "gl_FragColor.rgb = fcFog( gl_FragColor.rgb, texture2D( uFog, vFogUv ).r );" : ""}`);
      if (build) {
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>" + BUILD_DISCARD)
          .replace("#include <color_fragment>", `#include <color_fragment>
  if ( !gl_FrontFacing ) diffuseColor.rgb *= vec3( 0.42, 0.36, 0.3 );`)
          .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  if ( vBuild.x < 0.999 ) {
    float band = 1.0 - smoothstep( 0.0, 0.2, fcCut - vBuildY );
    totalEmissiveRadiance += vec3( 1.0, 0.6, 0.2 ) * band * ( 1.1 + 0.4 * sin( uTime * 6.0 ) );
  }
  totalEmissiveRadiance += vec3( 1.0, 0.86, 0.55 ) * vBuild.z * 0.7;`)
          .replace("uniform sampler2D uFog;", "uniform sampler2D uFog; uniform float uTime;");
      }
    };
    mat.customProgramCacheKey = () => (anim ? "fc-anim" : "fc") + (fog ? "f" : "") + (build ? "b" : "");
    return mat;
  }

  // Shadow pass for construction sites: same cut, so a half-built house casts a half-built shadow.
  function buildDepth() {
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>" + BUILD_VERT)
        .replace("#include <begin_vertex>", "#include <begin_vertex>" + BUILD_SET);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBuild; varying float vBuildY;")
        .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>" + BUILD_DISCARD);
    };
    m.customProgramCacheKey = () => "fc-build-depth";
    return m;
  }

  // Hologram: fresnel rim + rising scan lines + a sweep band, alpha-blended, no depth write.
  // instanced = true → reads iBuild and shows only the part ABOVE the construction cut
  // (the unbuilt remainder of a site); false → whole mesh (the placement ghost, coloured by uColor).
  function holoMaterial({ color = 0x9fd8ff, instanced = false, opacity = 1 } = {}) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uTime: shared.uTime, uFog: shared.uFog, uMap: shared.uMap, uHeight: { value: 3 }, uOpacity: { value: opacity } },
      vertexShader: /* glsl */ `
        uniform float uMap; uniform float uHeight;
        ${instanced ? "attribute vec3 iBuild;" : ""}
        varying vec3 vN; varying vec3 vView; varying float vY; varying vec3 vB; varying vec2 vFogUv; varying vec3 vTint;
        void main() {
          mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
          vec4 wp = m * vec4( position, 1.0 );
          vN = normalize( mat3( m ) * normal );
          vView = cameraPosition - wp.xyz;
          vY = position.y; vFogUv = wp.xz / uMap;
          vB = ${instanced ? "iBuild" : "vec3( -1.0, uHeight, 0.0 )"};
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #else
          vTint = vec3( 1.0 );
        #endif
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime; uniform sampler2D uFog; uniform float uOpacity;
        varying vec3 vN; varying vec3 vView; varying float vY; varying vec3 vB; varying vec2 vFogUv; varying vec3 vTint;
        void main() {
          float cutY = vB.x * vB.y;
          if ( vB.x >= 0.0 && vY < cutY ) discard;
          vec3 n = normalize( vN );
          float fres = pow( 1.0 - clamp( abs( dot( n, normalize( vView ) ) ), 0.0, 1.0 ), 2.0 );
          float lines = smoothstep( 0.82, 1.0, abs( fract( vY * 6.0 - uTime * 0.9 ) - 0.5 ) * 2.0 );
          float sweep = 1.0 - smoothstep( 0.0, 0.07 * vB.y, abs( vY - fract( uTime * 0.45 ) * vB.y * 1.15 ) );
          float edge = vB.x >= 0.0 ? 1.0 - smoothstep( 0.0, 0.18, vY - cutY ) : 0.0;
          float a = 0.14 + 0.62 * fres + 0.28 * lines + 0.45 * sweep + 0.5 * edge;
          vec3 col = uColor * vTint * ( 0.75 + 0.6 * fres + 0.6 * sweep ) + vec3( 1.0, 0.7, 0.3 ) * edge;
          float fog = texture2D( uFog, vFogUv ).r;
          gl_FragColor = vec4( col * mix( 0.4, 1.0, fog ), clamp( a, 0.0, 0.9 ) * uOpacity * mix( 0.35, 1.0, fog ) );
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    });
  }

  // Shadows must use the same posed vertices (and hide unused tools), so animated pools get a patched depth material.
  function animDepth() {
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>\n${ANIM_GLSL}`)
        .replace("#include <begin_vertex>", "vec3 transformed = animate( vec3( position ) );");
    };
    m.customProgramCacheKey = () => "fc-anim-depth";
    return m;
  }
  const depthMat = animDepth();

  const tmpC = new THREE.Color(), tmpE = new THREE.Euler(), tmpM = new THREE.Matrix4();

  class InstancePool {
    // extra: optional custom per-instance attribute { name, size, def: [defaults] } (e.g. iBuild)
    constructor(geo, mat, cap, { anim = false, shadow = true, receive = true, name = "", extra = null, depth = null } = {}) {
      this.geo = geo.clone();
      if (!this.geo.boundingBox) this.geo.computeBoundingBox();
      this.height = this.geo.boundingBox.max.y;
      this.cap = cap; this.anim = anim;
      if (extra) {
        this.ex = extra; this.exArr = new Float32Array(cap * extra.size); this.exAttr = new THREE.InstancedBufferAttribute(this.exArr, extra.size);
        this.exAttr.setUsage(THREE.DynamicDrawUsage); this.geo.setAttribute(extra.name, this.exAttr);
      }
      if (anim) { this.animArr = new Float32Array(cap * 4); this.animAttr = new THREE.InstancedBufferAttribute(this.animArr, 4); this.animAttr.setUsage(THREE.DynamicDrawUsage); this.geo.setAttribute("iAnim", this.animAttr); }
      this.mesh = new THREE.InstancedMesh(this.geo, mat, cap);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.setColorAt(0, tmpC.set(1, 1, 1));
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.mesh.castShadow = shadow; this.mesh.receiveShadow = receive;
      if (anim) this.mesh.customDepthMaterial = depthMat;
      if (depth) this.mesh.customDepthMaterial = depth;
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
      if (this.anim) this.animArr.fill(0, k * 4, k * 4 + 4);
      if (this.ex) this.setExtra(k, ...this.ex.def);
      return k;
    }
    // Yaw + pitch + roll (units that tilt with the terrain: horses, cannon, deer).
    pushTilt(x, y, z, yaw, pitch, roll, r = 1, g = 1, b = 1) {
      tmpE.set(pitch, yaw, roll, "YXZ"); tmpM.makeRotationFromEuler(tmpE); tmpM.setPosition(x, y, z);
      return this.pushMatrix(tmpM, r, g, b);
    }
    pushMatrix(mat4, r = 1, g = 1, b = 1) {
      if (this.n >= this.cap) return -1;
      const k = this.n++; mat4.toArray(this.m, k * 16);
      const q = k * 3; this.c[q] = r; this.c[q + 1] = g; this.c[q + 2] = b;
      if (this.anim) this.animArr.fill(0, k * 4, k * 4 + 4);
      if (this.ex) this.setExtra(k, ...this.ex.def);
      return k;
    }
    // custom per-instance values (must follow the push that returned k)
    setExtra(k, a = 0, b = 0, c = 0, d = 0) {
      if (k < 0 || !this.ex) return;
      const o = k * this.ex.size, A = this.exArr; A[o] = a; if (this.ex.size > 1) A[o + 1] = b; if (this.ex.size > 2) A[o + 2] = c; if (this.ex.size > 3) A[o + 3] = d;
    }
    // code = kind*32 + clip, t = clip time (s), mv = walk blend 0..1, ph = gait phase (rad)
    setAnim(k, code, t, mv, ph) { if (k < 0 || !this.anim) return; const q = k * 4; this.animArr[q] = code; this.animArr[q + 1] = t; this.animArr[q + 2] = mv; this.animArr[q + 3] = ph; }
    end() {
      this.mesh.count = this.n;
      this.mesh.visible = this.n > 0; // empty pools issue no draw (and no shadow) call
      if (this.n) {
        this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16); this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.instanceColor.clearUpdateRanges(); this.mesh.instanceColor.addUpdateRange(0, this.n * 3); this.mesh.instanceColor.needsUpdate = true;
        if (this.anim) { this.animAttr.clearUpdateRanges(); this.animAttr.addUpdateRange(0, this.n * 4); this.animAttr.needsUpdate = true; }
        if (this.ex) { this.exAttr.clearUpdateRanges(); this.exAttr.addUpdateRange(0, this.n * this.ex.size); this.exAttr.needsUpdate = true; }
      }
    }
  }

  return { patch, InstancePool, shared, holoMaterial, buildDepth };
}
