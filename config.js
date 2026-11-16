// NEON HARBOR — shared tuning: weapons, teams, economy, rounds.
// One place for every number the rest of the game balances on, so a tweak
// here never means hunting the same constant through three files.
export const GAME_NAME = 'NEON HARBOR';
export const GAME_SLUG = 'neon-harbor';

export const TEAMS = {
  raiders: { id: 'raiders', name: 'Dock Raiders', color: 0xff7a1a, css: '#ff7a1a', role: 'attack' },
  guard: { id: 'guard', name: 'Harbor Guard', color: 0x19c2d8, css: '#19c2d8', role: 'defend' },
};

// Map bounds (metres). The yard is a rectangle; z+ is the Raiders' spawn side.
export const MAP = { halfX: 35, halfZ: 25, wallHeight: 4.5 };

export const ROUND = {
  buySeconds: 15,
  roundSeconds: 100,
  bombSeconds: 35,
  plantSeconds: 3.5,
  defuseSeconds: 5,
  winsToTakeMatch: 5,
  maxRounds: 9,
};

export const ECONOMY = {
  startMoney: 800,
  killReward: 300,
  roundWin: 3250,
  roundLoss: 1900,
  plantReward: 300,
  defuseReward: 300,
  armourPrice: 650,
  grenadePrice: 300,
};

// Weapons. damage is the body-shot value at close range; headshots multiply
// by headMult. spread is radians of cone half-angle at rest; moveSpread is
// added while moving, airSpread while airborne.
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'Kestrel P9', kind: 'pistol', price: 0,
    damage: 34, headMult: 4, intervalMs: 260, auto: false,
    mag: 12, reserve: 48, reloadMs: 1400, spread: 0.010, moveSpread: 0.030,
    airSpread: 0.055, adsSpread: 0.004, recoil: 0.011, range: 60,
    tracer: 0xffe08a, sound: 'pistol',
  },
  jackal: {
    id: 'jackal', name: 'Jackal-9 SMG', kind: 'smg', price: 1500,
    damage: 26, headMult: 4, intervalMs: 92, auto: true,
    mag: 28, reserve: 112, reloadMs: 1900, spread: 0.016, moveSpread: 0.034,
    airSpread: 0.060, adsSpread: 0.007, recoil: 0.008, range: 55,
    tracer: 0xffd23f, sound: 'smg',
  },
  vulture: {
    id: 'vulture', name: 'Vulture-5 Rifle', kind: 'rifle', price: 2700,
    damage: 33, headMult: 4, intervalMs: 108, auto: true,
    mag: 30, reserve: 90, reloadMs: 2300, spread: 0.011, moveSpread: 0.028,
    airSpread: 0.052, adsSpread: 0.003, recoil: 0.013, range: 70,
    tracer: 0xffb020, sound: 'rifle',
  },
  longshot: {
    id: 'longshot', name: 'Longshot DMR', kind: 'dmr', price: 4200,
    damage: 86, headMult: 4, intervalMs: 950, auto: false,
    mag: 5, reserve: 20, reloadMs: 2800, spread: 0.002, moveSpread: 0.045,
    airSpread: 0.080, adsSpread: 0.0005, recoil: 0.045, range: 90,
    tracer: 0x9fd8ff, sound: 'dmr', adsZoom: 3.2,
  },
  breacher: {
    id: 'breacher', name: 'Breacher-12', kind: 'shotgun', price: 1800,
    damage: 13, headMult: 2, pellets: 8, intervalMs: 820, auto: false,
    mag: 6, reserve: 24, reloadMs: 2600, spread: 0.045, moveSpread: 0.055,
    airSpread: 0.075, adsSpread: 0.030, recoil: 0.038, range: 28,
    tracer: 0xff9a3d, sound: 'shotgun',
  },
};

// The buy menu, in display order. Keys 1-6 buy the matching row.
// Prices mirror WEAPONS / ECONOMY so the menu can never disagree with them.
export const BUY_MENU = [
  { key: '1', kind: 'weapon', id: 'jackal', name: 'Jackal-9 SMG', desc: 'Fast close-quarters spray, 28-round mag', price: 1500 },
  { key: '2', kind: 'weapon', id: 'vulture', name: 'Vulture-5 Rifle', desc: 'Accurate all-rounder, 30-round mag', price: 2700 },
  { key: '3', kind: 'weapon', id: 'breacher', name: 'Breacher-12 Shotgun', desc: '8 pellets up close, 6 shells', price: 1800 },
  { key: '4', kind: 'weapon', id: 'longshot', name: 'Longshot DMR', desc: 'One-tap headshots at range, 5-round mag', price: 4200 },
  { key: '5', kind: 'armour', name: 'Kevlar Armour', desc: 'Absorbs half of incoming damage', price: 650 },
  { key: '6', kind: 'grenade', name: 'Grenade Kit', desc: 'One frag + one smoke grenade', price: 300 },
];

export const BOT_NAMES = {
  raiders: ['Rook', 'Mara', 'Vex', 'Kilo'],
  guard: ['Anchor', 'Buoy', 'Tide', 'Reef', 'Gull'],
};

// Seeded RNG (mulberry32) so staged screenshots are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
export function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
