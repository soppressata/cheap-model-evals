/**
 * Storage.js — localStorage wrappers for coins, unlocks, customizations, bests.
 * All persistence is local-only (single-player). Values are JSON-serialized.
 */

const KEY = 'paper_glider_save';

export const DEFAULT_SAVE = Object.freeze({
  coins: 350,           // starter coins so the shop feels immediate
  highScore: 0,         // best distance (meters)
  highTime: 0,          // best air time (seconds)
  bestRings: 0,         // most rings in a single run
  unlockedPlanes: ['glider_a'],
  equippedPlane: 'glider_a',
  customizations: {
    // default per-plane; overwritten as player picks options
    glider_a: { primary: '#fb9233', secondary: '#1e293b', pattern: 'stripes', finish: 'paper', contrail: 'ribbon' },
    glider_b: { primary: '#06b6d4', secondary: '#0f172a', pattern: 'chevrons', finish: 'foil', contrail: 'spark' },
    glider_c: { primary: '#8b5cf6', secondary: '#1e1b37', pattern: 'confetti', finish: 'glitch', contrail: 'neon' },
    glider_d: { primary: '#22c55e', secondary: '#0b2c15', pattern: 'camo', finish: 'matte', contrail: 'ribbon' },
    glider_e: { primary: '#ef4444', secondary: '#2a1010', pattern: 'gradient', finish: 'foil', contrail: 'spark' },
    glider_f: { primary: '#fbbf24', secondary: '#422006', pattern: 'confetti', finish: 'paper', contrail: 'neon' },
  },
});

export const PLANES = [
  { id: 'glider_a', name: 'Classic Glider',  cost: 0,     stats: { speed: 5, handling: 6, lift: 5, boost: 5, coins: 1.0 } },
  { id: 'glider_b', name: 'Swift Dart',      cost: 200,   stats: { speed: 8, handling: 4, lift: 3, boost: 7, coins: 1.1 } },
  { id: 'glider_c', name: 'Driftwing',       cost: 450,   stats: { speed: 4, handling: 8, lift: 7, boost: 4, coins: 1.2 } },
  { id: 'glider_d', name: 'Stallion',        cost: 750,   stats: { speed: 6, handling: 5, lift: 8, boost: 6, coins: 1.3 } },
  { id: 'glider_e', name: 'Neon Racer',      cost: 1200,  stats: { speed: 9, handling: 3, lift: 2, boost: 9, coins: 1.4 } },
  { id: 'glider_f', name: 'Barrage',         cost: 1800,  stats: { speed: 3, handling: 9, lift: 9, boost: 3, coins: 1.5 } },
];

export const PATTERNS = ['stripes', 'chevrons', 'confetti', 'camo', 'gradient'];
export const FINISHES = ['paper', 'foil', 'matte', 'glitch'];
export const CONTRAILS = ['ribbon', 'spark', 'neon'];

// Cosmetic stat scaling helpers (multipliers on base flight params).
export const FINISH_PARAMS = {
  paper:  { roughness: 0.65, metalness: 0.05 },
  foil:   { roughness: 0.05, metalness: 0.9  },
  matte:  { roughness: 0.85, metalness: 0.0  },
  glitch: { roughness: 0.45, metalness: 0.4  },
};

export const CONTRAIL_COLORS = {
  ribbon: '#fb9233',
  spark:  '#f59e0b',
  neon:   '#06b6d4',
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    // merge with defaults so migrations are forward-compatible
    const merged = { ...DEFAULT_SAVE, ...obj };
    merged.unlockedPlanes = [...(DEFAULT_SAVE.unlockedPlanes), ...(obj.unlockedPlanes || [])].filter(
      (v, i, a) => a.indexOf(v) === i
    );
    merged.customizations = { ...DEFAULT_SAVE.customizations, ...(obj.customizations || {}) };
    return merged;
  } catch {
    return null;
  }
}

function write(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function loadSave() {
  return read() || JSON.parse(JSON.stringify(DEFAULT_SAVE));
}

export function save(save) {
  return write(save);
}

export function addCoins(n) {
  const s = loadSave();
  s.coins = (s.coins || 0) + n;
  save(s);
  return s.coins;
}

export function unlockPlane(id) {
  const s = loadSave();
  if (!s.unlockedPlanes.includes(id)) s.unlockedPlanes.push(id);
  save(s);
}

export function equipPlane(id) {
  const s = loadSave();
  s.equippedPlane = id;
  save(s);
}

export function setCustomization(planeId, patch) {
  const s = loadSave();
  s.customizations = s.customizations || {};
  s.customizations[planeId] = { ...(s.customizations[planeId] || {}), ...patch };
  save(s);
  return s.customizations[planeId];
}

export function updateStats(score) {
  const s = loadSave();
  let best = false;
  if (score.distance > s.highScore) { s.highScore = score.distance; best = true; }
  if (score.airTime > s.highTime) s.highTime = score.airTime;
  if (score.rings > s.bestRings) s.bestRings = score.rings;
  const gained = Math.floor(score.coins);
  s.coins = (s.coins || 0) + gained;
  save(s);
  return { gained, best, coins: s.coins, highScore: s.highScore };
}
