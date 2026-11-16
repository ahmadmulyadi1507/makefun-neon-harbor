// NEON HARBOR — the map: a dusk-lit container dock, 70 x 50 metres.
// Raiders spawn south (z+), Guard spawn north (z-). Site A sits in the
// north-west container stack, Site B by the north-east warehouse. Three
// lanes run north: Long (west), Mid (centre) and Short (east). Everything
// the eye sees is also a collider — what blocks a bullet blocks a body.
import * as THREE from 'three';
import { boxFromCenter } from './collision.js';
import { MAP } from './config.js';

const CONTAINER_COLORS = [0xb4552d, 0x2d7a8c, 0x6b7a2d, 0x5a6068, 0x8c4a2d, 0x3d6b8c];

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 768;
  const g = c.getContext('2d');
  g.fillStyle = '#24272c'; g.fillRect(0, 0, 1024, 768);
  // Asphalt speckle.
  for (let i = 0; i < 9000; i++) {
    const v = 30 + Math.random() * 26;
    g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    g.fillRect(Math.random() * 1024, Math.random() * 768, 2, 2);
  }
  // Faint yard grid.
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 2;
  for (let x = 0; x <= 1024; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 768); g.stroke(); }
  for (let y = 0; y <= 768; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  // Centre lane dashes (yellow).
  g.fillStyle = 'rgba(240,168,48,0.55)';
  for (let y = 24; y < 768; y += 64) g.fillRect(508, y, 8, 36);
  // Site circles with letters, painted on the asphalt.
  const site = (cx, cy, letter, color) => {
    g.strokeStyle = color; g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, 62, 0, Math.PI * 2); g.stroke();
    g.fillStyle = color; g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, cx, cy + 4);
  };
  // Canvas maps x: -35..35 -> 0..1024, z: -25..25 -> 0..768.
  const px = (x) => (x + 35) / 70 * 1024;
  const pz = (z) => (z + 25) / 50 * 768;
  site(px(-22), pz(-15), 'A', 'rgba(255,122,26,0.8)');
  site(px(22), pz(-15), 'B', 'rgba(25,194,216,0.8)');
  // Spawn tints.
  g.fillStyle = 'rgba(255,122,26,0.08)'; g.fillRect(px(-14), pz(17), px(14) - px(-14), pz(24) - pz(17));
  g.fillStyle = 'rgba(25,194,216,0.08)'; g.fillRect(px(-14), pz(-24), px(14) - px(-14), pz(-17) - pz(-24));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function letterSprite(letter, color) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color; g.font = 'bold 92px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(2.2, 2.2, 1);
  return s;
}

export function buildMap(scene) {
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);

  const addBox = (cx, cy, cz, sx, sy, sz, color, opts = {}) => {
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.25,
      emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1,
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(cx, cy, cz);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    if (opts.collide !== false) colliders.push(boxFromCenter(cx, cy, cz, sx, sy, sz));
    return m;
  };

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.halfX * 2, MAP.halfZ * 2),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0.05 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Outer walls.
  const W = MAP.wallHeight, H = MAP.halfX, D = MAP.halfZ;
  addBox(0, W / 2, -D - 0.5, H * 2 + 2, W, 1, 0x2e3440);
  addBox(0, W / 2, D + 0.5, H * 2 + 2, W, 1, 0x2e3440);
  addBox(-H - 0.5, W / 2, 0, 1, W, D * 2 + 2, 0x2e3440);
  addBox(H + 0.5, W / 2, 0, 1, W, D * 2 + 2, 0x2e3440);
  // Hazard stripe caps on the walls (visual only).
  for (const [x, z, ry] of [[-20, -D + 0.05, 0], [20, -D + 0.05, 0], [0, D - 0.05, 0]]) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(8, 0.35, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xf0a830, emissive: 0xf0a830, emissiveIntensity: 0.5 }),
    );
    stripe.position.set(x, 3.9, z);
    stripe.rotation.y = ry;
    group.add(stripe);
  }

  // Shipping containers (cover + lanes). [cx, cz, sx, sz, stacked]
  const containers = [
    [0, -8, 12, 2.4, false], [-14, 2, 2.4, 10, false], [14, 2, 2.4, 10, false],
    [-6, 10, 8, 2.4, false], [8, -2, 2.4, 2.4, true], [-24, 4, 6, 2.4, false],
    [24, 8, 6, 2.4, false], [0, 16, 10, 2.4, false], [-28, -14, 2.4, 8, false],
    [28, -18, 8, 2.4, false], [-8, -16, 2.4, 6, false],
  ];
  containers.forEach(([cx, cz, sx, sz, stacked], i) => {
    const color = CONTAINER_COLORS[i % CONTAINER_COLORS.length];
    addBox(cx, 1.3, cz, sx, 2.6, sz, color);
    // Dark roof lip so containers read as boxes, not slabs.
    addBox(cx, 2.66, cz, sx + 0.08, 0.12, sz + 0.08, 0x1a1d22, { collide: false });
    if (stacked) addBox(cx, 3.9, cz, sx, 2.6, sz, CONTAINER_COLORS[(i + 2) % CONTAINER_COLORS.length]);
  });

  // Warehouse corner around Site B.
  addBox(27, 2.25, -20, 2, 4.5, 10, 0x3a4152);
  addBox(22, 2.25, -23.5, 10, 4.5, 2, 0x3a4152);
  // Silos (cylinders, collided as square footprints).
  for (const [x, z] of [[-30, -20], [30, 20]]) {
    const silo = new THREE.Mesh(
      new THREE.CylinderGeometry(2, 2, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0x8c949e, roughness: 0.6, metalness: 0.6 }),
    );
    silo.position.set(x, 3, z);
    silo.castShadow = true; silo.receiveShadow = true;
    group.add(silo);
    colliders.push(boxFromCenter(x, 3, z, 4, 6, 4));
  }
  // Crates.
  const crates = [[-10, -12], [10, -12], [-4, -4], [6, 6], [-16, 14], [16, 14], [0, -16], [-28, -8], [28, -4], [-2, 20]];
  for (const [x, z] of crates) addBox(x, 0.6, z, 1.2, 1.2, 1.2, 0x7a5c33);

  // Lamp poles with warm light pools.
  const lampPositions = [[-12, -8], [12, -8], [-12, 12], [12, 12]];
  for (const [x, z] of lampPositions) {
    addBox(x, 2.5, z, 0.18, 5, 0.18, 0x22262c, { collide: false });
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.25, 0.7),
      new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffc46b, emissiveIntensity: 2.2 }),
    );
    head.position.set(x, 5.05, z);
    group.add(head);
    const light = new THREE.PointLight(0xffc46b, 14, 18, 1.8);
    light.position.set(x, 4.8, z);
    group.add(light);
  }

  // Distant crane silhouettes outside the walls (visual only).
  for (const [x, z] of [[-28, -32], [18, -32], [-8, 32]]) {
    addBox(x, 6, z, 1.2, 12, 1.2, 0x14171c, { collide: false });
    addBox(x + 4, 11.5, z, 10, 1, 1, 0x14171c, { collide: false });
  }

  // Stars + moon.
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(420 * 3);
  for (let i = 0; i < 420; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.45 + 0.08;
    const r = 160;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starPos[i * 3 + 1] = Math.sin(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  group.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcdd8ff, size: 0.9, sizeAttenuation: false })));
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(7, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe9c4, fog: false }),
  );
  moon.position.set(-90, 70, -120);
  moon.lookAt(0, 0, 0);
  group.add(moon);

  // Bomb sites: glowing ring + floating letter.
  const sites = {
    A: { pos: new THREE.Vector3(-22, 0, -15), radius: 4.5, color: 0xff7a1a },
    B: { pos: new THREE.Vector3(22, 0, -15), radius: 4.5, color: 0x19c2d8 },
  };
  const siteMeshes = {};
  for (const [key, site] of Object.entries(sites)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.25, site.radius, 40),
      new THREE.MeshBasicMaterial({ color: site.color, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.pos.x, 0.03, site.pos.z);
    group.add(ring);
    const letter = letterSprite(key, key === 'A' ? '#ff7a1a' : '#19c2d8');
    letter.position.set(site.pos.x, 4.2, site.pos.z);
    group.add(letter);
    siteMeshes[key] = { ring, letter };
  }

  const spawns = {
    raiders: [{ x: -8, z: 21 }, { x: -3, z: 22 }, { x: 2, z: 21 }, { x: 7, z: 22 }],
    guard: [{ x: -8, z: -21 }, { x: -3, z: -22 }, { x: 2, z: -21 }, { x: 7, z: -22 }],
  };

  // Waypoints: hand-placed nodes; edges auto-link within 13 m when the
  // straight line between them is not blocked by a wall.
  const waypointPos = [
    [0, 21], [-12, 14], [0, 12], [12, 14], [-20, 8], [0, 4], [20, 8],
    [-24, -2], [-8, -2], [8, -2], [24, -2], [-28, -10], [-14, -10], [0, -10],
    [14, -10], [28, -10], [-22, -15], [22, -15], [-10, -18], [10, -18],
    [0, -20], [-8, -21], [8, -21], [-30, 18], [30, 18], [-18, 18], [18, 18],
  ];
  const waypoints = waypointPos.map(([x, z], i) => ({ id: i, x, z, links: [] }));
  const probe = (x, z) => new THREE.Vector3(x, 1.0, z);
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i], b = waypoints[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 13) continue;
      // Segment blocked test needs colliders; use the collision helper via a
      // local slab check imported lazily to avoid a cycle (map -> collision).
      if (segmentBlockedLocal(probe(a.x, a.z), probe(b.x, b.z), colliders)) continue;
      a.links.push(j); b.links.push(i);
    }
  }

  return { colliders, sites, siteMeshes, spawns, waypoints, group };
}

// Local copy of the slab test so map.js does not import collision.js's
// ray helpers (kept tiny and dependency-free).
function segmentBlockedLocal(a, b, colliders) {
  for (const box of colliders) {
    const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    let tmin = 0, tmax = 1, hit = true;
    for (const [o, dd, mn, mx] of [
      [a.x, d.x, box.minX, box.maxX], [a.y, d.y, box.minY, box.maxY], [a.z, d.z, box.minZ, box.maxZ],
    ]) {
      if (Math.abs(dd) < 1e-9) { if (o < mn || o > mx) { hit = false; break; } }
      else {
        let t1 = (mn - o) / dd, t2 = (mx - o) / dd;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { hit = false; break; }
      }
    }
    if (hit) return true;
  }
  return false;
}
