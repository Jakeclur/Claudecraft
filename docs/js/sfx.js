// Tiny synthesized sound effects (no audio files needed).
let ctx = null, master = null, muted = false, volume = 0.7;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = muted ? 0 : volume * 0.5; master.connect(ctx.destination);
  } catch { ctx = null; }
}
export function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : volume * 0.5; return muted; }
export function setVolume(v) { volume = v; if (master) master.gain.value = muted ? 0 : volume * 0.5; }

function noise(dur, freq, q = 1, vol = 0.5, type = 'bandpass') {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f).connect(g).connect(master); src.start();
}
function tone(freq, dur, type = 'square', vol = 0.15, slide = 0) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur);
}

export const sfx = {
  dig: () => noise(0.08, 900 + Math.random() * 600, 1.2, 0.35),
  brk: () => { noise(0.18, 600, 0.8, 0.6); tone(140, 0.1, 'triangle', 0.1, -60); },
  place: () => { noise(0.07, 300, 1, 0.5, 'lowpass'); tone(110, 0.08, 'sine', 0.2, -40); },
  hit: () => { noise(0.08, 1800, 2, 0.4); tone(220, 0.08, 'square', 0.08, -120); },
  hurt: () => tone(320, 0.22, 'sawtooth', 0.14, -200),
  eat: () => { for (let i = 0; i < 3; i++) setTimeout(() => noise(0.06, 1400, 3, 0.3), i * 110); },
  craft: () => { tone(660, 0.09, 'triangle', 0.12); setTimeout(() => tone(990, 0.12, 'triangle', 0.12), 80); },
  pickup: () => tone(880, 0.07, 'sine', 0.1, 300),
  thunder: () => { noise(2.2, 120, 0.5, 0.9, 'lowpass'); noise(0.4, 400, 0.6, 0.5, 'lowpass'); },
  die: () => tone(260, 0.8, 'sawtooth', 0.14, -220),
  splash: () => noise(0.25, 700, 0.7, 0.3),
  boing: () => tone(180, 0.35, 'sine', 0.2, 500),
  blink: () => { tone(900, 0.2, 'sine', 0.12, -600); noise(0.15, 3000, 2, 0.2); },
  magic: () => { tone(520, 0.15, 'triangle', 0.1, 300); setTimeout(() => tone(780, 0.2, 'triangle', 0.1, 300), 90); },
  zap: () => { noise(0.5, 2500, 0.8, 0.7); tone(90, 0.6, 'sawtooth', 0.15, -40); },
  door: () => tone(300, 0.12, 'triangle', 0.12, -100),
};
