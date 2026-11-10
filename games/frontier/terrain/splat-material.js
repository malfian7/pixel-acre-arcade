// Frontier Crown — terrain texturing: four tileable ground textures (grass, dirt, sand, rock) generated
// on canvases, blended per vertex by an `aSplat` weight attribute with height-based blending, rock
// projected triplanar so cliffs don't stretch, plus a macro tint map, fog of war and the build grid.
//
//   const tex = createGroundTextures(THREE);
//   const { material, uniforms } = createTerrainMaterial(THREE, { textures: tex, tint, fogTex, buildTex, mapSize: 128 });
//   uniforms.uGrid.value = 1; uniforms.uCursor.value.set(x, z); uniforms.uFoot.value.set(x0, z0, x1, z1);

function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Paint helper that wraps around the edges so the texture tiles seamlessly.
function wrapDraw(g, size, x, y, r, fn) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
    const px = x + dx, py = y + dy;
    if (px + r < 0 || py + r < 0 || px - r > size || py - r > size) continue;
    fn(px, py);
  }
}

function paint(size, seed, base, steps) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"); g.fillStyle = base; g.fillRect(0, 0, size, size);
  steps(g, rnd(seed), size);
  return c;
}

export function createGroundTextures(THREE, size = 256) {
  const blob = (g, R, S, n, rmin, rmax, colors, alpha) => {
    for (let k = 0; k < n; k++) {
      const x = R() * S, y = R() * S, r = rmin + R() * (rmax - rmin), col = colors[Math.floor(R() * colors.length)];
      wrapDraw(g, S, x, y, r, (px, py) => {
        const gr = g.createRadialGradient(px, py, 0, px, py, r);
        gr.addColorStop(0, col.replace("A", alpha)); gr.addColorStop(1, col.replace("A", 0));
        g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
      });
    }
  };
  const grass = paint(size, 11, "#668a3c", (g, R, S) => {
    blob(g, R, S, 40, 20, 60, ["rgba(86,118,48,A)", "rgba(122,150,70,A)", "rgba(74,98,40,A)", "rgba(130,138,70,A)"], 0.5);
    for (let k = 0; k < 2600; k++) { // blades
      const x = R() * S, y = R() * S, l = 2 + R() * 5, a = -Math.PI / 2 + (R() - 0.5) * 0.9;
      const v = R(); g.strokeStyle = v < 0.5 ? `rgba(${50 + v * 40},${95 + v * 60},${30 + v * 20},.7)` : `rgba(${120 + v * 40},${160 + v * 30},${70},.55)`;
      g.lineWidth = 1; wrapDraw(g, S, x, y, l, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
    }
  });
  const dirt = paint(size, 23, "#8a6a46", (g, R, S) => {
    blob(g, R, S, 50, 10, 50, ["rgba(110,85,55,A)", "rgba(120,95,60,A)", "rgba(95,72,48,A)"], 0.6);
    for (let k = 0; k < 500; k++) { // pebbles
      const x = R() * S, y = R() * S, r = 0.8 + R() * 2.4, v = 120 + R() * 70;
      wrapDraw(g, S, x, y, r, (px, py) => { g.fillStyle = `rgb(${v},${v * 0.85},${v * 0.7})`; g.beginPath(); g.ellipse(px, py, r, r * 0.75, R() * 3, 0, 7); g.fill(); g.fillStyle = "rgba(40,28,18,.35)"; g.fillRect(px - r * 0.6, py + r * 0.5, r * 1.2, 1); });
    }
  });
  const sand = paint(size, 37, "#d3bd8a", (g, R, S) => {
    blob(g, R, S, 30, 20, 60, ["rgba(225,205,155,A)", "rgba(190,165,115,A)"], 0.45);
    for (let y = 0; y < S; y += 1) { // wind ripples (periodic in the tile)
      const a = 0.05 + 0.05 * Math.sin((y / S) * Math.PI * 2 * 9);
      g.fillStyle = `rgba(150,125,80,${a.toFixed(3)})`; g.fillRect(0, y, S, 1);
    }
    for (let k = 0; k < 4000; k++) { const v = R() < 0.5 ? "rgba(120,100,65,.35)" : "rgba(245,230,195,.4)"; g.fillStyle = v; g.fillRect(R() * S, R() * S, 1, 1); }
  });
  const rock = paint(size, 53, "#878079", (g, R, S) => {
    for (let y = 0; y < S; y += 2) { // strata bands (horizontal in side projections)
      const v = 0.5 + 0.5 * Math.sin((y / S) * Math.PI * 2 * 5 + Math.sin((y / S) * Math.PI * 2 * 2) * 1.4);
      g.fillStyle = `rgba(${90 + v * 50},${84 + v * 44},${76 + v * 40},.55)`; g.fillRect(0, y, S, 2);
    }
    blob(g, R, S, 45, 8, 40, ["rgba(70,66,62,A)", "rgba(160,152,140,A)", "rgba(110,104,96,A)"], 0.45);
    g.lineWidth = 1.2;
    for (let k = 0; k < 40; k++) { // cracks
      let x = R() * S, y = R() * S; g.strokeStyle = "rgba(40,36,32,.55)";
      for (let s = 0; s < 6; s++) { const nx = x + (R() - 0.5) * 22, ny = y + (R() - 0.5) * 22; wrapDraw(g, S, x, y, 24, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + nx - x, py + ny - y); g.stroke(); }); x = nx; y = ny; }
    }
    for (let k = 0; k < 2500; k++) { const v = 60 + R() * 140; g.fillStyle = `rgba(${v},${v},${v * 0.95},.3)`; g.fillRect(R() * S, R() * S, 1.5, 1.5); }
  });
  const mk = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { grass: mk(grass), dirt: mk(dirt), sand: mk(sand), rock: mk(rock), canvases: { grass, dirt, sand, rock } };
}

export function createTerrainMaterial(THREE, { textures, tint, fogTex, buildTex, mapSize, triplanar = true }) {
  const uniforms = {
    tGrass: { value: textures.grass }, tDirt: { value: textures.dirt }, tSand: { value: textures.sand }, tRock: { value: textures.rock },
    tTint: { value: tint }, uFog: { value: fogTex }, uBuild: { value: buildTex }, uMap: { value: mapSize },
    uGrid: { value: 0 }, uCursor: { value: new THREE.Vector2(-999, -999) }, uRadius: { value: 9 },
    uFoot: { value: new THREE.Vector4(0, 0, 0, 0) }, uFootOk: { value: 1 }, uTime: { value: 0 },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 });
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec4 aSplat;
varying vec4 vSplat; varying vec3 vWP; varying vec3 vWN;`)
      .replace("#include <project_vertex>", `#include <project_vertex>
  vSplat = aSplat;
  vec4 twp = modelMatrix * vec4( transformed, 1.0 );
  vWP = twp.xyz; vWN = normalize( mat3( modelMatrix ) * objectNormal );`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
uniform sampler2D tGrass, tDirt, tSand, tRock, tTint, uFog, uBuild;
uniform float uMap, uGrid, uRadius, uFootOk, uTime;
uniform vec2 uCursor; uniform vec4 uFoot;
varying vec4 vSplat; varying vec3 vWP; varying vec3 vWN;
float lum( vec3 c ) { return dot( c, vec3( 0.333 ) ); }
vec3 rockTex() {
#ifdef TRIPLANAR
  vec3 n = abs( normalize( vWN ) ); n = pow( n, vec3( 4.0 ) ); n /= ( n.x + n.y + n.z );
  return texture2D( tRock, vWP.zy * 0.3 ).rgb * n.x + texture2D( tRock, vWP.xz * 0.3 ).rgb * n.y + texture2D( tRock, vWP.xy * 0.3 ).rgb * n.z;
#else
  return texture2D( tRock, vWP.xz * 0.3 ).rgb;
#endif
}`)
      .replace("#include <map_fragment>", `
  vec2 tuv = vWP.xz * 0.25;
  vec3 cG = texture2D( tGrass, tuv ).rgb, cD = texture2D( tDirt, tuv * 1.15 ).rgb, cS = texture2D( tSand, tuv * 0.9 ).rgb, cR = rockTex();
  // height-based blend: brighter texels win the transition, so borders follow pebbles and tufts
  vec4 hgt = vec4( lum( cG ), lum( cD ), lum( cS ), lum( cR ) );
  vec4 h4 = vSplat * ( 1.0 + hgt * 1.6 );
  float ma = max( max( h4.x, h4.y ), max( h4.z, h4.w ) ) - 0.18;
  vec4 b = max( h4 - ma, 0.0 ); b /= ( b.x + b.y + b.z + b.w + 1e-4 );
  vec3 ground = cG * b.x + cD * b.y + cS * b.z + cR * b.w;
  ground *= texture2D( tTint, vWP.xz / uMap ).rgb * 2.0;
  // break up visible tiling with a very low-frequency resample of the grass texture
  float macro = texture2D( tGrass, vWP.xz * 0.041 + 0.37 ).g + texture2D( tDirt, vWP.xz * 0.017 ).r;
  ground *= 0.86 + 0.32 * smoothstep( 0.55, 1.05, macro );
  diffuseColor.rgb *= ground;`)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
  // ---- build grid: tile class texture, fades out around the cursor
  if ( uGrid > 0.001 ) {
    vec2 cell = floor( vWP.xz );
    float cls = floor( texture2D( uBuild, ( cell + 0.5 ) / uMap ).r * 255.0 / 80.0 + 0.5 );
    vec2 f = fract( vWP.xz );
    float edge = min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) );
    float line = 1.0 - smoothstep( 0.02, 0.07, edge );
    float fade = 1.0 - smoothstep( uRadius * 0.55, uRadius, distance( vWP.xz, uCursor ) );
    vec3 gc = cls < 0.5 ? vec3( 0.35, 1.0, 0.45 ) : cls < 1.5 ? vec3( 1.0, 0.28, 0.22 ) : cls < 2.5 ? vec3( 1.0, 0.72, 0.2 ) : vec3( 0.12 );
    float a = ( 0.16 + line * 0.6 ) * fade * uGrid;
    bool inFoot = vWP.x >= uFoot.x && vWP.x <= uFoot.z && vWP.z >= uFoot.y && vWP.z <= uFoot.w;
    if ( inFoot ) { gc = uFootOk > 0.5 ? vec3( 0.45, 1.0, 0.55 ) : vec3( 1.0, 0.25, 0.2 ); a = max( a, ( 0.42 + line * 0.4 ) * uGrid ); }
    gl_FragColor.rgb = mix( gl_FragColor.rgb, gc, a );
  }
  gl_FragColor.rgb *= texture2D( uFog, vWP.xz / uMap ).r;`);
  };
  if (triplanar) material.defines = { TRIPLANAR: "" };
  material.customProgramCacheKey = () => "fc-terrain" + (triplanar ? "-tri" : "");
  return { material, uniforms };
}
