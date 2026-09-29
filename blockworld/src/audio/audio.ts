/**
 * Procedural sound engine. Every effect is synthesised with WebAudio at play
 * time (noise bursts, filtered tones, envelopes) - no recorded samples - and
 * positioned with distance attenuation and stereo panning.
 */

export interface Listener { x: number; y: number; z: number; yaw: number }

type Voice = (ctx: AudioContext, out: AudioNode, t: number, pitch: number, vol: number) => void;

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    d[i] = (seed / 4294967296) * 2 - 1;
  }
  return buf;
}

let NOISE: AudioBuffer | null = null;

function noise(ctx: AudioContext, out: AudioNode, t: number, dur: number, filterType: BiquadFilterType, freq: number, q: number, vol: number, attack = 0.002, sweepTo?: number): void {
  if (!NOISE) NOISE = noiseBuffer(ctx);
  const src = ctx.createBufferSource();
  src.buffer = NOISE;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function tone(ctx: AudioContext, out: AudioNode, t: number, dur: number, type: OscillatorType, f0: number, f1: number, vol: number, attack = 0.005, vibrato = 0): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  if (vibrato > 0) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 6;
    lg.gain.value = vibrato;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const MATERIAL: Record<string, [BiquadFilterType, number, number, number]> = {
  // filter, frequency, q, duration
  grass: ['lowpass', 1800, 0.7, 0.12],
  gravel: ['bandpass', 1400, 0.9, 0.14],
  stone: ['bandpass', 2400, 1.5, 0.1],
  wood: ['bandpass', 700, 2.2, 0.12],
  sand: ['highpass', 2500, 0.5, 0.12],
  snow: ['lowpass', 1200, 0.5, 0.14],
  cloth: ['lowpass', 700, 0.5, 0.1],
  glass: ['highpass', 3500, 3, 0.1],
};

function materialVoice(kind: 'step' | 'dig', mat: string): Voice {
  const [ft, freq, q, dur] = MATERIAL[mat] ?? MATERIAL.stone;
  return (ctx, out, t, pitch, vol) => {
    const d = kind === 'dig' ? dur * 1.6 : dur;
    noise(ctx, out, t, d, ft, freq * pitch, q, vol * (kind === 'dig' ? 0.9 : 0.35));
    if (mat === 'wood') tone(ctx, out, t, d * 0.8, 'triangle', 180 * pitch, 120 * pitch, vol * 0.25);
    if (mat === 'stone' && kind === 'dig') tone(ctx, out, t, 0.05, 'square', 900 * pitch, 600 * pitch, vol * 0.05);
    if (mat === 'glass') tone(ctx, out, t, 0.25, 'sine', 2400 * pitch, 1800 * pitch, vol * 0.2);
  };
}

const VOICES: Record<string, Voice> = {
  'random.pop': (c, o, t, p, v) => tone(c, o, t, 0.08, 'sine', 600 * p, 1400 * p, v * 0.25),
  'random.orb': (c, o, t, p, v) => { tone(c, o, t, 0.25, 'sine', 1300 * p, 1320 * p, v * 0.2); tone(c, o, t + 0.02, 0.2, 'sine', 1950 * p, 1960 * p, v * 0.1); },
  'random.levelup': (c, o, t, p, v) => { [0, 0.12, 0.24, 0.4].forEach((d, i) => tone(c, o, t + d, 0.35, 'triangle', [523, 659, 784, 1046][i] * p, [523, 659, 784, 1046][i] * p, v * 0.25)); },
  'random.click': (c, o, t, p, v) => tone(c, o, t, 0.03, 'square', 1800 * p, 1200 * p, v * 0.12),
  'tile.piston.out': (c, o, t, p, v) => { noise(c, o, t, 0.18, 'bandpass', 700 * p, 1.4, v * 0.45); tone(c, o, t, 0.12, 'square', 220 * p, 330 * p, v * 0.08); },
  'tile.piston.in': (c, o, t, p, v) => { noise(c, o, t, 0.16, 'bandpass', 550 * p, 1.4, v * 0.4); tone(c, o, t, 0.1, 'square', 300 * p, 200 * p, v * 0.08); },
  'random.bow': (c, o, t, p, v) => noise(c, o, t, 0.25, 'bandpass', 900 * p, 1.2, v * 0.5, 0.01, 3000 * p),
  'arrow.hit': (c, o, t, p, v) => { noise(c, o, t, 0.08, 'bandpass', 800 * p, 2, v * 0.5); tone(c, o, t, 0.06, 'triangle', 300 * p, 150, v * 0.2); },
  'random.break': (c, o, t, p, v) => { noise(c, o, t, 0.2, 'highpass', 2000 * p, 1, v * 0.5); tone(c, o, t, 0.15, 'square', 400 * p, 100, v * 0.08); },
  'random.glass': (c, o, t, p, v) => { for (let i = 0; i < 4; i++) tone(c, o, t + i * 0.03, 0.2, 'sine', (2000 + Math.random() * 2000) * p, 1500 * p, v * 0.12); noise(c, o, t, 0.2, 'highpass', 4000, 1, v * 0.3); },
  'random.eat': (c, o, t, p, v) => noise(c, o, t, 0.07, 'bandpass', 1100 * p, 1.5, v * 0.5),
  'random.drink': (c, o, t, p, v) => tone(c, o, t, 0.1, 'sine', 300 * p, 500 * p, v * 0.25),
  'random.burp': (c, o, t, p, v) => tone(c, o, t, 0.25, 'sawtooth', 110 * p, 80 * p, v * 0.15, 0.01, 8),
  'random.explode': (c, o, t, p, v) => { noise(c, o, t, 1.4, 'lowpass', 1200 * p, 0.7, v * 1.2, 0.005, 60); tone(c, o, t, 1.0, 'sine', 70 * p, 30, v * 0.8); },
  'random.fuse': (c, o, t, p, v) => noise(c, o, t, 1.2, 'highpass', 3000 * p, 0.5, v * 0.3, 0.1),
  'tnt.fuse': (c, o, t, p, v) => noise(c, o, t, 1.5, 'highpass', 3500 * p, 0.5, v * 0.3, 0.05),
  'fire.fizz': (c, o, t, p, v) => noise(c, o, t, 0.5, 'highpass', 3000 * p, 0.5, v * 0.35, 0.01, 6000),
  'fire.ignite': (c, o, t, p, v) => { noise(c, o, t, 0.15, 'bandpass', 3000 * p, 1, v * 0.4); noise(c, o, t + 0.05, 0.3, 'lowpass', 900, 0.5, v * 0.3); },
  'fire.crackle': (c, o, t, p, v) => { for (let i = 0; i < 3; i++) noise(c, o, t + Math.random() * 0.3, 0.03, 'highpass', 2500 * p, 1, v * 0.25); },
  'liquid.splash': (c, o, t, p, v) => noise(c, o, t, 0.5, 'lowpass', 2500 * p, 0.8, v * 0.6, 0.01, 400),
  'liquid.water': (c, o, t, p, v) => noise(c, o, t, 1.2, 'lowpass', 600 * p, 1, v * 0.12, 0.3),
  'liquid.lavapop': (c, o, t, p, v) => tone(c, o, t, 0.08, 'sine', 180 * p, 60, v * 0.4),
  'player.hurt': (c, o, t, p, v) => { tone(c, o, t, 0.18, 'sawtooth', 240 * p, 140 * p, v * 0.25); noise(c, o, t, 0.12, 'bandpass', 800 * p, 1, v * 0.25); },
  'fall.small': (c, o, t, p, v) => noise(c, o, t, 0.12, 'lowpass', 500 * p, 1, v * 0.5),
  'fall.big': (c, o, t, p, v) => { noise(c, o, t, 0.2, 'lowpass', 400 * p, 1, v * 0.7); tone(c, o, t, 0.2, 'sine', 90, 50, v * 0.4); },
  'door.open': (c, o, t, p, v) => { noise(c, o, t, 0.3, 'bandpass', 500 * p, 3, v * 0.4, 0.02, 900 * p); tone(c, o, t, 0.25, 'triangle', 140 * p, 180 * p, v * 0.15); },
  'door.close': (c, o, t, p, v) => { noise(c, o, t, 0.15, 'bandpass', 400 * p, 2, v * 0.5); tone(c, o, t, 0.12, 'triangle', 120 * p, 80 * p, v * 0.3); },
  'chest.open': (c, o, t, p, v) => noise(c, o, t, 0.4, 'bandpass', 350 * p, 4, v * 0.45, 0.05, 700 * p),
  'chest.close': (c, o, t, p, v) => { noise(c, o, t, 0.15, 'bandpass', 300 * p, 2, v * 0.5); tone(c, o, t, 0.1, 'triangle', 100 * p, 70, v * 0.3); },
  'portal.ambient': (c, o, t, p, v) => { tone(c, o, t, 2.5, 'sine', 90 * p, 110 * p, v * 0.12, 0.8, 10); tone(c, o, t, 2.5, 'triangle', 135 * p, 120 * p, v * 0.06, 0.8, 6); },
  'portal.travel': (c, o, t, p, v) => { tone(c, o, t, 3.5, 'sawtooth', 60 * p, 400 * p, v * 0.12, 1.5, 20); noise(c, o, t, 3.5, 'bandpass', 300, 3, v * 0.2, 1.5, 2000); },
  'portal.trigger': (c, o, t, p, v) => tone(c, o, t, 2, 'sine', 200 * p, 500 * p, v * 0.12, 0.5, 15),
  'portal.activate': (c, o, t, p, v) => { tone(c, o, t, 2.5, 'sine', 110 * p, 55 * p, v * 0.5, 0.05); noise(c, o, t, 2, 'lowpass', 800, 1, v * 0.4, 0.05, 80); },
  'mob.zombie': (c, o, t, p, v) => tone(c, o, t, 0.7, 'sawtooth', 110 * p, 85 * p, v * 0.18, 0.1, 5),
  'mob.zombie.hurt': (c, o, t, p, v) => tone(c, o, t, 0.25, 'sawtooth', 150 * p, 100 * p, v * 0.2, 0.01, 6),
  'mob.zombie.death': (c, o, t, p, v) => tone(c, o, t, 0.9, 'sawtooth', 120 * p, 55 * p, v * 0.2, 0.02, 4),
  'mob.skeleton': (c, o, t, p, v) => { for (let i = 0; i < 4; i++) noise(c, o, t + i * 0.06, 0.04, 'bandpass', 2500 * p, 4, v * 0.35); },
  'mob.skeleton.hurt': (c, o, t, p, v) => { for (let i = 0; i < 3; i++) noise(c, o, t + i * 0.04, 0.04, 'bandpass', 3000 * p, 5, v * 0.4); },
  'mob.creeper.hurt': (c, o, t, p, v) => noise(c, o, t, 0.3, 'bandpass', 1500 * p, 1, v * 0.35),
  'mob.spider': (c, o, t, p, v) => { noise(c, o, t, 0.2, 'bandpass', 3500 * p, 6, v * 0.25); tone(c, o, t, 0.15, 'square', 900 * p, 1200 * p, v * 0.05); },
  'mob.spider.hurt': (c, o, t, p, v) => noise(c, o, t, 0.2, 'bandpass', 3000 * p, 3, v * 0.35),
  'mob.pig': (c, o, t, p, v) => { tone(c, o, t, 0.12, 'sawtooth', 220 * p, 180 * p, v * 0.15, 0.01, 20); tone(c, o, t + 0.15, 0.1, 'sawtooth', 240 * p, 200 * p, v * 0.12, 0.01, 20); },
  'mob.cow': (c, o, t, p, v) => tone(c, o, t, 0.9, 'sawtooth', 130 * p, 95 * p, v * 0.18, 0.1, 3),
  'mob.sheep': (c, o, t, p, v) => tone(c, o, t, 0.6, 'sawtooth', 330 * p, 300 * p, v * 0.12, 0.05, 25),
  'mob.chicken': (c, o, t, p, v) => { for (let i = 0; i < 3; i++) tone(c, o, t + i * 0.09, 0.06, 'square', 900 * p, 700 * p, v * 0.07); },
  'mob.animal.hurt': (c, o, t, p, v) => tone(c, o, t, 0.2, 'sawtooth', 300 * p, 200 * p, v * 0.18, 0.01, 10),
  'mob.wolf': (c, o, t, p, v) => { tone(c, o, t, 0.12, 'sawtooth', 500 * p, 300 * p, v * 0.18); noise(c, o, t, 0.1, 'bandpass', 1200, 2, v * 0.15); },
  'mob.wolf.growl': (c, o, t, p, v) => tone(c, o, t, 0.8, 'sawtooth', 90 * p, 80 * p, v * 0.2, 0.1, 12),
  'mob.wolf.whine': (c, o, t, p, v) => tone(c, o, t, 0.5, 'sine', 900 * p, 1300 * p, v * 0.1, 0.05, 20),
  'mob.slime': (c, o, t, p, v) => { noise(c, o, t, 0.15, 'lowpass', 500 * p, 3, v * 0.5); tone(c, o, t, 0.12, 'sine', 120 * p, 60, v * 0.3); },
  'mob.ghast': (c, o, t, p, v) => tone(c, o, t, 1.4, 'sine', 700 * p, 1100 * p, v * 0.18, 0.2, 40),
  'mob.ghast.fireball': (c, o, t, p, v) => noise(c, o, t, 0.5, 'lowpass', 1500 * p, 1, v * 0.5, 0.01, 200),
  'mob.ghast.scream': (c, o, t, p, v) => tone(c, o, t, 0.8, 'sawtooth', 900 * p, 1500 * p, v * 0.12, 0.05, 60),
  'mob.blaze': (c, o, t, p, v) => { noise(c, o, t, 0.8, 'bandpass', 600 * p, 1, v * 0.25, 0.2); tone(c, o, t, 0.8, 'sawtooth', 70 * p, 90 * p, v * 0.08, 0.2, 5); },
  'mob.blaze.shoot': (c, o, t, p, v) => noise(c, o, t, 0.3, 'bandpass', 1200 * p, 1, v * 0.4, 0.01, 300),
  'mob.enderman': (c, o, t, p, v) => { tone(c, o, t, 0.6, 'sine', 200 * p, 120 * p, v * 0.18, 0.05, 30); noise(c, o, t, 0.6, 'bandpass', 700 * p, 6, v * 0.15); },
  'mob.endermen.portal': (c, o, t, p, v) => tone(c, o, t, 0.4, 'sine', 180 * p, 900 * p, v * 0.25, 0.01, 50),
  'mob.enderman.scream': (c, o, t, p, v) => { tone(c, o, t, 0.9, 'sawtooth', 600 * p, 1800 * p, v * 0.12, 0.05, 80); noise(c, o, t, 0.9, 'bandpass', 2200, 4, v * 0.12); },
  'mob.pigman': (c, o, t, p, v) => tone(c, o, t, 0.6, 'sawtooth', 160 * p, 120 * p, v * 0.18, 0.05, 15),
  'mob.pigman.angry': (c, o, t, p, v) => tone(c, o, t, 0.5, 'sawtooth', 260 * p, 180 * p, v * 0.25, 0.02, 25),
  'mob.silverfish': (c, o, t, p, v) => noise(c, o, t, 0.15, 'bandpass', 5000 * p, 5, v * 0.3),
  'mob.magmacube': (c, o, t, p, v) => { noise(c, o, t, 0.2, 'lowpass', 400 * p, 2, v * 0.6); tone(c, o, t, 0.15, 'sine', 90 * p, 50, v * 0.3); },
  'mob.dragon.growl': (c, o, t, p, v) => { tone(c, o, t, 2.4, 'sawtooth', 55 * p, 40 * p, v * 0.35, 0.3, 4); noise(c, o, t, 2.4, 'lowpass', 400, 1, v * 0.35, 0.3); },
  'mob.dragon.wings': (c, o, t, p, v) => noise(c, o, t, 0.6, 'lowpass', 300 * p, 1, v * 0.5, 0.15),
  'mob.dragon.hurt': (c, o, t, p, v) => tone(c, o, t, 0.8, 'sawtooth', 110 * p, 70 * p, v * 0.35, 0.02, 8),
  'mob.dragon.end': (c, o, t, p, v) => { tone(c, o, t, 5, 'sawtooth', 70 * p, 30, v * 0.35, 0.5, 3); noise(c, o, t, 5, 'lowpass', 900, 1, v * 0.35, 0.5, 60); },
  'note.harp': (c, o, t, p, v) => tone(c, o, t, 0.9, 'triangle', 370 * p, 370 * p, v * 0.25, 0.003),
  'note.bassattack': (c, o, t, p, v) => tone(c, o, t, 0.6, 'sawtooth', 92 * p, 92 * p, v * 0.2, 0.003),
  'note.bd': (c, o, t, p, v) => tone(c, o, t, 0.3, 'sine', 150 * p, 45, v * 0.5, 0.002),
  'note.snare': (c, o, t, p, v) => noise(c, o, t, 0.2, 'highpass', 1500 * p, 0.5, v * 0.4),
  'note.hat': (c, o, t, p, v) => noise(c, o, t, 0.06, 'highpass', 7000 * p, 0.5, v * 0.35),
  'ambient.cave': (c, o, t, p, v) => { tone(c, o, t, 4, 'sine', 70 * p, 55 * p, v * 0.25, 1.5, 3); noise(c, o, t, 4, 'bandpass', 250 * p, 8, v * 0.2, 1.5); },
  'ambient.rain': (c, o, t, p, v) => noise(c, o, t, 1.2, 'highpass', 1800 * p, 0.3, v * 0.15, 0.3),
  'ambient.thunder': (c, o, t, p, v) => { noise(c, o, t, 3, 'lowpass', 300 * p, 0.7, v * 0.8, 0.05, 50); },
  'minecart.roll': (c, o, t, p, v) => noise(c, o, t, 0.4, 'bandpass', 500 * p, 3, v * 0.2, 0.1),
  'ui.click': (c, o, t, p, v) => { tone(c, o, t, 0.04, 'square', 1500 * p, 900 * p, v * 0.12); noise(c, o, t, 0.03, 'highpass', 3000, 1, v * 0.15); },
};

for (const mat of Object.keys(MATERIAL)) {
  VOICES[`step.${mat}`] = materialVoice('step', mat);
  VOICES[`dig.${mat}`] = materialVoice('dig', mat);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicGain: GainNode | null = null;
  listener: Listener = { x: 0, y: 0, z: 0, yaw: 0 };
  masterVolume = 0.8;
  soundVolume = 1;
  musicVolume = 0.5;
  private recent = new Map<string, number>();
  private musicTimer = 30;
  musicEnabled = true;

  /** Must be called from a user gesture (browser autoplay policy). */
  resume(): void {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.sfx = this.ctx.createGain();
        this.sfx.connect(this.master);
        this.musicGain = this.ctx.createGain();
        this.musicGain.connect(this.master);
        const comp = this.ctx.createDynamicsCompressor();
        this.master.disconnect();
        this.master.connect(comp).connect(this.ctx.destination);
        this.applyVolumes();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes(): void {
    if (!this.master || !this.sfx || !this.musicGain) return;
    this.master.gain.value = this.masterVolume;
    this.sfx.gain.value = this.soundVolume;
    this.musicGain.gain.value = this.musicVolume * 0.6;
  }

  /** Non-positional sound (UI, the player's own actions). */
  play2d(name: string, volume = 1, pitch = 1): void {
    this.playAt(name, this.listener.x, this.listener.y, this.listener.z, volume, pitch);
  }

  playAt(name: string, x: number, y: number, z: number, volume = 1, pitch = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || ctx.state !== 'running') return;
    const voice = VOICES[name];
    if (!voice) return;
    const L = this.listener;
    const dx = x - L.x; const dy = y - L.y; const dz = z - L.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const range = 16 * Math.max(1, volume);
    if (dist > range) return;
    // Rate-limit identical sounds to avoid machine-gun stacking.
    const now = ctx.currentTime;
    const last = this.recent.get(name) ?? -1;
    if (now - last < 0.03) return;
    this.recent.set(name, now);
    const gain = Math.min(1, volume) * (1 - dist / range);
    if (gain <= 0.01) return;
    const pan = ctx.createStereoPanner();
    // Listener right vector for yaw (facing -Z at yaw 0): (cos yaw, 0, -sin yaw).
    const right = dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw);
    pan.pan.value = dist > 0.5 ? Math.max(-0.9, Math.min(0.9, right / Math.max(1, dist))) : 0;
    pan.connect(this.sfx);
    const p = pitch * (0.95 + Math.random() * 0.1);
    voice(ctx, pan, now + 0.005, p, gain);
    setTimeout(() => pan.disconnect(), 6000);
  }

  /** Occasional generative ambient music (original pentatonic phrases). */
  updateMusic(dt: number, dimension: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || ctx.state !== 'running' || !this.musicEnabled || this.musicVolume <= 0) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 120 + Math.random() * 240;
    const scales = [[0, 2, 4, 7, 9], [0, 3, 5, 7, 10], [0, 2, 5, 7, 9]];
    const scale = scales[dimension === 1 ? 1 : Math.floor(Math.random() * scales.length)];
    const base = dimension === 1 ? 110 : 220;
    let t = ctx.currentTime + 0.5;
    const notes = 12 + Math.floor(Math.random() * 16);
    for (let i = 0; i < notes; i++) {
      const deg = scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
      const f = base * Math.pow(2, deg / 12);
      const dur = 1.5 + Math.random() * 2.5;
      tone(ctx, this.musicGain, t, dur, 'sine', f, f, 0.12, 0.02);
      tone(ctx, this.musicGain, t, dur * 0.8, 'triangle', f * 2, f * 2, 0.03, 0.02);
      if (Math.random() < 0.3) tone(ctx, this.musicGain, t, dur * 1.5, 'sine', f / 2, f / 2, 0.08, 0.3);
      t += 0.6 + Math.random() * 1.6;
    }
  }
}
