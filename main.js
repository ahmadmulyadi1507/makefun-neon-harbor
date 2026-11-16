// NEON HARBOR — main loop: renderer, cameras, agent meshes, the fixed-step
// simulation, event drain (sounds + HUD), and the menu / match flow.
// The simulation itself lives in state / bots / combat / rounds; this file
// only wires it to the screen.
import * as THREE from 'three';
import { createWorld, eyeHeight, bodyHeight } from './state.js';
import { buildMap } from './map.js';
import { SoundBank } from './audio.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { updateBots } from './bots.js';
import { updatePlayer, spectatorCamera } from './player.js';
import { updateRounds, startRound, buyItem } from './rounds.js';
import { updateReloads, updateTracers, updateGrenades, giveWeapon } from './combat.js';
import { moveBody, separateAgents } from './collision.js';
import { parseShotMode, stageShot } from './shots.js';
import { BOT_NAMES, ROUND, WEAPONS } from './config.js';

const STEP = 1 / 60;
const container = document.getElementById('game');

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1420);
scene.fog = new THREE.FogExp2(0x0e1420, 0.011);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 320);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0x36466a, 0x2a2018, 0.95);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0xbfd0ff, 1.2);
moon.position.set(-40, 60, -30);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -45; moon.shadow.camera.right = 45;
moon.shadow.camera.top = 45; moon.shadow.camera.bottom = -45;
moon.shadow.camera.near = 1; moon.shadow.camera.far = 160;
moon.shadow.bias = -0.0004;
scene.add(moon);

// ---------- World ----------
const world = createWorld();
world.scene = scene;
const map = buildMap(scene);
world.map = map;

const sounds = new SoundBank();
const input = new Input(renderer.domElement);
const hud = new Hud();

// ---------- Agent meshes ----------
const DARK = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.85, metalness: 0.2 });
const GUNMETAL = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.45, metalness: 0.8 });

function nameSprite(text, colorHex) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const g = c.getContext('2d');
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 6;
  g.fillStyle = colorHex;
  g.fillText(text, 128, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(2.4, 0.52, 1);
  s.position.y = 2.1;
  return s;
}

function buildAgentMesh(agent) {
  const group = new THREE.Group();
  const teamColor = agent.team === 'raiders' ? 0xff7a1a : 0x19c2d8;
  const teamMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.7, metalness: 0.1 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.75, 4, 10), DARK);
  body.position.y = 0.95; body.castShadow = true;
  group.add(body);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.42), teamMat);
  vest.position.y = 1.18; vest.castShadow = true;
  group.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12), DARK);
  head.position.y = 1.62; head.castShadow = true;
  group.add(head);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.08, 0.1),
    new THREE.MeshStandardMaterial({ color: teamColor, emissive: teamColor, emissiveIntensity: 1.8 }),
  );
  visor.position.set(0, 1.63, 0.19);
  group.add(visor);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), DARK);
  legL.position.set(-0.16, 0.36, 0); legL.castShadow = true;
  const legR = legL.clone(); legR.position.x = 0.16;
  group.add(legL, legR);
  // Gun, held forward (-z is forward at yaw 0).
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, 0.62), GUNMETAL);
  gunBody.castShadow = true;
  gun.add(gunBody);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), GUNMETAL);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.42);
  gun.add(barrel);
  gun.position.set(0.26, 1.28, -0.25);
  group.add(gun);
  // Muzzle flash quad at the barrel tip.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.42),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0, 0.02, -0.6);
  flash.visible = false;
  gun.add(flash);
  const name = nameSprite(agent.name, agent.team === 'raiders' ? '#ff9a4d' : '#5fd8ea');
  group.add(name);
  group.visible = !agent.isPlayer;
  scene.add(group);
  return { group, legL, legR, gun, flash, name };
}

// Agents: the player plus three Raider bots and three Guard bots.
function createAgents() {
  const agents = [];
  const mk = (id, name, team, isPlayer, skill) => {
    const a = {
      id, name, team, isPlayer, skill,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), spawnPos: new THREE.Vector3(),
      yaw: 0, pitch: 0, hp: 100, armour: 0, alive: true, money: 800,
      weapon: WEAPONS.p9, mag: 12, reserve: 36, reloading: false, reloadEnd: 0,
      lastShot: -99, bloom: 0, moveSpeed: 0, moving: false, onGround: true,
      crouched: false, ads: false, walkPhase: 0, fallT: 0,
      kills: 0, deaths: 0, carryingBomb: false, planting: false, defusing: false,
      plantProgress: 0, defuseProgress: 0,
      grenades: { frag: 0, smoke: 0 },
      bot: isPlayer ? null : {
        skill, state: 'move', role: 'push', site: 'A', holdPos: 12,
        path: [], pathIdx: 0, thinkAt: 0, repathAt: 0,
        targetId: null, lastSeenPos: null, lastSeenT: -99,
        heardPos: null, heardT: -99, reactionAt: 0,
        burstLeft: 0, nextBurstAt: 0, strafeDir: 1, strafeAt: 0,
      },
    };
    a.mesh = buildAgentMesh(a);
    agents.push(a);
    return a;
  };
  mk(0, 'You', 'raiders', true, 0);
  const raiderNames = BOT_NAMES.raiders.slice(0, 3);
  const guardNames = BOT_NAMES.guard.slice(0, 3);
  const skills = [0.5, 0.62, 0.72];
  raiderNames.forEach((n, i) => mk(i + 1, n, 'raiders', false, skills[i]));
  guardNames.forEach((n, i) => mk(i + 4, n, 'guard', false, skills[(i + 1) % 3]));
  return agents;
}
world.agents = createAgents();
const player = world.agents[0];

// ---------- Viewmodel (first-person gun) ----------
const viewmodel = new THREE.Group();
{
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.44), GUNMETAL);
  viewmodel.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.3, 8), GUNMETAL);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.34);
  viewmodel.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.1), DARK);
  mag.position.set(0, -0.13, 0.03);
  viewmodel.add(mag);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.09), GUNMETAL);
  sight.position.set(0, 0.09, -0.04);
  viewmodel.add(sight);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.015, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x8c4a12, emissive: 0xff7a1a, emissiveIntensity: 0.45 }),
  );
  stripe.position.set(0.035, 0.05, 0);
  viewmodel.add(stripe);
  viewmodel.scale.setScalar(0.72);
  viewmodel.position.set(0.24, -0.24, -0.58);
  viewmodel.rotation.y = -0.05;
  camera.add(viewmodel);
}
let vmKick = 0;

// Shared muzzle light (one light, moved to whoever just fired).
const flashLight = new THREE.PointLight(0xffc46b, 0, 10, 1.6);
scene.add(flashLight);

// ---------- Bomb / grenade / smoke / explosion visuals ----------
const bombGroup = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.5), GUNMETAL);
  box.position.y = 0.12; box.castShadow = true;
  bombGroup.add(box);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 3 }),
  );
  lamp.position.y = 0.3;
  bombGroup.add(lamp);
  bombGroup.userData.lamp = lamp;
  const light = new THREE.PointLight(0xff3b30, 0, 7, 1.8);
  light.position.y = 0.4;
  bombGroup.add(light);
  bombGroup.userData.light = light;
  bombGroup.visible = false;
  scene.add(bombGroup);
}

const grenadeMeshes = new Map();
const smokeGroups = new Map();
const explosionMeshes = new Map();
const _fwd = new THREE.Vector3();

function syncProjectiles() {
  for (const g of world.grenades) {
    if (!grenadeMeshes.has(g)) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), GUNMETAL);
      m.castShadow = true;
      scene.add(m);
      grenadeMeshes.set(g, m);
    }
    grenadeMeshes.get(g).position.copy(g.pos);
  }
  for (const [g, m] of grenadeMeshes) {
    if (!world.grenades.includes(g)) { scene.remove(m); grenadeMeshes.delete(g); }
  }
  for (const s of world.smokes) {
    if (world.time > s.until) continue;
    if (!smokeGroups.has(s)) {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0x9aa5b5, transparent: true, opacity: 0.26, depthWrite: false });
      for (let i = 0; i < 6; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1.9 + Math.random() * 0.9, 12, 10), mat);
        puff.position.set((Math.random() - 0.5) * 3.4, 0.8 + Math.random() * 1.8, (Math.random() - 0.5) * 3.4);
        group.add(puff);
      }
      group.position.copy(s.pos);
      scene.add(group);
      smokeGroups.set(s, group);
    }
    smokeGroups.get(s).rotation.y += 0.0015;
  }
  for (const [s, group] of smokeGroups) {
    if (world.time > s.until || !world.smokes.includes(s)) {
      scene.remove(group);
      smokeGroups.delete(s);
      const idx = world.smokes.indexOf(s);
      if (idx >= 0) world.smokes.splice(idx, 1);
    }
  }
  for (const ex of world.explosions) {
    if (!explosionMeshes.has(ex)) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 18, 14),
        new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.position.copy(ex.pos);
      const light = new THREE.PointLight(0xff9a3c, 30, 18, 1.6);
      light.position.copy(ex.pos).y += 0.5;
      scene.add(mesh, light);
      explosionMeshes.set(ex, { mesh, light });
    }
    const vis = explosionMeshes.get(ex);
    const k = Math.min(1, ex.t / 0.6);
    vis.mesh.scale.setScalar(1 + ex.t * 13);
    vis.mesh.material.opacity = 0.9 * (1 - k);
    vis.light.intensity = 30 * (1 - k);
    if (k >= 1) {
      scene.remove(vis.mesh, vis.light);
      explosionMeshes.delete(ex);
      const idx = world.explosions.indexOf(ex);
      if (idx >= 0) world.explosions.splice(idx, 1);
    }
  }
}

// ---------- Match flow ----------
function resetMatch() {
  world.score.raiders = 0;
  world.score.guard = 0;
  world.round = 1;
  world.matchWinner = null;
  world.feed = [];
  for (const a of world.agents) {
    a.money = 800; a.kills = 0; a.deaths = 0;
    a.armour = 0; a.grenades.frag = 0; a.grenades.smoke = 0;
    giveWeapon(a, 'p9');
  }
}

function startMatch() {
  resetMatch();
  startRound(world, sounds);
  world.paused = false;
}

document.getElementById('play').addEventListener('click', () => {
  sounds.unlock(); sounds.ambience(); sounds.click();
  input.requestLock();
  startMatch();
});
document.getElementById('again').addEventListener('click', () => {
  sounds.unlock(); sounds.click();
  input.requestLock();
  startMatch();
});
document.getElementById('resume').addEventListener('click', () => {
  sounds.click();
  world.paused = false;
  input.requestLock();
});
renderer.domElement.addEventListener('click', () => {
  if (world.phase !== 'menu' && world.phase !== 'matchEnd' && !world.paused && !world.ui.buyOpen && !input.locked) {
    input.requestLock();
  }
});
input.onFirstGesture = () => { sounds.unlock(); sounds.ambience(); };
input.onLockChange = (locked) => {
  // Losing the pointer mid-match pauses, unless the buy menu took it.
  if (!locked && world.phase !== 'menu' && world.phase !== 'matchEnd'
    && !world.ui.buyOpen && !world.paused && !world.shotMode) {
    world.paused = true;
  }
};
hud.onBuy = (key) => buyItem(world, player, key, sounds);

// ---------- Events ----------
function drainEvents() {
  for (const ev of world.events) {
    switch (ev.type) {
      case 'hitmarker': hud.flashHitmarker(ev.kill); break;
      case 'hurt': hud.flashDamage(); break;
      case 'roundStart': hud.showBanner(`ROUND ${ev.round}`, 'Plant the charge — or eliminate the Guard'); break;
      case 'liveStart': hud.showBanner('GO!', '', 900); break;
      case 'roundEnd':
        hud.showBanner(ev.winner === 'raiders' ? 'RAIDERS WIN THE ROUND' : 'GUARD WINS THE ROUND', ev.reason, 3200);
        break;
      case 'matchEnd': hud.showMatchEnd(ev.winner); break;
      case 'planted': hud.showBanner('CHARGE PLANTED', `Site ${ev.site} — detonation in ${ROUND.bombSeconds}s`, 3000); break;
      case 'bombDropped': hud.showBanner('CHARGE DROPPED', 'A Raider must recover it', 2200); break;
      case 'detonation':
        world.explosions.push({ pos: ev.pos.clone(), t: 0, mesh: null, light: null });
        sounds.explosion(player.pos.distanceTo(ev.pos));
        world.shake = 0.6;
        break;
      case 'explosion':
        // (frag blasts push their visual directly in combat.js)
        break;
      default: break;
    }
  }
  world.events.length = 0;
}

// ---------- Fixed step ----------
const prevWalkPhase = new Map();
function step(dt) {
  world.time += dt;
  if (world.paused) return;
  if (world.phase === 'menu') return;

  updatePlayer(world, player, input, dt, sounds);
  updateBots(world, dt, sounds);
  for (const a of world.agents) {
    if (!a.alive) { a.vel.set(0, 0, 0); continue; }
    // Gravity lives here (moveBody integrates velocity, it does not add g).
    a.vel.y -= 14 * dt;
    a.onGround = moveBody(a.pos, { x: 0.32, z: 0.32 }, bodyHeight(a), a.vel, dt, world.map.colliders);
  }
  separateAgents(world.agents);
  updateReloads(world, world.time);
  updateGrenades(world, dt, sounds);
  updateTracers(world, dt);
  updateRounds(world, dt, sounds);
  drainEvents();

  // Footsteps.
  for (const a of world.agents) {
    if (!a.alive || !a.moving || !a.onGround) continue;
    const prev = prevWalkPhase.get(a.id) ?? a.walkPhase;
    if (Math.floor(a.walkPhase / Math.PI) !== Math.floor(prev / Math.PI)) {
      sounds.step(a.isPlayer ? 0 : a.pos.distanceTo(player.pos));
    }
    prevWalkPhase.set(a.id, a.walkPhase);
  }
  world.shake = Math.max(0, world.shake - dt * 1.4);
}

// ---------- Per-frame visuals ----------
function syncAgentMeshes() {
  for (const a of world.agents) {
    const m = a.mesh;
    m.group.position.copy(a.pos);
    m.group.rotation.y = a.yaw;
    if (!a.alive) {
      const k = Math.min(1, (world.time - a.fallT) * 4);
      m.group.rotation.x = -Math.PI / 2 * k * 0.9;
      m.group.position.y = a.pos.y + 0.3 * (1 - k);
      m.flash.visible = false;
      m.name.visible = false;
    } else {
      m.group.rotation.x = 0;
      const swing = a.moving ? Math.sin(a.walkPhase) * 0.55 : 0;
      m.legL.rotation.x = swing;
      m.legR.rotation.x = -swing;
      m.gun.rotation.x = -a.pitch * 0.8;
      m.flash.visible = (world.time - a.lastShot) < 0.05;
      m.name.visible = !a.isPlayer;
    }
  }
}

function updateCamera(dt) {
  if (world.phase === 'menu') {
    const t = world.time * 0.07;
    camera.position.set(Math.sin(t) * 26, 15, Math.cos(t) * 26);
    camera.lookAt(0, 1, -6);
    camera.fov = 60;
    camera.updateProjectionMatrix();
    return;
  }
  if (!player.alive) {
    const spec = spectatorCamera(world, player, dt);
    camera.position.copy(spec.pos);
    camera.lookAt(spec.lookAt);
    camera.fov = 70;
    camera.updateProjectionMatrix();
    return;
  }
  const eye = eyeHeight(player);
  const bobY = player.moving && player.onGround ? Math.sin(player.walkPhase * 2) * 0.035 : 0;
  camera.position.set(player.pos.x, player.pos.y + eye + bobY, player.pos.z);
  camera.rotation.y = player.yaw + (Math.random() - 0.5) * world.shake * 0.06;
  camera.rotation.x = player.pitch + (Math.random() - 0.5) * world.shake * 0.06;
  camera.rotation.z = (Math.random() - 0.5) * world.shake * 0.03;
  const targetFov = player.ads ? 55 : 75;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();

  // Viewmodel: recoil kick, reload dip, ADS centering.
  vmKick *= Math.exp(-10 * dt);
  const adsK = player.ads ? 1 : 0;
  const baseX = 0.24 - adsK * 0.24;
  const baseY = -0.24 + adsK * 0.065;
  const baseZ = -0.58 + adsK * 0.07;
  viewmodel.position.set(baseX, baseY, baseZ + vmKick * 0.06);
  viewmodel.rotation.x = vmKick * 0.14;
  if (player.reloading) {
    const total = player.weapon.reloadMs / 1000;
    const prog = 1 - Math.max(0, (player.reloadEnd - world.time) / total);
    viewmodel.rotation.x = -0.6 * Math.sin(prog * Math.PI);
    viewmodel.position.y = baseY - 0.09 * Math.sin(prog * Math.PI);
  }
  viewmodel.visible = true;
}

function updateWorldVisuals(dt) {
  // Site rings pulse; letters bob.
  for (const [key, s] of Object.entries(map.siteMeshes)) {
    s.ring.material.opacity = 0.5 + 0.28 * Math.sin(world.time * 2.2 + (key === 'A' ? 0 : 2));
    s.letter.position.y = 4.2 + Math.sin(world.time * 1.4 + (key === 'A' ? 0 : 1.5)) * 0.15;
  }
  // Bomb mesh.
  const b = world.bomb;
  if (b.state === 'dropped' || b.state === 'planted') {
    bombGroup.visible = true;
    bombGroup.position.copy(b.pos);
    const blink = b.state === 'planted' ? (Math.sin(world.time * 9) > 0 ? 9 : 0.6) : 2.5;
    bombGroup.userData.light.intensity = blink;
  } else bombGroup.visible = false;
  // Muzzle light follows the most recent shot.
  let shooter = null;
  for (const a of world.agents) {
    if (a.alive && world.time - a.lastShot < 0.05) { shooter = a; break; }
  }
  if (shooter) {
    _fwd.set(-Math.sin(shooter.yaw), 0, -Math.cos(shooter.yaw));
    flashLight.position.set(
      shooter.pos.x + _fwd.x * 0.7,
      shooter.pos.y + eyeHeight(shooter) - 0.08,
      shooter.pos.z + _fwd.z * 0.7,
    );
    flashLight.intensity = 5;
  } else flashLight.intensity = 0;
  syncProjectiles();
  for (const ex of world.explosions) ex.t += dt;
}

// ---------- Shot modes ----------
const shotMode = parseShotMode();
let framesRendered = 0;
if (shotMode) {
  startMatch();
  stageShot(world, shotMode, step);
  // Drop the roundStart event startMatch queued, or its banner would
  // overwrite the staged one on the first frame.
  world.events.length = 0;
  if (shotMode === 'end') hud.showBanner('RAIDERS WIN THE ROUND', 'Charge detonated', 60000);
  window.__shotReady = false;
}

// ---------- Main loop ----------
let lastNow = performance.now();
let acc = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  // The menu camera orbits on world.time, but step() does not run in menu.
  if (world.phase === 'menu') world.time += dt;
  if (!world.paused) acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 5) { step(STEP); acc -= STEP; steps++; }
  if (steps === 5) acc = 0;

  sounds.enabled = !world.muted;
  // Buy menu takes the pointer; closing it re-locks.
  if (world.ui.buyOpen && input.locked) input.exitLock();
  if (!world.ui.buyOpen && world._wasBuyOpen && world.phase !== 'menu' && world.phase !== 'matchEnd' && !world.paused && !world.shotMode) {
    input.requestLock();
  }
  world._wasBuyOpen = world.ui.buyOpen;

  syncAgentMeshes();
  updateCamera(dt);
  updateWorldVisuals(dt);
  hud.update(world, player, dt);
  renderer.render(scene, camera);
  input.endFrame();

  framesRendered++;
  if (shotMode && framesRendered >= 3) window.__shotReady = true;
}
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.__game = { world, input, sounds, version: 'neon-harbor-1' };
frame();
