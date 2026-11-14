// The Shackleton rim world: terrain from NASA LOLA data plus simple, documented models
// for sunlight, cold traps, ice and Earth visibility.
import { TERRAIN } from './data/terrain.js';

export const N = TERRAIN.n;
export const CELL_M = TERRAIN.meta.cell_m; // about 333 m
export const SLOPE_TEXT = ['under 10°', '10-15°', '15-20°', 'over 20°'];

const slope = Array.from(TERRAIN.slope, Number);
const elev = TERRAIN.elev;

// Seeded random numbers so every player gets the same hidden ice map.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function localMean(i, j, r) {
  let s = 0, n = 0;
  for (let y = Math.max(0, j - r); y <= Math.min(N - 1, j + r); y++)
    for (let x = Math.max(0, i - r); x <= Math.min(N - 1, i + r); x++) { s += elev[y * N + x]; n++; }
  return s / n;
}

/** Per-cell model. kind: 'floor' | 'wall' | 'trap' | 'plain'. */
export const cells = (() => {
  const rand = rng(73);
  const out = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i, e = elev[k], s = slope[k];
      let kind = 'plain';
      if (e < 110) kind = s <= 1 ? 'floor' : 'wall';                 // inside Shackleton: never sunlit
      else if (s <= 1 && e < localMean(i, j, 3) - 3) kind = 'trap';  // small low spot on the plateau
      // Sunlight: higher ground sees the low polar Sun more often (the rim peaks are lit ~90% of the time).
      let sun = Math.min(0.95, Math.max(0.3, 0.3 + (e - 110) / 130 * 0.65));
      if (kind === 'floor' || kind === 'wall') sun = 0;
      if (kind === 'trap') sun = 0.05;
      // Ice by weight. LCROSS measured about 5.6% in Cabeus crater; cold traps hold less and vary.
      let ice = 0.1 + rand() * 0.2;
      if (kind === 'floor') ice = 4 + rand() * 3;
      if (kind === 'wall') ice = 1 + rand() * 2;
      if (kind === 'trap') ice = 0.3 + rand() * 2.2;
      out.push({ i, j, k, slope: s, elev: e, kind, sun, ice });
    }
  }
  return out;
})();

export const cellAt = (i, j) => (i < 0 || j < 0 || i >= N || j >= N ? null : cells[j * N + i]);

/** Sunlight 0..1 at hour t. The Sun circles the horizon, so light rises and falls slowly. */
export function sunAt(c, t) {
  if (c.sun === 0) return 0;
  const swing = 0.85 + 0.15 * Math.sin((2 * Math.PI * t) / 168 + c.i / 9);
  return Math.min(1, c.sun * swing);
}

/** Can the rover talk to Earth from this cell at hour t? */
export function commsAt(c, t, comm) {
  const dte = !!comm.dte && c.elev >= 150;      // Earth is low on the horizon: you need high ground
  const relay = !!comm.relay && t % 12 < 4;       // relay satellite overhead 4 h of every 12
  return { ok: dte || relay, dte, relay };
}

/** Can this rover enter a cell? */
export function passable(c, rover) {
  if (c.slope <= rover.mob.maxSlope) return true;
  return !!rover.extra.tether; // tether lets wheels lower down steep walls
}

/** Hours and watt-hours to move one step into cell c. */
export function stepCost(c, diag, rover) {
  const km = (CELL_M * (diag ? Math.SQRT2 : 1)) / 1000;
  const tethered = c.slope > rover.mob.maxSlope; // only possible with tether
  // On the tether the winch lowers and hauls the rover: slow, but the wheels do less work.
  const hours = (km / rover.mob.speedKmh) * (1 + 0.35 * c.slope) * (tethered ? 2 : 1);
  const watts = rover.mob.driveW * (1 + 0.25 * c.slope) * (tethered ? 0.8 : 1);
  return { hours, wh: hours * watts, watts, tethered };
}

/** A* path from a to b, minimising hours. Returns { path, hours, wh } or null. */
export function findPath(a, b, rover) {
  if (!passable(b, rover)) return null;
  const open = new Map([[a.k, 0]]);
  const g = new Float64Array(N * N).fill(Infinity);
  const prev = new Int32Array(N * N).fill(-1);
  g[a.k] = 0;
  const hMin = (CELL_M / 1000) / rover.mob.speedKmh;
  const heur = (c) => Math.hypot(c.i - b.i, c.j - b.j) * hMin;
  while (open.size) {
    let bestK = -1, bestF = Infinity;
    for (const [k, f] of open) if (f < bestF) { bestF = f; bestK = k; }
    open.delete(bestK);
    if (bestK === b.k) break;
    const c = cells[bestK];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const n = cellAt(c.i + di, c.j + dj);
      if (!n || !passable(n, rover)) continue;
      const cost = g[bestK] + stepCost(n, di && dj, rover).hours;
      if (cost < g[n.k]) { g[n.k] = cost; prev[n.k] = bestK; open.set(n.k, cost + heur(n)); }
    }
  }
  if (g[b.k] === Infinity) return null;
  const path = [];
  for (let k = b.k; k !== -1; k = prev[k]) path.unshift(cells[k]);
  let hours = 0, wh = 0;
  for (let s = 1; s < path.length; s++) {
    const d = path[s].i !== path[s - 1].i && path[s].j !== path[s - 1].j;
    const st = stepCost(path[s], d, rover); hours += st.hours; wh += st.wh;
  }
  return { path, hours, wh };
}

/** Nearest reachable cell of a kind (for the test checks). */
export function nearestReachable(from, kinds, rover) {
  const seen = new Uint8Array(N * N);
  const q = [from]; seen[from.k] = 1;
  while (q.length) {
    const c = q.shift();
    if (kinds.includes(c.kind)) return c;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const n = cellAt(c.i + di, c.j + dj);
      if (n && !seen[n.k] && passable(n, rover)) { seen[n.k] = 1; q.push(n); }
    }
  }
  return null;
}

export const SOURCE_NOTE =
  'Terrain: NASA LRO LOLA slope and elevation, Shackleton crater rim, from NASA Moon Trek. ' +
  'Sunlight, ice amounts and Earth visibility are simplified game models based on that terrain.';
