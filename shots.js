// NEON HARBOR — screenshot staging: ?shot=start|play|end puts the game in a
// fixed, good-looking state for a still image. Only used when the query is
// present; normal play never touches it.
export function parseShotMode() {
  try {
    return new URLSearchParams(window.location.search).get('shot');
  } catch { return null; }
}

function playerOf(world) {
  return world.agents.find((a) => a.isPlayer);
}

// Runs the fixed-step simulation forward so bots spread into the lanes,
// then frames the player on a vantage looking down the action.
export function stageShot(world, mode, stepFn) {
  const p = playerOf(world);
  if (mode === 'start') {
    world.phase = 'buy';
    world.phaseT = 12;
    world.ui.buyOpen = true;
    p.pos.set(-3, 0, 21);
    p.yaw = 0; p.pitch = 0.02;
    p.vel.set(0, 0, 0);
  } else if (mode === 'play') {
    world.demoInvulnerable = true;
    world.phase = 'live';
    world.phaseT = 75;
    for (let i = 0; i < 14 * 60; i++) stepFn(1 / 60);
    world.demoInvulnerable = false;
    p.pos.set(-6, 0, 10);
    p.yaw = -0.46; p.pitch = 0.04;
    p.vel.set(0, 0, 0);
    p.alive = true; p.hp = 100;
  } else if (mode === 'end') {
    world.phase = 'ended';
    world.phaseT = 5;
    world.winner = 'raiders';
    world.winReason = 'Charge detonated';
    world.score.raiders = 2; world.score.guard = 1;
    world.round = 3;
    world.bomb.state = 'planted';
    world.bomb.site = 'A';
    world.bomb.pos.set(-22, 0, -15);
    p.pos.set(-13, 0, -7);
    p.yaw = 0.85; p.pitch = 0.02;
    p.vel.set(0, 0, 0);
  }
  world.shotMode = true;
}
