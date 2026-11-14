// 3D rover built from simple shapes. It changes with the player's design:
// wheels or legs, solar panels or RTG, scoop / drum / drill, antennas, tether spool.
import * as THREE from 'three';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35, ...extra });
const M = {
  foil: mat(0xd8a943, { metalness: 0.8, roughness: 0.35 }),
  white: mat(0xe9edf2, { roughness: 0.6, metalness: 0.1 }),
  dark: mat(0x2a2f3a, { roughness: 0.7 }),
  metal: mat(0x9aa3b2, { metalness: 0.8, roughness: 0.3 }),
  panel: mat(0x1d3a7a, { metalness: 0.6, roughness: 0.25, emissive: 0x06122e }),
  rtg: mat(0x3b3f47, { emissive: 0x3a1204, emissiveIntensity: 0.6 }),
  tire: mat(0x6c7480, { metalness: 0.6, roughness: 0.5, wireframe: false }),
  mesh: mat(0xb8c2d0, { metalness: 0.9, roughness: 0.3, wireframe: true }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xfff3c4 }),
  sensor: mat(0xf2b84b, { emissive: 0x3a2400 }),
};

function box(w, h, d, m) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.castShadow = true; o.receiveShadow = true; return o; }
function cyl(rt, rb, h, m, seg = 20) { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.castShadow = true; return o; }

function wheel(r, w, meshy) {
  const g = new THREE.Group();
  const tire = cyl(r, r, w, M.tire, 24); tire.rotation.x = Math.PI / 2; g.add(tire);
  if (meshy) { const net = cyl(r * 1.02, r * 1.02, w * 1.05, M.mesh, 16); net.rotation.x = Math.PI / 2; g.add(net); }
  const hub = cyl(r * 0.35, r * 0.35, w * 1.1, M.dark); hub.rotation.x = Math.PI / 2; g.add(hub);
  return g;
}

function leg(side) {
  const g = new THREE.Group();
  const thigh = cyl(0.06, 0.06, 0.7, M.metal); thigh.rotation.z = side * 1.0; thigh.position.set(0, 0.1, side * 0.3); thigh.rotation.x = side * 0.9;
  const shin = cyl(0.05, 0.03, 0.75, M.metal); shin.position.set(0, -0.25, side * 0.62);
  const foot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), M.dark); foot.position.set(0, -0.62, side * 0.62);
  g.add(thigh, shin, foot);
  return g;
}

function panel(w, h) {
  const g = new THREE.Group();
  const p = box(w, h, 0.04, M.panel); g.add(p);
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(p.geometry), new THREE.LineBasicMaterial({ color: 0x8aa0c8 }));
  g.add(frame);
  return g;
}

/** Build the rover. `design` is the parts object from parts.js (ids per slot). */
export function buildRover(design) {
  const g = new THREE.Group();
  const parts = { wheels: [], legs: [], drums: [], drill: null, dish: null, lamp: null };

  const body = box(1.6, 0.45, 1.0, M.foil); body.position.y = 0.75; g.add(body);
  const deck = box(1.5, 0.06, 0.9, M.white); deck.position.y = 1.0; g.add(deck);
  const mast = cyl(0.04, 0.04, 0.8, M.metal); mast.position.set(0.55, 1.4, 0); g.add(mast);
  const head = box(0.18, 0.14, 0.32, M.dark); head.position.set(0.6, 1.82, 0); g.add(head);
  for (const z of [-0.09, 0.09]) { const cam = cyl(0.04, 0.04, 0.06, M.lamp); cam.rotation.z = Math.PI / 2; cam.position.set(0.71, 1.84, z); g.add(cam); }
  const lampL = box(0.04, 0.08, 0.5, M.lamp); lampL.position.set(0.81, 0.82, 0); g.add(lampL);
  const spot = new THREE.SpotLight(0xfff1cf, 0, 9, 0.6, 0.5, 1.5); spot.position.set(0.85, 0.85, 0);
  spot.target.position.set(4, -0.6, 0); g.add(spot, spot.target); parts.lamp = spot;

  // mobility
  if (design.mobility === 'legs') {
    for (const x of [-0.6, 0, 0.6]) for (const side of [-1, 1]) {
      const l = leg(side); l.position.set(x, 0.65, 0); l.userData.phase = (x * 2 + (side > 0 ? 0 : 1)) % 2; g.add(l); parts.legs.push(l);
    }
  } else {
    const xs = design.mobility === 'mesh6' ? [-0.62, 0, 0.62] : [-0.6, 0.6];
    const r = design.mobility === 'mesh6' ? 0.3 : 0.28;
    for (const x of xs) for (const z of [-0.62, 0.62]) {
      const w = wheel(r, 0.22, design.mobility === 'mesh6'); w.position.set(x, r, z); g.add(w); parts.wheels.push(w);
      const strut = box(0.06, 0.4, 0.06, M.metal); strut.position.set(x, 0.55, z * 0.82); g.add(strut);
    }
  }

  // power: polar Sun is low on the horizon, so panels stand upright like VIPER's
  if (design.power === 'rtg') {
    const rtg = cyl(0.17, 0.17, 0.55, M.rtg); rtg.rotation.z = 0.7; rtg.position.set(-0.95, 1.05, 0); g.add(rtg);
    for (let k = 0; k < 6; k++) { const fin = box(0.02, 0.5, 0.42, M.dark); fin.rotation.x = (k / 6) * Math.PI; fin.position.copy(rtg.position); fin.rotation.z = 0.7; g.add(fin); }
  } else {
    const big = design.power === 'solarL';
    for (const z of big ? [-0.52, 0.52] : [0.52]) {
      const p = panel(big ? 1.3 : 1.0, big ? 0.9 : 0.7); p.position.set(-0.15, 1.5, z); p.rotation.y = 0; g.add(p);
    }
  }
  if (design.extra === 'panels') { const p = panel(0.9, 0.6); p.position.set(-0.4, 1.2, 0); p.rotation.y = Math.PI / 2; g.add(p); }

  // excavator at the front (+x)
  if (design.digger === 'drum') {
    for (const z of [-0.28, 0.28]) {
      const d = cyl(0.22, 0.22, 0.42, M.metal, 12); d.rotation.x = Math.PI / 2; d.position.set(1.15, 0.3, z);
      for (let k = 0; k < 6; k++) { const s = box(0.06, 0.1, 0.44, M.dark); s.position.set(Math.cos(k) * 0.22, Math.sin(k) * 0.22, 0); s.rotation.z = k; d.add(s); }
      g.add(d); parts.drums.push(d);
    }
    const arm = box(0.5, 0.08, 0.08, M.metal); arm.position.set(0.95, 0.5, 0); arm.rotation.z = -0.5; g.add(arm);
  } else if (design.digger === 'drill') {
    const tower = box(0.12, 0.9, 0.12, M.metal); tower.position.set(0.95, 0.75, 0); g.add(tower);
    const bit = cyl(0.06, 0.01, 0.8, M.metal, 8); bit.position.set(0.95, 0.15, 0); g.add(bit); parts.drill = bit;
  } else {
    const arm = box(0.7, 0.06, 0.06, M.metal); arm.position.set(1.05, 0.55, 0); arm.rotation.z = -0.6; g.add(arm);
    const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.metal);
    scoop.rotation.z = Math.PI; scoop.position.set(1.35, 0.32, 0); g.add(scoop); parts.drums.push(scoop);
  }

  // comms
  if (design.comms === 'dte' || design.comms === 'both') {
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 10, 0, Math.PI * 2, 0, 0.9), M.white);
    dish.material.side = THREE.DoubleSide; dish.rotation.z = 1.9; dish.position.set(-0.2, 2.0, -0.1); g.add(dish); parts.dish = dish;
    const dm = cyl(0.03, 0.03, 0.9, M.metal); dm.position.set(-0.2, 1.5, -0.1); g.add(dm);
  }
  if (design.comms === 'relay' || design.comms === 'both') {
    const whip = cyl(0.015, 0.015, 0.9, M.metal); whip.position.set(-0.7, 1.45, 0.35); g.add(whip);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), M.sensor); tip.position.set(-0.7, 1.92, 0.35); g.add(tip);
  }
  if (design.science === 'nss') { const n = box(0.3, 0.14, 0.26, M.sensor); n.position.set(-0.55, 0.45, 0); g.add(n); }
  if (design.thermal === 'heaters') { const rad = box(0.7, 0.03, 0.5, M.white); rad.position.set(-0.1, 1.06, 0); g.add(rad); }
  if (design.extra === 'tether') {
    const spool = cyl(0.2, 0.2, 0.36, M.dark); spool.rotation.x = Math.PI / 2; spool.position.set(-0.95, 0.75, 0); g.add(spool);
    const rim = cyl(0.24, 0.24, 0.04, M.sensor); rim.rotation.x = Math.PI / 2; rim.position.set(-0.95, 0.75, 0.19); g.add(rim);
  }

  g.userData.parts = parts;
  g.userData.mobility = design.mobility;
  return g;
}

/** Per-frame motion: wheels roll, legs walk, drums spin, drill hammers. */
export function animateRover(g, time, { moving = false, digging = false, dark = false } = {}) {
  const p = g.userData.parts;
  for (const w of p.wheels) if (moving) w.rotation.z -= 0.12;
  p.legs.forEach((l) => {
    const ph = time * 6 + l.userData.phase * Math.PI;
    l.rotation.x = moving ? Math.sin(ph) * 0.25 : 0;
    l.position.y = 0.65 + (moving ? Math.max(0, Math.sin(ph)) * 0.08 : 0);
  });
  p.drums.forEach((d, n) => { if (digging) d.rotation.y += n % 2 ? 0.25 : -0.25; });
  if (p.drill) p.drill.position.y = digging ? 0.1 + Math.abs(Math.sin(time * 25)) * 0.08 : 0.2;
  if (p.dish) p.dish.rotation.y = Math.sin(time * 0.4) * 0.3;
  if (p.lamp) p.lamp.intensity = dark ? 30 : 0;
}

/** A simple lander: octagonal body, four legs, engine bell. */
export function buildLander() {
  const g = new THREE.Group();
  const body = cyl(0.9, 1.0, 0.9, M.foil, 8); body.position.y = 1.4; g.add(body);
  const top = cyl(0.7, 0.9, 0.3, M.white, 8); top.position.y = 2.0; g.add(top);
  const bell = cyl(0.25, 0.45, 0.5, M.dark, 16); bell.position.y = 0.8; g.add(bell);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const legM = cyl(0.05, 0.05, 1.6, M.metal); legM.position.set(Math.cos(a) * 1.1, 0.75, Math.sin(a) * 1.1);
    legM.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); g.add(legM);
    const pad = cyl(0.22, 0.22, 0.05, M.metal); pad.position.set(Math.cos(a) * 1.45, 0.03, Math.sin(a) * 1.45); g.add(pad);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.8, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.x = Math.PI; flame.position.y = -0.3; g.add(flame);
  g.userData.flame = flame;
  return g;
}
