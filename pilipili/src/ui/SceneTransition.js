import { PALETTE } from '../config/Palette.js';

/**
 * SceneTransition.js — the crimson wipe between screens.
 *
 * A single full-screen overlay (pointer-events: none, above everything) that the
 * Game plays on every FSM state change. Because the state has already swapped by
 * the time STATE_CHANGE fires, this runs the REVEAL half of a wipe: it snaps to a
 * crimson-black veil that covers the fresh screen for a beat, then peels away with
 * a bright leading edge — so each new scene materialises out of the club's dark
 * instead of hard-cutting. Entering the boss burns a deeper, longer red.
 *
 * It is purely cosmetic: it never gates input or the sim, restarts cleanly if a
 * transition interrupts another, and removes its own animating class on end so a
 * later play() always re-triggers.
 */

function toCss(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return '#' + ((v >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  }
  if (typeof v === 'string' && v) return v;
  return fallback;
}

export class SceneTransition {
  constructor() {
    this.crimson = toCss(PALETTE?.crimson, '#ff2b48');
    this.magenta = toCss(PALETTE?.magenta, '#ff2b6b');
    this._onEnd = this._onEnd.bind(this);
    this._clearTimer = 0;
    this._build();
  }

  _build() {
    const mount = typeof document !== 'undefined' ? (document.getElementById('ui') || document.body) : null;
    if (!mount) { this.root = null; return; }
    this.root = document.createElement('div');
    this.root.className = 'pili-wipe';
    this.root.innerHTML = `<style>${this._css()}</style><span class="pili-wipe__edge"></span>`;
    this.root.addEventListener('animationend', this._onEnd);
    mount.appendChild(this.root);
  }

  /**
   * Play the reveal wipe. `to` is the destination state name; the boss and the end
   * screen get a heavier variant so the beat lands.
   */
  play(to) {
    if (!this.root) return;
    const heavy = to === 'boss' || to === 'end';
    this.root.classList.remove('is-playing', 'is-heavy');
    // Force reflow so re-adding the class restarts the animation from frame 0.
    void this.root.offsetWidth;
    this.root.classList.add('is-playing');
    if (heavy) this.root.classList.add('is-heavy');
    // animationend clears the class, but it can be missed if the tab is throttled
    // or a transition interrupts another — so guarantee cleanup with a timer too.
    if (this._clearTimer) clearTimeout(this._clearTimer);
    if (typeof setTimeout === 'function') {
      this._clearTimer = setTimeout(() => this._clear(), (heavy ? 720 : 460) + 120);
    }
  }

  _onEnd(e) {
    // Only clear on the veil's own animation (not the edge child), so both finish.
    if (e.target === this.root) this._clear();
  }

  _clear() {
    if (this._clearTimer) { clearTimeout(this._clearTimer); this._clearTimer = 0; }
    this.root?.classList.remove('is-playing', 'is-heavy');
  }

  destroy() {
    if (this._clearTimer) clearTimeout(this._clearTimer);
    this.root?.removeEventListener('animationend', this._onEnd);
    this.root?.parentNode?.removeChild(this.root);
    this.root = null;
  }

  _css() {
    return `
      .pili-wipe {
        position: fixed; inset: 0; z-index: 9000; pointer-events: none;
        opacity: 0; will-change: opacity, transform;
        background:
          radial-gradient(120% 80% at 50% 42%, rgba(120, 4, 26, .96), rgba(4, 1, 9, .99));
      }
      .pili-wipe.is-playing { animation: pili-wipe-veil 460ms cubic-bezier(.5, 0, .2, 1) both; }
      .pili-wipe.is-heavy.is-playing { animation-duration: 720ms; }
      @keyframes pili-wipe-veil {
        0% { opacity: 1; clip-path: inset(0 0 0 0); }
        55% { opacity: 1; }
        100% { opacity: 0; clip-path: inset(0 0 100% 0); }
      }
      /* A bright neon edge that rides the top of the peeling veil. */
      .pili-wipe__edge {
        position: absolute; left: 0; right: 0; top: 0; height: 5px;
        background: linear-gradient(90deg, transparent, var(--pili-crimson, ${this.crimson}), var(--pili-magenta, ${this.magenta}), transparent);
        box-shadow: 0 0 22px 6px var(--pili-crimson, ${this.crimson});
        opacity: 0;
      }
      .pili-wipe.is-playing .pili-wipe__edge { animation: pili-wipe-edge 460ms cubic-bezier(.5, 0, .2, 1) both; }
      .pili-wipe.is-heavy.is-playing .pili-wipe__edge { animation-duration: 720ms; }
      @keyframes pili-wipe-edge {
        0% { opacity: 0; transform: translateY(0); }
        50% { opacity: 1; }
        100% { opacity: .9; transform: translateY(100vh); }
      }
      @media (prefers-reduced-motion: reduce) {
        .pili-wipe.is-playing { animation: pili-wipe-fade 220ms ease both; }
        .pili-wipe.is-playing .pili-wipe__edge { animation: none; }
        @keyframes pili-wipe-fade { from { opacity: .9; } to { opacity: 0; } }
      }
    `;
  }
}
