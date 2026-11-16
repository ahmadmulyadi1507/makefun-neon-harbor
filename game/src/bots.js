// NEON HARBOR — bot AI: waypoint routes, perception, burst fire, and the
// objective. Bots are not aimbots: they see late, miss early, and only get
// dangerous when they hold an angle. Skill varies per bot.
import * as THREE from 'three';
import { ROUND } from './config.js';
import { tryFire, losClear, startReload } from './combat.js';
import { forwardOf, aliveAgents } from './state.js';

const _v = new THREE.Vector3();
const _eye = new THREE.Vector3();

export function nearestWaypoint(world, x, z) {
  let best = 0, bestD = Infinity;
  for (const w of world.map.waypoints) {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bestD) { bestD = d; best = w.id; }
  }
  return best;
}

// Breadth-first path over the waypoint graph. Returns waypoint ids.
export function findPath(world, fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = new Map([[fromId, -1]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toId) break;
    for (const n of world.map.waypoints[cur].links) {
      if (!prev.has(n)) { prev.set(n, cur); queue.push(n); }
    }
  }
  if (!prev.has(toId)) return [toId];
  const path = [];
  let cur = toId;
  while (cur !== -1) { path.unshift(cur); cur = prev.get(cur); }
  return path;
}

function angleTo(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), dist: Math.hypot(dx, dz) };
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnToward(agent, targetYaw, targetPitch, rate, dt) {
  agent.yaw += Math.max(-rate * dt, Math.min(rate * dt, angleDiff(targetYaw, agent.yaw)));
  const dp = targetPitch - agent.pitch;
  agent.pitch += Math.max(-rate * dt, Math.min(rate * dt, dp));
}

// Can this bot see the enemy right now? Range 48 m, ~110 degree cone,
// line of sight clear. A target that just fired is heard even off-angle.
function canSee(world, bot, enemy) {
  const dx = enemy.pos.x - bot.pos.x, dz = enemy.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 48) return false;
  const eye = _eye.set(bot.pos.x, bot.pos.y + 1.5, bot.pos.z);
  const chest = new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1.0, enemy.pos.z);
  if (!losClear(world, eye, chest)) return false;
  const fwd = forwardOf(bot.yaw, _v);
  const dot = (dx * fwd.x + dz * fwd.z) / Math.max(0.001, dist);
  const heard = world.time - enemy.lastShot < 0.4 && dist < 26;
  return dot > 0.25 || heard;
}

function nearestVisibleEnemy(world, bot) {
  let best = null, bestD = Infinity;
  for (const e of aliveAgents(world)) {
    if (e.team === bot.team) continue;
    if (!canSee(world, bot, e)) continue;
    const d = bot.pos.distanceTo(e.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function setPath(world, bot, toId) {
  const from = nearestWaypoint(world, bot.pos.x, bot.pos.z);
  bot.bot.path = findPath(world, from, toId);
  bot.bot.pathIdx = 0;
}

function waypointFor(world, bot) {
  // Where this bot wants to be right now, by role and round state.
  const b = bot.bot;
  const bomb = world.bomb;
  if (bot.team === 'guard' && bomb.state === 'planted') {
    return nearestWaypoint(world, bomb.pos.x, bomb.pos.z);
  }
  if (bot.carryingBomb && b.site) {
    return b.site === 'A' ? 16 : 17; // site waypoints
  }
  if (bot.team === 'guard') {
    // Hold near the assigned site; rotate if the other site is loud.
    if (b.heardPos && world.time - b.heardT < 4) {
      const nearA = Math.hypot(b.heardPos.x + 22, b.heardPos.z + 15) < 10;
      const nearB = Math.hypot(b.heardPos.x - 22, b.heardPos.z + 15) < 10;
      if (nearA && b.site === 'B') return 12;
      if (nearB && b.site === 'A') return 15;
    }
    return b.site === 'A' ? (b.holdPos ?? 12) : (b.holdPos ?? 15);
  }
  // Raiders push their assigned site.
  return b.site === 'A' ? 16 : 17;
}

export function updateBots(world, dt, sounds) {
  const now = world.time;
  for (const bot of world.agents) {
    if (!bot.alive || !bot.bot) continue;
    if (world.phase !== 'live' && world.phase !== 'planted') continue;
    const b = bot.bot;

    // --- Think (staggered, every 0.15 s) ---
    if (now >= b.thinkAt) {
      b.thinkAt = now + 0.15 + (bot.id % 5) * 0.02;
      const enemy = nearestVisibleEnemy(world, bot);
      if (enemy) {
        if (b.targetId !== enemy.id) {
          b.targetId = enemy.id;
          b.reactionAt = now + 0.55 - b.skill * 0.35; // 0.2–0.55 s
          b.burstLeft = 0;
        }
        b.lastSeenPos = enemy.pos.clone();
        b.lastSeenT = now;
      } else if (b.targetId !== null && now - b.lastSeenT > 1.2) {
        b.targetId = null;
      }
      // Hearing: a recent enemy shot within 26 m pulls the bot over.
      for (const e of aliveAgents(world)) {
        if (e.team === bot.team) continue;
        if (now - e.lastShot < 0.4 && bot.pos.distanceTo(e.pos) < 26) {
          b.heardPos = e.pos.clone(); b.heardT = now;
        }
      }
      // Pick up a dropped charge.
      if (world.bomb.state === 'dropped' && bot.team === 'raiders') {
        if (bot.pos.distanceTo(world.bomb.pos) < 1.6) {
          bot.carryingBomb = true;
          world.bomb.state = 'carried';
          world.bomb.carrierId = bot.id;
          world.events.push({ type: 'bombPickup', name: bot.name });
        }
      }
      // Repath when the goal moved or the path ran out.
      if (now >= b.repathAt || b.pathIdx >= b.path.length) {
        b.repathAt = now + 2.5;
        setPath(world, bot, waypointFor(world, bot));
      }
      // Reload when the mag is low and nothing is in front of us.
      if (bot.mag <= bot.weapon.mag * 0.3 && !b.targetId) startReload(world, bot, now);
    }

    const target = b.targetId !== null
      ? world.agents.find((a) => a.id === b.targetId && a.alive) ?? null : null;
    if (!target) b.targetId = null;

    // --- Plant / defuse ---
    bot.planting = false; bot.defusing = false;
    if (bot.carryingBomb && world.phase === 'live') {
      const site = world.map.sites[b.site ?? 'A'];
      if (bot.pos.distanceTo(site.pos) < site.radius && !target) {
        bot.planting = true;
        bot.plantProgress += dt / ROUND.plantSeconds;
        if (bot.plantProgress >= 1) {
          bot.plantProgress = 0; bot.planting = false;
          world.events.push({ type: 'plantComplete', agent: bot, site: b.site ?? 'A' });
        }
      } else bot.plantProgress = Math.max(0, bot.plantProgress - dt * 0.5);
    }
    if (bot.team === 'guard' && world.bomb.state === 'planted') {
      if (bot.pos.distanceTo(world.bomb.pos) < 1.8 && !target) {
        bot.defusing = true;
        bot.defuseProgress += dt / ROUND.defuseSeconds;
        if (bot.defuseProgress >= 1) {
          bot.defuseProgress = 0; bot.defusing = false;
          world.events.push({ type: 'defuseComplete', agent: bot });
        }
      } else bot.defuseProgress = Math.max(0, bot.defuseProgress - dt * 0.5);
    }

    // --- Move ---
    let wishX = 0, wishZ = 0, speed = 0;
    if (target && now >= b.reactionAt) {
      // Engage: strafe sideways, keep distance, face the target.
      b.state = 'engage';
      if (now >= b.strafeAt) { b.strafeAt = now + 0.7 + world.rng() * 0.8; b.strafeDir *= -1; }
      const fwd = forwardOf(bot.yaw, _v);
      const d = target.pos.distanceTo(bot.pos);
      const approach = d > 16 ? 1 : d < 6 ? -1 : 0;
      wishX = fwd.x * approach + (-fwd.z) * b.strafeDir * 0.8;
      wishZ = fwd.z * approach + fwd.x * b.strafeDir * 0.8;
      speed = 2.6;
    } else if (!bot.planting && !bot.defusing) {
      b.state = 'move';
      const wp = world.map.waypoints[b.path[b.pathIdx]];
      if (wp) {
        const dx = wp.x - bot.pos.x, dz = wp.z - bot.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) b.pathIdx++;
        else {
          wishX = dx / d; wishZ = dz / d;
          speed = d > 14 ? 5.0 : 3.6;
          const { yaw } = angleTo(bot.pos, wp);
          turnToward(bot, yaw, 0, 5, dt);
        }
      }
    }

    // Apply acceleration toward the wish velocity. main.js resolves the
    // actual move (moveBody) for every agent after this update.
    const accel = 34;
    const targetVx = wishX * speed, targetVz = wishZ * speed;
    bot.vel.x += Math.max(-accel * dt, Math.min(accel * dt, targetVx - bot.vel.x));
    bot.vel.z += Math.max(-accel * dt, Math.min(accel * dt, targetVz - bot.vel.z));
    // Gravity is applied by moveBody in the main loop, not here.
    bot.moveSpeed = Math.hypot(bot.vel.x, bot.vel.z);
    bot.moving = bot.moveSpeed > 0.4;
    if (bot.moving) bot.walkPhase += dt * bot.moveSpeed * 1.6;

    // --- Aim & fire ---
    if (target && now >= b.reactionAt) {
      const aimAt = new THREE.Vector3(target.pos.x, target.pos.y + 1.1, target.pos.z);
      if (world.rng() < 0.25) aimAt.y = target.pos.y + 1.55; // sometimes go for the head
      const dx = aimAt.x - bot.pos.x, dy = aimAt.y - (bot.pos.y + 1.5), dz = aimAt.z - bot.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.asin(Math.max(-1, Math.min(1, dy / Math.max(0.001, dist))));
      turnToward(bot, wantYaw, wantPitch, 4.5, dt);
      const aimErr = Math.abs(angleDiff(wantYaw, bot.yaw)) + Math.abs(wantPitch - bot.pitch);
      if (aimErr < 0.09 && bot.mag > 0) {
        if (b.burstLeft <= 0 && now >= b.nextBurstAt) {
          b.burstLeft = 3 + Math.floor(world.rng() * 3);
          b.nextBurstAt = now + 0.55 + world.rng() * 0.6;
        }
        if (b.burstLeft > 0) {
          // Aim error: worse far away, worse while moving, better with skill.
          const err = (0.055 + 0.05 * (1 - b.skill) + dist * 0.0011) * (bot.moving ? 1.6 : 1);
          bot.yaw += (world.rng() - 0.5) * err * 2;
          bot.pitch += (world.rng() - 0.5) * err * 1.4;
          if (tryFire(world, bot, now, sounds)) b.burstLeft -= 1;
          bot.yaw -= (world.rng() - 0.5) * err; // recenter roughly
        }
      }
    } else {
      // Scan: slow yaw sweep while holding or walking.
      if (b.state === 'move' && b.pathIdx >= b.path.length) {
        bot.yaw += Math.sin(now * 0.5 + bot.id) * 0.35 * dt;
      }
    }

    // Bloom recovery.
    bot.bloom = Math.max(0, bot.bloom - dt * 0.09);
  }
}
