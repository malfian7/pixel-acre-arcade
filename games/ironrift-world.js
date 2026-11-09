// Iron Rift — the arena: a sunset container terminal on a wet quay. Built in stages: the yard,
// cranes and sky first (title + wave 1), harbour ships and distant terminals streamed in later.

export function buildWorld(THREE, F, scene, renderer) {
  const rnd = (a, b) => a + Math.random() * (b - a);
  let seed = 7; const srnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), sr = (a, b) => a + srnd() * (b - a);
  const W = { colliders: [], solids: [], spawns: [], update: null, stages: [] };
  const ARENA = W.ARENA = { x0: -64, x1: 64, z0: -61, z1: 64 };

  /* ---------------------------------------------------------------- sky, sun, fog, environment */
  const SUN = W.sunDir = new THREE.Vector3(-0.38, 0.2, -0.9).normalize();
  const FOG = new THREE.Color("#a8796a");
  scene.fog = new THREE.Fog(FOG, 70, 620);
  const skyGeo = new THREE.SphereGeometry(1800, 48, 24), col = new Float32Array(skyGeo.attributes.position.count * 3);
  {
    const p = new THREE.Vector3(), c = new THREE.Color(), stops = [[-0.1, "#5b3e3e"], [0, "#e09062"], [0.05, "#f2a273"], [0.14, "#c9787a"], [0.32, "#6f5c86"], [0.6, "#2e3561"], [1, "#151a36"]].map(([y, h]) => [y, new THREE.Color(h)]);
    const glow = new THREE.Color("#ffd29a");
    for (let i = 0; i < col.length / 3; i++) {
      p.fromBufferAttribute(skyGeo.attributes.position, i).normalize();
      let k = 0; while (k < stops.length - 2 && p.y > stops[k + 1][0]) k++;
      c.copy(stops[k][1]).lerp(stops[k + 1][1], Math.min(1, Math.max(0, (p.y - stops[k][0]) / (stops[k + 1][0] - stops[k][0]))));
      const d = Math.max(0, p.dot(SUN)); c.lerp(glow, Math.pow(d, 12) * 0.9 + Math.pow(d, 3) * 0.18);
      col.set([c.r, c.g, c.b], i * 3);
    }
  }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  const skyGroup = W.skyGroup = new THREE.Group(); skyGroup.add(sky); scene.add(skyGroup);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshBasicMaterial({ color: 0xffe2b8, fog: false, toneMapped: false }));
  sunDisc.position.copy(SUN).multiplyScalar(1700); sunDisc.lookAt(0, 0, 0); skyGroup.add(sunDisc);
  // streaky dusk clouds on a wide band
  const cloudTex = F.canvasTex(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { const x = Math.random() * w, y = h * (0.35 + Math.random() * 0.5), rw = rnd(60, 260), rh = rnd(4, 16); const gr = g.createRadialGradient(x, y, 0, x, y, rw); gr.addColorStop(0, `rgba(255,${190 + Math.random() * 40 | 0},${150 + Math.random() * 40 | 0},${rnd(0.15, 0.4)})`); gr.addColorStop(1, "rgba(255,200,170,0)"); g.save(); g.translate(x, y); g.scale(1, rh / rw); g.translate(-x, -y); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rw, 0, 7); g.fill(); g.restore(); }
  });
  cloudTex.wrapS = THREE.RepeatWrapping; cloudTex.repeat.set(3, 1);
  const clouds = new THREE.Mesh(new THREE.CylinderGeometry(1500, 1500, 420, 48, 1, true), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  clouds.position.y = 260; skyGroup.add(clouds);
  const sun = W.sun = new THREE.DirectionalLight(0xffc89a, 3.2);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
  scene.add(sun, sun.target);
  const hemi = W.hemi = new THREE.HemisphereLight(0x9aa6d6, 0x5a4840, 1.7); scene.add(hemi);
  // environment: a blurred copy of the sky for restrained reflections on wet concrete, paint and armour
  {
    const es = new THREE.Scene(); es.add(new THREE.Mesh(skyGeo, sky.material)); const sd = sunDisc.clone(); sd.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.5) }); es.add(sd);
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, 0.04).texture; pm.dispose();
    if ("environmentIntensity" in scene) scene.environmentIntensity = 0.55;
  }

  /* ---------------------------------------------------------------- wet concrete ground with markings and puddles */
  const G = { x0: -80, x1: 80, z0: -62, z1: 98 }, GW = G.x1 - G.x0, GD = G.z1 - G.z0;
  const groundCol = F.canvasTex(2048, 2048, (g, w, h) => {
    const sx = w / GW, sz = h / GD, X = (x) => (x - G.x0) * sx, Z = (z) => (z - G.z0) * sz;
    g.fillStyle = "#77736e"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "20,18,16" : "150,145,138"},${rnd(0.02, 0.07)})`; const r = rnd(4, 40); g.fillRect(Math.random() * w, Math.random() * h, r, r * rnd(0.3, 1)); }
    g.strokeStyle = "rgba(30,28,26,.55)"; g.lineWidth = 2;   // slab joints every 6 m
    for (let x = G.x0; x < G.x1; x += 6) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), h); g.stroke(); }
    for (let z = G.z0; z < G.z1; z += 6) { g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(w, Z(z)); g.stroke(); }
    // lane markings: yellow driving lanes, white bay boxes with numbers
    g.fillStyle = "rgba(214,176,52,.85)";
    for (const z of [-48, -14, 24, 54]) for (let x = G.x0; x < G.x1; x += 4) g.fillRect(X(x), Z(z) - 1.5, 2.2 * sx, 0.18 * sz);
    for (const x of [-30, 0, 30]) for (let z = G.z0; z < G.z1; z += 4) g.fillRect(X(x) - 1.5, Z(z), 0.18 * sx, 2.2 * sz);
    g.strokeStyle = "rgba(225,222,210,.7)"; g.lineWidth = 0.15 * sx; g.font = `bold ${1.4 * sz | 0}px sans-serif`; g.fillStyle = "rgba(225,222,210,.55)";
    let n = 1;
    for (const [bx, bz] of [[-44, -28], [20, -30], [-50, 2], [52, 14], [-40, 34], [22, 38]]) { g.strokeRect(X(bx - 8), Z(bz - 5), 16 * sx, 10 * sz); g.fillText(`B${String(n++).padStart(2, "0")}`, X(bx - 7.5), Z(bz + 4.3)); }
    // quay edge: yellow safety strip
    g.fillStyle = "rgba(214,176,52,.9)"; g.fillRect(0, Z(-61.5), w, 0.6 * sz); g.fillStyle = "rgba(20,20,20,.9)"; for (let x = 0; x < w; x += 1.2 * sx) g.fillRect(x, Z(-61.5), 0.6 * sx, 0.6 * sz);
    // oil stains and tyre marks
    for (let i = 0; i < 120; i++) { const x = Math.random() * w, y = Math.random() * h, r = rnd(8, 40), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(10,9,8,.35)"); gr.addColorStop(1, "rgba(10,9,8,0)"); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  });
  groundCol.wrapS = groundCol.wrapT = THREE.ClampToEdgeWrapping; groundCol.repeat.set(1, 1);
  // puddles: low roughness + darker colour where water collects in dips
  const puddleCanvas = document.createElement("canvas"); puddleCanvas.width = puddleCanvas.height = 1024;
  {
    const g = puddleCanvas.getContext("2d"); g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 260; i++) { const x = Math.random() * 1024, y = Math.random() * 1024, r = rnd(4, 26); g.fillStyle = "#1a1a1a"; g.beginPath(); for (let k = 0; k < 12; k++) { const a = (k / 12) * 6.283, rr = r * rnd(0.6, 1.25); g.lineTo(x + Math.cos(a) * rr * 1.6, y + Math.sin(a) * rr); } g.fill(); }
    g.filter = "blur(3px)"; g.drawImage(puddleCanvas, 0, 0); g.filter = "none";
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 0 : 255},${Math.random() < 0.5 ? 0 : 255},${Math.random() < 0.5 ? 0 : 255},0.04)`; g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2); }
  }
  const puddleTex = new THREE.CanvasTexture(puddleCanvas); puddleTex.anisotropy = 4;
  const pdata = puddleCanvas.getContext("2d").getImageData(0, 0, 1024, 1024).data;
  W.puddleAt = (x, z) => { const u = (x - G.x0) / GW, v = (z - G.z0) / GD; if (u < 0 || u > 1 || v < 0 || v > 1) return false; return pdata[((v * 1023 | 0) * 1024 + (u * 1023 | 0)) * 4] < 90; };
  const concreteN = F.canvasTex(512, 512, (g, w, h) => {   // tiled micro-detail normal map
    const id = g.createImageData(w, h), d = id.data, hgt = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) hgt[i] = Math.random();
    for (let pass = 0; pass < 2; pass++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; hgt[i] = (hgt[i] * 2 + hgt[y * w + (x + 1) % w] + hgt[((y + 1) % h) * w + x]) / 4; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, dx = hgt[y * w + (x + 1) % w] - hgt[i], dy = hgt[((y + 1) % h) * w + x] - hgt[i]; d[i * 4] = 128 - dx * 400; d[i * 4 + 1] = 128 - dy * 400; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255; }
    g.putImageData(id, 0, 0);
  }, false, 40);
  const groundMat = new THREE.MeshStandardMaterial({ map: groundCol, roughnessMap: puddleTex, roughness: 1, metalness: 0.0, normalMap: concreteN, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 1.1 });
  groundMat.onBeforeCompile = (sh) => {   // puddles also darken the albedo a little (wet look)
    sh.fragmentShader = sh.fragmentShader.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
      diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.08, 0.6, roughnessFactor));`);
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GW, GD), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.set((G.x0 + G.x1) / 2, 0, (G.z0 + G.z1) / 2); ground.receiveShadow = true; scene.add(ground);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(1200, 900), new THREE.MeshStandardMaterial({ color: 0x3f3d3c, roughness: 0.85 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(0, -0.02, 380); apron.receiveShadow = true; scene.add(apron);

  /* ---------------------------------------------------------------- harbour water and quay wall */
  const waterN = F.canvasTex(256, 256, (g, w, h) => {
    const id = g.createImageData(w, h), d = id.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = Math.sin((x / w) * Math.PI * 8 + Math.sin((y / h) * Math.PI * 6) * 1.5), b = Math.cos((y / h) * Math.PI * 10 + Math.sin((x / w) * Math.PI * 4) * 2); const i = (y * w + x) * 4; d[i] = 128 + a * 50; d[i + 1] = 128 + b * 50; d[i + 2] = 255; d[i + 3] = 255; }
    g.putImageData(id, 0, 0);
  }, false, 90);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1100), new THREE.MeshStandardMaterial({ color: 0x1e2a30, roughness: 0.14, metalness: 0.2, normalMap: waterN, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 0.9 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -2.2, -62 - 550); scene.add(water);
  const quayWall = new THREE.Mesh(new THREE.BoxGeometry(1200, 6, 2), new THREE.MeshStandardMaterial({ color: 0x48443f, roughness: 0.9 })); quayWall.position.set(0, -3, -63); quayWall.receiveShadow = true; scene.add(quayWall);

  /* ---------------------------------------------------------------- shipping containers (instanced, three materials) */
  const ribs = (g, w, h, n) => { for (let i = 0; i < n; i++) { const x = (i / n) * w; const gr = g.createLinearGradient(x, 0, x + w / n, 0); gr.addColorStop(0, "rgba(0,0,0,.18)"); gr.addColorStop(0.5, "rgba(255,255,255,.12)"); gr.addColorStop(1, "rgba(0,0,0,.18)"); g.fillStyle = gr; g.fillRect(x, 0, w / n, h); } };
  const rust = (g, w, h, k) => { for (let i = 0; i < k; i++) { const x = Math.random() * w, l = rnd(h * 0.2, h * 0.9), gr = g.createLinearGradient(0, 0, 0, l); gr.addColorStop(0, "rgba(90,44,20,.55)"); gr.addColorStop(1, "rgba(90,44,20,0)"); g.fillStyle = gr; g.fillRect(x, 0, rnd(1, 4), l); } for (let i = 0; i < k / 2; i++) { g.fillStyle = `rgba(80,40,18,${rnd(0.15, 0.4)})`; g.fillRect(Math.random() * w, Math.random() * h, rnd(2, 10), rnd(2, 8)); } };
  const sideTex = F.canvasTex(1024, 256, (g, w, h) => { g.fillStyle = "#d8d8d8"; g.fillRect(0, 0, w, h); ribs(g, w, h, 56); g.fillStyle = "rgba(40,40,40,.5)"; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 8, w, 8); g.fillRect(0, 0, 8, h); g.fillRect(w - 8, 0, 8, h); rust(g, w, h, 70); g.fillStyle = "rgba(255,255,255,.75)"; g.font = "bold 22px monospace"; g.fillText(`IRFU ${100000 + Math.random() * 899999 | 0}`, 40, 46); g.font = "14px monospace"; g.fillText("MAX GROSS 30480 KG", 40, 70); });
  const sideN = F.canvasTex(1024, 64, (g, w, h) => { const n = 56; for (let x = 0; x < w; x++) { const s = Math.sin((x / w) * n * Math.PI * 2); g.fillStyle = `rgb(${128 + s * 90 | 0},128,255)`; g.fillRect(x, 0, 1, h); } }, false);
  const doorTex = F.canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#d4d4d4"; g.fillRect(0, 0, w, h); ribs(g, w, h, 10); g.fillStyle = "rgba(30,30,30,.7)"; g.fillRect(w / 2 - 2, 0, 4, h); for (const x of [0.14, 0.36, 0.64, 0.86]) { g.fillStyle = "rgba(60,60,60,.85)"; g.fillRect(x * w - 3, 10, 6, h - 20); g.fillRect(x * w - 7, h * 0.55, 14, 20); } rust(g, w, h, 30); });
  const roofTex = F.canvasTex(512, 128, (g, w, h) => { g.fillStyle = "#bfbfbf"; g.fillRect(0, 0, w, h); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${rnd(0.04, 0.12)})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, rnd(6, 26), 0, 7); g.fill(); } rust(g, w, h, 50); });
  const cMats = [
    new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.7, metalness: 0.35 }), new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.7, metalness: 0.35 }),
    new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.6, metalness: 0.35 }), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ map: sideTex, normalMap: sideN, roughness: 0.62, metalness: 0.35 }), new THREE.MeshStandardMaterial({ map: sideTex, normalMap: sideN, roughness: 0.62, metalness: 0.35 }),
  ];
  const PALETTE = ["#8e3b2a", "#2c4f7c", "#3f6a4a", "#c4652a", "#6b6f72", "#b9b9b2", "#2f6f73", "#b8902a", "#7a2f3a", "#425a8a"].map((c) => new THREE.Color(c));
  const CL = 12.19, CH = 2.59, CWd = 2.44;
  const cList40 = [], cList20 = [];
  const addCollider = (x0, x1, y0, y1, z0, z1, kind = "box") => { const c = { x0, x1, y0, y1, z0, z1, kind }; W.colliders.push(c); return c; };
  // a block: `cols` stacks side by side; levels per stack; `along` is the long axis ("x" or "z")
  function block(cx, cz, along, levels, len = CL) {
    const n = levels.length;
    levels.forEach((lv, i) => {
      const off = (i - (n - 1) / 2) * (CWd + 0.12);
      const x = along === "x" ? cx : cx + off, z = along === "x" ? cz + off : cz;
      for (let k = 0; k < lv; k++) (len > 8 ? cList40 : cList20).push({ x: x + sr(-0.08, 0.08), y: CH / 2 + k * CH, z: z + sr(-0.08, 0.08), ry: (along === "x" ? 0 : Math.PI / 2) + sr(-0.008, 0.008), c: PALETTE[srnd() * PALETTE.length | 0] });
      const hx = (along === "x" ? len : CWd) / 2, hz = (along === "x" ? CWd : len) / 2;
      addCollider(x - hx, x + hx, 0, lv * CH, z - hz, z + hz, "container");
    });
  }
  const BLOCKS = [
    [-44, -28, "x", [2, 3, 2]], [-17, -32, "x", [1, 2]], [20, -30, "x", [3, 2, 1]], [47, -27, "z", [2, 2]],
    [-51, 2, "z", [3, 3, 2]], [-26, 8, "x", [1, 2]], [32, 4, "z", [1, 2]], [52, 16, "z", [3, 2, 3]],
    [-41, 35, "x", [2, 1]], [-12, 42, "x", [1]], [23, 38, "x", [2, 3]], [48, 46, "x", [1, 2]],
    [-6, 12, "x", [2]], [7, 12, "x", [1]],
  ];
  for (const [x, z, a, lv] of BLOCKS) block(x, z, a, lv);
  for (const [x, z, a] of [[-8, -12, "z"], [10, -9, "x"], [-31, -10, "z"], [33, -12, "x"], [-20, 26, "z"], [38, 27, "x"], [-56, 52, "x"], [0, 28, "x"]]) block(x, z, a, [1], 6.06);
  // perimeter: tall walls of stacked boxes so the arena reads as a yard deep inside the terminal
  for (let x = -60; x <= 60; x += 12.6) { block(x, 70, "x", [3, 2, 3]); }
  for (let z = -48; z <= 62; z += 12.6) { block(-71, z, "z", [2, 3]); block(71, z, "z", [3, 2]); }
  const mkInst = (list, len) => {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(len, CH, CWd), cMats, list.length), d = new THREE.Object3D();
    list.forEach((c, i) => { d.position.set(c.x, c.y, c.z); d.rotation.set(0, c.ry, 0); d.updateMatrix(); m.setMatrixAt(i, d.matrix); m.setColorAt(i, c.c); });
    m.castShadow = m.receiveShadow = true; scene.add(m); return m;
  };
  mkInst(cList40, CL); mkInst(cList20, 6.06);
  // invisible world bounds
  addCollider(-200, 200, -5, 50, -80, -61.2, "edge"); addCollider(-200, -66, -5, 50, -80, 200, "edge"); addCollider(66, 200, -5, 50, -80, 200, "edge"); addCollider(-200, 200, -5, 50, 66, 200, "edge");

  /* ---------------------------------------------------------------- jersey barriers (low cover you can vault onto) */
  {
    const B = new F.Builder(), grp = new THREE.Group(), bm = new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.85, map: F.TEX.wear });
    const shape = new THREE.Shape([[-0.3, 0], [0.3, 0], [0.12, 0.3], [0.1, 0.95], [-0.1, 0.95], [-0.12, 0.3]].map(([x, y]) => new THREE.Vector2(x, y)));
    const bg = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false }); bg.translate(0, 0, -1.5);
    for (const [x, z, ry] of [[-6, 21, 0], [6, 21, 0], [-15, -19, Math.PI / 2], [15, -20, Math.PI / 2], [-2, -2, 0], [26, -2, Math.PI / 2], [-36, 18, 0], [40, -40, 0], [-38, -44, Math.PI / 2], [12, 52, 0], [-26, 54, Math.PI / 2], [0, -46, 0], [8, -46, 0]]) {
      B.add(grp, bg, bm, x, 0, z, 0, ry); const hx = ry ? 1.5 : 0.3, hz = ry ? 0.3 : 1.5; addCollider(x - hx, x + hx, 0, 0.95, z - hz, z + hz, "barrier");
      // hazard stripe cap
    }
    B.build(); scene.add(grp);
  }

  /* ---------------------------------------------------------------- reach stackers (vehicles used as cover) */
  function reachStacker(x, z, ry) {
    const g = new THREE.Group(), B = new F.Builder(), paint = new THREE.MeshStandardMaterial({ color: 0xc9781e, roughness: 0.5, metalness: 0.3, roughnessMap: F.TEX.wear });
    const tyre = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9 });
    B.add(g, F.rbox(3.4, 1.5, 7.6, 0.25), paint, 0, 1.6, 0);
    B.add(g, F.rbox(3.0, 0.5, 2.2, 0.15), "black", 0, 2.6, -2.6);                    // counterweight top
    B.add(g, F.rbox(1.6, 2.0, 1.8, 0.12), paint, -0.8, 3.3, -0.4);                    // cab frame
    B.add(g, F.box(1.5, 1.3, 1.7), F.MAT.glass, -0.8, 3.4, -0.4);
    B.add(g, F.rbox(0.9, 0.9, 9, 0.12), paint, 0.7, 4.2, 1.2, -0.42);                 // boom
    B.add(g, F.rbox(0.7, 0.7, 4, 0.1), "exoFrame", 0.7, 6.0, 5.4, -0.42);
    B.add(g, F.rbox(2.6, 0.5, 0.6, 0.08), paint, 0.7, 7.0, 7.6);                       // spreader
    B.add(g, F.box(2.5, 0.25, 0.25), "hazard", 0, 0.95, 3.85);
    for (const [wx, wz] of [[-1.55, 2.4], [1.55, 2.4], [-1.55, -2.5], [1.55, -2.5]]) { B.add(g, F.cyl(0.85, 0.85, 0.7, 18), tyre, wx, 0.85, wz, 0, 0, Math.PI / 2); B.add(g, F.cyl(0.45, 0.45, 0.72, 12), "gunmetal", wx, 0.85, wz, 0, 0, Math.PI / 2); }
    B.build(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    const rot = Math.abs(Math.sin(ry)) > 0.5, hx = rot ? 3.9 : 1.9, hz = rot ? 1.9 : 3.9;
    addCollider(x - hx, x + hx, 0, 2.4, z - hz, z + hz, "vehicle");
  }
  reachStacker(-3, 4, 0); reachStacker(18, 24, Math.PI / 2); reachStacker(-32, 22, Math.PI); reachStacker(36, -46, Math.PI / 2);

  /* ---------------------------------------------------------------- cranes: two ship-to-shore cranes and a yard gantry */
  const craneRed = new THREE.MeshStandardMaterial({ color: 0xa4372b, roughness: 0.55, metalness: 0.5, roughnessMap: F.TEX.wear });
  const craneWhite = new THREE.MeshStandardMaterial({ color: 0xd8d4cb, roughness: 0.5, metalness: 0.4, roughnessMap: F.TEX.wear });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x332a1e, emissive: 0xffc58a, emissiveIntensity: 1.2 });
  const truss = (B, mat, x0, y0, z0, x1, y1, z1, w) => {   // a member between two points
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dx, dy, dz);
    const g = new THREE.BoxGeometry(w, w, L), m = new THREE.Object3D(); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.lookAt(x1, y1, z1);
    B.add(B.root, g, mat, m.position.x, m.position.y, m.position.z, m.rotation.x, m.rotation.y, m.rotation.z);
  };
  function stsCrane(cx) {
    const grp = new THREE.Group(), B = new F.Builder(); B.root = grp;
    const zs = -58.5, zl = -42, gx = 8;
    for (const sx of [-1, 1]) for (const z of [zs, zl]) { truss(B, craneRed, cx + sx * gx, 0, z, cx + sx * gx, 32, z, 1.4); addCollider(cx + sx * gx - 0.9, cx + sx * gx + 0.9, 0, 32, z - 0.9, z + 0.9, "crane"); B.add(grp, F.rbox(2.4, 1.2, 3.2, 0.2), "exoFrame", cx + sx * gx, 0.6, z); }
    for (const z of [zs, zl]) truss(B, craneRed, cx - gx, 32, z, cx + gx, 32, z, 1.6);
    for (const sx of [-1, 1]) { truss(B, craneRed, cx + sx * gx, 14, zs, cx + sx * gx, 14, zl, 1.0); truss(B, craneRed, cx + sx * gx, 2, zs, cx + sx * gx, 14, zl, 0.6); }
    // boom over the water and the back reach, with A-frame and stays
    for (const sx of [-0.7, 0.7]) { truss(B, craneWhite, cx + sx * 4, 36, -130, cx + sx * 4, 36, -24, 1.4); }
    for (let z = -128; z < -24; z += 6) { truss(B, craneWhite, cx - 2.8, 36, z, cx + 2.8, 36, z, 0.4); truss(B, craneWhite, cx - 2.8, 36, z, cx + 2.8, 36, z + 6, 0.3); }
    for (const sx of [-1, 1]) { truss(B, craneRed, cx + sx * gx, 32, zs, cx + sx * 3, 52, -50, 1.0); truss(B, craneRed, cx + sx * gx, 32, zl, cx + sx * 3, 52, -50, 1.0); truss(B, craneWhite, cx + sx * 3, 52, -50, cx + sx * 2.8, 36, -126, 0.35); truss(B, craneWhite, cx + sx * 3, 52, -50, cx + sx * 2.8, 36, -26, 0.35); }
    B.add(grp, F.rbox(6, 4, 8, 0.4), craneWhite, cx, 39, -38);   // machinery house
    B.add(grp, F.rbox(3.2, 2.6, 3, 0.3), craneWhite, cx, 33.5, -76); B.add(grp, F.box(3, 1.6, 0.1), F.MAT.glass, cx, 33.8, -77.55);   // trolley cab
    for (const z of [-80, -110]) B.add(grp, F.cyl(0.04, 0.04, 30, 4), "black", cx, 21, z);
    for (const z of [-30, -70, -120]) B.add(grp, F.box(0.6, 0.4, 0.6), lampMat, cx, 35.2, z);
    B.build(); scene.add(grp);
  }
  stsCrane(-26); stsCrane(26);
  {  // rubber-tyred gantry over the middle row
    const grp = new THREE.Group(), B = new F.Builder(); B.root = grp; const x0 = -16, x1 = 18, z0 = 7.4, z1 = 16.6, H = 16;
    for (const x of [x0, x1]) { for (const z of [z0, z1]) { truss(B, craneWhite, x, 0.8, z, x, H, z, 0.9); addCollider(x - 0.6, x + 0.6, 0, H, z - 0.6, z + 0.6, "crane"); B.add(grp, F.cyl(0.8, 0.8, 0.8, 14), "black", x, 0.8, z, 0, 0, Math.PI / 2); } truss(B, craneWhite, x, 1.4, z0, x, 1.4, z1, 0.8); truss(B, craneWhite, x, H, z0, x, H, z1, 1.0); }
    for (const z of [z0, z1]) truss(B, craneRed, x0, H, z, x1, H, z, 1.2);
    B.add(grp, F.rbox(4, 2, 10, 0.2), craneRed, 4, H + 1.2, 12); B.add(grp, F.rbox(1.6, 1.8, 1.8, 0.15), craneWhite, 4, H - 1.5, 9); B.add(grp, F.box(1.4, 1.2, 0.08), F.MAT.glass, 4, H - 1.4, 9.95);
    B.add(grp, F.rbox(2.8, 0.45, 12.4, 0.08), "hazard", 4, 9, 12); for (const sx of [-1, 1]) B.add(grp, F.cyl(0.03, 0.03, 6, 4), "black", 4 + sx * 1.2, 12.5, 12);
    B.build(); scene.add(grp);
  }
  // yard light masts with restrained lamps
  for (const [x, z] of [[-34, -16], [34, -18], [-36, 50], [36, 52], [0, -52], [0, 60]]) {
    const grp = new THREE.Group(), B = new F.Builder(); B.root = grp;
    truss(B, craneWhite, x, 0, z, x, 26, z, 0.5); B.add(grp, F.box(3, 0.3, 1.2), "exoFrame", x, 26, z); for (const dx of [-1, 0, 1]) B.add(grp, F.box(0.8, 0.5, 0.2), lampMat, x + dx, 25.6, z + (z > 0 ? -0.7 : 0.7));
    B.build(); scene.add(grp); addCollider(x - 0.4, x + 0.4, 0, 26, z - 0.4, z + 0.4, "pole");
  }
  // bollards along the quay
  { const g = new THREE.Group(), B = new F.Builder(); for (let x = -60; x <= 60; x += 10) { B.add(g, F.cyl(0.32, 0.4, 0.9, 12), "exoFrame", x, 0.45, -60.6); B.add(g, F.cyl(0.42, 0.42, 0.12, 12), "exoFrame", x, 0.9, -60.6); } B.build(); scene.add(g); }

  /* ---------------------------------------------------------------- drizzle: streaks that follow the camera */
  const RN = 1800, rainGeo = new THREE.BufferGeometry(), rainPos = new Float32Array(RN * 6), rainV = new Float32Array(RN * 3);
  for (let i = 0; i < RN; i++) { rainV[i * 3] = rnd(-40, 40); rainV[i * 3 + 1] = rnd(0, 26); rainV[i * 3 + 2] = rnd(-40, 40); }
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc9c6cf, transparent: true, opacity: 0.32, fog: true, depthWrite: false }));
  rain.frustumCulled = false; scene.add(rain);
  const WIND = { x: 1.1, z: 0.6 };

  /* ---------------------------------------------------------------- spawn gates for enemies */
  W.spawns = [[-58, 56], [58, 56], [-60, -6], [60, -14], [-6, 60], [30, 60], [-46, -54], [46, -54], [-58, 24], [58, 34], [-20, 58], [10, -56]].map(([x, z]) => ({ x, z }));

  /* ---------------------------------------------------------------- navigation grid (1 m cells) */
  const NX = 128, NZ = 128, NOX = -64, NOZ = -61; W.nav = { NX, NZ, NOX, NOZ, block: new Uint8Array(NX * NZ) };
  for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) {
    const x = NOX + i + 0.5, z = NOZ + k + 0.5;
    for (const c of W.colliders) if (c.kind !== "edge" && x > c.x0 - 0.7 && x < c.x1 + 0.7 && z > c.z0 - 0.7 && z < c.z1 + 0.7 && c.y1 > 0.5) { W.nav.block[i * NZ + k] = 1; break; }
  }
  W.cellOf = (x, z) => { const i = Math.floor(x - NOX), k = Math.floor(z - NOZ); return i < 0 || k < 0 || i >= NX || k >= NZ ? -1 : i * NZ + k; };
  // breadth-first distance field from a target; enemies walk downhill on it
  W.flow = (tx, tz, out) => {
    out.fill(65535); const q = new Int32Array(NX * NZ); let h = 0, t = 0; const s = W.cellOf(tx, tz); if (s < 0) return out;
    out[s] = 0; q[t++] = s;
    while (h < t) { const c = q[h++], i = (c / NZ) | 0, k = c % NZ, d = out[c] + 1;
      if (i > 0) { const n = c - NZ; if (!W.nav.block[n] && out[n] > d) { out[n] = d; q[t++] = n; } }
      if (i < NX - 1) { const n = c + NZ; if (!W.nav.block[n] && out[n] > d) { out[n] = d; q[t++] = n; } }
      if (k > 0) { const n = c - 1; if (!W.nav.block[n] && out[n] > d) { out[n] = d; q[t++] = n; } }
      if (k < NZ - 1) { const n = c + 1; if (!W.nav.block[n] && out[n] > d) { out[n] = d; q[t++] = n; } } }
    return out;
  };

  /* ---------------------------------------------------------------- ray casting against the boxes and the ground */
  W.raycast = (o, d, max, out = {}) => {
    let best = max, n = null, hit = null;
    if (d.y < -1e-4) { const t = -o.y / d.y; if (t > 0 && t < best) { best = t; n = [0, 1, 0]; hit = "ground"; } }
    for (const c of W.colliders) {
      let t0 = 0, t1 = best, nn = null;
      for (const [ax, lo, hi] of [[0, c.x0, c.x1], [1, c.y0, c.y1], [2, c.z0, c.z1]]) {
        const oo = ax === 0 ? o.x : ax === 1 ? o.y : o.z, dd = ax === 0 ? d.x : ax === 1 ? d.y : d.z;
        if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) { t0 = 1e9; break; } continue; }
        let ta = (lo - oo) / dd, tb = (hi - oo) / dd, s = -1; if (ta > tb) { const q = ta; ta = tb; tb = q; s = 1; }
        if (ta > t0) { t0 = ta; nn = [ax, s]; } if (tb < t1) t1 = tb; if (t0 > t1) { t0 = 1e9; break; }
      }
      if (t0 < best && t0 > 0 && nn) { best = t0; n = [0, 0, 0]; n[nn[0]] = nn[1]; hit = c; }
    }
    out.t = best; out.n = n; out.hit = hit; return out;
  };
  // first blocker between two points (line of sight)
  const tmpO = new THREE.Vector3(), tmpD = new THREE.Vector3(), RH = {};
  W.los = (a, b) => { tmpD.subVectors(b, a); const L = tmpD.length(); tmpD.divideScalar(L); W.raycast(a, tmpD, L, RH); return RH.t >= L - 0.05; };

  /* ---------------------------------------------------------------- per-frame */
  const camTmp = new THREE.Vector3();
  W.update = (dt, t, cam) => {
    camTmp.copy(cam.position);
    skyGroup.position.copy(camTmp); clouds.rotation.y += dt * 0.004;
    waterN.offset.x = (t * 0.012) % 1; waterN.offset.y = (t * 0.007) % 1;
    for (let i = 0; i < RN; i++) {
      let x = rainV[i * 3] + WIND.x * dt * 2, y = rainV[i * 3 + 1] - dt * 11, z = rainV[i * 3 + 2] + WIND.z * dt * 2;
      if (y < 0) { y += 26; x = rnd(-40, 40); z = rnd(-40, 40); }
      if (x > 40) x -= 80; if (x < -40) x += 80; if (z > 40) z -= 80; if (z < -40) z += 80;
      rainV[i * 3] = x; rainV[i * 3 + 1] = y; rainV[i * 3 + 2] = z;
      const px = camTmp.x + x, py = camTmp.y - 6 + y, pz = camTmp.z + z, o = i * 6;
      rainPos[o] = px; rainPos[o + 1] = py; rainPos[o + 2] = pz; rainPos[o + 3] = px - WIND.x * 0.05; rainPos[o + 4] = py + 0.42; rainPos[o + 5] = pz - WIND.z * 0.05;
    }
    rainGeo.attributes.position.needsUpdate = true;
    // shadow box follows the player
    sun.position.set(cam.position.x + SUN.x * 160, SUN.y * 160, cam.position.z + SUN.z * 160); sun.target.position.set(cam.position.x, 0, cam.position.z);
  };

  /* ---------------------------------------------------------------- stage 2 (streamed): harbour ships and far terminals */
  W.stages.push(() => {
    const ship = (x, z, len, hullCol, scale = 1) => {
      const grp = new THREE.Group(), B = new F.Builder(), hull = new THREE.MeshStandardMaterial({ color: hullCol, roughness: 0.6, metalness: 0.3, roughnessMap: F.TEX.wear }), red = new THREE.MeshStandardMaterial({ color: 0x6e231d, roughness: 0.7 });
      const sh = new THREE.Shape(); sh.moveTo(-len / 2, -16); sh.lineTo(len / 2 - 22, -16); sh.quadraticCurveTo(len / 2 + 4, -16, len / 2 + 6, 0); sh.quadraticCurveTo(len / 2 + 4, 16, len / 2 - 22, 16); sh.lineTo(-len / 2, 16); sh.lineTo(-len / 2, -16);
      const hg = new THREE.ExtrudeGeometry(sh, { depth: 16, bevelEnabled: false, curveSegments: 10 }); hg.rotateX(-Math.PI / 2);
      B.add(grp, hg, hull, 0, -6, 0); B.add(grp, F.box(len + 4, 4, 32.2), red, 2, -6, 0);
      B.add(grp, F.rbox(16, 14, 30, 0.6), craneWhite, -len / 2 + 14, 17, 0); B.add(grp, F.box(16.2, 1.6, 30.2), F.MAT.glass, -len / 2 + 14, 21, 0); B.add(grp, F.cyl(2.2, 2.6, 12, 12), red, -len / 2 + 8, 28, 0);
      B.build(); grp.position.set(x, 0, z); grp.scale.setScalar(scale); scene.add(grp);
      // container stacks on deck
      const list = []; for (let bx = -len / 2 + 30; bx < len / 2 - 26; bx += 13) for (let r = -5; r <= 5; r++) { const h = 2 + (srnd() * 5 | 0); for (let k = 0; k < h; k++) list.push({ x: x + bx * scale, y: (10 + CH / 2 + k * CH) * scale, z: z + r * (CWd + 0.1) * scale, ry: 0, c: PALETTE[srnd() * PALETTE.length | 0] }); }
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(CL * scale, CH * scale, CWd * scale), cMats, list.length), d = new THREE.Object3D();
      list.forEach((c, i) => { d.position.set(c.x, c.y, c.z); d.rotation.set(0, Math.PI / 2 * 0, 0); d.updateMatrix(); m.setMatrixAt(i, d.matrix); m.setColorAt(i, c.c); });
      m.castShadow = true; m.receiveShadow = true; scene.add(m);
      grp.rotation.y = 0;
    };
    ship(150, -84, 230, 0x22303a); ship(160, -360, 260, 0x3a2420, 1); ship(-420, -520, 260, 0x24282e, 1);
    // distant terminal cranes on the far shore: cheap silhouettes
    const far = new THREE.Group(), B = new F.Builder(), dark = new THREE.MeshStandardMaterial({ color: 0x3a3236, roughness: 0.8 });
    for (let k = 0; k < 9; k++) { const x = -700 + k * 120, z = -900; B.root = far; truss(B, dark, x - 10, 0, z, x - 10, 45, z, 3); truss(B, dark, x + 10, 0, z, x + 10, 45, z, 3); truss(B, dark, x - 10, 45, z, x + 10, 45, z, 3); truss(B, dark, x, 50, z - 70, x, 50, z + 40, 3); }
    B.build({ shadow: false }); scene.add(far);
  });

  return W;
}
