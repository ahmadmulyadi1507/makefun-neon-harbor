// NEON HARBOR — rounds: the phase machine, the economy, the buy menu and
// the charge. One module owns every rule about who wins a round and what
// anyone can afford next round.
import { ROUND, ECONOMY, WEAPONS, BUY_MENU } from './config.js';
import { giveWeapon } from './combat.js';
import { aliveAgents } from './state.js';

export function assignRoles(world) {
  // Raiders: two push A, one pushes B, the player is free. Guards: two hold
  // each site. The charge goes to a random Raider bot (or the player).
  const raiders = aliveAgents(world, 'raiders');
  const guards = aliveAgents(world, 'guard');
  const raiderBots = raiders.filter((a) => a.bot);
  raiderBots.forEach((b, i) => {
    b.bot.site = i % 3 === 2 ? 'B' : 'A';
    b.bot.role = 'push';
  });
  guards.forEach((g, i) => {
    if (!g.bot) return;
    g.bot.site = i % 2 === 0 ? 'A' : 'B';
    g.bot.role = 'hold';
    g.bot.holdPos = g.bot.site === 'A' ? (i === 0 ? 12 : 11) : (i === 1 ? 15 : 14);
  });
  const carrier = raiderBots.length ? raiderBots[Math.floor(world.rng() * raiderBots.length)] : raiders[0];
  if (carrier) {
    carrier.carryingBomb = true;
    world.bomb.state = 'carried';
    world.bomb.carrierId = carrier.id;
    world.bomb.site = carrier.bot ? carrier.bot.site : 'A';
  }
}

export function botAutoBuy(world, agent) {
  // Bots spend like casual players: rifle when rich, SMG when broke, armour
  // and a grenade when there is money left over.
  if (agent.money >= 2700 && agent.weapon.id === 'p9') {
    agent.money -= 2700; giveWeapon(agent, 'vulture');
  } else if (agent.money >= 1500 && agent.weapon.id === 'p9') {
    agent.money -= 1500; giveWeapon(agent, 'jackal');
  }
  if (agent.money >= 650 && agent.armour < 50) { agent.money -= 650; agent.armour = 100; }
  if (agent.money >= 300 && agent.grenades.frag === 0) { agent.money -= 300; agent.grenades.frag = 1; }
  if (agent.money >= 300 && agent.grenades.smoke === 0) { agent.money -= 300; agent.grenades.smoke = 1; }
}

export function buyItem(world, agent, key, sounds) {
  if (!agent.alive) return false;
  if (world.phase !== 'buy') return false;
  const row = BUY_MENU.find((r) => r.key === key);
  if (!row) return false;
  if (row.kind === 'weapon') {
    const w = WEAPONS[row.id];
    if (agent.weapon.id === row.id) { sounds.denied(); return false; }
    if (agent.money < w.price) { sounds.denied(); return false; }
    agent.money -= w.price;
    giveWeapon(agent, row.id);
  } else if (row.kind === 'armour') {
    if (agent.money < ECONOMY.armourPrice || agent.armour >= 100) { sounds.denied(); return false; }
    agent.money -= ECONOMY.armourPrice;
    agent.armour = 100;
  } else if (row.kind === 'grenade') {
    if (agent.money < ECONOMY.grenadePrice) { sounds.denied(); return false; }
    agent.money -= ECONOMY.grenadePrice;
    agent.grenades.frag += 1;
    agent.grenades.smoke += 1;
  }
  sounds.buy();
  world.events.push({ type: 'bought', agent, key });
  return true;
}

export function startRound(world, sounds) {
  world.phase = 'buy';
  world.phaseT = ROUND.buySeconds;
  world.winner = null; world.winReason = '';
  world.bomb = { state: 'none', site: null, pos: world.bomb.pos, timer: 0, progress: 0, actor: null, carrierId: null, beepAt: 0 };
  world.feed = [];
  // Respawn everyone at their spawn, keep money and surviving weapons.
  for (const a of world.agents) {
    const spawn = world.map.spawns[a.team][a.id % 4] ?? world.map.spawns[a.team][0];
    a.pos.set(spawn.x, 0, spawn.z);
    a.vel.set(0, 0, 0);
    a.spawnPos.set(spawn.x, 0, spawn.z);
    a.hp = 100;
    a.alive = true;
    a.fallT = 0;
    a.carryingBomb = false;
    a.planting = false; a.defusing = false;
    a.plantProgress = 0; a.defuseProgress = 0;
    a.reloading = false;
    a.yaw = a.team === 'raiders' ? 0 : Math.PI;
    a.pitch = 0;
    a.mag = a.weapon.mag; a.reserve = a.weapon.reserve;
    if (a.bot) {
      a.bot.state = 'move'; a.bot.targetId = null; a.bot.path = []; a.bot.pathIdx = 0;
      a.bot.thinkAt = world.time + (a.id % 5) * 0.03;
      botAutoBuy(world, a);
    }
  }
  assignRoles(world);
  world.events.push({ type: 'roundStart', round: world.round });
}

function endRound(world, winner, reason, sounds) {
  world.phase = 'ended';
  world.phaseT = 5;
  world.winner = winner;
  world.winReason = reason;
  world.score[winner] += 1;
  for (const a of world.agents) {
    const won = a.team === winner;
    a.money += won ? ECONOMY.roundWin : ECONOMY.roundLoss;
    if (a.team === 'raiders' && winner === 'raiders' && a.carryingBomb) a.money += ECONOMY.plantReward;
    // A dead agent loses their bought weapon — next round starts on a pistol.
    if (!a.alive && a.weapon.id !== 'p9') giveWeapon(a, 'p9');
  }
  const player = world.agents.find((a) => a.isPlayer);
  if (player) {
    if (player.team === winner) sounds.roundWin(); else sounds.roundLose();
  }
  world.events.push({ type: 'roundEnd', winner, reason });
  // Clear live grenades and smoke between rounds.
  world.grenades.length = 0;
  world.smokes.length = 0;
}

function matchOver(world) {
  if (world.score.raiders >= ROUND.winsToTakeMatch) return 'raiders';
  if (world.score.guard >= ROUND.winsToTakeMatch) return 'guard';
  if (world.round >= ROUND.maxRounds) {
    if (world.score.raiders === world.score.guard) return 'draw';
    return world.score.raiders > world.score.guard ? 'raiders' : 'guard';
  }
  return null;
}

export function updateRounds(world, dt, sounds) {
  const now = world.time;
  if (world.phase === 'menu' || world.phase === 'matchEnd') return;

  if (world.phase === 'buy') {
    world.phaseT -= dt;
    if (world.phaseT <= 0) {
      world.phase = 'live';
      world.phaseT = ROUND.roundSeconds;
      world.events.push({ type: 'liveStart' });
    }
    return;
  }

  if (world.phase === 'ended') {
    world.phaseT -= dt;
    if (world.phaseT <= 0) {
      const m = matchOver(world);
      if (m) {
        world.phase = 'matchEnd';
        world.matchWinner = m;
        world.events.push({ type: 'matchEnd', winner: m });
      } else {
        world.round += 1;
        startRound(world, sounds);
      }
    }
    return;
  }

  // Live or planted.
  world.phaseT -= dt;

  // Plant / defuse completions arrive as events from bots and the player.
  for (const ev of world.events) {
    if (ev.type === 'plantComplete' && world.phase === 'live') {
      world.bomb.state = 'planted';
      world.bomb.site = ev.site;
      world.bomb.pos.copy(ev.agent.pos);
      world.bomb.timer = ROUND.bombSeconds;
      world.bomb.beepAt = now;
      world.phase = 'planted';
      world.phaseT = ROUND.bombSeconds;
      ev.agent.money += ECONOMY.plantReward;
      world.events.push({ type: 'planted', site: ev.site });
    }
    if (ev.type === 'defuseComplete' && world.phase === 'planted') {
      ev.agent.money += ECONOMY.defuseReward;
      endRound(world, 'guard', 'Charge defused', sounds);
      return;
    }
  }

  if (world.phase === 'planted') {
    world.bomb.timer -= dt;
    // Beep faster as the timer runs down.
    const interval = world.bomb.timer > 10 ? 1 : world.bomb.timer > 5 ? 0.5 : 0.25;
    if (now - world.bomb.beepAt >= interval) {
      world.bomb.beepAt = now;
      sounds.bombBeep();
    }
    if (world.bomb.timer <= 0) {
      world.events.push({ type: 'detonation', pos: world.bomb.pos.clone() });
      endRound(world, 'raiders', 'Charge detonated', sounds);
      return;
    }
  } else if (world.phaseT <= 0) {
    endRound(world, 'guard', 'Time expired — charge never planted', sounds);
    return;
  }

  // Elimination wins.
  const raidersAlive = aliveAgents(world, 'raiders').length;
  const guardAlive = aliveAgents(world, 'guard').length;
  if (raidersAlive === 0 && guardAlive > 0) { endRound(world, 'guard', 'Raiders eliminated', sounds); return; }
  if (guardAlive === 0 && raidersAlive > 0) { endRound(world, 'raiders', 'Guard eliminated', sounds); return; }
  if (raidersAlive === 0 && guardAlive === 0) {
    // Simultaneous wipe: the team that planted (or the defenders) take it.
    endRound(world, world.bomb.state === 'planted' ? 'raiders' : 'guard', 'Mutual elimination', sounds);
  }
}

// Player plant/defuse input: hold E near a site (Raiders) or near the
// planted charge (Guard). Called from the player update every tick.
export function updatePlayerObjective(world, agent, dt, holdingE, sounds) {
  agent.planting = false; agent.defusing = false;
  if (!agent.alive || world.phase !== 'live' && world.phase !== 'planted') return;
  if (!holdingE || agent.moveSpeed > 1.5) {
    agent.plantProgress = Math.max(0, agent.plantProgress - dt * 0.5);
    agent.defuseProgress = Math.max(0, agent.defuseProgress - dt * 0.5);
    return;
  }
  if (agent.team === 'raiders' && agent.carryingBomb && world.phase === 'live') {
    const near = Object.entries(world.map.sites).find(([, s]) => agent.pos.distanceTo(s.pos) < s.radius);
    if (near) {
      agent.planting = true;
      agent.plantProgress += dt / ROUND.plantSeconds;
      if (Math.floor(agent.plantProgress * 10) !== Math.floor((agent.plantProgress - dt / ROUND.plantSeconds) * 10)) sounds.plantBeep();
      if (agent.plantProgress >= 1) {
        agent.plantProgress = 0; agent.planting = false;
        world.events.push({ type: 'plantComplete', agent, site: near[0] });
      }
      return;
    }
  }
  if (agent.team === 'guard' && world.bomb.state === 'planted') {
    if (agent.pos.distanceTo(world.bomb.pos) < 1.8) {
      agent.defusing = true;
      agent.defuseProgress += dt / ROUND.defuseSeconds;
      if (Math.floor(agent.defuseProgress * 10) !== Math.floor((agent.defuseProgress - dt / ROUND.defuseSeconds) * 10)) sounds.defuseBeep();
      if (agent.defuseProgress >= 1) {
        agent.defuseProgress = 0; agent.defusing = false;
        world.events.push({ type: 'defuseComplete', agent });
      }
    }
  }
}
