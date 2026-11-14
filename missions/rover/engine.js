// Rover mission rules: power, temperature, driving, digging, scanning and scoring.
// Pure logic (no screen code) so it can be tested with `npm test`.
import { LIMITS, summarize, OBJECTIVES } from './parts.js';
import { cells, cellAt, sunAt, commsAt, findPath, stepCost, CELL_M } from './world.js';
import { rollEvent } from './events.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function newRun({ design, objectiveId, siteK, testsRun = 0, seed = 2026 }) {
  const rover = { ...summarize(design), alive: true };
  return {
    design, rover, objective: OBJECTIVES.find((o) => o.id === objectiveId),
    t: 0, k: siteK, siteK, batteryWh: rover.batteryWh, shadowH: 0, dust: 0,
    cargo: { regolith: 0, water: 0 }, floorSample: false,
    scanned: new Set(), damage: {}, testsRun,
    decisions: { total: 0, withLink: 0 },
    stats: { driveKm: 0, digH: 0, brownouts: 0 },
    log: [], rand: rng(seed), lastEvent: null,
    ended: false, endReason: '',
    get here() { return cells[this.k]; },
  };
}

const say = (s, text, kind = 'info') => s.log.unshift({ t: Math.round(s.t), text, kind });

function heaterW(s, sun) {
  const th = s.rover.therm;
  if (s.rover.warm || sun > 0.1 || s.damage.noHeater) return 0;
  return th.heaterW;
}

function shadowLimit(s) {
  if (s.rover.warm) return Infinity;
  return s.damage.noHeater ? 3 : s.rover.therm.shadowLimitH;
}

/** Let time pass. extraW is the load on top of the computer's base load. */
export function wait(s, hours, extraW = 0) {
  let left = hours;
  while (left > 1e-9 && !s.ended) {
    const dt = Math.min(1, left);
    const c = cells[s.k];
    const sun = sunAt(c, s.t);
    const gen = s.rover.solarW * sun * (1 - s.dust) + s.rover.rtgW;
    const load = Math.max(0, LIMITS.baseLoadW + extraW + heaterW(s, sun));
    s.batteryWh = Math.min(s.rover.batteryWh, s.batteryWh + (gen - load) * dt);
    s.shadowH = sun <= 0.1 && heaterW(s, sun) === 0 && !s.rover.warm ? s.shadowH + dt : 0;
    s.t += dt; left -= dt;
    if (s.shadowH > shadowLimit(s)) return end(s, 'froze', 'The rover froze in the shadow. Its electronics cracked at about -200 °C.');
    if (s.batteryWh <= 0) {
      if (sun > 0.2 || s.rover.rtgW) {
        s.stats.brownouts++;
        say(s, `Battery empty. The rover shut down and slowly recharged ${s.rover.rtgW ? 'from its RTG' : 'in the sunlight'}. Lost 6 hours.`, 'bad');
        s.t += 6;
        s.batteryWh = Math.min(s.rover.batteryWh, (s.rover.solarW * sun * (1 - s.dust) + s.rover.rtgW - LIMITS.baseLoadW) * 6);
      } else {
        return end(s, 'battery', 'The battery ran out in the dark. With no power for heaters, the rover froze.');
      }
    }
    if (s.t >= LIMITS.missionHours) return end(s, 'night', 'The 14-day mission is over and the lunar night begins.');
  }
}

function end(s, reason, text) {
  if (s.ended) return;
  s.ended = true; s.endReason = reason;
  s.rover.alive = reason === 'night' || reason === 'player';
  say(s, text, s.rover.alive ? 'info' : 'bad');
}

export function finish(s) { end(s, 'player', 'You ended the mission and sent the final report to Earth.'); }

export function link(s) { return commsAt(cells[s.k], s.t, s.rover.comm); }

export function planDrive(s, target) { return findPath(cells[s.k], target, s.rover); }

/** Drive along a planned path. Returns an event (or null) for the screen to show. */
export function drive(s, plan) {
  let hours = 0, steep = false, i = 1;
  for (; i < plan.path.length && !s.ended; i++) {
    if (s.batteryWh < 0.12 * s.rover.batteryWh) {
      say(s, 'Fault protection stopped the drive: battery under 12%. Recharge before you go on.', 'bad');
      break;
    }
    const a = plan.path[i - 1], b = plan.path[i];
    const diag = a.i !== b.i && a.j !== b.j;
    const km = (CELL_M * (diag ? Math.SQRT2 : 1)) / 1000;
    steep = steep || b.slope === 3;
    const st = stepCost(b, diag, s.rover);
    const h = st.hours;
    s.k = b.k;
    wait(s, h, st.watts * (s.damage.drive || 1));
    hours += h; s.stats.driveKm += km;
    if (b.kind === 'floor') s.floorSample = true;
  }
  say(s, `Drove ${i - 1} cells in ${hours.toFixed(1)} h.`);
  return rollEvent(s, { action: 'drive', steep }, hours);
}

export function digRate(s) {
  const c = cells[s.k];
  const frozen = c.kind === 'trap' || c.kind === 'floor' || c.kind === 'wall';
  return s.rover.dig.rateKgH * (frozen ? s.rover.dig.iceFactor : 1) * (s.damage.digSlow || 1);
}

export function dig(s, hours) {
  const c = cells[s.k];
  const rate = digRate(s);
  let done = 0;
  while (done < hours && !s.ended) {
    if (s.batteryWh < 0.12 * s.rover.batteryWh) {
      say(s, 'Fault protection stopped digging: battery under 12%.', 'bad');
      break;
    }
    wait(s, 1, s.rover.dig.digW); done++;
  }
  if (s.ended && !s.rover.alive) return null;
  const kg = rate * done, water = (kg * c.ice) / 100;
  const before = s.objective.metric === 'water' ? s.cargo.water : s.cargo.regolith;
  s.cargo.regolith += kg; s.cargo.water += water; s.stats.digH += done;
  const after = s.objective.metric === 'water' ? s.cargo.water : s.cargo.regolith;
  if (before < s.objective.target && after >= s.objective.target) {
    say(s, 'Objective complete. Get the rover somewhere safe and sunny, then end the mission to keep the survival points.', 'good');
  }
  s.damage.digSlow = 1;
  if (c.kind === 'floor') s.floorSample = true;
  say(s, `Dug ${Math.round(kg)} kg of regolith with ${c.ice.toFixed(1)}% ice: ${water.toFixed(2)} kg of water.`, water > 0.5 ? 'good' : 'info');
  return done ? rollEvent(s, { action: 'dig' }, done) : null;
}

export function scan(s) {
  if (!s.rover.sci.scan) return null;
  wait(s, 1, s.rover.sci.scanW);
  const c = cells[s.k];
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const n = cellAt(c.i + di, c.j + dj); if (n) s.scanned.add(n.k);
  }
  say(s, 'Neutron scan done. Hidden ice nearby is now on the map.');
  return rollEvent(s, { action: 'scan' }, 1);
}

export function rest(s, hours) {
  wait(s, hours, 0);
  say(s, `Waited ${hours} h to recharge.`);
  return rollEvent(s, { action: 'rest' }, hours);
}

/** Resolve an event choice (index) or the automatic outcome when there is no link. */
export function resolveEvent(s, ev, choiceIdx) {
  const eng = { wait };
  const hasLink = link(s).ok;
  s.decisions.total++;
  if (ev.apply) ev.apply(s);
  if (!hasLink) {
    if (ev.noLink) { ev.noLink(s, eng); say(s, `${ev.title}: ${ev.noLinkText}`, 'bad'); return ev.noLinkText; }
    const msg = ev.choices[ev.auto].run(s, eng);
    say(s, `${ev.title}: no link to Earth, so the rover chose "${ev.choices[ev.auto].label}". ${msg}`, 'bad');
    return msg;
  }
  s.decisions.withLink++;
  const msg = ev.choices[choiceIdx].run(s, eng);
  say(s, `${ev.title}: ${msg}`);
  return msg;
}

/** Final score out of 100, with the reasons. */
export function debrief(s) {
  const o = s.objective;
  const got = o.metric === 'water' ? s.cargo.water : s.cargo.regolith;
  const progress = Math.min(1, got / o.target);
  const budgetLeft = LIMITS.budgetM - s.rover.costM - s.testsRun * LIMITS.testCostM;
  const massMargin = LIMITS.landerCapacityKg - s.rover.massKg;
  const items = [
    { label: 'Objective', max: 50, pts: Math.round(50 * progress),
      why: `${got.toFixed(o.metric === 'water' ? 1 : 0)} of ${o.target} ${o.unit}.` },
    { label: 'Survival', max: 15, pts: s.rover.alive ? 15 : 0,
      why: s.rover.alive ? 'The rover is still alive for the next crew.' : s.log.find((l) => l.kind === 'bad')?.text || 'The rover was lost.' },
    { label: 'Science', max: 15, pts: Math.min(15, Math.round(Math.min(1, s.scanned.size / 75) * 10) + (s.floorSample ? 5 : 0)),
      why: `${s.scanned.size} map cells scanned for ice${s.floorSample ? ', plus a sample from the never-lit crater floor' : ''}.` },
    { label: 'Teamwork with Earth', max: 10, pts: s.decisions.total ? Math.round(10 * s.decisions.withLink / s.decisions.total) : 10,
      why: `${s.decisions.withLink} of ${s.decisions.total} surprises were handled with a live link to Earth.` },
    { label: 'Efficiency', max: 10, pts: Math.round(5 * Math.min(1, Math.max(0, budgetLeft) / 40) + 5 * Math.min(1, Math.max(0, massMargin) / 40)),
      why: `$${budgetLeft}M left, ${massMargin} kg spare on the lander, ${s.testsRun} test campaigns.` },
  ];
  const score = items.reduce((a, i) => a + i.pts, 0);
  const grade = progress >= 1 && s.rover.alive && score >= 80 ? 'Mission success'
    : progress >= 0.5 ? 'Partial success' : 'Mission failed';
  return { score, grade, items, progress, got };
}
