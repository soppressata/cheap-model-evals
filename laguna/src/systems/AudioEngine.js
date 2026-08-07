/**
 * AudioEngine.js — procedural, file-less audio synthesized with the Web Audio
 * API. Everything is generated in-memory: wind (filtered white noise), coin/
 * ring chimes (ascending bell tones), boost thruster (bandpassed noise) and
 * crash bursts (down-sweep + noise).
 *
 * The API is fire-and-forget: Game calls setWind/update each frame and one-shot
 * methods for events. Failures are swallowed so audio never crashes the loop.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.lowpass = null;
    this._windNode = null;
    this._windFilter = null;
    this._windGain = null;
    this._boostNode = null;
    this._boostFilter = null;
    this._boostGain = null;
    this._boostActive = false;
    this._ready = false;
    this._noiseBuffer = null; // reusable 2s white-noise buffer
  }

  async init() {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.lowpass = this.ctx.createBiquadFilter();
      this.lowpass.type = 'lowpass';
      this.lowpass.frequency.value = 9000;
      this.master.connect(this.lowpass);
      this.lowpass.connect(this.ctx.destination);
      // pre-render a 2s white-noise buffer
      this._noiseBuffer = this._makeNoiseBuffer(2);
      this._ready = true;
    } catch (e) {
      console.warn('Audio unavailable', e);
      this._ready = false;
    }
    return this._ready;
  }

  // Resume the context from a user gesture (required by browsers).
  resume() {
    if (!this.ctx) return this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this._ready;
  }

  _makeNoiseBuffer(seconds) {
    const sampleRate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, sampleRate * seconds, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // simple white noise (rand*2-1). Use a deterministic PRNG for no pops.
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // --- wind: continuous filtered noise, modulated by airspeed ---
  ensureWind() {
    if (this._windNode) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0;
    src.connect(filter).connect(gain).connect(this.lowpass);
    src.start();
    this._windNode = src;
    this._windFilter = filter;
    this._windGain = gain;
  }

  setWind(speed) {
    if (!this._ready) return;
    this.ensureWind();
    // speed drives both how "bright" (filter cutoff) and loud the wind gets
    const s = Math.max(0, Math.min(1, speed / 60));
    const cutoff = 160 + s * 1640; // up to ~1.8kHz
    const vol = 0.05 + s * 0.32;
    const now = this.ctx.currentTime;
    this._windFilter.frequency.setValueAtTime(cutoff, now);
    this._windGain.gain.setTargetAtTime(vol, now, 0.06);
  }

  // --- boost thruster: bandpassed noise that follows the boost meter ---
  startBoost() {
    if (!this._ready) return;
    this._boostActive = true;
    if (!this._boostNode) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 260;
      filter.Q.value = 1.2;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.lowpass);
      src.start();
      this._boostNode = src;
      this._boostFilter = filter;
      this._boostGain = gain;
    }
    this._setBoostLevel(1);
  }

  stopBoost() {
    this._boostActive = false;
    this._setBoostLevel(0);
  }

  _setBoostLevel(t) {
    if (!this._boostGain) return;
    const now = this.ctx.currentTime;
    this._boostGain.gain.setTargetAtTime(t * 0.55, now, 0.04);
    this._boostFilter.frequency.setTargetAtTime(180 + t * 240, now, 0.05);
  }

  setBoostLevel(normalized) {
    if (this._boostActive) this._setBoostLevel(Math.max(0, Math.min(1, normalized)));
  }

  // --- one-shot tones ---
  _bell(freqs, dur = 0.35, decayStart = 0.12) {
    if (!this._ready) return;
    const now = this.ctx.currentTime;
    const masterGain = this.ctx.createGain();
    masterGain.connect(this.lowpass);
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(0.36, now + 0.005);
    // short release
    masterGain.gain.setValueAtTime(0.36, now + dur);
    masterGain.gain.linearRampToValueAtTime(0.0001, now + dur + 0.25);
    freqs.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, now);
      o.connect(masterGain);
      o.start(now + i * 0.035);
      o.stop(now + dur + 0.3 + i * 0.035);
    });
  }

  playRing() {
    // ascending triad (coin-collection "bling")
    this._bell([523, 659, 784]);
  }

  playCoin() {
    this._bell([660, 880, 1100]);
  }

  playChime() {
    // richer, warmer pickup chime
    this._bell([440, 554, 660, 784], 0.45);
  }

  playCrash() {
    if (!this._ready) return;
    const now = this.ctx.currentTime;
    // low-frequency down-sweep
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, now);
    o.frequency.exponentialRampToValueAtTime(24, now + 0.45);
    // noise burst
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.playbackRate.value = 0.5;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(220, now);
    filt.frequency.exponentialRampToValueAtTime(40, now + 0.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    src.connect(filt).connect(g).connect(this.lowpass);
    o.connect(g);
    o.start(now);
    o.stop(now + 0.48);
    src.start(now);
    src.stop(now + 0.6);
  }

  // ambient bed: very low filtered rumble
  setAmbient(strength) {
    if (!this._ready) return;
    // driven by wind gain indirectly; noop for now (could add a hum).
  }
}
