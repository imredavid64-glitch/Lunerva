// Deploy: survive and dig on the Moon, in 3D (three.js) with a 2D fallback.
import { LIMITS } from './parts.js';
import { cells, cellAt, sunAt, SLOPE_TEXT } from './world.js';
import * as E from './engine.js';
import { hint } from './capcom.js';
import { setupCanvas, draw, cellFromEvent } from './map.js';
import { S, go, legend } from './game.js';
import { finishRun } from './debrief.js';
import { sfx, toast, isMuted, setMuted } from '../../shared/fx.js';

const $ = (sel) => document.querySelector(sel);
let ui = null; // { scene, map, busy, hoverK, hoverPlan, keyHandler, logLen }

export function startDeploy() {
  S.run = E.newRun({ design: { ...S.design }, objectiveId: S.objectiveId, siteK: S.siteK, testsRun: S.testsRun, seed: Date.now() % 100000 });
  S.plan = null; S.event = null; S.eventMsg = null; S.landed = false;
}

export function leaveDeploy() {
  if (!ui) return;
  if (ui.scene) ui.scene.dispose();
  window.removeEventListener('keydown', ui.keyHandler);
  ui = null;
}

const KIND = { trap: 'Cold trap', floor: 'Crater floor, never lit', wall: 'Crater wall', plain: 'Plain' };

function overlay() {
  const r = S.run;
  draw(ui.map, { view: S.view === 'sun' ? 'sun' : S.view === 'slope' ? 'slope' : 'terrain', mode: 'deploy', t: r.t, siteK: r.siteK, run: r,
    plan: S.plan, hoverPlan: ui.hoverPlan, hover: ui.hoverK != null ? cells[ui.hoverK] : null, markers: !ui.scene || ui.flat });
  if (ui.scene) ui.scene.refreshOverlay();
}

function hudHtml(view) {
  const r = S.run, o = r.objective, c = cells[r.k];
  const t = view?.t ?? r.t, b = view?.b ?? r.batteryWh / r.rover.batteryWh;
  const got = o.metric === 'water' ? r.cargo.water : r.cargo.regolith;
  const left = LIMITS.missionHours - t, sun = sunAt(c, t), link = E.link(r);
  const pct = Math.max(0, Math.round(b * 100));
  return `<div class="hud-row"><span class="chip ${left < 48 ? 'urgent' : ''}">Day ${Math.min(14, Math.floor(t / 24) + 1)}/14 · ${Math.max(0, Math.round(left))} h to night</span>
      <span class="chip ${sun > 0.2 ? 'sun' : 'dark'}">${sun > 0.2 ? `Sun ${Math.round(sun * 100)}%` : 'In shadow'}</span>
      <span class="chip ${link.ok ? 'ok' : 'off'}">${link.ok ? (link.dte ? 'Earth link' : 'Relay link') : 'No link'}</span></div>
    <div class="gauge"><span>Battery</span><div class="bar"><i class="${pct < 20 ? 'bad' : pct < 40 ? 'warn' : ''}" style="width:${pct}%"></i></div><b>${pct}%</b></div>
    <div class="gauge"><span>${o.metric === 'water' ? 'Water' : 'Regolith'}</span><div class="bar"><i class="goal" style="width:${Math.min(100, (got / o.target) * 100)}%"></i></div><b>${got.toFixed(o.metric === 'water' ? 1 : 0)}/${o.target}</b></div>
    ${r.shadowH > 0 ? `<div class="chip dark">Cold: ${r.shadowH.toFixed(1)} h in shadow without heat</div>` : ''}
    <div class="small muted">${KIND[c.kind]} · ${SLOPE_TEXT[c.slope]}${r.scanned.has(c.k) ? ` · ice ${c.ice.toFixed(1)}%` : ''}</div>`;
}

function updateHud(view) {
  $('#hud').innerHTML = hudHtml(view);
  if (view) return;
  const r = S.run, plan = S.plan;
  $('#plan').innerHTML = plan
    ? `Route: <b>${plan.path.length - 1}</b> cells · <b>${plan.hours.toFixed(1)} h</b> · <b>${(plan.wh / 1000).toFixed(2)} kWh</b> of ${(r.batteryWh / 1000).toFixed(2)} available ${plan.wh > r.batteryWh ? '<span class="tag bad">not enough battery</span>' : ''}`
    : 'Click the ground to plan a route, or drive one square with <span class="kbd">W A S D</span>.';
  $('#a-drive').disabled = !plan || ui.busy;
  for (const id of ['a-dig2', 'a-dig6', 'a-rest', 'a-end']) $('#' + id).disabled = ui.busy || r.ended;
  $('#a-scan').disabled = ui.busy || !r.rover.sci.scan;
  $('#a-dig2').innerHTML = `Dig 2 h <small>${Math.round(E.digRate(r) * 2)} kg</small> <span class="kbd">Space</span>`;
  $('#side').innerHTML = ui.capcom(hint('deploy', { state: r }));
  $('#log').innerHTML = r.log.slice(0, 30).map((l) => `<div class="${l.kind}"><span class="mono muted">${l.t} h</span> ${l.text}</div>`).join('');
  if (ui.scene) { ui.scene.setSunTime(r.t); ui.scene.setDark(sunAt(cells[r.k], r.t) < 0.2); }
}

function showEvent() {
  const r = S.run, box = $('#ev');
  if (!S.event && !S.eventMsg) { box.innerHTML = ''; return; }
  if (S.eventMsg) {
    box.innerHTML = `<div class="overlay"><div class="panel stack pop"><h2>${S.eventMsg.title}</h2><p>${S.eventMsg.text}</p>
      <div class="row"><button class="primary" id="ev-ok">Continue</button></div></div></div>`;
    $('#ev-ok').focus(); return;
  }
  const ev = S.event, link = E.link(r).ok;
  box.innerHTML = `<div class="overlay" role="dialog" aria-label="${ev.title}"><div class="panel stack pop alert"><span class="tag warn">Surprise · Day ${Math.floor(r.t / 24) + 1}</span><h2>${ev.title}</h2><p>${ev.text}</p>
    ${link ? ev.choices.map((c, n) => `<button data-choice="${n}" ${!c.needs || c.needs(r) ? '' : 'disabled'}>${c.label}</button>`).join('')
      : `<p class="small"><span class="tag bad">No link to Earth</span> The rover must act on its own.</p><button class="primary" data-choice="auto">See what the rover does</button>`}
  </div></div>`;
  box.querySelector('button:not([disabled])')?.focus();
}

function announceNewLog() {
  const r = S.run, fresh = r.log.length - ui.logLen; ui.logLen = r.log.length;
  r.log.slice(0, Math.min(3, fresh)).reverse().forEach((l) => toast(l.text, l.kind, l.kind === 'bad' ? 6000 : 3800));
  if (r.log.slice(0, fresh).some((l) => l.kind === 'good')) sfx.good();
  else if (r.log.slice(0, fresh).some((l) => l.kind === 'bad')) sfx.bad();
}

async function act(kind, arg) {
  const r = S.run;
  if (ui.busy || r.ended || S.event || S.eventMsg) return;
  ui.busy = true; updateHud();
  let ev = null;
  const t0 = r.t;
  if (kind === 'drive') {
    const plan = arg || S.plan; if (!plan) { ui.busy = false; return; }
    ev = E.drive(r, plan); sfx.drive();
    const track = r.track.slice();
    S.plan = null; ui.hoverPlan = null;
    if (ui.scene && !ui.flat) {
      overlay();
      await ui.scene.driveAlong(track.map((p) => cells[p.k]), (n) => { const p = track[n]; updateHud({ t: p.t, b: p.b }); });
    }
  } else if (kind === 'dig') {
    ev = E.dig(r, arg); sfx.dig();
    if (ui.scene) { ui.scene.dig(1.8); await sleep(1400); }
  } else if (kind === 'scan') {
    ev = E.scan(r); sfx.scan();
    if (ui.scene) { ui.scene.scanPulse(); await sleep(700); }
  } else if (kind === 'rest') {
    ev = E.rest(r, arg);
    if (ui.scene) await timelapse(t0, r.t);
  }
  ui.busy = false;
  overlay(); updateHud(); announceNewLog();
  if (ev) { S.event = ev; sfx.alarm(); showEvent(); return; }
  if (r.ended) finishRun();
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function timelapse(t0, t1) {
  const steps = 20;
  for (let k = 1; k <= steps; k++) { ui.scene.setSunTime(t0 + ((t1 - t0) * k) / steps); await sleep(35); }
}

function onHover(k, ev) {
  const tip = $('#tip');
  if (k == null || ui.busy) { tip.hidden = true; if (ui.hoverK != null) { ui.hoverK = null; ui.hoverPlan = null; overlay(); } return; }
  const r = S.run, c = cells[k];
  if (k !== ui.hoverK) {
    ui.hoverK = k;
    ui.hoverPlan = k === r.k ? null : E.planDrive(r, c);
    if (ui.hoverPlan) ui.hoverPlan.tooFar = ui.hoverPlan.wh > r.batteryWh;
    overlay();
  }
  const p = ui.hoverPlan;
  tip.innerHTML = `<b>${KIND[c.kind]}</b><br>Slope ${SLOPE_TEXT[c.slope]} · Sun ${Math.round(sunAt(c, r.t) * 100)}%
    ${r.scanned.has(k) ? `<br>Ice: <b>${c.ice.toFixed(1)}%</b>` : c.kind !== 'plain' ? '<br>Ice: unknown, scan to find out' : ''}
    <br>${k === r.k ? 'Rover is here' : p ? `${p.hours.toFixed(1)} h · ${(p.wh / 1000).toFixed(2)} kWh ${p.tooFar ? '<span class="neg">too far for the battery</span>' : ''}` : '<span class="neg">No safe route</span>'}`;
  const vp = $('#vp').getBoundingClientRect();
  tip.style.left = `${Math.min(vp.width - 240, ev.clientX - vp.left + 16)}px`;
  tip.style.top = `${Math.max(8, ev.clientY - vp.top - 10)}px`;
  tip.hidden = false;
}

function onPick(k) {
  if (k == null || ui.busy || S.event || S.eventMsg) return;
  const r = S.run;
  if (k === r.k) { S.plan = null; }
  else {
    const p = E.planDrive(r, cells[k]);
    if (!p) { toast(`No route there. Your ${r.rover.mob.name.toLowerCase()} can't climb that${r.rover.extra.tether ? '' : ' without a tether'}.`, 'bad'); sfx.bad(); return; }
    // second click on the same target drives
    if (S.plan && S.plan.path[S.plan.path.length - 1].k === k) { act('drive'); return; }
    S.plan = p; sfx.select();
  }
  overlay(); updateHud();
}

function keys(e) {
  const el = e.target instanceof Element ? e.target : null;
  if (S.stage !== 'deploy' || el?.closest('input,textarea,select,summary')) return;
  if ((e.key === ' ' || e.key === 'Enter') && el?.closest('button')) return; // let the focused button handle it
  const r = S.run, c = cells[r.k];
  const dir = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] }[e.key.toLowerCase()];
  if (dir) {
    e.preventDefault();
    const n = cellAt(c.i + dir[0], c.j + dir[1]);
    const p = n && E.planDrive(r, n);
    if (p) act('drive', p); else { toast('Too steep that way.', 'bad', 1800); sfx.bad(); }
    return;
  }
  if (e.key === ' ') { e.preventDefault(); act('dig', 2); }
  else if (e.key.toLowerCase() === 'f') act('scan');
  else if (e.key.toLowerCase() === 'r') act('rest', 4);
  else if (e.key === 'Enter' && S.plan && !S.event) act('drive');
  else if (e.key === 'Escape') { S.plan = null; overlay(); updateHud(); }
}

export async function renderDeploy(capcomPanel) {
  if (ui) return; // already mounted: the screen updates itself
  ui = { busy: false, hoverK: null, hoverPlan: null, logLen: S.run.log.length, capcom: capcomPanel, flat: false };
  $('#main').innerHTML = `<section class="stack">
    <div class="viewport" id="vp">
      <div id="v3d" class="v3d"></div>
      <canvas id="flat" class="flat" hidden aria-label="2D rover map"></canvas>
      <div class="hud tl" id="hud"></div>
      <div class="hud tr row">
        <button id="v-3d" class="primary" title="3D view">3D</button><button id="v-2d" title="Flat NASA map">2D map</button>
        <button id="v-chase" title="Follow the rover">Follow</button><button id="v-over" title="See the whole area">Overview</button>
        <button id="v-mute" aria-pressed="${isMuted()}">${isMuted() ? 'Sound off' : 'Sound on'}</button>
      </div>
      <div class="tip" id="tip" hidden></div>
      <div id="banner"></div>
      <div id="ev"></div>
    </div>
    <div class="actionbar">
      <p class="small" id="plan"></p>
      <div class="row">
        <button class="primary" id="a-drive">Drive <span class="kbd">Enter</span></button>
        <button id="a-dig2"></button><button id="a-dig6">Dig 6 h</button>
        <button id="a-scan" title="${S.run.rover.sci.scan ? 'Reveal buried ice nearby (1 h)' : 'Needs the neutron spectrometer'}">Scan <span class="kbd">F</span></button>
        <button id="a-rest">Rest 4 h <span class="kbd">R</span></button>
        <button id="a-end">End mission</button>
        <span class="row small muted" style="margin-left:auto">${['terrain', 'slope', 'sun'].map((v) => `<button data-view="${v}" class="${S.view === v ? 'on' : ''}">${{ terrain: 'Terrain', slope: 'NASA slope', sun: 'Sunlight' }[v]}</button>`).join('')}</span>
      </div>
    </div>
    ${legend()}
    <details class="panel"><summary><b>Mission log</b></summary><div class="log" id="log"></div></details>
  </section>`;

  ui.map = document.createElement('canvas');
  setupCanvas(ui.map, () => overlay());
  const flat = $('#flat'); setupCanvas(flat, () => {});
  ui.keyHandler = keys; window.addEventListener('keydown', keys);

  try {
    const { MoonScene } = await import('./scene3d.js');
    ui.scene = new MoonScene($('#v3d'), ui.map);
    ui.scene.onHover = onHover; ui.scene.onPick = onPick;
    ui.scene.setLander(S.run.siteK);
  } catch (err) {
    console.warn('3D view unavailable, using the 2D map', err);
    ui.scene = null; setFlat(true); $('#v-3d').disabled = true;
  }
  overlay(); updateHud(); showEvent();

  $('#main').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.view) { S.view = b.dataset.view; document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b)); overlay(); drawFlat(); return; }
    if (b.dataset.choice) {
      const ev = S.event; S.event = null;
      const text = E.resolveEvent(S.run, ev, b.dataset.choice === 'auto' ? -1 : Number(b.dataset.choice));
      S.eventMsg = { title: ev.title, text }; sfx.click(); showEvent(); overlay(); updateHud(); ui.logLen = S.run.log.length; return;
    }
    if (b.id === 'ev-ok') { S.eventMsg = null; showEvent(); if (S.run.ended) finishRun(); return; }
    const id = b.id;
    if (id === 'a-drive') act('drive');
    else if (id === 'a-dig2') act('dig', 2);
    else if (id === 'a-dig6') act('dig', 6);
    else if (id === 'a-scan') act('scan');
    else if (id === 'a-rest') act('rest', 4);
    else if (id === 'a-end') { E.finish(S.run); finishRun(); }
    else if (id === 'v-2d') setFlat(true);
    else if (id === 'v-3d' && ui.scene) setFlat(false);
    else if (id === 'v-chase' && ui.scene) ui.scene.chase();
    else if (id === 'v-over' && ui.scene) ui.scene.overview();
    else if (id === 'v-mute') { setMuted(!isMuted()); b.textContent = isMuted() ? 'Sound off' : 'Sound on'; b.setAttribute('aria-pressed', isMuted()); }
  };

  flat.onmousemove = (e) => { const c = cellFromEvent(flat, e); onHover(c ? c.k : null, e); drawFlat(); };
  flat.onmouseleave = () => onHover(null);
  flat.onclick = (e) => { const c = cellFromEvent(flat, e); onPick(c ? c.k : null); drawFlat(); };

  if (!S.landed) await landing();
  else if (ui.scene) ui.scene.setRover(S.run.design, S.run.k);
}

function drawFlat() {
  if (!ui || !ui.flat) return;
  const r = S.run;
  draw($('#flat'), { view: S.view, mode: 'deploy', t: r.t, siteK: r.siteK, run: r, plan: S.plan, hoverPlan: ui.hoverPlan, hover: ui.hoverK != null ? cells[ui.hoverK] : null });
}

function setFlat(on) {
  ui.flat = on;
  $('#flat').hidden = !on; $('#v3d').hidden = on;
  $('#v-2d').classList.toggle('primary', on); $('#v-3d').classList.toggle('primary', !on);
  overlay(); drawFlat();
}

async function landing() {
  S.landed = true;
  if (!ui.scene) { toast('Touchdown on the Shackleton rim.', 'good'); return; }
  ui.busy = true; updateHud();
  const banner = $('#banner');
  banner.innerHTML = '<div class="banner"><span class="tag accent">Powered descent</span><h2 id="bn-text">Altitude 2,000 m</h2><button id="skip" class="small">Skip</button></div>';
  sfx.thrust();
  let skip = false; $('#skip').onclick = () => { skip = true; ui.scene.endLanding(); };
  const done = ui.scene.playLanding(S.run.siteK);
  const lines = ['Altitude 2,000 m', 'Altitude 600 m · hazard scan', 'Altitude 100 m · dust rising', 'Contact light'];
  for (let n = 0; n < lines.length && !skip; n++) { $('#bn-text').textContent = lines[n]; await Promise.race([sleep(900), done]); }
  await done;
  sfx.touchdown();
  banner.innerHTML = '<div class="banner"><span class="tag good">Touchdown</span><h2>The rover is rolling off the lander</h2></div>';
  ui.scene.setRover(S.run.design, S.run.siteK);
  setTimeout(() => { if (ui) banner.innerHTML = ''; }, 2200);
  ui.busy = false; updateHud();
  toast('Tip: hover the ground to see the route and its cost. Click twice to drive.', 'info', 7000);
}
