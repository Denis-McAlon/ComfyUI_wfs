import { PALETTE } from '../config/Palette.js';

/**
 * LevelBanner.js — the level-title drop shown as a scene begins.
 *
 * A transient, self-destructing DOM overlay: it slides the level's name in over
 * the crimson dark, holds for a beat, then fades and removes itself. Purely a
 * flourish — pointer-events: none, it never touches input or the sim. The gameplay
 * scene fires one on enter (once the level name is known) and forgets about it; the
 * banner cleans up after itself on animationend, with a timer fallback.
 */

function toCss(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return '#' + ((v >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  }
  if (typeof v === 'string' && v) return v;
  return fallback;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export class LevelBanner {
  /** @param {{ name?: string, index?: number|null, kicker?: string }} opts */
  constructor(ctx, { name = '', index = null, kicker = null } = {}) {
    if (!name || typeof document === 'undefined') { this.root = null; return; }
    this.crimson = toCss(PALETTE?.crimson, '#ff2b48');
    this.magenta = toCss(PALETTE?.magenta, '#ff2b6b');
    this._onEnd = this._onEnd.bind(this);

    const mount = document.getElementById('ui') || document.body;
    this.root = document.createElement('div');
    this.root.className = 'pili-banner';
    const eyebrow = kicker ?? (index != null ? `Niveau ${index}` : 'Le PiliPili');
    this.root.innerHTML = `
      <style>${this._css()}</style>
      <div class="pili-banner__inner">
        <div class="pili-banner__kicker">${esc(eyebrow)}</div>
        <div class="pili-banner__name">${esc(name)}</div>
        <div class="pili-banner__rule"></div>
      </div>
    `;
    this.root.addEventListener('animationend', this._onEnd);
    mount.appendChild(this.root);
    // Belt-and-braces cleanup if animationend is throttled/missed.
    if (typeof setTimeout === 'function') this._timer = setTimeout(() => this.destroy(), 3200);
  }

  _onEnd(e) {
    // The inner block runs the longest (hold + fade); remove once it finishes.
    if (e.animationName === 'pili-banner-out') this.destroy();
  }

  destroy() {
    if (this._timer) { clearTimeout(this._timer); this._timer = 0; }
    this.root?.removeEventListener('animationend', this._onEnd);
    this.root?.parentNode?.removeChild(this.root);
    this.root = null;
  }

  _css() {
    return `
      .pili-banner {
        position: absolute; inset: 0; z-index: 55; pointer-events: none;
        display: grid; place-items: center;
        --pili-crimson: ${this.crimson}; --pili-magenta: ${this.magenta};
        font-family: system-ui, sans-serif;
      }
      .pili-banner__inner {
        text-align: center; transform: translateY(8px);
        animation: pili-banner-out 2.8s ease forwards;
      }
      @keyframes pili-banner-out {
        0% { opacity: 0; transform: translateY(16px); }
        14% { opacity: 1; transform: translateY(0); }
        72% { opacity: 1; transform: translateY(0); }
        100% { opacity: 0; transform: translateY(-10px); }
      }
      .pili-banner__kicker {
        font-size: 12px; letter-spacing: .5em; text-transform: uppercase;
        color: var(--pili-crimson); text-shadow: 0 0 12px var(--pili-crimson);
        margin-bottom: 8px;
      }
      .pili-banner__name {
        font-size: clamp(32px, 6vw, 66px); font-weight: 900; letter-spacing: .08em;
        color: #fff; text-shadow: 0 0 16px var(--pili-crimson), 0 0 44px var(--pili-magenta);
      }
      .pili-banner__rule {
        width: 0; height: 2px; margin: 14px auto 0;
        background: linear-gradient(90deg, transparent, var(--pili-crimson), var(--pili-magenta), transparent);
        box-shadow: 0 0 14px var(--pili-crimson);
        animation: pili-banner-rule 2.8s ease forwards;
      }
      @keyframes pili-banner-rule {
        0%, 14% { width: 0; opacity: 0; }
        34% { width: min(60vw, 340px); opacity: 1; }
        72% { width: min(60vw, 340px); opacity: 1; }
        100% { width: min(60vw, 340px); opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .pili-banner__inner { animation: pili-banner-fade 2.4s ease forwards; transform: none; }
        .pili-banner__rule { animation: none; width: min(60vw, 340px); opacity: .5; }
        @keyframes pili-banner-fade { 0% { opacity: 0; } 14%, 72% { opacity: 1; } 100% { opacity: 0; } }
      }
    `;
  }
}
