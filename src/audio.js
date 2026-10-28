// Tiny synthesized sound kit. No files to load.
import { storage } from './util.js';

let ctx = null;
let enabled = storage.get('doodlepond:sound', true);
let noiseBuf = null;

export function initAudio() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export const soundOn = () => enabled;
export function setSound(on) {
  enabled = on;
  storage.set('doodlepond:sound', on);
}

function envelope(g, t, attack, decay, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(f0, f1, dur, type = 'sine', vol = 0.2, delay = 0) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  envelope(g, t, 0.006, dur, vol);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur, freq, q, vol, delay = 0) {
  if (!ctx || !enabled) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  envelope(g, t, 0.01, dur, vol);
  s.connect(f).connect(g).connect(ctx.destination);
  s.start(t);
  s.stop(t + dur + 0.05);
}

export const sfx = {
  whoosh: () => noise(0.28, 700, 0.7, 0.1),
  plop: () => {
    tone(720, 170, 0.17, 'sine', 0.22);
    noise(0.1, 1300, 1.5, 0.06);
  },
  nibble: () => tone(520, 330, 0.06, 'sine', 0.07),
  splash: () => {
    noise(0.45, 900, 0.8, 0.28);
    tone(420, 120, 0.22, 'sine', 0.1);
  },
  tick: () => tone(1900, 1500, 0.02, 'square', 0.02),
  snap: () => {
    noise(0.14, 3200, 2, 0.24);
    tone(900, 180, 0.14, 'triangle', 0.1);
  },
  chime: () => {
    tone(660, 660, 0.35, 'sine', 0.13);
    tone(880, 880, 0.4, 'sine', 0.11, 0.11);
    tone(1320, 1320, 0.55, 'sine', 0.09, 0.22);
  },
  pop: () => tone(320, 880, 0.08, 'sine', 0.1),
};
