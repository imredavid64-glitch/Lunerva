// Debrief: score, battery chart, badges, lessons and real missions.
import { LIMITS } from './parts.js';
import * as E from './engine.js';
import { S, go } from './game.js';
import { leaveDeploy, startDeploy } from './deploy.js';
import { saveResult } from '../../shared/results.js';
import { sfx } from '../../shared/fx.js';

const $ = (sel) => document.querySelector(sel);

export function finishRun() {
  S.result = E.debrief(S.run);
  S.badges = badges(S.run, S.result);
  saveResult('rover', { score: S.result.score, grade: S.result.grade, summary: `${S.run.objective.title}: ${S.result.got.toFixed(1)} ${S.run.objective.unit}` });
  leaveDeploy();
  go('debrief');
  if (S.result.grade === 'Mission success') sfx.good(); else sfx.bad();
}

function badges(r, d) {
  const budgetLeft = LIMITS.budgetM - r.rover.costM - r.testsRun * LIMITS.testCostM;
  const all = [
    ['Objective met', 'Hit the mission target', d.progress >= 1],
    ['Survivor', 'Rover alive at the end', r.rover.alive],
    ['Into the dark', 'Sampled the never-lit crater floor', r.floorSample],
    ['Ice mapper', 'Scanned 75+ squares for ice', r.scanned.size >= 75],
    ['Never flat', 'No battery brownouts', r.stats.brownouts === 0],
    ['Penny pincher', '$40M or more left over', budgetLeft >= 40],
    ['Light packer', '40 kg or more spare on the lander', LIMITS.landerCapacityKg - r.rover.massKg >= 40],
    ['Mission control', 'Every surprise handled with a link to Earth', r.decisions.total > 0 && r.decisions.total === r.decisions.withLink],
  ];
  return all.map(([name, why, got]) => ({ name, why, got }));
}

function chart(canvas, r) {
  const W = 1200, H = 260, pad = 36; canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'), T = LIMITS.missionHours;
  const X = (t) => pad + (t / T) * (W - pad * 2), Y = (b) => H - pad - b * (H - pad * 2);
  ctx.fillStyle = '#0d1220'; ctx.fillRect(0, 0, W, H);
  // shadow periods
  ctx.fillStyle = 'rgba(40,70,160,.35)';
  r.tele.forEach((p, n) => { if (p.shadow && n) ctx.fillRect(X(r.tele[n - 1].t), pad, Math.max(1, X(p.t) - X(r.tele[n - 1].t)), H - pad * 2); });
  ctx.strokeStyle = '#26314a'; ctx.lineWidth = 1; ctx.font = '20px system-ui'; ctx.fillStyle = '#9aa6bd';
  for (let d = 0; d <= 14; d += 2) { const x = X(d * 24); ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, H - pad); ctx.stroke(); ctx.fillText(`day ${d}`, x - 22, H - 8); }
  ctx.fillText('100%', 0, Y(1) + 6); ctx.fillText('0%', 8, Y(0));
  ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3; ctx.beginPath();
  r.tele.forEach((p, n) => (n ? ctx.lineTo(X(p.t), Y(p.b)) : ctx.moveTo(X(p.t), Y(p.b))));
  ctx.stroke();
}

const REAL = [
  ['NASA VIPER', 'Planned south pole ice rover with "wheel-walking", a neutron spectrometer, a drill, solar power, heaters and headlights for driving into shadow.'],
  ['NASA RASSOR', 'Digging robot prototype with two bucket drums spinning opposite ways, so it can dig in low gravity without being pushed away.'],
  ['Honeybee TRIDENT', 'A 1 m rotary-percussive drill built to reach ice-rich soil on the Moon.'],
  ['LCROSS (2009)', 'Crashed a rocket stage into Cabeus crater near the south pole and measured about 5.6% water in the plume.'],
];

export function renderDebrief(capcomPanel) {
  const d = S.result, r = S.run;
  const lessons = [];
  if (r.endReason === 'froze') lessons.push('Shadows near the pole drop to about -200 °C. Heaters or an RTG keep electronics alive.');
  if (r.endReason === 'battery') lessons.push('Batteries drain fast in the dark. Plan trips into shadow like dives: go in, work, come back up for sunlight.');
  if (r.stats.brownouts) lessons.push(`The battery ran flat ${r.stats.brownouts} time(s). A bigger battery or shorter drives would have saved hours.`);
  if (r.rover.sci.id === 'none' && r.objective.id !== 'base') lessons.push('Without an ice detector you dug blind. VIPER carried a neutron spectrometer for exactly this reason.');
  if (r.decisions.total > r.decisions.withLink) lessons.push('Some surprises hit while there was no link to Earth. Comms are part of survival, not an extra.');
  if (d.progress >= 1) lessons.push('You met the objective. Could you do it with less mass or money? Real missions are judged on margins too.');
  const stars = d.score >= 85 ? 3 : d.score >= 60 ? 2 : d.score >= 35 ? 1 : 0;
  $('#main').innerHTML = `<section class="panel stack debrief">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><span class="tag ${d.grade === 'Mission success' ? 'good' : d.grade === 'Partial success' ? 'warn' : 'bad'}">${d.grade}</span>
      <div class="row" style="align-items:baseline;margin-top:8px"><div class="score" id="score">0</div><div class="muted">/ 100 points</div></div></div>
      <div class="stars" aria-label="${stars} of 3 stars">${[1, 2, 3].map((n) => `<span class="${n <= stars ? 'on' : ''}" style="--i:${n}">★</span>`).join('')}</div>
    </div>
    <div>${d.items.map((i, n) => `<div class="check rise" style="--i:${n}"><span class="tag ${i.pts >= i.max * 0.8 ? 'good' : i.pts >= i.max * 0.4 ? 'warn' : 'bad'}">${i.pts}/${i.max}</span>
      <div><b>${i.label}</b><div class="small muted">${i.why}</div></div></div>`).join('')}</div>
    <h2>Battery over the mission</h2><canvas id="chart" class="chart" aria-label="Battery level over the 14 days; blue bands are time in shadow"></canvas>
    <p class="small muted">Yellow line: battery. Blue bands: time in shadow.</p>
    <h2>Badges</h2>
    <div class="badges">${S.badges.map((b, n) => `<div class="badge ${b.got ? 'got' : ''} rise" style="--i:${n}"><b>${b.name}</b><span class="small">${b.why}</span></div>`).join('')}</div>
    <h2>Why it went this way</h2><ul>${lessons.map((l) => `<li>${l}</li>`).join('')}</ul>
    <h2>Real missions like yours</h2>${REAL.map(([n, t]) => `<p class="small"><b>${n}:</b> ${t}</p>`).join('')}
    <div class="row"><button class="primary" id="again">Fly the same rover again</button><button id="redesign">Change the design</button><a href="../../index.html"><button>Back to mission control</button></a></div></section>`;
  $('#side').innerHTML = capcomPanel(['Your score is saved to mission control. Try a harder objective, or the same one with a cheaper rover.']);
  chart($('#chart'), r);
  const el = $('#score'), t0 = performance.now();
  const count = () => { const u = Math.min(1, (performance.now() - t0) / 1200); el.textContent = Math.round(d.score * (1 - Math.pow(1 - u, 3))); if (u < 1) requestAnimationFrame(count); };
  count();
  $('#main').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'again') { startDeploy(); go('deploy'); }
    if (b.id === 'redesign') go('build');
  };
}
