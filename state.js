// NEON HARBOR — the world: one object holds every piece of mutable game
// state. Systems (bots, rounds, combat, player) read and write this object;
// main.js only renders it. Nothing else keeps a second copy of the truth.
import * as THREE from 'three';
import { mulberry32 } from './config.js';

// Forward/right vectors for a yaw, three.js camera convention:
// yaw 0 faces -z (toward the Guard spawn), yaw PI faces +z.
export function forwardOf(yaw, out = new THREE.Vector3()) {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}
export function rightOf(yaw, out = new THREE.Vector3()) {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

export function createWorld(seed = 1) {
  return {
    seed,
    time: 0,
    tick: 0,
    phase: 'menu', // menu | buy | live | planted | ended | matchEnd
    phaseT: 0, // seconds left in the current phase
    round: 1,
    score: { raiders: 0, guard: 0 },
    agents: [],
    tracers: [], // pooled tracer lines { mesh, life, maxLife }
    grenades: [], // live grenades { pos, vel, kind, fuse, ownerId, bounced, mesh }
    smokes: [], // { pos, until, meshes }
    explosions: [], // { pos, t, mesh, light }
    bomb: { state: 'none', site: null, pos: new THREE.Vector3(), timer: 0, progress: 0, actor: null, carrierId: null, beepAt: 0 },
    feed: [], // kill feed { text, team, t }
    events: [], // one-frame event queue for HUD/audio { type, ... }
    map: null, // set by buildMap
    scene: null, // set by main.js (tracer lines attach here)
    winner: null, // 'raiders' | 'guard' — winner of the last round
    winReason: '',
    matchWinner: null,
    shotMode: false, // true while staging a ?shot= screenshot
    demoInvulnerable: false, // screenshot staging never kills the player
    muted: false,
    paused: false,
    ui: { buyOpen: false },
    shake: 0,
    shotsFired: 0,
    hits: 0,
    spectateId: null,
    rng: mulberry32(seed),
  };
}

// Every agent's eye height, used for shooting and cameras.
export function eyeHeight(agent) { return agent.crouched ? 1.08 : 1.62; }
export function bodyHeight(agent) { return agent.crouched ? 1.15 : 1.7; }

export function aliveAgents(world, team) {
  return world.agents.filter((a) => a.alive && (!team || a.team === team));
}
