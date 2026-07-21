import { PALETTE, cssVars } from '../config/Palette.js';
import { ACTIONS } from '../config/Constants.js';
import { formatTime } from '../core/SaveSystem.js';

/**
 * TitleScreen.js — the front door of Le PiliPili.
 *
 * The first thing a player sees: the venue name burning in crimson neon over the
 * dark underground, a one-line invitation, the best run so far (pulled from the
 * save so the front door reflects your progress), a compact control legend, and a
 * pulsing "press to enter". It is a self-contained DOM overlay in the same mould
 * as CharacterSelectUI — it listens to the DOM directly (so it works the instant
 * it mounts) AND accepts handleInput() so the shared InputManager (keyboard +
 * gamepad) can drive it once the loop is running. Any input confirms and hands off.
 *
 * Defensive by contract: PALETTE and the save are read with optional chaining and
 * crimson/neutral fallbacks, so a missing field degrades the look, never throws.
 */

/** Convert a palette value (hex number OR css string) to a css colour, else fallback. */
function toCss(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return '#' + ((v >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  }
  if (typeof v === 'string' && v) return v;
  return fallback;
}

export class TitleScreen {
  constructor(ctx, { onStart } = {}) {
    this.ctx = ctx;
    this._onStart = onStart;
    this._confirmed = false;

    this.crimson = toCss(PALETTE?.crimson, '#ff2b48');
    this.magenta = toCss(PALETTE?.magenta, '#ff2b6b');

    this._onKey = this._onKey.bind(this);
    this._onClick = this._onClick.bind(this);
    this._build();
  }

  // ── Construction ──────────────────────────────────────────────────────────

  _build() {
    const mount = typeof document !== 'undefined' ? document.getElementById('ui') : null;
    this.root = document.createElement('div');
    this.root.className = 'pili-title';
    this.root.style.pointerEvents = 'auto';

    // Best-run readout, pulled from the save. Absent on a first night.
    const save = this.ctx?.save;
    const bestTier = save?.get?.('bestTier') ?? 0;
    const bestTimeMs = save?.get?.('bestTimeMs') ?? null;
    const wins = save?.get?.('wins') ?? 0;
    const hasHistory = bestTier > 0 || wins > 0;
    const bestBlock = hasHistory
      ? `<div class="pili-title__best">
           <span class="pili-title__best-item">MEILLEUR PALIER <b>${bestTier}</b></span>
           <span class="pili-title__best-sep">·</span>
           <span class="pili-title__best-item">MEILLEUR TEMPS <b>${formatTime(bestTimeMs)}</b></span>
           ${wins > 0 ? `<span class="pili-title__best-sep">·</span><span class="pili-title__best-item">NUITS GAGNÉES <b>${wins}</b></span>` : ''}
         </div>`
      : `<div class="pili-title__best pili-title__best--fresh">PREMIÈRE NUIT · FAIS-TOI UN NOM</div>`;

    this.root.innerHTML = `
      <style>${this._css()}</style>
      <div class="pili-title__grid" aria-hidden="true"></div>
      <div class="pili-title__skull" aria-hidden="true">☠</div>
      <div class="pili-title__inner">
        <div class="pili-title__eyebrow">MIMIZAN · SOUS-SOL NÉON</div>
        <h1 class="pili-title__logo" data-logo>LE PILIPILI</h1>
        <div class="pili-title__chili" aria-hidden="true">🌶</div>
        <p class="pili-title__tag">Le bar qui ne dort jamais. Descends, grandis, fais tomber le DJ&nbsp;Skull.</p>
        ${bestBlock}
        <button class="pili-title__cta" data-start type="button">
          <span class="pili-title__cta-label">ENTRER DANS LE CLUB</span>
        </button>
        <div class="pili-title__prompt" data-prompt>Appuie sur <b>Entrée</b> pour commencer</div>
        <div class="pili-title__legend">
          <span class="pili-title__key"><kbd>←</kbd><kbd>→</kbd> Se déplacer</span>
          <span class="pili-title__key"><kbd>Espace</kbd> Sauter</span>
          <span class="pili-title__key"><kbd>X</kbd> Frapper</span>
          <span class="pili-title__key"><kbd>Échap</kbd> Pause</span>
        </div>
      </div>
    `;

    this._applyPaletteVars();

    this.root.addEventListener('click', this._onClick);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this._onKey);

    mount?.appendChild(this.root);
  }

  _applyPaletteVars() {
    try {
      const vars = typeof cssVars === 'function' ? cssVars() : null;
      if (vars && typeof vars === 'object') {
        for (const [k, v] of Object.entries(vars)) {
          const name = k.startsWith('--') ? k : `--${k}`;
          this.root.style.setProperty(name, String(v));
        }
      }
    } catch { /* palette not ready — inline fallbacks already applied */ }
  }

  // ── Input (any confirm enters) ────────────────────────────────────────────

  _onKey(e) {
    // Any of the "go" keys, plus arrows, count as "let me in" on a title card.
    if (['Enter', 'NumpadEnter', 'Space', 'KeyZ', 'KeyK', 'KeyX'].includes(e.code)) {
      this._confirm(); e.preventDefault();
    }
  }

  _onClick() { this._confirm(); }

  /** Forwarded each frame by TitleState so pad/keys can enter once the loop runs. */
  handleInput(input) {
    if (!input) return;
    if (input.pressed?.(ACTIONS.CONFIRM) || input.pressed?.(ACTIONS.JUMP) || input.pressed?.(ACTIONS.ATTACK)) {
      this._confirm();
    }
  }

  _confirm() {
    if (this._confirmed) return;   // one-shot: the door is only opened once
    this._confirmed = true;
    this.hide();
    this._onStart?.();
  }

  // ── Visibility / teardown ─────────────────────────────────────────────────

  show() { if (this.root) this.root.style.display = ''; }
  hide() { if (this.root) this.root.style.display = 'none'; }

  destroy() {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this._onKey);
    this.root?.removeEventListener('click', this._onClick);
    this.root?.parentNode?.removeChild(this.root);
    this.root = null;
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  _css() {
    return `
      .pili-title {
        position: absolute; inset: 0; z-index: 6; overflow: hidden;
        --pili-crimson: ${this.crimson};
        --pili-magenta: ${this.magenta};
        display: grid; place-items: center;
        font-family: system-ui, sans-serif; color: #ffdfe4;
        background:
          radial-gradient(75% 65% at 50% 26%, rgba(66, 2, 16, .96), rgba(4, 1, 9, .99)),
          #04010a;
        user-select: none; -webkit-tap-highlight-color: transparent;
      }
      /* Perspective floor grid, receding into the dark — the club underground. */
      .pili-title__grid {
        position: absolute; left: 50%; bottom: -8%; width: 240%; height: 62%;
        transform: translateX(-50%) perspective(420px) rotateX(64deg);
        background-image:
          linear-gradient(rgba(255, 43, 72, .28) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 43, 72, .18) 1px, transparent 1px);
        background-size: 44px 44px;
        mask-image: linear-gradient(to top, #000 8%, transparent 72%);
        -webkit-mask-image: linear-gradient(to top, #000 8%, transparent 72%);
        animation: pili-grid 5.5s linear infinite; opacity: .55;
      }
      @keyframes pili-grid { from { background-position: 0 0, 0 0; } to { background-position: 0 44px, 0 0; } }
      /* A huge, faint skull watermark presiding over the room. */
      .pili-title__skull {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -54%);
        font-size: min(78vh, 620px); line-height: 1; color: rgba(255, 43, 72, .05);
        text-shadow: 0 0 60px rgba(255, 43, 72, .12); pointer-events: none;
      }
      .pili-title__inner {
        position: relative; z-index: 2; width: min(92vw, 760px);
        text-align: center; padding: 24px;
      }
      .pili-title__eyebrow {
        font-size: 12px; letter-spacing: .5em; text-transform: uppercase;
        color: var(--pili-crimson); text-shadow: 0 0 12px var(--pili-crimson);
        margin-bottom: 14px; opacity: .9;
      }
      .pili-title__logo {
        margin: 0; font-weight: 900; font-size: clamp(44px, 11vw, 128px);
        letter-spacing: .06em; color: #fff; line-height: .96;
        text-shadow:
          0 0 14px var(--pili-crimson), 0 0 40px var(--pili-magenta),
          0 0 90px var(--pili-crimson), 0 0 160px var(--pili-magenta);
        animation: pili-flicker 4.8s linear infinite;
      }
      /* Neon flicker — irregular dips, like a tired tube fighting to stay lit. */
      @keyframes pili-flicker {
        0%, 100% { opacity: 1; }
        6% { opacity: .84; } 7% { opacity: 1; }
        43% { opacity: 1; } 44% { opacity: .62; } 45% { opacity: 1; }
        67% { opacity: .9; } 68% { opacity: 1; }
        88% { opacity: 1; } 89% { opacity: .5; } 90.5% { opacity: 1; }
      }
      .pili-title__chili { font-size: 30px; margin: 8px 0 2px; filter: drop-shadow(0 0 14px var(--pili-crimson)); }
      .pili-title__tag {
        max-width: 30em; margin: 10px auto 22px; font-size: 15px; line-height: 1.65;
        color: #ffb9c4;
      }
      .pili-title__best {
        display: inline-flex; flex-wrap: wrap; gap: 10px; align-items: baseline; justify-content: center;
        font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: #ff9fb0;
        padding: 9px 18px; margin-bottom: 26px; border-radius: 999px;
        background: rgba(24, 3, 11, .6); border: 1px solid rgba(255, 43, 72, .28);
      }
      .pili-title__best b { color: #fff; text-shadow: 0 0 10px var(--pili-crimson); font-size: 13px; }
      .pili-title__best-sep { color: rgba(255, 43, 72, .5); }
      .pili-title__best--fresh { color: var(--pili-magenta); }
      .pili-title__cta {
        pointer-events: auto; cursor: pointer; display: inline-block;
        padding: 16px 46px; font: inherit; font-weight: 800; font-size: 17px;
        letter-spacing: .3em; text-transform: uppercase; color: #fff;
        background: linear-gradient(180deg, var(--pili-crimson), #a80019);
        border: none; border-radius: 12px;
        box-shadow: 0 0 26px rgba(255, 43, 72, .6), 0 8px 26px rgba(0, 0, 0, .55);
        transition: transform .12s ease, box-shadow .12s ease;
        animation: pili-breathe 2.6s ease-in-out infinite;
      }
      .pili-title__cta:hover { transform: translateY(-2px); box-shadow: 0 0 40px rgba(255, 43, 72, .9); }
      .pili-title__cta:active { transform: translateY(0); }
      @keyframes pili-breathe {
        0%, 100% { box-shadow: 0 0 22px rgba(255, 43, 72, .5), 0 8px 26px rgba(0, 0, 0, .55); }
        50% { box-shadow: 0 0 40px rgba(255, 43, 72, .95), 0 8px 26px rgba(0, 0, 0, .55); }
      }
      .pili-title__prompt {
        margin-top: 16px; font-size: 12px; letter-spacing: .24em; text-transform: uppercase;
        color: #c98795; animation: pili-blink 1.5s steps(1, end) infinite;
      }
      .pili-title__prompt b { color: #fff; }
      @keyframes pili-blink { 0%, 60% { opacity: 1; } 61%, 100% { opacity: .35; } }
      .pili-title__legend {
        display: flex; flex-wrap: wrap; gap: 8px 20px; justify-content: center;
        margin-top: 30px; font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
        color: #9a6470;
      }
      .pili-title__key { display: inline-flex; align-items: center; gap: 7px; }
      .pili-title__key kbd {
        display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px;
        font: 600 11px/1 system-ui, sans-serif; color: #ffd9df;
        background: rgba(30, 4, 14, .9); border: 1px solid rgba(255, 43, 72, .4);
        border-radius: 5px; box-shadow: inset 0 -2px 0 rgba(0, 0, 0, .5), 0 0 8px rgba(255, 43, 72, .25);
      }
      @media (prefers-reduced-motion: reduce) {
        .pili-title__grid, .pili-title__logo, .pili-title__cta, .pili-title__prompt { animation: none; }
      }
    `;
  }
}
