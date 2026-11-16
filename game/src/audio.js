// NEON HARBOR — every sound is synthesized with WebAudio at runtime.
// No audio files ship with the game, so it stays offline and self-contained.
// A tiny synth: short noise bursts through filters for gunfire, sine blips
// for UI, and a low boom for the charge.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._noiseBuf = null;
  }

  // Browsers only let audio start after a user gesture; call from the first
  // click (or from a staged screenshot) and every later call is a no-op.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  _noise(dur, filterType, freq, gain, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  _tone(freq, dur, type, gain, slideTo = 0, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  // distance in metres: shots get quieter and duller far away.
  shot(kind, distance = 0) {
    const att = 1 / (1 + distance * 0.045);
    const vol = 0.5 * att;
    if (kind === 'pistol') { this._noise(0.09, 'bandpass', 1800, vol); this._tone(220, 0.08, 'square', vol * 0.35, 90); }
    else if (kind === 'smg') { this._noise(0.07, 'bandpass', 2400, vol * 0.8); this._tone(300, 0.05, 'square', vol * 0.25, 120); }
    else if (kind === 'rifle') { this._noise(0.13, 'lowpass', 1400, vol); this._tone(150, 0.12, 'sawtooth', vol * 0.4, 60); }
    else if (kind === 'dmr') { this._noise(0.2, 'lowpass', 1000, vol * 1.1); this._tone(110, 0.18, 'sawtooth', vol * 0.5, 45); }
    else if (kind === 'shotgun') { this._noise(0.18, 'lowpass', 900, vol * 1.1); this._tone(130, 0.14, 'sawtooth', vol * 0.45, 50); }
  }

  dryFire() { this._tone(1400, 0.03, 'square', 0.08); }
  reload() { this._tone(900, 0.05, 'square', 0.12); this._tone(600, 0.05, 'square', 0.12, 0, 0.16); this._tone(1100, 0.05, 'square', 0.14, 0, 0.42); }
  hit() { this._tone(2100, 0.06, 'sine', 0.22); }
  kill() { this._tone(1750, 0.07, 'sine', 0.25); this._tone(2600, 0.09, 'sine', 0.22, 0, 0.07); }
  hurt() { this._tone(180, 0.15, 'sawtooth', 0.25, 70); }
  step(distance = 0) { if (distance > 18) return; this._noise(0.05, 'lowpass', 500, 0.05 / (1 + distance * 0.1)); }
  grenadeThrow() { this._noise(0.12, 'bandpass', 900, 0.15); }
  grenadeBounce() { this._tone(320, 0.05, 'sine', 0.12, 180); }
  explosion(distance = 0) {
    const att = 1 / (1 + distance * 0.03);
    this._noise(0.9, 'lowpass', 320, 0.9 * att);
    this._tone(70, 0.8, 'sine', 0.7 * att, 28);
    this._noise(0.25, 'highpass', 3000, 0.3 * att);
  }
  plantBeep() { this._tone(1250, 0.09, 'sine', 0.2); }
  bombBeep() { this._tone(1500, 0.12, 'square', 0.12); }
  defuseBeep() { this._tone(980, 0.08, 'sine', 0.18); }
  buy() { this._tone(880, 0.06, 'sine', 0.2); this._tone(1320, 0.08, 'sine', 0.2, 0, 0.06); }
  denied() { this._tone(220, 0.12, 'square', 0.18, 160); }
  roundWin() { [523, 659, 784].forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.22, 0, i * 0.12)); }
  roundLose() { [392, 330, 262].forEach((f, i) => this._tone(f, 0.26, 'triangle', 0.2, 0, i * 0.13)); }
  click() { this._tone(700, 0.04, 'sine', 0.15); }
  // Distant harbour ambience: low filtered noise, started once per match.
  ambience() {
    if (!this.ctx || this._ambOn) return;
    this._ambOn = true;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 240;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start();
  }
}
