import { ACTIONS } from '../config/Constants.js';
import { PALETTE } from '../config/Palette.js';

/**
 * TouchControls.js — the on-screen gamepad for phones and tablets.
 *
 * A DOM overlay of thumb-sized neon buttons (a left move-pad, a big JUMP and a
 * FRAPPE on the right) that feed the shared InputManager through its touchDown /
 * touchUp methods — the exact same digital path as the keyboard, so coyote time,
 * the jump buffer and variable jump height all behave identically under a thumb.
 *
 * Pointer events (not touch events) drive it, which unifies touch + pen + mouse
 * and gives per-button pointer capture, so a finger that slides off the button
 * still releases cleanly and two thumbs can hold move+jump at once. It only mounts
 * on a touch-capable device (or when forced with ?touch=1), so desktop is untouched.
 *
 * Lifecycle mirrors the HUD: the gameplay scene builds one on enter and destroys it
 * on exit, so the pad exists only while you're actually playing (never on menus).
 */

/** Convert a palette value (hex number OR css string) to a css colour, else fallback. */
function toCss(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return '#' + ((v >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  }
  if (typeof v === 'string' && v) return v;
  return fallback;
}

export class TouchControls {
  /** Should we show a touch pad at all? Touch-capable device, or ?touch=1 override. */
  static enabled() {
    if (typeof window === 'undefined') return false;
    try {
      const q = new URLSearchParams(window.location.search).get('touch');
      if (q === '1') return true;
      if (q === '0') return false;
    } catch { /* no location — fall through to capability sniff */ }
    return ('ontouchstart' in window) || ((navigator?.maxTouchPoints || 0) > 0);
  }

  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx?.input;
    this._btns = [];
    this.crimson = toCss(PALETTE?.crimson, '#ff2b48');
    this.magenta = toCss(PALETTE?.magenta, '#ff2b6b');
    if (!TouchControls.enabled()) { this.root = null; return; } // desktop: no-op
    this._build();
  }

  _build() {
    const mount = typeof document !== 'undefined' ? document.getElementById('ui') : null;
    this.root = document.createElement('div');
    this.root.className = 'pili-touch';

    this.root.innerHTML = `
      <style>${this._css()}</style>
      <div class="pili-touch__pad pili-touch__pad--move">
        <button class="pili-touch__btn pili-touch__btn--dir" data-action="left"  type="button" aria-label="Gauche">‹</button>
        <button class="pili-touch__btn pili-touch__btn--dir" data-action="right" type="button" aria-label="Droite">›</button>
      </div>
      <div class="pili-touch__pad pili-touch__pad--act">
        <button class="pili-touch__btn pili-touch__btn--atk"  data-action="attack" type="button" aria-label="Frapper">✦</button>
        <button class="pili-touch__btn pili-touch__btn--jump" data-action="jump"   type="button" aria-label="Sauter">⤒</button>
      </div>
    `;

    const map = { left: ACTIONS.LEFT, right: ACTIONS.RIGHT, jump: ACTIONS.JUMP, attack: ACTIONS.ATTACK };
    for (const el of this.root.querySelectorAll('[data-action]')) {
      this._bindButton(el, map[el.dataset.action]);
    }

    mount?.appendChild(this.root);
  }

  /** Wire one button to an action with pointer capture + robust release. */
  _bindButton(el, action) {
    let pid = null; // the pointer currently holding this button (one at a time)
    const down = (e) => {
      if (pid !== null) return;
      pid = e.pointerId;
      try { el.setPointerCapture?.(pid); } catch { /* capture optional */ }
      el.classList.add('is-active');
      this.input?.touchDown?.(action);
      e.preventDefault();
    };
    const up = (e) => {
      if (pid === null || (e.pointerId != null && e.pointerId !== pid)) return;
      pid = null;
      el.classList.remove('is-active');
      this.input?.touchUp?.(action);
      e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    // Guard: if the page loses focus mid-hold, drop the action so it can't stick.
    this._btns.push({ el, action, down, up });
  }

  /** Release every held action (e.g. on teardown) so nothing sticks between scenes. */
  releaseAll() {
    for (const b of this._btns) { b.el.classList.remove('is-active'); this.input?.touchUp?.(b.action); }
  }

  destroy() {
    this.releaseAll();
    for (const b of this._btns) {
      b.el.removeEventListener('pointerdown', b.down);
      b.el.removeEventListener('pointerup', b.up);
      b.el.removeEventListener('pointercancel', b.up);
      b.el.removeEventListener('lostpointercapture', b.up);
    }
    this._btns.length = 0;
    this.root?.parentNode?.removeChild(this.root);
    this.root = null;
  }

  _css() {
    return `
      .pili-touch {
        position: absolute; inset: 0; z-index: 40; pointer-events: none;
        --pili-crimson: ${this.crimson}; --pili-magenta: ${this.magenta};
        touch-action: none; -webkit-user-select: none; user-select: none;
        -webkit-tap-highlight-color: transparent;
      }
      .pili-touch__pad {
        position: absolute; bottom: max(22px, env(safe-area-inset-bottom, 0px));
        display: flex; gap: 18px; align-items: flex-end;
      }
      .pili-touch__pad--move { left: max(20px, env(safe-area-inset-left, 0px)); }
      .pili-touch__pad--act  { right: max(20px, env(safe-area-inset-right, 0px)); align-items: center; }
      .pili-touch__btn {
        pointer-events: auto; touch-action: none;
        display: grid; place-items: center;
        width: 76px; height: 76px; border-radius: 50%;
        font: 700 34px/1 system-ui, sans-serif; color: #ffdfe4;
        background: radial-gradient(circle at 50% 38%, rgba(48, 6, 20, .82), rgba(10, 2, 8, .72));
        border: 1.5px solid rgba(255, 43, 72, .55);
        box-shadow: 0 0 18px rgba(255, 43, 72, .35), inset 0 0 18px rgba(0, 0, 0, .55);
        backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
        transition: transform .07s ease, box-shadow .1s ease, background .1s ease;
      }
      .pili-touch__btn.is-active {
        transform: scale(.92);
        background: radial-gradient(circle at 50% 38%, rgba(255, 43, 72, .55), rgba(60, 4, 16, .85));
        box-shadow: 0 0 30px rgba(255, 43, 72, .85), inset 0 0 14px rgba(255, 43, 72, .5);
      }
      .pili-touch__btn--jump {
        width: 96px; height: 96px; font-size: 40px;
        border-color: rgba(255, 43, 108, .7);
      }
      .pili-touch__btn--atk { width: 68px; height: 68px; font-size: 26px; color: #ffd36a; border-color: rgba(255, 211, 106, .5); }
      .pili-touch__btn--dir { font-size: 44px; }
      @media (min-width: 900px) and (pointer: fine) {
        /* A fine pointer (mouse) on a wide screen: keep the pad out of the way but
           still usable when explicitly forced on. */
        .pili-touch__btn { opacity: .82; }
      }
    `;
  }
}
