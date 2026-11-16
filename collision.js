// NEON HARBOR — collision: axis-aligned boxes only, no physics engine.
// The map is a list of AABBs { minX, minY, minZ, maxX, maxY, maxZ }; bodies
// are upright boxes too, so every test is a slab test. Deterministic and
// cheap enough to run for every bot every tick.
import * as THREE from 'three';

// Build an AABB from a centre and full sizes.
export function boxFromCenter(cx, cy, cz, sx, sy, sz) {
  return {
    minX: cx - sx / 2, maxX: cx + sx / 2,
    minY: cy - sy / 2, maxY: cy + sy / 2,
    minZ: cz - sz / 2, maxZ: cz + sz / 2,
  };
}

function overlaps(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX &&
    a.minY < b.maxY && a.maxY > b.minY &&
    a.minZ < b.maxZ && a.maxZ > b.minZ;
}

// Move a body (feet position in pos, y = height above ground) with axis
// separation: each axis moves, then resolves against every collider it
// overlaps. Returns true when the body is standing on the ground.
// half = { x, z } horizontal half extents; height = body height.
export function moveBody(pos, half, height, vel, dt, colliders) {
  // X axis
  pos.x += vel.x * dt;
  let box = bodyBox(pos, half, height);
  for (const c of colliders) {
    if (!overlaps(box, c)) continue;
    if (vel.x > 0) pos.x = c.minX - half.x - 0.001;
    else if (vel.x < 0) pos.x = c.maxX + half.x + 0.001;
    vel.x = 0;
    box = bodyBox(pos, half, height);
  }
  // Z axis
  pos.z += vel.z * dt;
  box = bodyBox(pos, half, height);
  for (const c of colliders) {
    if (!overlaps(box, c)) continue;
    if (vel.z > 0) pos.z = c.minZ - half.z - 0.001;
    else if (vel.z < 0) pos.z = c.maxZ + half.z + 0.001;
    vel.z = 0;
    box = bodyBox(pos, half, height);
  }
  // Y axis (gravity / jumping)
  pos.y += vel.y * dt;
  let grounded = false;
  if (pos.y <= 0) { pos.y = 0; vel.y = 0; grounded = true; }
  box = bodyBox(pos, half, height);
  for (const c of colliders) {
    if (!overlaps(box, c)) continue;
    if (vel.y > 0) { pos.y = c.minY - height - 0.001; vel.y = 0; }
    else if (vel.y < 0) { pos.y = c.maxY; vel.y = 0; grounded = true; }
    box = bodyBox(pos, half, height);
  }
  return grounded;
}

export function bodyBox(pos, half, height) {
  return {
    minX: pos.x - half.x, maxX: pos.x + half.x,
    minY: pos.y, maxY: pos.y + height,
    minZ: pos.z - half.z, maxZ: pos.z + half.z,
  };
}

// Slab test: does segment a->b hit box? Returns the entry t in [0,1] or -1.
export function segmentBoxT(a, b, box) {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  let tmin = 0, tmax = 1;
  for (const [o, dd, mn, mx] of [
    [a.x, d.x, box.minX, box.maxX],
    [a.y, d.y, box.minY, box.maxY],
    [a.z, d.z, box.minZ, box.maxZ],
  ]) {
    if (Math.abs(dd) < 1e-9) {
      if (o < mn || o > mx) return -1;
    } else {
      let t1 = (mn - o) / dd, t2 = (mx - o) / dd;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Nearest wall hit along segment a->b, as t in [0,1], or -1 when clear.
export function segmentBlockT(a, b, colliders) {
  let best = -1;
  for (const c of colliders) {
    const t = segmentBoxT(a, b, c);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

export function segmentBlocked(a, b, colliders) {
  return segmentBlockT(a, b, colliders) >= 0;
}

// Ray vs sphere. Returns distance along the ray or -1.
function raySphere(origin, dir, center, radius, maxDist) {
  const ox = center.x - origin.x, oy = center.y - origin.y, oz = center.z - origin.z;
  const tca = ox * dir.x + oy * dir.y + oz * dir.z;
  if (tca < 0) return -1;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return -1;
  const t = tca - Math.sqrt(r2 - d2);
  if (t < 0 || t > maxDist) return -1;
  return t;
}

// Ray vs an agent's body: head sphere (4x damage) and torso box.
// Returns { agent, part, dist, point } for the nearest hit, or null.
export function rayHitAgents(origin, dir, maxDist, agents, ignoreId) {
  let best = null;
  const tmp = new THREE.Vector3();
  for (const a of agents) {
    if (!a.alive || a.id === ignoreId) continue;
    const crouch = a.crouched;
    const headY = a.pos.y + (crouch ? 1.0 : 1.55);
    tmp.set(a.pos.x, headY, a.pos.z);
    const headT = raySphere(origin, dir, tmp, 0.21, maxDist);
    let bodyT = -1;
    const bodyTop = a.pos.y + (crouch ? 0.95 : 1.35);
    const body = {
      minX: a.pos.x - 0.30, maxX: a.pos.x + 0.30,
      minY: a.pos.y, maxY: bodyTop,
      minZ: a.pos.z - 0.24, maxZ: a.pos.z + 0.24,
    };
    // Ray-AABB via the segment slab test with a far endpoint.
    const far = { x: origin.x + dir.x * maxDist, y: origin.y + dir.y * maxDist, z: origin.z + dir.z * maxDist };
    const t = segmentBoxT(origin, far, body);
    if (t >= 0) bodyT = t * maxDist;
    let dist = -1, part = null;
    if (headT >= 0 && (bodyT < 0 || headT <= bodyT)) { dist = headT; part = 'head'; }
    else if (bodyT >= 0) { dist = bodyT; part = 'body'; }
    if (dist >= 0 && (!best || dist < best.dist)) {
      best = {
        agent: a, part, dist,
        point: new THREE.Vector3(origin.x + dir.x * dist, origin.y + dir.y * dist, origin.z + dir.z * dist),
      };
    }
  }
  return best;
}

// Push two overlapping agents apart horizontally (cheap separation so bots
// and the player never stand inside each other).
export function separateAgents(agents) {
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < agents.length; j++) {
      const b = agents[j];
      if (!b.alive) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.49 && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (0.7 - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
      }
    }
  }
}
