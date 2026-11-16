// NEON HARBOR — the human player: mouse look, WASD, sprint, crouch, jump,
// ADS, fire/reload, grenades, plant/defuse (E), buy (B) and the spectator
// camera after death. Reads input once per tick and writes velocity + aim.
import * as THREE from 'three';
import { tryFire, startReload, throwGrenade } from './combat.js';
import { updatePlayerObjective, buyItem } from './rounds.js';
import { forwardOf } from './state.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

export function updatePlayer(world, agent, input, dt, sounds) {
  const now = world.time;
  const { dx, dy, edge } = input.consumeMouse();

  // Mouse look (only while locked; the menu does not need it).
  if (input.locked) {
    const sens = 0.0021 * (agent.ads ? 0.55 : 1);
    agent.yaw -= dx * sens;
    agent.pitch -= dy * sens;
    agent.pitch = Math.max(-1.5, Math.min(1.5, agent.pitch));
  }

  // Keys that act on the edge of a press.
  if (input.pressed('KeyR') && startReload(world, agent, now)) sounds.reload();
  if (input.pressed('KeyB')) world.ui.buyOpen = world.phase === 'buy' ? !world.ui.buyOpen : false;
  if (input.pressed('KeyM')) world.muted = !world.muted;
  if (input.pressed('KeyP')) world.paused = !world.paused;

  if (world.ui.buyOpen && world.phase === 'buy') {
    // Buy keys: 1–6 buy the matching row (key codes are Digit1..Digit6).
    for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']) {
      if (input.pressed(k)) buyItem(world, agent, k.replace('Digit', ''), sounds);
    }
  } else {
    if (input.pressed('Digit1')) throwGrenade(world, agent, 'frag', sounds);
    if (input.pressed('Digit2')) throwGrenade(world, agent, 'smoke', sounds);
  }

  agent.ads = input.mouseRight && agent.weapon.id !== 'p9' && !agent.reloading;

  if (!agent.alive) return;

  // Movement.
  const axes = input.axes();
  const sprinting = input.down('ShiftLeft') && axes.z > 0 && !agent.ads;
  const crouched = input.down('KeyC') || input.down('ControlLeft');
  agent.crouched = crouched;
  const speed = crouched ? 2.2 : sprinting ? 5.6 : 4.4;
  forwardOf(agent.yaw, _fwd);
  _right.set(-_fwd.z, 0, _fwd.x);
  const wishX = _right.x * axes.x + _fwd.x * axes.z;
  const wishZ = _right.z * axes.x + _fwd.z * axes.z;
  const accel = agent.onGround ? 34 : 10;
  agent.vel.x += Math.max(-accel * dt, Math.min(accel * dt, wishX * speed - agent.vel.x));
  agent.vel.z += Math.max(-accel * dt, Math.min(accel * dt, wishZ * speed - agent.vel.z));
  // Gravity is applied by moveBody in the main loop, not here.
  if (input.down('Space') && agent.onGround) {
    agent.vel.y = 5.4;
    agent.onGround = false;
  }
  agent.moveSpeed = Math.hypot(agent.vel.x, agent.vel.z);
  agent.moving = agent.moveSpeed > 0.4;
  if (agent.moving && agent.onGround) agent.walkPhase += dt * agent.moveSpeed * 1.7;

  // Fire: hold for autos, click for the pistol (edge) — autos also fire on
  // edge, so the check is simply "mouse held and not ADS-blocked".
  if (input.mouseDown || edge) {
    const ok = tryFire(world, agent, now, sounds);
    if (!ok && agent.mag === 0 && input.mouseDown && startReload(world, agent, now)) sounds.reload();
  }

  // Plant / defuse.
  updatePlayerObjective(world, agent, dt, input.down('KeyE'), sounds);

  // Bloom recovery.
  agent.bloom = Math.max(0, agent.bloom - dt * 0.09);
  agent.shake = Math.max(0, (agent.shake ?? 0) - dt * 2);
}

// Spectator camera: after death, follow the best surviving Raider bot (or
// free-orbit the map if none are alive). Returns the camera transform.
export function spectatorCamera(world, agent, dt) {
  const target = world.agents.find((a) => a.id === world.spectateId && a.alive);
  if (!target) {
    // Slow orbit over the dock.
    const t = world.time * 0.08;
    return {
      pos: new THREE.Vector3(Math.sin(t) * 26, 18, Math.cos(t) * 26),
      lookAt: new THREE.Vector3(0, 0, -6),
    };
  }
  forwardOf(target.yaw, _fwd);
  const pos = new THREE.Vector3(target.pos.x - _fwd.x * 2.2, target.pos.y + 2.1, target.pos.z - _fwd.z * 2.2);
  const lookAt = new THREE.Vector3(target.pos.x + _fwd.x * 6, target.pos.y + 1.2, target.pos.z + _fwd.z * 6);
  return { pos, lookAt };
}
