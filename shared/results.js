// Shared mission results, so the hub can show every team member's mission.
// Teammates: call saveResult('comms', {...}) or saveResult('orbit', {...}) at the end of your mission.
// Result shape: { score: 0-100, grade: string, summary: string, at: ISO date }

const KEY = 'smg.results.v1';

export function loadResults() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function saveResult(missionId, result) {
  const all = loadResults();
  const prev = all[missionId];
  all[missionId] = { ...result, at: new Date().toISOString(), best: Math.max(result.score, prev?.best || 0) };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked: results just won't persist */ }
  return all[missionId];
}

/** Values one mission can hand to another, e.g. the orbit team's relay pass schedule. */
export function shareValue(name, value) {
  try { localStorage.setItem(`smg.share.${name}`, JSON.stringify(value)); } catch { /* ignore */ }
}
export function readShared(name, fallback) {
  try { const v = localStorage.getItem(`smg.share.${name}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
