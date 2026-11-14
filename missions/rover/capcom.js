// CAPCOM: the in-game guide. Rule-based, so it gives the same advice every time.
// It explains WHY a choice matters instead of only saying right or wrong.
import { LIMITS } from './parts.js';
import { cells, nearestReachable, findPath, sunAt, commsAt, SLOPE_TEXT } from './world.js';

/** Pre-launch test campaign. Returns checks with status 'pass' | 'warn' | 'fail'. */
export function runTests(sum, objective, siteK) {
  const out = [];
  const add = (status, title, why) => out.push({ status, title, why });
  const site = cells[siteK];

  add(sum.massKg <= LIMITS.landerCapacityKg ? 'pass' : 'fail', `Mass ${sum.massKg} kg (limit ${LIMITS.landerCapacityKg} kg)`,
    sum.massKg <= LIMITS.landerCapacityKg ? 'The lander can carry it.' : 'Too heavy: the lander cannot lift off with this rover. Remove or swap parts.');
  add(sum.costM <= LIMITS.budgetM ? 'pass' : 'fail', `Cost $${sum.costM}M (budget $${LIMITS.budgetM}M)`,
    sum.costM <= LIMITS.budgetM ? 'Within budget.' : 'Over budget: the mission would be cancelled.');

  const workW = LIMITS.baseLoadW + sum.dig.digW;
  const sunGen = sum.solarW * site.sun + sum.rtgW;
  const hoursOnBattery = sum.batteryWh / Math.max(1, workW + (sum.warm ? 0 : sum.therm.heaterW) - sum.rtgW);
  if (sunGen >= workW) add('pass', 'Power in sunlight', `At the landing site you make about ${Math.round(sunGen)} W and digging needs ${workW} W.`);
  else add('warn', 'Power in sunlight', `Digging needs ${workW} W but you make about ${Math.round(sunGen)} W here. The battery will drain even in sunlight.`);

  const needDark = objective.id !== 'base';
  if (needDark) {
    if (sum.warm) add('pass', 'Cold and dark', 'The RTG keeps you warm and powered in shadow.');
    else if (sum.therm.heaterW) add(hoursOnBattery > 6 ? 'pass' : 'warn', 'Cold and dark', `In shadow you can dig for about ${hoursOnBattery.toFixed(1)} h on battery before you must come back to the Sun.`);
    else add('warn', 'Cold and dark', 'Ice is only in shadow, and blankets alone freeze after 3 hours there. Add heaters or an RTG, or keep trips very short.');
  }

  const kinds = objective.id === 'dark' ? ['floor'] : objective.id === 'ice' ? ['trap', 'floor', 'wall'] : ['plain', 'trap'];
  const goal = nearestReachable(site, kinds, sum);
  if (!goal) {
    add('fail', 'Can it reach the dig site?', objective.id === 'dark'
      ? 'Shackleton\'s walls are steeper than 20°. Wheels alone cannot get down. You need a tether or a walker.'
      : 'No route from your landing site. Pick a different site or better mobility.');
  } else {
    const p = findPath(site, goal, sum);
    add(p.hours < 60 ? 'pass' : 'warn', 'Can it reach the dig site?', `Yes: about ${p.hours.toFixed(0)} h of driving, ${(p.wh / 1000).toFixed(1)} kWh. ${p.hours >= 60 ? 'That is a long way. Land closer?' : ''}`);
  }

  if (objective.id !== 'base') {
    add(sum.sci.scan ? 'pass' : 'warn', 'Finding the ice', sum.sci.scan ? 'The neutron spectrometer will show buried ice.' : 'Without an ice detector you dig blind. Ice amounts change a lot between spots.');
    add(sum.dig.iceFactor >= 0.5 ? 'pass' : 'warn', 'Digging frozen soil', sum.dig.iceFactor >= 0.5 ? `Your ${sum.dig.name.toLowerCase()} handles ice-cemented soil.` : 'Icy soil is hard as concrete. The scoop works at only 20% speed there.');
  }

  const c0 = commsAt(site, 0, sum.comm);
  const linkHours = Array.from({ length: 24 }, (_, t) => commsAt(site, t, sum.comm).ok).filter(Boolean).length;
  add(linkHours >= 8 ? 'pass' : 'warn', 'Link to Earth', `${linkHours} of 24 hours with a link at the landing site${c0.dte ? ' (Earth in view)' : ''}. ${sum.comm.relay ? '' : 'Down in craters the direct antenna cannot see Earth.'}`);
  return out;
}

/** Short tips for each stage. */
export function hint(stage, ctx) {
  const tips = [];
  if (stage === 'briefing') {
    tips.push('Welcome, flight director. Pick an objective. Harder ones score more science but need better hardware.');
  }
  if (stage === 'site') {
    tips.push('Landers need ground under 10°. Green cells are safe.');
    if (ctx.cell) {
      const c = ctx.cell;
      tips.push(`This spot: slope ${SLOPE_TEXT[c.slope]}, sunlight about ${Math.round(c.sun * 100)}% of the time. ${c.elev >= 150 ? 'High enough to see Earth.' : 'Too low to see Earth directly.'}`);
    }
    tips.push('Trade-off: high rims get Sun and an Earth view; the ice is down in the dark. Landing close to ice saves driving time.');
  }
  if (stage === 'build' && ctx.sum) {
    const s = ctx.sum;
    if (s.massKg > LIMITS.landerCapacityKg) tips.push(`Too heavy by ${s.massKg - LIMITS.landerCapacityKg} kg. Every kilogram costs fuel to land on the Moon.`);
    if (s.costM > LIMITS.budgetM) tips.push(`Over budget by $${s.costM - LIMITS.budgetM}M.`);
    if (ctx.objective?.id === 'dark' && !s.extra.tether && s.mob.id !== 'legs') tips.push('The crater floor is behind walls steeper than 20°. Wheels alone will not make it down.');
    if (ctx.objective?.id !== 'base' && !s.warm && !s.therm.heaterW) tips.push('Ice lives in permanent shadow at about -200 °C. Blankets alone give you 3 hours there.');
    if (s.rtgW && s.dig.digW > s.rtgW) tips.push(`The RTG gives ${s.rtgW} W but your digger needs ${s.dig.digW} W. You will dig in short bursts on battery.`);
    if (!tips.length) tips.push('Looks balanced. Run a test campaign before you launch. Tests cost money but find problems on Earth, not on the Moon.');
  }
  if (stage === 'deploy' && ctx.state) {
    const s = ctx.state, c = cells[s.k];
    const pct = s.batteryWh / s.rover.batteryWh;
    const sun = sunAt(c, s.t);
    if (pct < 0.25 && sun < 0.2) tips.push('Battery low and no Sun here. Drive back to a sunlit spot now.');
    else if (pct < 0.25) tips.push('Battery low. Rest in the sunlight to recharge.');
    if (s.shadowH > 1.5 && !s.rover.warm && !s.rover.therm.heaterW) tips.push(`You have been in shadow for ${s.shadowH.toFixed(1)} h. Blankets give out at 3 h.`);
    if (!commsAt(c, s.t, s.rover.comm).ok) tips.push('No link to Earth right now. If something goes wrong, the rover must decide on its own.');
    if (s.rover.sci.scan && s.scanned.size === 0) tips.push('Try a neutron scan. It shows where buried ice is before you dig.');
    if (s.dust > 0) tips.push(`Dust is blocking ${Math.round(s.dust * 100)}% of your solar power.`);
    const got = s.objective.metric === 'water' ? s.cargo.water : s.cargo.regolith;
    if (got >= s.objective.target) tips.push('Objective complete. Park in the Sun and end the mission to bank the survival points.');
    if (!tips.length) tips.push('All systems nominal. Click the map to plan a drive.');
  }
  return tips;
}

export const GLOSSARY = [
  ['Regolith', 'The loose, dusty soil and broken rock that covers the Moon.'],
  ['Cold trap', 'A spot that never gets sunlight, so ice that lands there stays frozen for billions of years.'],
  ['Permanently shadowed region', 'Crater floors near the poles where the low Sun never shines. About -200 °C.'],
  ['Slope', 'How steep the ground is. Most rovers struggle above 15-20°.'],
  ['RTG', 'Radioisotope generator. Turns heat from decaying plutonium into steady electricity, day and night.'],
  ['Neutron spectrometer', 'Counts neutrons coming out of the ground. Fewer fast neutrons means hydrogen, which usually means water ice.'],
  ['LOLA', 'Lunar Orbiter Laser Altimeter on NASA\'s Lunar Reconnaissance Orbiter. It measured the height of the Moon with lasers; this map uses its data.'],
  ['Relay satellite', 'A satellite that passes on messages between the rover and Earth when Earth is out of view.'],
];
