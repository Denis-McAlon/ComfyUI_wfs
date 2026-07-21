import { EVENT } from '../config/Constants.js';

/**
 * BeatClock.js — the metronome the whole boss fight dances to.
 *
 * WHY IT LIVES IN THE FIXED STEP (and not on the audio clock)
 *   The DJ Skull boss telegraphs and fires strictly on the beat. If beats were
 *   derived from `AudioContext.currentTime` (wall time), their landing frame would
 *   wobble with audio latency and frame pacing, and the fight would be
 *   non-deterministic — impossible to author, replay, or test. Instead the beat is
 *   accumulated from the FIXED simulation step (SIM.FIXED_DT, a constant 1/60 s),
 *   exactly like every other piece of gameplay. Same inputs → same beats → the
 *   boss's attacks are frame-perfect and reproducible. The AudioEngine plays its
 *   own cosmetic four-on-the-floor separately; this clock is the source of truth
 *   for gameplay timing.
 *
 * CONTRACT
 *   Ticked once per fixed step via fixedUpdate(dt). Emits EVENT.BEAT with a 1-based
 *   `beat` counter and a 0-based `bar` (four beats to the bar). Beats 1–4 → bar 0,
 *   5–8 → bar 1, and so on.
 */
export class BeatClock {
  constructor(bus, bpm) {
    this.bus = bus;
    this.bpm = bpm;
    /** Seconds between beats, derived from tempo. 128 BPM → 0.46875 s. */
    this.secondsPerBeat = 60 / bpm;

    /** Accumulated sim-time since the last beat fired. */
    this._acc = 0;
    /** 1-based beat index (0 = "no beat yet"). Incremented as beats fire. */
    this.beat = 0;
    /** 0-based bar index, four beats to the bar. */
    this.bar = 0;
    this.running = false;
  }

  /** Begin counting. Idempotent. */
  start() { this.running = true; }

  /** Pause counting. The accumulator/beat are preserved (call reset() to zero). */
  stop() { this.running = false; }

  /** Rewind to the top of the song (beat 0, bar 0, empty accumulator). */
  reset() {
    this._acc = 0;
    this.beat = 0;
    this.bar = 0;
  }

  /**
   * Advance by one fixed step. Uses a while-loop so that even if `dt` ever spans
   * more than one beat (or the tempo is very high) EVERY crossed beat is emitted
   * in order — no beat is ever skipped or doubled. Carrying the remainder
   * (`_acc -= secondsPerBeat`) instead of zeroing keeps the phase drift-free over
   * the length of a whole song.
   */
  fixedUpdate(dt) {
    if (!this.running) return;
    this._acc += dt;
    while (this._acc >= this.secondsPerBeat) {
      this._acc -= this.secondsPerBeat;
      this.beat += 1;
      this.bar = Math.floor((this.beat - 1) / 4);
      this.bus.emit(EVENT.BEAT, { beat: this.beat, bar: this.bar });
    }
  }
}
