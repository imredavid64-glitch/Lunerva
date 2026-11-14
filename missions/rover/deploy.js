// Deploy (survive and dig on the Moon) and Debrief screens.
import { LIMITS } from './parts.js';
import { cells, sunAt, SLOPE_TEXT } from './world.js';
import * as E from './engine.js';
import { hint } from './capcom.js';
import { setupCanvas, draw, cellFromEvent } from './map.js';
import { S, go, meter, legend } from './game.js';
import { saveResult } from '../../shared/results.js';

const $ = (sel) => document.querySelector(sel);

export function startDeploy() {
  S.run = E.newRun({ design: { ...S.design }, objectiveId: S.objectiveId, siteK: S.siteK, testsRun: S.testsRun, seed: Date.now() % 100000 });
  S.plan = null; S.event = null; S.eventMsg = null; S.view = 'terrain';
}

function after(ev) {
  S.plan = null;
  if (ev) S.event = ev;
  if (S.run.ended && !S.event) { finishRun(); return; }
  renderDeploy();
}

function finishRun() {
  S.result = E.debrief(S.run);
  saveResult('rover', { score: S.result.score, grade: S.result.grade, summary: `${S.run.objective.title}: ${S.result.got.toFixed(1)} ${S.run.objective.unit}` });
  go('debrief');
}

function statusPanel(r) {
  const c = cells[r.k];
  const sun = sunAt(c, r.t);
  const link = E.link(r);
  const o = r.objective;
  const got = o.metric === 'water' ? r.cargo.water : r.cargo.regolith;
  return `<section class="panel"><h3>Rover status</h3>
    ${meter('Mission time', r.t, LIMITS.missionHours, 'h', { text: `Day ${Math.floor(r.t / 24) + 1} of 14 · ${Math.round(LIMITS.missionHours - r.t)} h left` })}
    ${meter('Battery', r.batteryWh, r.rover.batteryWh, 'Wh', { lowBad: true, text: `${Math.max(0, Math.round((r.batteryWh / r.rover.batteryWh) * 100))}%` })}
    ${meter('Objective', got, o.target, o.unit, { text: `${got.toFixed(o.metric === 'water' ? 1 : 0)} / ${o.target} ${o.unit}` })}
    <p class="small">Sun here: <b>${Math.round(sun * 100)}%</b> · Link to Earth: <b>${link.ok ? (link.dte ? 'direct' : 'relay') : 'none'}</b><br>
    Ground: ${SLOPE_TEXT[c.slope]}, ${c.kind === 'trap' ? 'cold trap' : c.kind === 'floor' ? 'crater floor (never lit)' : c.kind === 'wall' ? 'crater wall' : 'plain'}<br>
    Regolith dug: ${Math.round(r.cargo.regolith)} kg · Water: ${r.cargo.water.toFixed(1)} kg
    ${r.scanned.has(c.k) ? `<br>Ice here (scanned): <b>${c.ice.toFixed(1)}%</b>` : ''}${r.shadowH > 0 ? `<br>Time in shadow without heat: ${r.shadowH.toFixed(1)} h` : ''}</p></section>`;
}

function eventOverlay(r) {
  if (S.eventMsg) {
    return `<div class="overlay"><div class="panel stack"><h2>${S.eventMsg.title}</h2><p>${S.eventMsg.text}</p>
      <div class="row"><button class="primary" id="ev-ok">Continue</button></div></div></div>`;
  }
  const ev = S.event, link = E.link(r).ok;
  return `<div class="overlay" role="dialog" aria-label="${ev.title}"><div class="panel stack"><span class="tag warn">Surprise</span><h2>${ev.title}</h2><p>${ev.text}</p>
    ${link ? ev.choices.map((c, n) => {
      const ok = !c.needs || c.needs(r);
      return `<button data-choice="${n}" ${ok ? '' : 'disabled'}>${c.label}</button>`;
    }).join('') : `<p class="small"><span class="tag bad">No link to Earth</span> The rover must act on its own.</p><button class="primary" data-choice="auto">See what the rover does</button>`}
  </div></div>`;
}

export function renderDeploy(capcomPanel) {
  const r = S.run;
  if (capcomPanel) renderDeploy.capcom = capcomPanel;
  const cap = renderDeploy.capcom;
  const c = cells[r.k];
  const plan = S.plan;
  const canDig = !r.ended;
  $('#main').innerHTML = `<section class="panel stack"><div class="row" style="justify-content:space-between"><h1 style="margin:0">On the Moon</h1>
    <div class="row small">${[['terrain', 'Terrain'], ['slope', 'NASA slope'], ['sun', 'Sunlight']].map(([v, l]) => `<button data-view="${v}" class="${S.view === v ? 'primary' : ''}">${l}</button>`).join('')}</div></div>
    <div class="mapwrap"><canvas id="map" aria-label="Rover map. Click a cell to plan a drive."></canvas>${S.event || S.eventMsg ? eventOverlay(r) : ''}</div>
    ${legend()}
    <div class="panel" style="background:var(--panel-2)">
      ${plan ? `<p><b>Planned drive:</b> ${plan.path.length - 1} cells, about ${plan.hours.toFixed(1)} h and ${(plan.wh / 1000).toFixed(2)} kWh. You have ${(r.batteryWh / 1000).toFixed(2)} kWh.</p>`
        : '<p class="small muted">Click the map to plan a drive. The route avoids slopes your rover cannot climb.</p>'}
      <div class="row">
        <button class="primary" id="drive" ${plan ? '' : 'disabled'}>Drive</button>
        <button id="dig2" ${canDig ? '' : 'disabled'}>Dig 2 h (${Math.round(E.digRate(r) * 2)} kg)</button>
        <button id="dig6" ${canDig ? '' : 'disabled'}>Dig 6 h</button>
        <button id="scan" ${r.rover.sci.scan ? '' : 'disabled'} title="${r.rover.sci.scan ? 'Reveal buried ice nearby (1 h)' : 'Needs the neutron spectrometer'}">Scan for ice (1 h)</button>
        <button id="rest">Rest 4 h</button>
        <button id="end">End mission</button>
      </div></div>
    <section><h3>Mission log</h3><div class="log">${r.log.slice(0, 40).map((l) => `<div class="${l.kind}"><span class="mono muted">${l.t} h</span> ${l.text}</div>`).join('')}</div></section></section>`;
  $('#side').innerHTML = statusPanel(r) + cap(hint('deploy', { state: r }));

  const canvas = $('#map');
  const redraw = () => draw(canvas, { view: S.view, mode: 'deploy', t: r.t, siteK: r.siteK, run: r, plan: S.plan, hover: S.hover });
  setupCanvas(canvas, redraw); redraw();
  canvas.onmousemove = (e) => { const h = cellFromEvent(canvas, e); if (h !== S.hover) { S.hover = h; redraw(); } };
  canvas.onclick = (e) => {
    if (S.event || S.eventMsg || r.ended) return;
    const h = cellFromEvent(canvas, e); if (!h) return;
    S.plan = h.k === r.k ? null : E.planDrive(r, h);
    if (!S.plan && h.k !== r.k) {
      $('#side').innerHTML = statusPanel(r) + cap([`No route there. Your ${r.rover.mob.name.toLowerCase()} can't handle slopes ${SLOPE_TEXT[Math.min(3, r.rover.mob.maxSlope + 1)]}${r.rover.extra.tether ? '' : ' without a tether'}.`]);
      redraw(); return;
    }
    renderDeploy();
  };
  $('#main').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.view) { S.view = b.dataset.view; renderDeploy(); return; }
    if (b.dataset.choice) {
      const ev = S.event; S.event = null;
      const text = E.resolveEvent(r, ev, b.dataset.choice === 'auto' ? -1 : Number(b.dataset.choice));
      S.eventMsg = { title: ev.title, text }; renderDeploy(); return;
    }
    if (b.id === 'ev-ok') { S.eventMsg = null; if (r.ended) finishRun(); else renderDeploy(); return; }
    if (b.id === 'drive' && S.plan) after(E.drive(r, S.plan));
    if (b.id === 'dig2') after(E.dig(r, 2));
    if (b.id === 'dig6') after(E.dig(r, 6));
    if (b.id === 'scan') after(E.scan(r));
    if (b.id === 'rest') after(E.rest(r, 4));
    if (b.id === 'end') { E.finish(r); finishRun(); }
  };
}

const REAL = [
  ['NASA VIPER', 'Planned 2023-24 south pole ice rover: 4 wheels that could "walk", neutron spectrometer, drill, solar power, heaters and a lamp for driving into shadow.'],
  ['NASA RASSOR', 'Prototype digging robot with two counter-rotating bucket drums, so it can dig in low gravity without being pushed away.'],
  ['Honeybee TRIDENT', 'A 1 m rotary-percussive drill built to reach ice-rich soil on the Moon.'],
  ['LCROSS (2009)', 'Crashed a rocket stage into Cabeus crater near the south pole and measured about 5.6% water in the plume.'],
];

export function renderDebrief(capcomPanel) {
  const d = S.result, r = S.run;
  const lessons = [];
  if (r.endReason === 'froze') lessons.push('Shadows near the pole drop to about -200 °C. Heaters or an RTG keep electronics alive.');
  if (r.endReason === 'battery') lessons.push('Batteries drain fast in the dark. Plan trips into shadow like dives: go in, work, come back up for sunlight.');
  if (r.stats.brownouts) lessons.push(`The battery ran flat ${r.stats.brownouts} time(s). Bigger batteries or shorter drives would have saved hours.`);
  if (r.rover.sci.id === 'none' && r.objective.id !== 'base') lessons.push('Without an ice detector you dug blind. VIPER carried a neutron spectrometer for exactly this reason.');
  if (r.decisions.total > r.decisions.withLink) lessons.push('Some surprises hit while there was no link to Earth. Comms are part of survival, not an extra.');
  if (d.progress >= 1) lessons.push('You met the objective. Could you do it with less mass or money? Real missions are judged on margins too.');
  $('#main').innerHTML = `<section class="panel stack"><span class="tag ${d.grade === 'Mission success' ? 'good' : d.grade === 'Partial success' ? 'warn' : 'bad'}">${d.grade}</span>
    <div class="row" style="align-items:baseline"><div class="score">${d.score}</div><div class="muted">/ 100 points</div></div>
    <div>${d.items.map((i) => `<div class="check"><span class="tag ${i.pts >= i.max * 0.8 ? 'good' : i.pts >= i.max * 0.4 ? 'warn' : 'bad'}">${i.pts}/${i.max}</span>
      <div><b>${i.label}</b><div class="small muted">${i.why}</div></div></div>`).join('')}</div>
    <h2>Why it went this way</h2><ul>${lessons.map((l) => `<li>${l}</li>`).join('')}</ul>
    <h2>Real missions like yours</h2>${REAL.map(([n, t]) => `<p class="small"><b>${n}:</b> ${t}</p>`).join('')}
    <div class="row"><button class="primary" id="again">Fly the same rover again</button><button id="redesign">Change the design</button><a href="../../index.html"><button>Back to mission control</button></a></div></section>`;
  $('#side').innerHTML = statusPanel(r) + capcomPanel(['Your score is saved to mission control. Try a harder objective, or the same one with a cheaper rover.']);
  $('#main').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'again') { startDeploy(); go('deploy'); }
    if (b.id === 'redesign') go('build');
  };
}
