// A simple robot player proves each objective can be won with a sensible design,
// and that bad designs really fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../missions/rover/engine.js';
import { cells, sunAt, nearestReachable } from '../missions/rover/world.js';
import { summarize, defaultDesign } from '../missions/rover/parts.js';

function landingNear(kinds, rover) {
  // best flat sunny landing cell with the shortest path to a target kind
  let best = null;
  for (const c of cells) {
    if (c.slope !== 0 || c.kind !== 'plain' || c.sun < 0.5) continue;
    const g = nearestReachable(c, kinds, rover);
    if (!g) continue;
    const d = Math.hypot(g.i - c.i, g.j - c.j);
    if (!best || d < best.d) best = { c, d };
  }
  return best.c;
}

function play(design, objectiveId, kinds) {
  const rover = summarize(design);
  const site = landingNear(kinds, rover);
  const s = E.newRun({ design, objectiveId, siteK: site.k, testsRun: 1 });
  const handle = (ev) => { if (ev) E.resolveEvent(s, ev, ev.choices.findIndex((c) => !c.needs || c.needs(s))); };
  let guard = 0;
  while (!s.ended && guard++ < 500) {
    const here = cells[s.k];
    const got = s.objective.metric === 'water' ? s.cargo.water : s.cargo.regolith;
    if (got >= s.objective.target) { E.finish(s); break; }
    const low = s.batteryWh / s.rover.batteryWh < 0.35;
    if (low) {
      if (sunAt(here, s.t) > 0.3 || s.rover.rtgW) { handle(E.rest(s, 4)); continue; }
      const sunny = nearestReachable(here, ['plain'], s.rover);
      const p = E.planDrive(s, sunny); if (!p) break;
      const t0 = s.t; handle(E.drive(s, p));
      if (s.t === t0) handle(E.rest(s, 1)); // fault protection refused to drive
      continue;
    }
    if (kinds.includes(here.kind)) {
      if (s.rover.sci.scan && !s.scanned.has(here.k)) { handle(E.scan(s)); continue; }
      handle(E.dig(s, 2)); continue;
    }
    const goal = nearestReachable(here, kinds, s.rover);
    const p = E.planDrive(s, goal); if (!p) break;
    handle(E.drive(s, p));
  }
  if (process.env.DEBUG === objectiveId) console.log(s.log.slice(0, 25).reverse().map((l) => `${l.t}h ${l.text}`).join('\n'));
  return { s, d: E.debrief(s) };
}

test('easy: build the base with a cheap rover', () => {
  const { s, d } = play(defaultDesign(), 'base', ['plain']);
  console.log('base', d.score, d.grade, Math.round(s.cargo.regolith), 'kg', Math.round(s.t), 'h');
  assert.ok(d.progress >= 1);
});

test('medium: ice hunter with heaters, drum and spectrometer', () => {
  const design = { ...defaultDesign(), power: 'solarL', digger: 'drum', thermal: 'heaters', comms: 'both', science: 'nss' };
  const { s, d } = play(design, 'ice', ['trap']);
  console.log('ice', d.score, d.grade, s.cargo.water.toFixed(1), 'kg water', Math.round(s.t), 'h', s.endReason);
  assert.ok(d.progress >= 1, `only ${s.cargo.water.toFixed(1)} kg`);
});

test('hard: into the dark with a tether', () => {
  const design = { mobility: 'mesh6', power: 'rtg', digger: 'drill', thermal: 'blanket', comms: 'relay', science: 'none', extra: 'tether' };
  const sum = summarize(design);
  console.log('hard design', sum.massKg, 'kg $', sum.costM, 'M');
  const { s, d } = play(design, 'dark', ['floor']);
  console.log('dark', d.score, d.grade, s.cargo.water.toFixed(1), 'kg water', Math.round(s.t), 'h', s.endReason);
  assert.ok(d.progress >= 0.5);
});

test('bad design: blankets only in the crater freezes', () => {
  const design = { mobility: 'legs', power: 'solarS', digger: 'scoop', thermal: 'blanket', comms: 'dte', science: 'none', extra: 'none' };
  const { s } = play(design, 'dark', ['floor']);
  console.log('bad', s.endReason);
  assert.ok(['froze', 'battery'].includes(s.endReason));
});
