// Frontier Crown — shipment visuals.
//  · Transit marker: a spinning gold emblem with a progress ring floats above the receiving Town
//    Center while a shipment sails (ring = shader with a uProgress uniform, no geometry rebuilds).
//  · Arrival: a column of light (additive cylinder, scrolling bands, soft top), a shock ring on the
//    ground, and ONE warm PointLight that flares and fades.
// The PointLight lives in the scene from the start with intensity 0: adding/removing a light changes
// the light count baked into every lit shader and would force a recompile (a hitch) on each arrival.

export function createShipFx(THREE, { quality = "high" } = {}) {
  const group = new THREE.Group();
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

  // ---------------------------------------------------------------- light column
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
  const beamMat = () => new THREE.ShaderMaterial({
    ...additive, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.82, 0.45) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main() {
        vUv = uv; vec4 wp = modelMatrix * vec4( position, 1.0 );
        vN = normalize( mat3( modelMatrix ) * normal ); vView = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uAlpha; uniform vec3 uColor;
      varying vec2 vUv; varying vec3 vN; varying vec3 vView;
      void main() {
        float edge = abs( dot( normalize( vN ), normalize( vView ) ) );        // bright core, soft rim
        float bands = 0.65 + 0.35 * sin( vUv.y * 22.0 - uTime * 9.0 );
        float fall = ( 1.0 - vUv.y ) * ( 1.0 - vUv.y );                       // fades toward the sky
        float a = uAlpha * edge * edge * bands * fall;
        gl_FragColor = vec4( uColor * ( 1.2 + 0.8 * bands ), a );
        #include <colorspace_fragment>
      }`,
  });
  // ---------------------------------------------------------------- ground shock ring
  const ringGeo = new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2);
  const ringMat = () => new THREE.MeshBasicMaterial({ color: 0xffd27a, opacity: 0, ...additive });

  const bursts = [];
  for (let i = 0; i < 3; i++) {
    const beam = new THREE.Mesh(beamGeo, beamMat()); beam.visible = false; beam.renderOrder = 4; beam.frustumCulled = false;
    const ring = new THREE.Mesh(ringGeo, ringMat()); ring.visible = false; ring.renderOrder = 4;
    group.add(beam, ring);
    bursts.push({ beam, ring, t: 99, x: 0, y: 0, z: 0, r: 3 });
  }
  const light = new THREE.PointLight(0xffc870, 0, 18, 1.6);
  light.castShadow = false;
  if (quality !== "low") group.add(light);
  let lightT = 99;

  // ---------------------------------------------------------------- transit marker
  const marker = new THREE.Group(); marker.visible = false; group.add(marker);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0xe9b93a, emissive: 0x7a4a08, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.3, flatShading: true }));
  gem.scale.set(1, 1.35, 1);
  const progMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      uniform float uProgress; uniform float uTime; varying vec2 vP;
      void main() {
        float r = length( vP );
        if ( r < 0.78 || r > 1.0 ) discard;
        float ang = fract( atan( vP.x, vP.y ) / 6.2831853 + 1.0 );            // 0 at 12 o'clock, clockwise
        bool done = ang < uProgress;
        vec3 c = done ? vec3( 1.0, 0.82, 0.35 ) : vec3( 0.12, 0.09, 0.05 );
        float a = done ? 0.95 : 0.55;
        gl_FragColor = vec4( c * ( done ? 1.0 + 0.25 * sin( uTime * 6.0 ) : 1.0 ), a );
        #include <colorspace_fragment>
      }`,
  });
  const prog = new THREE.Mesh(new THREE.CircleGeometry(1, 48), progMat); prog.scale.setScalar(1.15); prog.renderOrder = 5;
  marker.add(gem, prog);

  let time = 0;
  return {
    group,
    /** Arrival burst at (x, y, z) — r = footprint radius of the receiving building. */
    burst(x, y, z, r = 3) {
      const b = bursts.reduce((a, c) => (c.t > a.t ? c : a));
      Object.assign(b, { t: 0, x, y, z, r });
      if (quality !== "low") { light.position.set(x, y + 6.5, z); lightT = 0; }
    },
    /** Transit marker over (x, y, z); progress 0..1, or null to hide. */
    transit(x, y, z, progress, camQuat) {
      if (progress == null) { marker.visible = false; return; }
      marker.visible = true;
      marker.position.set(x, y + 7.2 + Math.sin(time * 2.2) * 0.2, z);
      gem.rotation.y = time * 1.6;
      prog.quaternion.copy(camQuat);           // face the camera
      progMat.uniforms.uProgress.value = progress;
    },
    update(dt) {
      time += dt; progMat.uniforms.uTime.value = time;
      for (const b of bursts) {
        b.t += dt;
        const on = b.t < 3.2;
        b.beam.visible = b.ring.visible = on;
        if (!on) continue;
        const k = b.t, rise = Math.min(1, k / 0.35), fade = 1 - Math.max(0, (k - 1.6) / 1.6);
        b.beam.position.set(b.x, b.y, b.z);
        b.beam.scale.set(b.r * (0.55 + 0.25 * rise), 26 * rise, b.r * (0.55 + 0.25 * rise));
        b.beam.material.uniforms.uTime.value = time;
        b.beam.material.uniforms.uAlpha.value = 1.4 * fade * (0.6 + 0.4 * rise);
        const rr = b.r * (0.6 + 3.2 * Math.min(1, k / 1.1));
        b.ring.position.set(b.x, b.y + 0.12, b.z); b.ring.scale.setScalar(rr);
        b.ring.material.opacity = Math.max(0, 0.9 * (1 - k / 1.1));
      }
      lightT += dt;
      light.intensity = lightT < 2.6 ? 40 * Math.min(1, lightT / 0.15) * Math.pow(1 - lightT / 2.6, 1.6) * (1 + 0.15 * Math.sin(time * 30)) : 0;
    },
    dispose() {
      beamGeo.dispose(); ringGeo.dispose(); progMat.dispose(); gem.geometry.dispose(); gem.material.dispose(); prog.geometry.dispose();
      for (const b of bursts) { b.beam.material.dispose(); b.ring.material.dispose(); }
    },
  };
}
