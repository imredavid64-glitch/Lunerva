// Rover mission screens: Briefing, Landing site, Build, Test. Deploy and Debrief live in deploy.js.
import { LIMITS, OBJECTIVES, SLOTS, PARTS, summarize, defaultDesign, BUS } from './parts.js';
import { cells, SLOPE_TEXT, SOURCE_NOTE } from './world.js';
import { runTests, hint, GLOSSARY } from './capcom.js';
import { setupCanvas, draw, cellFromEvent } from './map.js';
import { renderDeploy, renderDebrief, startDeploy } from './deploy.js';

const STAGES = [['briefing', 'Briefing'], ['site', 'Landing site'], ['build', 'Build rover'], ['test', 'Test'], ['deploy', 'Deploy'], ['debrief', 'Debrief']];

export const S = {
  stage: 'briefing', objectiveId: null, players: 1, siteK: null, hover: null, view: 'terrain',
  design: defaultDesign(), testsRun: 0, tests: null, run: null, plan: null, event: null, eventMsg: null, result: null,
};

const $ = (sel) => document.querySelector(sel);
const main = () => $('#main');
const side = () => $('#side');

export function go(stage) { S.stage = stage; render(); window.scrollTo({ top: 0 }); }

export function meter(label, value, max, unit, opts = {}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const over = opts.lowBad ? pct < 20 : value > max;
  const near = opts.lowBad ? pct < 40 : pct > 90;
  return `<div class="meter"><div class="lbl"><span>${label}</span><b>${opts.text ?? `${Math.round(value)} / ${max} ${unit}`}</b></div>
    <div class="bar"><i class="${over ? 'bad' : near ? 'warn' : ''}" style="width:${pct}%"></i></div></div>`;
}

function stageBar() {
  const idx = STAGES.findIndex(([id]) => id === S.stage);
  $('#stages').innerHTML = STAGES.map(([id, label], n) =>
    `<span class="stage ${n < idx ? 'done' : n === idx ? 'now' : ''}">${n + 1} ${label}</span>`).join('');
}

function capcomPanel(tips) {
  return `<section class="panel capcom" aria-live="polite"><h3>CAPCOM</h3>
    <ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul>
    <details class="small" style="margin-top:8px"><summary>Space words explained</summary>
    ${GLOSSARY.map(([w, d]) => `<p><b>${w}:</b> ${d}</p>`).join('')}</details></section>`;
}

function designSidebar() {
  const sum = summarize(S.design);
  const obj = OBJECTIVES.find((o) => o.id === S.objectiveId);
  return `<section class="panel"><h3>Mission budget</h3>
    ${meter('Mass on the lander', sum.massKg, LIMITS.landerCapacityKg, 'kg')}
    ${meter('Money', sum.costM + S.testsRun * LIMITS.testCostM, LIMITS.budgetM, '$M')}
    ${meter('Solar power', sum.solarW, 600, 'W', { text: `${sum.solarW} W solar${sum.rtgW ? ` + ${sum.rtgW} W RTG` : ''}` })}
    ${meter('Battery', sum.batteryWh, 5000, 'Wh', { text: `${(sum.batteryWh / 1000).toFixed(1)} kWh` })}
    ${obj ? `<p class="small muted">Objective: <b>${obj.title}</b>, ${obj.target} ${obj.unit}</p>` : ''}
    </section>`;
}

/* ---------- 1 Briefing ---------- */
function briefing() {
  main().innerHTML = `<section class="panel stack">
    <div><span class="tag accent">Mission 2 of 3: Excavation and rover</span>
    <h1>Operation Regolith</h1>
    <p>Artemis astronauts will need water to drink, air to breathe and rocket fuel. Near the Moon's south pole, ice hides in craters that have not seen sunlight for billions of years.
    Your team designs a rover, lands it on the rim of <b>Shackleton crater</b> and has <b>14 Earth days</b> of sunlight to dig before the long lunar night.</p>
    <p class="small muted">The map is real: slope and height from NASA's Lunar Reconnaissance Orbiter laser altimeter (LOLA).</p></div>
    <h2>Choose your objective</h2>
    <div class="grid">${OBJECTIVES.map((o) => `<button class="card ${S.objectiveId === o.id ? 'selected' : ''}" data-obj="${o.id}">
      <span class="tag ${o.level === 'Easy' ? 'good' : o.level === 'Medium' ? 'warn' : 'bad'}">${o.level}</span>
      <h3 style="margin-top:8px">${o.title}</h3><p class="small">${o.goal}</p></button>`).join('')}</div>
    <h2>Crew</h2>
    <div class="row">${[1, 2, 3, 4].map((n) => `<button data-players="${n}" class="${S.players === n ? 'primary' : ''}">${n} player${n > 1 ? 's' : ''}</button>`).join('')}</div>
    <p class="small muted">${S.players > 1 ? 'Team mode: each part of the rover is owned by a role (Mission lead, Engineer, Scientist, Comms). Pass the laptop and agree together before launch.' : 'Solo: you play every role.'}</p>
    <div class="row"><button class="primary" id="next" ${S.objectiveId ? '' : 'disabled'}>Choose a landing site</button></div></section>`;
  side().innerHTML = capcomPanel(hint('briefing', {}));
  main().onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.obj) { S.objectiveId = b.dataset.obj; briefing(); }
    if (b.dataset.players) { S.players = Number(b.dataset.players); briefing(); }
    if (b.id === 'next') go('site');
  };
}

/* ---------- 2 Landing site ---------- */
function mapControls() {
  return `<div class="row small" role="group" aria-label="Map view">
    ${[['terrain', 'Terrain'], ['slope', 'NASA slope map'], ['sun', 'Sunlight']].map(([v, l]) => `<button data-view="${v}" class="${S.view === v ? 'primary' : ''}">${l}</button>`).join('')}</div>`;
}
export function legend() {
  return `<div class="legend"><span><i style="background:rgba(70,194,138,.6)"></i>Safe to land (&lt;10°)</span>
    <span><i style="border:2px solid #7fdcff"></i>Cold trap (may hold ice)</span><span><i style="background:rgba(20,40,110,.9)"></i>Shackleton crater, never lit</span>
    <span><i style="background:#ffd166"></i>Rover</span></div><p class="small muted" style="margin-top:6px">${SOURCE_NOTE}</p>`;
}

function site() {
  const c = S.siteK != null ? cells[S.siteK] : null;
  main().innerHTML = `<section class="panel stack"><div><h1>Pick a landing site</h1>
    <p>Click a green cell. Landers tip over on slopes above about 10°. Ice is in the blue-outlined cold traps and in the dark crater.</p></div>
    ${mapControls()}<div class="mapwrap"><canvas id="map" aria-label="Map of Shackleton crater rim"></canvas></div>${legend()}
    <div class="row"><button id="back">Back</button><button class="primary" id="next" ${c ? '' : 'disabled'}>Build the rover</button>
    <span class="small muted">${c ? `Selected: slope ${SLOPE_TEXT[c.slope]}, sunlight ${Math.round(c.sun * 100)}%, ${c.elev >= 150 ? 'Earth in view' : 'no direct Earth view'}` : 'No site yet'}</span></div></section>`;
  const canvas = $('#map');
  const redraw = () => draw(canvas, { view: S.view, mode: 'site', siteK: S.siteK, hover: S.hover });
  setupCanvas(canvas, redraw); redraw();
  canvas.onmousemove = (e) => {
    const h = cellFromEvent(canvas, e); if (h === S.hover) return;
    S.hover = h; redraw(); side().innerHTML = capcomPanel(hint('site', { cell: h }));
  };
  canvas.onclick = (e) => {
    const h = cellFromEvent(canvas, e);
    if (h && h.slope === 0 && h.kind === 'plain') { S.siteK = h.k; S.tests = null; site(); }
    else side().innerHTML = capcomPanel(['That spot is too steep or in permanent darkness for a lander. Pick a green cell.', ...hint('site', { cell: h })]);
  };
  main().onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.view) { S.view = b.dataset.view; site(); }
    if (b.id === 'back') go('briefing');
    if (b.id === 'next') go('build');
  };
  side().innerHTML = capcomPanel(hint('site', { cell: c }));
}

/* ---------- 3 Build ---------- */
function build() {
  const sum = summarize(S.design);
  main().innerHTML = `<section class="panel stack"><div><h1>Build your rover</h1>
    <p>Every part has a cost in mass, money and power. There is no single right answer, only trade-offs.</p>
    <p class="small muted">Always included: ${BUS.name} (${BUS.massKg} kg, $${BUS.costM}M).</p></div>
    ${SLOTS.map((slot) => `<fieldset style="border:0;padding:0;margin:0"><legend class="row" style="margin-bottom:6px"><h2 style="margin:0">${slot.label}</h2>
      ${S.players > 1 ? `<span class="tag accent">${slot.role}</span>` : ''}</legend>
      ${PARTS[slot.id].map((p) => `<label class="opt ${S.design[slot.id] === p.id ? 'on' : ''}">
        <input type="radio" name="${slot.id}" value="${p.id}" ${S.design[slot.id] === p.id ? 'checked' : ''}>
        <div><b>${p.name}</b><div class="small muted">${p.info}</div>
        <div class="nums">${p.massKg} kg · $${p.costM}M${p.digW ? ` · ${p.digW} W · ${p.rateKgH} kg/h` : ''}${p.driveW ? ` · ${p.driveW} W · climbs ${['up to 10°', 'up to 15°', 'up to 20°', 'any slope'][p.maxSlope]}` : ''}${p.heaterW ? ` · heaters ${p.heaterW} W` : ''}</div></div></label>`).join('')}
    </fieldset>`).join('')}
    <div class="row"><button id="back">Back</button><button class="primary" id="next">Run test campaign ($${LIMITS.testCostM}M)</button></div></section>`;
  side().innerHTML = designSidebar() + capcomPanel(hint('build', { sum, objective: OBJECTIVES.find((o) => o.id === S.objectiveId) }));
  main().onchange = (e) => { if (e.target.name) { S.design[e.target.name] = e.target.value; S.tests = null; build(); } };
  main().onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'back') go('site');
    if (b.id === 'next') { S.testsRun++; S.tests = runTests(sum, OBJECTIVES.find((o) => o.id === S.objectiveId), S.siteK); go('test'); }
  };
}

/* ---------- 4 Test ---------- */
function test() {
  const fails = S.tests.filter((t) => t.status === 'fail').length;
  const warns = S.tests.filter((t) => t.status === 'warn').length;
  main().innerHTML = `<section class="panel stack"><div><h1>Test campaign ${S.testsRun}</h1>
    <p>Engineers shook, froze and drove your rover on Earth. Finding a problem here is cheap. Finding it on the Moon ends the mission.</p></div>
    <div>${S.tests.map((t) => `<div class="check"><span class="tag ${t.status === 'pass' ? 'good' : t.status}">${t.status.toUpperCase()}</span>
      <div><b>${t.title}</b><div class="small muted">${t.why}</div></div></div>`).join('')}</div>
    <p>${fails ? `<span class="tag bad">${fails} blocker${fails > 1 ? 's' : ''}</span> Fix these before launch.` : warns ? `<span class="tag warn">${warns} warning${warns > 1 ? 's' : ''}</span> You can launch, but these are risks.` : '<span class="tag good">Ready</span> All checks passed.'}</p>
    <div class="row"><button id="back">Change the design</button><button class="primary" id="launch" ${fails ? 'disabled' : ''}>Launch and land</button></div></section>`;
  side().innerHTML = designSidebar() + capcomPanel([fails ? 'Blockers mean the mission cannot fly. Go back and change parts.' : 'Warnings are risks, not rules. Real missions launch with known risks and plan around them.']);
  main().onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'back') go('build');
    if (b.id === 'launch') { startDeploy(); go('deploy'); }
  };
}

export function render() {
  stageBar();
  ({ briefing, site, build, test, deploy: () => renderDeploy(capcomPanel), debrief: () => renderDebrief(capcomPanel) })[S.stage]();
}

render();
