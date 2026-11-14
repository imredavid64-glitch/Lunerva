// Small sound effects (made with Web Audio, no files) and toast messages.
// Shared so every mission can use them.

let ctx = null;
let muted = (() => { try { return localStorage.getItem('smg.muted') === '1'; } catch { return false; } })();

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('smg.muted', m ? '1' : '0'); } catch { /* ignore */ }
}

function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', vol = 0.08, slide = 0, delay = 0 } = {}) {
  const a = ac(); if (!a || muted) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, { vol = 0.05, freq = 600, delay = 0 } = {}) {
  const a = ac(); if (!a || muted) return;
  const t = a.currentTime + delay;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0); for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.destination); src.start(t);
}

export const sfx = {
  click: () => tone(880, 0.06, { type: 'triangle', vol: 0.04 }),
  select: () => { tone(520, 0.08, { type: 'triangle', vol: 0.05 }); tone(780, 0.1, { type: 'triangle', vol: 0.05, delay: 0.06 }); },
  drive: () => noise(1.2, { vol: 0.03, freq: 300 }),
  dig: () => { noise(1.4, { vol: 0.06, freq: 900 }); tone(70, 1.2, { type: 'sawtooth', vol: 0.03 }); },
  scan: () => tone(300, 1.1, { vol: 0.07, slide: 1200 }),
  alarm: () => { for (let k = 0; k < 3; k++) tone(740, 0.14, { type: 'square', vol: 0.04, delay: k * 0.22 }); },
  good: () => [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.18, { type: 'triangle', vol: 0.06, delay: k * 0.09 })),
  bad: () => { tone(220, 0.5, { type: 'sawtooth', vol: 0.05, slide: -120 }); },
  thrust: () => { noise(3.4, { vol: 0.09, freq: 420 }); tone(55, 3.2, { type: 'sawtooth', vol: 0.03 }); },
  touchdown: () => { noise(0.5, { vol: 0.12, freq: 200 }); tone(90, 0.4, { vol: 0.1, slide: -40 }); },
};

/** Toast in the corner. kind: 'info' | 'good' | 'bad' */
export function toast(text, kind = 'info', ms = 3800) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = text;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}
