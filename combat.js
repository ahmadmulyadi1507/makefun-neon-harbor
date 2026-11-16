// NEON HARBOR — combat: hitscan gunfire, damage, grenades, tracers.
// One module owns every way an agent can hurt another, so the rules (falloff,
// headshots, armour, smoke) live in exactly one place.
import * as THREE from 'three';
import { WEAPONS, ECONOMY } from './config.js';
import { rayHitAgents, segmentBlocked, segmentBlockT } from './collision.js';
import { eyeHeight, forwardOf, aliveAgents } from './state.js';

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _end = new THREE.Vector3();

export function giveWeapon(agent, weaponId) {
  const def = WEAPONS[weaponId];
  agent.weapon = def;
  agent.mag = def.mag;
  agent.reserve = def.reserve;
  agent.reloading = false;
  agent.bloom = 0;
}

export function startReload(world, agent, now) {
  if (!agent.alive) return false;
  if (agent.reloading || agent.mag >= agent.weapon.mag || agent.reserve <= 0) return false;
  agent.reloading = true;
  agent.reloadEnd = now + agent.weapon.reloadMs / 1000;
  return true;
}

export function updateReloads(world, now) {
  for (const a of world.agents) {
    if (a.reloading && now >= a.reloadEnd) {
      const take = Math.min(a.weapon.mag - a.mag, a.reserve);
      a.mag += take;
      a.reserve -= take;
      a.reloading = false;
      if (a.isPlayer) world.events.push({ type: 'reloaded' });
    }
  }
}

// Spread cone for one shot: rest spread + bloom + movement/air penalties,
// reduced while aiming down sights.
function shotSpread(agent) {
  const w = agent.weapon;
  let s = w.spread + agent.bloom;
  if (agent.moveSpeed > 0.5) s += w.moveSpread * Math.min(1, agent.moveSpeed / 5);
  if (!agent.onGround) s += w.airSpread;
  if (agent.ads) s = w.adsSpread + agent.bloom * 0.4;
  return s;
}

function randomDir(base, spread, rng) {
  // Cheap gaussian-ish cone offset: sum of three uniforms.
  const ox = (rng() + rng() + rng() - 1.5) / 1.5 * spread;
  const oy = (rng() + rng() + rng() - 1.5) / 1.5 * spread;
  const dir = base.clone();
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir).normalize();
  dir.addScaledVector(right, ox).addScaledVector(up, oy).normalize();
  return dir;
}

// Fire one trigger pull. Returns true when a shot left the barrel.
export function tryFire(world, agent, now, sounds) {
  const w = agent.weapon;
  if (!agent.alive) return false;
  if (world.phase !== 'live' && world.phase !== 'planted') return false;
  if (agent.reloading) return false;
  if (now - agent.lastShot < w.intervalMs / 1000) return false;
  if (agent.mag <= 0) {
    if (agent.isPlayer) sounds.dryFire();
    startReload(world, agent, now);
    return false;
  }
  agent.mag -= 1;
  agent.lastShot = now;
  agent.bloom = Math.min(0.05, agent.bloom + w.recoil * 0.55);
  world.shotsFired += 1;

  // Muzzle position: eye, pushed forward so tracers start at the gun.
  forwardOf(agent.yaw, _dir);
  _dir.y = 0;
  const cp = Math.cos(agent.pitch), sp = Math.sin(agent.pitch);
  const aim = new THREE.Vector3(-Math.sin(agent.yaw) * cp, sp, -Math.cos(agent.yaw) * cp);
  _eye.set(agent.pos.x, agent.pos.y + eyeHeight(agent), agent.pos.z);
  _origin.copy(_eye).addScaledVector(aim, 0.5);
  _origin.y -= 0.08;

  const pellets = w.pellets || 1;
  for (let p = 0; p < pellets; p++) {
    const dir = randomDir(aim, shotSpread(agent), world.rng);
    const wallT = segmentBlockT(_origin, _end.copy(_origin).addScaledVector(dir, w.range), world.map.colliders);
    const wallDist = wallT >= 0 ? wallT * w.range : w.range;
    const hit = rayHitAgents(_origin, dir, wallDist, world.agents, agent.id);
    let endDist = wallDist;
    if (hit) {
      endDist = hit.dist;
      const falloff = hit.dist > 25 ? Math.max(0.6, 1 - (hit.dist - 25) / 100) : 1;
      let dmg = w.damage * falloff * (hit.part === 'head' ? w.headMult : 1);
      damageAgent(world, hit.agent, dmg, agent, hit.part, hit.point, sounds);
      world.hits += 1;
      if (agent.isPlayer) {
        world.events.push({ type: 'hitmarker', kill: !hit.agent.alive });
        sounds.hit();
      }
    }
    spawnTracer(world, _origin, dir, endDist, w.tracer);
  }

  // Recoil kicks the shooter's aim up (the player feels it; bots absorb it).
  if (agent.isPlayer) {
    agent.pitch += w.recoil * 0.55;
    agent.yaw += (world.rng() - 0.5) * w.recoil * 0.35;
    world.shake = Math.min(0.35, world.shake + w.recoil * 0.35);
    world.events.push({ type: 'muzzle' });
  } else {
    agent.pitch += w.recoil * 0.12;
  }
  const dist = agent.isPlayer ? 0 : agent.pos.distanceTo(aliveAgents(world).find((a) => a.isPlayer)?.pos ?? agent.pos);
  sounds.shot(w.sound, agent.isPlayer ? 0 : dist);
  return true;
}

function spawnTracer(world, origin, dir, dist, color) {
  let t = world.tracers.find((x) => x.life <= 0);
  if (!t) {
    if (world.tracers.length >= 24) return;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    if (world.scene) world.scene.add(line);
    t = { mesh: line, life: 0, maxLife: 0.07 };
    world.tracers.push(t);
  }
  const pts = t.mesh.geometry.attributes.position;
  pts.setXYZ(0, origin.x, origin.y, origin.z);
  pts.setXYZ(1, origin.x + dir.x * dist, origin.y + dir.y * dist, origin.z + dir.z * dist);
  pts.needsUpdate = true;
  t.mesh.material.color.setHex(color);
  t.mesh.material.opacity = 0.9;
  t.life = t.maxLife;
}

export function updateTracers(world, dt) {
  for (const t of world.tracers) {
    if (t.life <= 0) continue;
    t.life -= dt;
    t.mesh.material.opacity = Math.max(0, (t.life / t.maxLife) * 0.9);
  }
}

export function damageAgent(world, target, amount, attacker, part, point, sounds) {
  if (!target.alive) return;
  // Screenshot staging never kills the player.
  if (world.demoInvulnerable && target.isPlayer) return;
  // Armour absorbs half the damage until it runs out.
  const absorbed = Math.min(target.armour, amount * 0.5);
  target.armour -= absorbed;
  target.hp -= (amount - absorbed);
  if (target.isPlayer) {
    world.events.push({ type: 'hurt', from: attacker ? attacker.pos : null });
    sounds.hurt();
  }
  if (target.bot) {
    // Getting shot snaps a bot's attention to the shooter.
    target.bot.lastSeenPos = attacker ? attacker.pos.clone() : target.bot.lastSeenPos;
    target.bot.lastSeenT = world.time;
    target.bot.heardPos = attacker ? attacker.pos.clone() : null;
    target.bot.heardT = world.time;
  }
  if (target.hp <= 0) killAgent(world, target, attacker, sounds);
}

export function killAgent(world, target, attacker, sounds) {
  target.hp = 0;
  target.alive = false;
  target.deaths += 1;
  target.fallT = world.time;
  target.planting = false; target.defusing = false;
  if (target.carryingBomb) {
    target.carryingBomb = false;
    world.bomb.state = 'dropped';
    world.bomb.pos.copy(target.pos);
    world.bomb.carrierId = null;
    world.events.push({ type: 'bombDropped' });
  }
  if (attacker && attacker !== target) {
    attacker.kills += 1;
    attacker.money += ECONOMY.killReward;
    if (attacker.isPlayer) {
      sounds.kill();
      world.events.push({ type: 'kill', victim: target.name });
    }
  }
  const killer = attacker ? attacker.name : '—';
  world.feed.push({ text: `${killer}  ▸  ${target.name}`, team: attacker ? attacker.team : null, t: world.time });
  if (world.feed.length > 6) world.feed.shift();
  if (target.isPlayer) world.spectateId = pickSpectate(world);
}

export function pickSpectate(world) {
  const mate = world.agents.find((a) => a.alive && a.team === 'raiders' && !a.isPlayer);
  return mate ? mate.id : null;
}

// Line of sight between two points: clear of walls and smoke clouds.
export function losClear(world, a, b) {
  if (segmentBlocked(a, b, world.map.colliders)) return false;
  for (const s of world.smokes) {
    if (world.time > s.until) continue;
    // Segment vs smoke sphere (radius 3.2).
    const ab = new THREE.Vector3().subVectors(b, a);
    const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(s.pos, a).dot(ab) / ab.lengthSq()));
    const closest = new THREE.Vector3().copy(a).addScaledVector(ab, t);
    if (closest.distanceTo(s.pos) < 3.2) return false;
  }
  return true;
}

export function throwGrenade(world, agent, kind, sounds) {
  if (!agent.alive) return false;
  if (agent.grenades[kind] <= 0) return false;
  if (world.phase !== 'live' && world.phase !== 'planted') return false;
  agent.grenades[kind] -= 1;
  forwardOf(agent.yaw, _dir);
  const cp = Math.cos(agent.pitch), sp = Math.sin(agent.pitch);
  const aim = new THREE.Vector3(-Math.sin(agent.yaw) * cp, sp, -Math.cos(agent.yaw) * cp);
  const pos = new THREE.Vector3(agent.pos.x, agent.pos.y + eyeHeight(agent) - 0.1, agent.pos.z)
    .addScaledVector(aim, 0.6);
  const vel = aim.clone().multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0));
  world.grenades.push({ pos, vel, kind, fuse: kind === 'frag' ? 2.4 : 1.2, ownerId: agent.id, bounced: false, mesh: null });
  sounds.grenadeThrow();
  return true;
}

export function updateGrenades(world, dt, sounds) {
  for (let i = world.grenades.length - 1; i >= 0; i--) {
    const g = world.grenades[i];
    g.fuse -= dt;
    g.vel.y -= 12 * dt;
    const next = g.pos.clone().addScaledVector(g.vel, dt);
    // Floor bounce.
    if (next.y < 0.12) {
      next.y = 0.12;
      if (Math.abs(g.vel.y) > 2) sounds.grenadeBounce();
      g.vel.y = Math.abs(g.vel.y) * 0.45;
      g.vel.x *= 0.7; g.vel.z *= 0.7;
      g.bounced = true;
    }
    // Wall bounce: step back out of any collider on each axis.
    for (const c of world.map.colliders) {
      if (next.x > c.minX - 0.1 && next.x < c.maxX + 0.1 && next.y > c.minY - 0.1 && next.y < c.maxY + 0.1 && next.z > c.minZ - 0.1 && next.z < c.maxZ + 0.1) {
        if (g.pos.x <= c.minX || g.pos.x >= c.maxX) g.vel.x *= -0.45;
        if (g.pos.z <= c.minZ || g.pos.z >= c.maxZ) g.vel.z *= -0.45;
        if (g.pos.y >= c.maxY) g.vel.y = Math.abs(g.vel.y) * 0.45;
        next.copy(g.pos);
        g.bounced = true;
        break;
      }
    }
    g.pos.copy(next);
    if (g.mesh) g.mesh.position.copy(g.pos);
    if (g.fuse <= 0) {
      if (g.kind === 'frag') explode(world, g.pos, g.ownerId, sounds);
      else deploySmoke(world, g.pos);
      if (g.mesh) g.mesh.visible = false;
      world.grenades.splice(i, 1);
    }
  }
}

function explode(world, pos, ownerId, sounds) {
  const player = world.agents.find((a) => a.isPlayer);
  const dist = player ? player.pos.distanceTo(pos) : 99;
  sounds.explosion(dist);
  world.shake = Math.min(0.6, world.shake + 0.3);
  world.explosions.push({ pos: pos.clone(), t: 0, mesh: null, light: null });
  const owner = world.agents.find((x) => x.id === ownerId) ?? null;
  for (const a of world.agents) {
    if (!a.alive) continue;
    const d = a.pos.distanceTo(pos);
    if (d > 7) continue;
    const chest = new THREE.Vector3(a.pos.x, a.pos.y + 1.0, a.pos.z);
    const blocked = segmentBlocked(pos, chest, world.map.colliders);
    const dmg = (blocked ? 55 : 110) * Math.max(0.25, 1 - d / 7);
    damageAgent(world, a, dmg, owner, 'body', chest, sounds);
  }
  // The explosion visual is pushed above; no event is needed (the drain
  // would push a second, identical one).
}

function deploySmoke(world, pos) {
  const until = world.time + 12;
  const meshes = [];
  world.smokes.push({ pos: pos.clone(), until, meshes });
  world.events.push({ type: 'smoke', pos: pos.clone(), until });
}
