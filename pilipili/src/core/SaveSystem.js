/**
 * SaveSystem.js — tiny localStorage-backed persistence for meta-progression.
 *
 * Holds the handful of things worth remembering between sessions: the best growth
 * tier reached, the fastest clear time, run/win counts, and the audio volume. It
 * degrades gracefully — in a private-mode / storage-blocked context every method
 * is a quiet no-op over an in-memory copy, so the game never throws.
 */
const KEY = 'pilipili:save:v1';
const DEFAULTS = { bestTier: 0, bestTimeMs: null, runs: 0, wins: 0, volume: 0.9 };

export class SaveSystem {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(KEY) : null;
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  }

  save() {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage blocked */ }
  }

  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; this.save(); }

  /**
   * Record a finished run and fold in any new records.
   * @returns {{ newBestTier:boolean, newBestTime:boolean }}
   */
  recordRun({ outcome, tier = 0, timeMs = 0 }) {
    this.data.runs++;
    let newBestTier = false, newBestTime = false;
    if (tier > this.data.bestTier) { this.data.bestTier = tier; newBestTier = true; }
    if (outcome === 'win') {
      this.data.wins++;
      if (this.data.bestTimeMs == null || timeMs < this.data.bestTimeMs) { this.data.bestTimeMs = timeMs; newBestTime = true; }
    }
    this.save();
    return { newBestTier, newBestTime };
  }
}

/** Format milliseconds as M:SS.d for the HUD / end screens. */
export function formatTime(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem.toFixed(1).padStart(4, '0')}`;
}
