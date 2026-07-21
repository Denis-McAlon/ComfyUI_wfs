import { PALETTE, cssVars } from '../config/Palette.js';
import { PLAYER, EVENT, clamp } from '../config/Constants.js';

/**
 * HUD.js — the in-play heads-up display.
 *
 * A DOM overlay (mounted into #ui) rather than in-scene geometry: crisp text at any
 * resolution, trivial to style, and it never competes with the neon render budget.
 * The visual language matches the venue — crimson glow, wide letter-spacing, near-
 * black panels.
 *
 * PERFORMANCE DOCTRINE: the scene calls setHealth/setGrowth/setBoss EVERY fixed step
 * (see GameplayScene.fixedUpdate). So every setter is CHANGE-GATED — it caches the
 * last value it wrote and touches the DOM only when the number actually moves. A
 * steady state costs a few float comparisons per frame and zero layout.
 *
 * Palette is read from config/Palette.js when available and falls back to inline
 * crimson, so a shape mismatch (that file is authored in parallel) can't crash us.
 */

/** Convert a palette value (hex number OR css string) to a css colour, else fallback. */
function toCss(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return '#' + ((v >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  }
  if (typeof v === 'string' && v) return v;
  return fallback;
}

export class HUD {
  constructor(ctx) {
    this.ctx = ctx;

    // Resolve theme colours defensively from the shared palette.
    this.crimson = toCss(PALETTE?.crimson, '#ff2b48');
    this.magenta = toCss(PALETTE?.magenta, '#ff2b6b');
    this.ink = toCss(PALETTE?.ink ?? PALETTE?.bg, '#0a0208');

    // Cached last-written values (null == "force first write").
    this._hp = null; this._hpMax = null; this._filled = null;
    this._charge = null; this._tier = null;
    this._bossHp = null; this._bossShown = false;

    this.hearts = [];
    this._build();
  }

  // ── Construction ──────────────────────────────────────────────────────────

  _build() {
    const mount = typeof document !== 'undefined' ? document.getElementById('ui') : null;
    this.root = document.createElement('div');
    this.root.className = 'pili-hud';
    // The HUD is display-only; never let it intercept pointer input.
    this.root.style.pointerEvents = 'none';

    this.root.innerHTML = `
      <style>${this._css()}</style>
      <div class="pili-hud__boss" data-boss hidden>
        <div class="pili-hud__boss-label">DJ SKULL <span class="pili-hud__boss-phase" data-boss-phase>· PHASE 1/3</span></div>
        <div class="pili-hud__boss-track"><div class="pili-hud__boss-fill" data-boss-fill></div></div>
      </div>
      <div class="pili-hud__corner">
        <div class="pili-hud__hearts" data-hearts></div>
        <div class="pili-hud__growth">
          <div class="pili-hud__growth-head">
            <span class="pili-hud__growth-title">TAILLE</span>
            <span class="pili-hud__tier" data-tier>Palier 0</span>
          </div>
          <div class="pili-hud__growth-track"><div class="pili-hud__growth-fill" data-growth-fill></div></div>
        </div>
      </div>
    `;

    // Apply palette CSS variables if the palette exposes a cssVars() map.
    this._applyPaletteVars();

    // Cache element references.
    this.elHearts = this.root.querySelector('[data-hearts]');
    this.elTier = this.root.querySelector('[data-tier]');
    this.elGrowthFill = this.root.querySelector('[data-growth-fill]');
    this.elBoss = this.root.querySelector('[data-boss]');
    this.elBossFill = this.root.querySelector('[data-boss-fill]');
    this.elBossPhase = this.root.querySelector('[data-boss-phase]');

    // The boss announces phase changes on the bus; reflect them in the label.
    this._offBossPhase = this.ctx?.bus?.on?.(EVENT.BOSS_PHASE, ({ phase } = {}) => {
      if (this.elBossPhase && phase) this.elBossPhase.textContent = `· PHASE ${phase}/3`;
    });

    // Seed the health row at the base max so the first frame has hearts to toggle.
    this.setHealth(PLAYER?.MAX_HEALTH ?? 5, PLAYER?.MAX_HEALTH ?? 5);

    mount?.appendChild(this.root);
  }

  /** Best-effort: fold a palette cssVars() map onto the root as CSS custom props. */
  _applyPaletteVars() {
    try {
      const vars = typeof cssVars === 'function' ? cssVars() : null;
      if (vars && typeof vars === 'object') {
        for (const [k, v] of Object.entries(vars)) {
          const name = k.startsWith('--') ? k : `--${k}`;
          this.root.style.setProperty(name, String(v));
        }
      }
    } catch { /* palette not ready / odd shape — inline fallbacks already applied */ }
  }

  // ── Setters (all change-gated) ────────────────────────────────────────────

  /** Health as a row of hearts. Rebuilds the row only when `max` changes. */
  setHealth(hp, max = PLAYER?.MAX_HEALTH ?? 5) {
    if (max !== this._hpMax) {
      this._hpMax = max;
      this._buildHearts(max);
      this._filled = null; // force a re-fill after a rebuild
    }
    // Engine floors fractional (glass DoT) health for the discrete pip display.
    const filled = clamp(Math.floor(hp + 1e-6), 0, max);
    if (filled === this._filled) return;
    this._filled = filled;
    for (let i = 0; i < this.hearts.length; i++) {
      this.hearts[i].classList.toggle('is-on', i < filled);
    }
  }

  /** Growth meter (0..1 of the charge range) plus the current tier readout. */
  setGrowth(charge, tier, max) {
    const m = max || 1;
    if (charge !== this._charge) {
      this._charge = charge;
      const pct = clamp(charge / m, 0, 1) * 100;
      if (this.elGrowthFill) this.elGrowthFill.style.width = `${pct.toFixed(1)}%`;
    }
    if (tier !== this._tier) {
      this._tier = tier;
      if (this.elTier) this.elTier.textContent = `Palier ${tier ?? 0}`;
    }
  }

  /** Show/hide the boss health bar at the top of the screen. */
  showBoss(on) {
    const want = !!on;
    if (want === this._bossShown) return;
    this._bossShown = want;
    if (this.elBoss) this.elBoss.hidden = !want;
    if (want && this.elBossPhase) this.elBossPhase.textContent = '· PHASE 1/3'; // fresh fight
  }

  /** Boss health as a right-to-left depleting bar. Change-gated on the fraction. */
  setBoss(hp, max = 100) {
    const frac = clamp(hp / (max || 1), 0, 1);
    if (frac === this._bossHp) return;
    this._bossHp = frac;
    if (this.elBossFill) this.elBossFill.style.width = `${(frac * 100).toFixed(1)}%`;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  _buildHearts(max) {
    this.hearts.length = 0;
    if (!this.elHearts) return;
    this.elHearts.textContent = '';
    for (let i = 0; i < max; i++) {
      const h = document.createElement('span');
      h.className = 'pili-hud__heart';
      h.textContent = '♥'; // ♥
      this.elHearts.appendChild(h);
      this.hearts.push(h);
    }
  }

  _css() {
    // Fallback-first custom properties; a palette cssVars() map may override them.
    return `
      .pili-hud {
        position: absolute; inset: 0; pointer-events: none;
        --pili-crimson: ${this.crimson};
        --pili-magenta: ${this.magenta};
        --pili-ink: ${this.ink};
        font-family: system-ui, sans-serif;
        color: var(--pili-crimson);
      }
      .pili-hud__corner {
        position: absolute; top: 18px; left: 20px;
        display: flex; flex-direction: column; gap: 12px;
      }
      .pili-hud__hearts { display: flex; gap: 6px; font-size: 26px; line-height: 1; }
      .pili-hud__heart {
        color: #37070f; text-shadow: none; transition: color .12s ease, text-shadow .12s ease;
      }
      .pili-hud__heart.is-on {
        color: var(--pili-crimson);
        text-shadow: 0 0 10px var(--pili-crimson), 0 0 22px var(--pili-magenta);
      }
      .pili-hud__growth { width: 190px; }
      .pili-hud__growth-head {
        display: flex; justify-content: space-between; align-items: baseline;
        font-size: 10px; letter-spacing: .28em; text-transform: uppercase;
        margin-bottom: 5px; opacity: .92;
      }
      .pili-hud__tier { color: var(--pili-magenta); text-shadow: 0 0 10px var(--pili-magenta); }
      .pili-hud__growth-track, .pili-hud__boss-track {
        position: relative; height: 9px; border-radius: 6px;
        background: rgba(20, 3, 9, .72);
        border: 1px solid rgba(255, 43, 72, .35);
        box-shadow: inset 0 0 10px rgba(0, 0, 0, .8);
        overflow: hidden;
      }
      .pili-hud__growth-fill {
        height: 100%; width: 0%;
        background: linear-gradient(90deg, var(--pili-crimson), var(--pili-magenta));
        box-shadow: 0 0 14px var(--pili-crimson);
        transition: width .12s ease;
      }
      .pili-hud__boss {
        position: absolute; top: 22px; left: 50%; transform: translateX(-50%);
        width: min(62vw, 720px); text-align: center;
      }
      .pili-hud__boss[hidden] { display: none; }
      .pili-hud__boss-label {
        font-size: 12px; letter-spacing: .42em; text-transform: uppercase;
        margin-bottom: 6px; color: #fff;
        text-shadow: 0 0 12px var(--pili-crimson), 0 0 26px var(--pili-magenta);
      }
      .pili-hud__boss-track { height: 13px; border-radius: 7px; }
      .pili-hud__boss-fill {
        height: 100%; width: 100%; margin-left: auto;
        background: linear-gradient(90deg, #7a0012, var(--pili-crimson) 55%, #fff);
        box-shadow: 0 0 16px var(--pili-crimson);
        transition: width .18s ease;
      }
    `;
  }

  destroy() {
    this._offBossPhase?.();
    this.root?.parentNode?.removeChild(this.root);
    this.root = null;
    this.hearts.length = 0;
  }
}
