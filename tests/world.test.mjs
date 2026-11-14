// Run: node --test tests/
// Checks that the rover mission's terrain model and rules stay playable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../missions/rover/world.js';
import * as P from '../missions/rover/parts.js';

const kinds = {};
W.cells.forEach((c) => { kinds[c.kind] = (kinds[c.kind] || 0) + 1; });
const rover = (d) => P.summarize({ ...P.defaultDesign(), ...d });
const start = W.cells.find((c) => c.kind === 'plain' && c.slope === 0 && c.i < 10);

test('terrain has every kind of place', () => {
  console.log('kinds', kinds);
  for (const k of ['plain', 'trap', 'wall', 'floor']) assert.ok(kinds[k] > 5, `few ${k} cells`);
});

test('cold traps are reachable with ordinary wheels', () => {
  const t = W.nearestReachable(start, ['trap'], rover({ mobility: 'rigid4' }));
  assert.ok(t, 'no reachable cold trap');
});

test('crater floor needs a tether or legs', () => {
  assert.equal(W.nearestReachable(start, ['floor'], rover({ mobility: 'mesh6' })), null);
  assert.ok(W.nearestReachable(start, ['floor'], rover({ mobility: 'mesh6', extra: 'tether' })));
  assert.ok(W.nearestReachable(start, ['floor'], rover({ mobility: 'legs' })));
});

test('path to the floor costs real time and energy', () => {
  const r = rover({ mobility: 'mesh6', extra: 'tether' });
  const floor = W.nearestReachable(start, ['floor'], r);
  const p = W.findPath(start, floor, r);
  console.log('to floor', p.hours.toFixed(1), 'h', (p.wh / 1000).toFixed(1), 'kWh', p.path.length, 'cells');
  assert.ok(p.hours > 5 && p.hours < 200);
});

test('default design fits the lander and budget', () => {
  const s = rover({});
  assert.ok(s.massKg <= P.LIMITS.landerCapacityKg);
  assert.ok(s.costM <= P.LIMITS.budgetM);
});

test('no design can take every best part', () => {
  const s = rover({ mobility: 'legs', power: 'rtg', digger: 'drum', thermal: 'heaters', comms: 'both', science: 'nss', extra: 'tether' });
  assert.ok(s.costM > P.LIMITS.budgetM || s.massKg > P.LIMITS.landerCapacityKg);
});
