// Frontier Crown — floating "+10 [wood]" numbers when a villager unloads at a drop site.
// One CanvasTexture glyph atlas (digits, signs, three resource icons drawn with 2D paths) and one
// InstancedBufferGeometry quad: each glyph is an instance, billboarded in view space by the
// vertex shader, rising and fading with its age. A whole screen of numbers is one draw call.

const CELLS = 16, CELL = 64;
const G = { PLUS: 10, MINUS: 11, ICON: 12 }; // icons: 12 food, 13 wood, 14 coin, 15 XP

function drawAtlas(ctx) {
  ctx.clearRect(0, 0, CELLS * CELL, CELL);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "900 50px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.lineJoin = "round";
  const glyphs = "0123456789+-";
  for (let i = 0; i < glyphs.length; i++) {
    const x = i * CELL + CELL / 2, y = CELL / 2 + 2;
    ctx.lineWidth = 9; ctx.strokeStyle = "rgba(24,16,8,0.9)"; ctx.strokeText(glyphs[i], x, y);
    ctx.fillStyle = "#fff"; ctx.fillText(glyphs[i], x, y);
  }
  const at = (k) => { ctx.save(); ctx.translate((G.ICON + k) * CELL + CELL / 2, CELL / 2); };
  const outline = () => { ctx.lineWidth = 5; ctx.strokeStyle = "rgba(24,16,8,0.9)"; ctx.stroke(); };
  // food: berry/apple
  at(0); ctx.beginPath(); ctx.arc(0, 4, 19, 0, Math.PI * 2); outline(); ctx.fillStyle = "#e0483a"; ctx.fill();
  ctx.beginPath(); ctx.arc(-7, -2, 5, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -14); ctx.quadraticCurveTo(8, -26, 18, -22); ctx.lineWidth = 5; ctx.strokeStyle = "#5a8a3a"; ctx.stroke(); ctx.restore();
  // wood: two logs
  at(1);
  for (const [y, c] of [[9, "#9a6a3c"], [-8, "#b07b47"]]) {
    ctx.beginPath(); ctx.roundRect(-22, y - 8, 44, 16, 8); outline(); ctx.fillStyle = c; ctx.fill();
    ctx.beginPath(); ctx.arc(17, y, 6, 0, Math.PI * 2); ctx.fillStyle = "#e3c08a"; ctx.fill();
  }
  ctx.restore();
  // coin
  at(2); ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); outline(); ctx.fillStyle = "#e9b93a"; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = "#fff3c4"; ctx.stroke(); ctx.restore();
  // XP: blue star
  at(3); ctx.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 9 : 22; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r + 2); }
  ctx.closePath(); outline(); ctx.fillStyle = "#6fb0ff"; ctx.fill(); ctx.restore();
}

const TINT = [[1, 0.62, 0.55], [1, 0.86, 0.62], [1, 0.9, 0.45], [0.7, 0.86, 1]]; // digit colour per resource (+ XP)

export function createFloaters(THREE, { max = 320, life = 1.5 } = {}) {
  const cv = document.createElement("canvas"); cv.width = CELLS * CELL; cv.height = CELL;
  drawAtlas(cv.getContext("2d"));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;

  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.setAttribute("position", base.attributes.position); geo.setAttribute("uv", base.attributes.uv);
  const pos = new Float32Array(max * 3), dat = new Float32Array(max * 4), col = new Float32Array(max * 3);
  const aPos = new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aDat = new THREE.InstancedBufferAttribute(dat, 4).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.InstancedBufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("iPos", aPos); geo.setAttribute("iDat", aDat); geo.setAttribute("iCol", aCol);
  geo.instanceCount = 0;

  const mat = new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: tex }, uSize: { value: 0.58 } },
    vertexShader: /* glsl */ `
      attribute vec3 iPos; attribute vec4 iDat; attribute vec3 iCol;   // iDat = (glyph, x offset, age 0..1, unused)
      uniform float uSize;
      varying vec2 vUv; varying vec3 vCol; varying float vAlpha;
      void main() {
        float age = iDat.z;
        vec4 mv = viewMatrix * vec4( iPos + vec3( 0.0, 0.4 + age * 1.6, 0.0 ), 1.0 );
        float pop = 1.0 + 0.35 * ( 1.0 - smoothstep( 0.0, 0.12, age ) );
        float s = uSize * pop * max( 1.0, -mv.z / 32.0 );                // stay legible when zoomed out
        mv.xy += ( position.xy + vec2( iDat.y, 0.0 ) ) * s;              // billboard: offset in view space
        gl_Position = projectionMatrix * mv;
        vUv = vec2( ( iDat.x + uv.x ) / ${CELLS.toFixed(1)}, uv.y );
        vCol = iCol; vAlpha = 1.0 - smoothstep( 0.6, 1.0, age );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying vec2 vUv; varying vec3 vCol; varying float vAlpha;
      void main() {
        vec4 c = texture2D( uAtlas, vUv );
        if ( c.a * vAlpha < 0.02 ) discard;
        gl_FragColor = vec4( c.rgb * vCol, c.a * vAlpha );
        #include <colorspace_fragment>
      }`,
    transparent: true, depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 6;

  const live = []; // { x, y, z, glyphs: [[g, off, tintIdx]], t }
  return {
    mesh,
    /** "+amt" followed by the resource icon, centred above (x, y, z). */
    spawn(x, y, z, amt, res) {
      const txt = (amt >= 0 ? "+" : "-") + Math.round(Math.abs(amt));
      const gl = [...txt].map((ch) => (ch === "+" ? G.PLUS : ch === "-" ? G.MINUS : +ch));
      gl.push(G.ICON + res);
      const n = gl.length, w = 0.56;
      live.push({ x, y, z, t: 0, res, glyphs: gl.map((g, i) => [g, (i - (n - 1) / 2) * w + (i === n - 1 ? 0.12 : 0)]) });
      if (live.length > 60) live.shift();
    },
    update(dt) {
      let k = 0;
      for (let i = live.length - 1; i >= 0; i--) {
        const f = live[i]; f.t += dt;
        if (f.t > life) { live.splice(i, 1); continue; }
        const age = f.t / life, tint = TINT[f.res];
        for (const [g, off] of f.glyphs) {
          if (k >= max) break;
          pos[k * 3] = f.x; pos[k * 3 + 1] = f.y; pos[k * 3 + 2] = f.z;
          dat[k * 4] = g; dat[k * 4 + 1] = off; dat[k * 4 + 2] = age;
          const icon = g >= G.ICON;
          col[k * 3] = icon ? 1 : tint[0]; col[k * 3 + 1] = icon ? 1 : tint[1]; col[k * 3 + 2] = icon ? 1 : tint[2];
          k++;
        }
      }
      geo.instanceCount = k; mesh.visible = k > 0;
      if (k) { aPos.needsUpdate = true; aDat.needsUpdate = true; aCol.needsUpdate = true; }
    },
    dispose() { tex.dispose(); geo.dispose(); base.dispose(); mat.dispose(); },
  };
}
