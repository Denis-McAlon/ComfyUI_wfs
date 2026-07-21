import { BOSS, EVENT, clamp } from '../config/Constants.js';

/**
 * AudioEngine.js — 100% procedural WebAudio, zero asset files.
 *
 * PHILOSOPHY
 *   The whole soundtrack and every SFX is *synthesised on the fly* with the
 *   WebAudio graph (oscillators, gain envelopes, filtered white noise). There is
 *   nothing to fetch or decode, so the game boots instantly and the sound design
 *   is tunable in code alongside the game-feel constants. Each cue is a tiny
 *   percussive "voice": a source → an envelope gain → the master bus. Bloom-bright
 *   visuals get bloom-bright audio — short, snappy, saturated.
 *
 * BROWSER GESTURE POLICY
 *   Browsers forbid starting an AudioContext before a user gesture, so we do NOT
 *   build one in the constructor. `init()` only wires the event subscriptions and
 *   arms a one-shot "unlock" listener; the AudioContext is created lazily the
 *   first time `resume()` runs (either from that unlock, or from an explicit call
 *   on your own gesture handler). Until it exists, every cue is a guarded no-op —
 *   nothing throws, sound simply begins once the player first touches the page.
 *
 * GRACEFUL DEGRADATION
 *   If WebAudio is unavailable (feature-detect at construction) the engine is an
 *   inert stub: init/resume/play* all return quietly and the game runs silent.
 */
export class AudioEngine {
  constructor(bus) {
    this.bus = bus;

    /** The AudioContext — created lazily on first resume() (needs a gesture). */
    this.ctx = null;
    /** Master GainNode (post-mix, pre-limiter). Null until the context exists. */
    this.master = null;
    /** A gentle limiter so stacked SFX can't clip the output. */
    this._limiter = null;
    /** Cached white-noise buffer, built once the context is alive. */
    this._noiseBuf = null;
    /** Handle to the running music scheduler ({ bus, timer }) or null. */
    this._music = null;
    /** Bus unsubscribe thunks, so the wiring can be torn down cleanly. */
    this._offs = [];
    /** Removes the one-shot gesture-unlock listeners once fired. */
    this._unlock = null;

    /** Desired master volume 0..1 (remembered even before the context exists). */
    this._volume = 0.9;

    /** Feature-detect once: is the WebAudio API present at all? */
    this._AC = (typeof window !== 'undefined')
      ? (window.AudioContext || window.webkitAudioContext || null)
      : null;
    this._supported = !!this._AC;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Wire the bus → synth table and arm the gesture unlock. Deliberately does NOT
   * create the AudioContext (that waits for a user gesture, see resume()).
   */
  async init() {
    if (!this._supported) return;          // silent game if WebAudio is missing
    this._subscribe();
    this._armGestureUnlock();
  }

  /** Map every gameplay event onto a procedural voice. */
  _subscribe() {
    const on = (evt, fn) => this._offs.push(this.bus.on(evt, fn));
    on(EVENT.PLAYER_JUMP, () => this._jump());
    on(EVENT.PLAYER_LAND, (p) => this._land(p));
    on(EVENT.PLAYER_HURT, (p) => this._hurt(p));
    on(EVENT.PLAYER_ATTACK, () => this._swipe());
    on(EVENT.PLAYER_GROW, () => this._grow());
    on(EVENT.PLAYER_DIED, () => this._death());
    on(EVENT.PICKUP_COLLECTED, (p) => this._pickup(p));
    on(EVENT.ENEMY_KILLED, () => this._crunch());
    on(EVENT.BOSS_SHOCKWAVE, () => this._boom());
    on(EVENT.BOSS_VINYL, () => this._vinylDrop());
    on(EVENT.BOSS_VULNERABLE, (p) => { if (p?.on) this._expose(); });
    on(EVENT.BOSS_HURT, () => this._zap());
    on(EVENT.BOSS_PHASE, () => this._riser());
    on(EVENT.BOSS_DEFEATED, () => this._defeatSweep());
  }

  /**
   * Arm a one-shot listener that unlocks audio on the first user gesture. This
   * keeps the engine self-contained: you *may* call resume() yourself from a
   * click handler, but you don't have to — the first pointer/key/touch will do it.
   */
  _armGestureUnlock() {
    if (typeof window === 'undefined' || this._unlock) return;
    const unlock = () => { this.resume(); this._unlock?.(); };
    const opts = { once: true, passive: true };
    window.addEventListener('pointerdown', unlock, opts);
    window.addEventListener('keydown', unlock, opts);
    window.addEventListener('touchstart', unlock, opts);
    this._unlock = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
      this._unlock = null;
    };
  }

  /**
   * Create the AudioContext if absent and resume it. Safe to call repeatedly and
   * safe to call when WebAudio is unavailable. Call from a user gesture.
   */
  resume() {
    const ctx = this._ensureContext();
    // .resume() returns a promise; swallow rejections (some browsers reject if
    // called just outside a gesture) so a stray call can never crash the game.
    ctx?.resume?.().catch?.(() => {});
  }

  /** Suspend all audio (called when the game pauses). No-op if silent/uncreated. */
  suspend() {
    this.ctx?.suspend?.().catch?.(() => {});
  }

  /** Build the AudioContext + master chain the first time we truly need it. */
  _ensureContext() {
    if (this.ctx || !this._supported) return this.ctx;
    let ctx;
    try {
      ctx = new this._AC();
    } catch {
      // Construction can throw in locked-down contexts; degrade to silence.
      this._supported = false;
      return null;
    }
    this.ctx = ctx;

    // Master bus → soft limiter → speakers. The limiter (a compressor tuned as a
    // brickwall-ish catch) tames transient stacks (e.g. a landing during a boss
    // boom) without audible pumping.
    this.master = ctx.createGain();
    this.master.gain.value = this._volume;
    this._limiter = ctx.createDynamicsCompressor();
    this._limiter.threshold.value = -6;
    this._limiter.knee.value = 6;
    this._limiter.ratio.value = 12;
    this._limiter.attack.value = 0.003;
    this._limiter.release.value = 0.15;
    this.master.connect(this._limiter);
    this._limiter.connect(ctx.destination);

    // Two seconds of white noise, reused by every noise-based voice.
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;

    return ctx;
  }

  /** Master volume 0..1. Remembered and applied whenever the context exists. */
  setVolume(v) {
    this._volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.02);
  }

  // ── Low-level synth primitives ──────────────────────────────────────────────

  /** A fresh gain "voice" wired to a destination (defaults to the master bus). */
  _voice(dest) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(dest || this.master);
    return g;
  }

  /** Percussive attack/decay envelope on a gain param (exponential tail = punchy). */
  _perc(param, t0, peak, attack, decay) {
    const floor = 0.0001;
    param.cancelScheduledValues(t0);
    param.setValueAtTime(floor, t0);
    param.linearRampToValueAtTime(peak, t0 + attack);
    param.exponentialRampToValueAtTime(floor, t0 + attack + decay);
  }

  /** A pitched oscillator voice with an optional exponential frequency glide. */
  _tone({ type = 'sine', f0, f1, t0, dur, peak = 0.3, attack = 0.005, dest, detune = 0 }) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = this._voice(dest);
    this._perc(g.gain, t0, peak, attack, dur - attack);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    return osc;
  }

  /** A filtered white-noise voice (bandpass/highpass/lowpass sweeps = swishes/thuds). */
  _noise({ t0, dur, peak = 0.3, type = 'bandpass', f0, f1, q = 1, dest }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = this._voice(dest);
    this._perc(g.gain, t0, peak, Math.min(0.01, dur * 0.2), dur);
    src.connect(filt); filt.connect(g);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
    return src;
  }

  get _t() { return this.ctx.currentTime; }

  // ── SFX voices (one method per gameplay event) ──────────────────────────────

  /** Jump: a short rising blip — bright and instant so the launch reads on frame 1. */
  _jump() {
    if (!this.ctx) return;
    const t = this._t;
    this._tone({ type: 'square', f0: 320, f1: 760, t0: t, dur: 0.12, peak: 0.22, attack: 0.004 });
    this._tone({ type: 'sine', f0: 640, f1: 1400, t0: t, dur: 0.10, peak: 0.10, attack: 0.004 });
  }

  /** Land: a low thud whose weight scales with the fall impact (payload.impact = |vy|). */
  _land(p = {}) {
    if (!this.ctx) return;
    const t = this._t;
    const impact = p.impact ?? 8;
    const peak = clamp(0.18 + impact * 0.012, 0.18, 0.6);   // heavier fall → louder
    const f = clamp(170 - impact * 1.6, 60, 170);           // …and lower-pitched
    this._tone({ type: 'sine', f0: f, f1: f * 0.4, t0: t, dur: 0.18, peak, attack: 0.004 });
    this._noise({ t0: t, dur: 0.10, peak: peak * 0.5, type: 'lowpass', f0: 900, f1: 200, q: 0.7 });
  }

  /** Hurt: a harsh noise burst. Softer + shorter for damage-over-time (glass) ticks. */
  _hurt(p = {}) {
    if (!this.ctx) return;
    const t = this._t;
    const dot = !!p.dot;
    const peak = dot ? 0.14 : 0.34;
    const dur = dot ? 0.10 : 0.20;
    this._noise({ t0: t, dur, peak, type: 'highpass', f0: 1200, f1: 400, q: 0.8 });
    this._tone({ type: 'sawtooth', f0: 220, f1: 90, t0: t, dur, peak: peak * 0.6, attack: 0.002 });
  }

  /** Attack: a filtered swipe — bandpass noise sweeping up, like air torn by the swing. */
  _swipe() {
    if (!this.ctx) return;
    this._noise({ t0: this._t, dur: 0.14, peak: 0.22, type: 'bandpass', f0: 400, f1: 3200, q: 1.4 });
  }

  /** Grow: an upward whoosh — rising lowpassed noise + a rising tone; a power surge. */
  _grow() {
    if (!this.ctx) return;
    const t = this._t;
    this._noise({ t0: t, dur: 0.42, peak: 0.24, type: 'lowpass', f0: 200, f1: 2600, q: 0.6 });
    this._tone({ type: 'triangle', f0: 180, f1: 720, t0: t, dur: 0.42, peak: 0.16, attack: 0.02 });
  }

  /**
   * Pickup: a bright little arpeggio. Vinyls (the rarer, bigger reward) ring
   * higher and add a sparkling top octave; cocktails are a warmer major triad.
   */
  _pickup(p = {}) {
    if (!this.ctx) return;
    const vinyl = p.kind === 'vinyl';
    const root = vinyl ? 659.25 : 523.25;                 // E5 vs C5
    const steps = vinyl ? [0, 4, 7, 12] : [0, 4, 7];       // add-octave sparkle for vinyl
    const t0 = this._t;
    const gap = 0.055;
    steps.forEach((semi, i) => {
      const f = root * Math.pow(2, semi / 12);
      this._tone({ type: 'triangle', f0: f, t0: t0 + i * gap, dur: 0.12, peak: 0.18, attack: 0.003 });
    });
  }

  /** Death: a heavy thud under a mournful descending tone — the run ends with weight. */
  _death() {
    if (!this.ctx) return;
    const t = this._t;
    this._tone({ type: 'sine', f0: 220, f1: 52, t0: t, dur: 0.7, peak: 0.42, attack: 0.005 });
    this._tone({ type: 'sawtooth', f0: 330, f1: 62, t0: t, dur: 0.8, peak: 0.22, attack: 0.01, detune: -8 });
    this._noise({ t0: t, dur: 0.26, peak: 0.3, type: 'lowpass', f0: 700, f1: 120, q: 0.8 });
  }

  /** Falling vinyl: a short spinning whoosh so an incoming record is AUDIBLE (fair). */
  _vinylDrop() {
    if (!this.ctx) return;
    this._noise({ t0: this._t, dur: 0.28, peak: 0.13, type: 'bandpass', f0: 1700, f1: 520, q: 3.2 });
  }

  /** Boss exposed: a bright rising chime — the "hit me NOW" tell that opens the window. */
  _expose() {
    if (!this.ctx) return;
    const t = this._t;
    this._tone({ type: 'triangle', f0: 520, f1: 1040, t0: t, dur: 0.22, peak: 0.18, attack: 0.004 });
    this._tone({ type: 'sine', f0: 784, f1: 1568, t0: t, dur: 0.18, peak: 0.10, attack: 0.004 });
  }

  /** Enemy killed: a short gritty crunch — collapsing noise plus a downward blip. */
  _crunch() {
    if (!this.ctx) return;
    const t = this._t;
    this._noise({ t0: t, dur: 0.12, peak: 0.28, type: 'lowpass', f0: 1400, f1: 220, q: 1.2 });
    this._tone({ type: 'square', f0: 200, f1: 70, t0: t, dur: 0.10, peak: 0.14, attack: 0.002 });
  }

  /** Boss shockwave: a sub boom — a deep sine drop plus a lowpassed noise slam. */
  _boom() {
    if (!this.ctx) return;
    const t = this._t;
    this._tone({ type: 'sine', f0: 90, f1: 28, t0: t, dur: 0.5, peak: 0.6, attack: 0.005 });
    this._noise({ t0: t, dur: 0.22, peak: 0.3, type: 'lowpass', f0: 500, f1: 90, q: 0.8 });
  }

  /** Boss hurt: an electric zap — a fast falling saw through a highpass, slightly detuned. */
  _zap() {
    if (!this.ctx) return;
    const t = this._t;
    this._tone({ type: 'sawtooth', f0: 900, f1: 180, t0: t, dur: 0.14, peak: 0.3, attack: 0.002, detune: 12 });
    this._noise({ t0: t, dur: 0.10, peak: 0.16, type: 'highpass', f0: 2000, q: 1.0 });
  }

  /** Boss phase change: a tension riser — bandpass noise + saw both sweeping upward. */
  _riser() {
    if (!this.ctx) return;
    const t = this._t;
    this._noise({ t0: t, dur: 1.0, peak: 0.26, type: 'bandpass', f0: 200, f1: 4000, q: 1.6 });
    this._tone({ type: 'sawtooth', f0: 110, f1: 440, t0: t, dur: 1.0, peak: 0.14, attack: 0.05 });
  }

  /** Boss defeated: a long descending sweep — a deflating, victorious fall. */
  _defeatSweep() {
    if (!this.ctx) return;
    const t = this._t;
    this._tone({ type: 'sawtooth', f0: 800, f1: 70, t0: t, dur: 1.2, peak: 0.3, attack: 0.01 });
    this._tone({ type: 'sine', f0: 400, f1: 35, t0: t, dur: 1.2, peak: 0.18, attack: 0.01, detune: -6 });
  }

  // ── Music: procedural four-on-the-floor for the boss ────────────────────────

  /**
   * Start a simple, quiet club loop. name==='boss' gives a four-on-the-floor:
   * a kick on every beat at BOSS.BPM plus a pulsing sawtooth bass riff. Notes are
   * scheduled ahead on the *AudioContext clock* via a lookahead timer, which is
   * the standard jitter-free WebAudio pattern (the setInterval only tops up the
   * queue; the audio clock is what keeps time). The gameplay beat is driven
   * separately by the deterministic BeatClock, so the music is purely cosmetic.
   */
  playMusic(name) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    this.stopMusic();
    if (name !== 'boss') return;

    // Dedicated, deliberately quiet music bus (master ~0.25 as briefed).
    const musicBus = ctx.createGain();
    musicBus.gain.value = 0.25;
    musicBus.connect(this.master);

    const spb = 60 / BOSS.BPM;                 // seconds per beat (club four-on-the-floor)
    const bassPattern = [0, 0, 3, 5];          // semitone riff over an A1 root, per beat
    const root = 55;                           // A1

    let beat = 0;
    let nextTime = ctx.currentTime + 0.12;     // small pad before the first kick
    const LOOKAHEAD = 0.12;                     // schedule this far into the future

    const pump = () => {
      if (!this._music) return;                // stopped between ticks
      while (nextTime < ctx.currentTime + LOOKAHEAD) {
        this._kick(nextTime, musicBus);
        const f = root * Math.pow(2, bassPattern[beat % bassPattern.length] / 12);
        this._bass(nextTime, spb, f, musicBus);
        this._hat(nextTime + spb * 0.5, musicBus);   // soft offbeat hat for groove
        nextTime += spb;
        beat++;
      }
    };

    const timer = (typeof setInterval !== 'undefined') ? setInterval(pump, 25) : null;
    this._music = { bus: musicBus, timer };
    pump();                                     // prime the queue immediately
  }

  /** Stop and dispose the running music loop, fading out to avoid a click. */
  stopMusic() {
    if (!this._music) return;
    const { bus, timer } = this._music;
    this._music = null;
    if (timer != null && typeof clearInterval !== 'undefined') clearInterval(timer);
    try {
      const now = this.ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setTargetAtTime(0, now, 0.05);
      // Disconnect after the fade tail so we don't cut it with a pop.
      if (typeof setTimeout !== 'undefined') setTimeout(() => { try { bus.disconnect(); } catch {} }, 400);
    } catch {
      try { bus.disconnect(); } catch {}
    }
  }

  /** One kick drum: a pitched sine that drops fast, with a snappy click of attack. */
  _kick(time, dest) {
    this._tone({ type: 'sine', f0: 130, f1: 45, t0: time, dur: 0.16, peak: 0.9, attack: 0.002, dest });
  }

  /** One bass note: a lowpassed saw that pulses across most of the beat. */
  _bass(time, spb, freq, dest) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 420;
    filt.Q.value = 0.7;
    const g = this._voice(dest);
    this._perc(g.gain, time, 0.5, 0.01, spb * 0.85);
    osc.connect(filt); filt.connect(g);
    osc.start(time);
    osc.stop(time + spb + 0.02);
  }

  /** One closed hi-hat: a very short, quiet burst of highpassed noise for lift. */
  _hat(time, dest) {
    this._noise({ t0: time, dur: 0.03, peak: 0.06, type: 'highpass', f0: 7000, q: 0.6, dest });
  }
}
