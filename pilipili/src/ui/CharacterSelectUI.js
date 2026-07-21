import { CHARACTERS } from '../config/Characters.js';
import { PALETTE, cssVars } from '../config/Palette.js';
import { ACTIONS } from '../config/Constants.js';

/**
 * CharacterSelectUI.js — "LE PILIPILI" roster screen.
 *
 * A full-screen DOM menu (into #ui) presenting the two heroes as neon cards with
 * their French flavour text, over the club's dark-crimson mood. It is fully self-
 * contained: it listens to the DOM for mouse + keyboard on its own, AND exposes
 * handleInput() so the shared InputManager (keyboard + gamepad) can drive it once
 * the game loop is running. Every navigation path funnels through _move()/_confirm(),
 * which are debounced and one-shot guarded, so double-delivery of a single press
 * (DOM keydown AND InputManager edge for the same key) collapses to one action.
 *
 * Defensive by contract: CHARACTERS and PALETTE are authored in parallel, so every
 * field is read with optional chaining and sensible French/crimson fallbacks — a
 * missing key degrades the visuals, it never throws.
 */

/** Convert a palette/character colour (hex number OR css string) to css, else fallback. */
function toCss(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return '#' + ((v >>> 0) & 0xffffff).toString(16).padStart(6, '0');
  }
  if (typeof v === 'string' && v) return v;
  return fallback;
}

/** Minimal HTML escape for any character-supplied strings we interpolate. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

/** Debounce window (ms) so held keys / duplicated events don't oscillate selection. */
const NAV_COOLDOWN_MS = 140;

export class CharacterSelectUI {
  constructor(ctx, { onConfirm } = {}) {
    this.ctx = ctx;
    this._onConfirm = onConfirm;
    this.index = 0;
    this._navLock = 0;
    this._confirmed = false;
    // Forwarded-input confirm is gated until a fresh press: a CONFIRM edge left
    // latched by the previous screen (title → select) must not skip this menu.
    this._confirmArmed = false;

    // Theme colours (fallback-first).
    this.crimson = toCss(PALETTE?.crimson, '#ff2b48');
    this.magenta = toCss(PALETTE?.magenta, '#ff2b6b');

    // Build the roster defensively from the shared character table.
    this.heroes = ['male', 'female'].map((key, i) => {
      const c = (CHARACTERS && CHARACTERS[key]) || {};
      return {
        id: c.id || key,
        name: c.name || (i === 0 ? 'Le Videur' : 'La Barmaid'),
        description: c.description || 'Un pilier des nuits du PiliPili.',
        hair: toCss(c.hair, i === 0 ? '#181018' : '#2a0a16'),
        skin: toCss(c.skin, '#e2a487'),
        top: toCss(c.top, i === 0 ? '#ff2b48' : '#ff2b6b'),
        bottom: toCss(c.bottom, '#1c1020'),
        accent: toCss(c.accent, '#ffd36a'),
      };
    });

    this._onKey = this._onKey.bind(this);
    this._onClick = this._onClick.bind(this);
    this._build();
  }

  // ── Construction ──────────────────────────────────────────────────────────

  _build() {
    const mount = typeof document !== 'undefined' ? document.getElementById('ui') : null;
    this.root = document.createElement('div');
    this.root.className = 'pili-select';
    this.root.style.pointerEvents = 'auto';

    const cards = this.heroes.map((h, i) => this._cardHTML(h, i)).join('');
    this.root.innerHTML = `
      <style>${this._css()}</style>
      <div class="pili-select__glass">
        <h1 class="pili-select__title">LE PILIPILI</h1>
        <p class="pili-select__prompt">Choisis ton personnage</p>
        <div class="pili-select__cards" data-cards>${cards}</div>
        <button class="pili-select__play" data-play type="button">JOUER</button>
        <p class="pili-select__hint">← → pour choisir &nbsp;·&nbsp; Entrée / Espace pour valider</p>
      </div>
    `;

    this._applyPaletteVars();

    this.cardEls = Array.from(this.root.querySelectorAll('.pili-select__card'));
    this._highlight();

    // Self-wired DOM input (works the instant we mount, before the loop starts).
    this.root.addEventListener('click', this._onClick);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this._onKey);

    mount?.appendChild(this.root);
  }

  _cardHTML(hero, idx) {
    // A stylised neon "paper-doll" tinted by the hero's palette fields.
    return `
      <button class="pili-select__card" data-idx="${idx}" type="button">
        <div class="pili-select__avatar">
          <span class="av-glow"></span>
          <span class="av-hair"  style="background:${hero.hair}"></span>
          <span class="av-head"  style="background:${hero.skin}"></span>
          <span class="av-torso" style="background:${hero.top}"></span>
          <span class="av-belt"  style="background:${hero.accent}"></span>
          <span class="av-legs"  style="background:${hero.bottom}"></span>
        </div>
        <div class="pili-select__name">${esc(hero.name)}</div>
        <div class="pili-select__desc">${esc(hero.description)}</div>
      </button>
    `;
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

  // ── Input paths (all funnel through _move / _confirm) ─────────────────────

  /** DOM keyboard: arrows to move, Enter/Space to validate. */
  _onKey(e) {
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': this._move(-1); e.preventDefault(); break;
      case 'ArrowRight': case 'KeyD': this._move(1); e.preventDefault(); break;
      case 'Enter': case 'NumpadEnter': case 'Space': this._confirm(); e.preventDefault(); break;
      default: break;
    }
  }

  /** Mouse: click a card to select it (or re-click / press JOUER to validate). */
  _onClick(e) {
    if (e.target.closest('[data-play]')) { this._confirm(); return; }
    const card = e.target.closest('.pili-select__card');
    if (!card) return;
    const idx = Number(card.dataset.idx);
    if (idx === this.index) this._confirm();   // clicking the highlighted hero validates
    else this._select(idx);
  }

  /**
   * Optional: called every frame by CharacterSelectState with the shared input.
   * Edge-triggered, so held keys/pad buttons don't repeat; the _move debounce
   * absorbs any overlap with the DOM keydown for the same physical press.
   */
  handleInput(input) {
    if (!input) return;
    if (input.pressed?.(ACTIONS.LEFT)) this._move(-1);
    else if (input.pressed?.(ACTIONS.RIGHT)) this._move(1);
    const confirm = input.pressed?.(ACTIONS.CONFIRM) || input.pressed?.(ACTIONS.JUMP) || input.pressed?.(ACTIONS.ATTACK);
    // Arm on the first frame that reports NO confirm pressed, so a press inherited
    // from the title card can't validate a hero the instant this menu appears.
    if (!confirm) this._confirmArmed = true;
    else if (this._confirmArmed) this._confirm();
  }

  _move(dir) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this._navLock < NAV_COOLDOWN_MS) return; // debounce repeats / duplicates
    this._navLock = now;
    const n = this.heroes.length;
    this._select((this.index + dir + n) % n);
  }

  _select(idx) {
    this.index = idx;
    this._highlight();
  }

  _highlight() {
    for (let i = 0; i < this.cardEls.length; i++) {
      this.cardEls[i].classList.toggle('is-selected', i === this.index);
    }
  }

  _confirm() {
    if (this._confirmed) return;      // one-shot: a menu is only left once
    this._confirmed = true;
    const hero = this.heroes[this.index];
    this.hide();                      // instant visual feedback before the transition
    this._onConfirm?.(hero?.id ?? 'male');
  }

  // ── Visibility / teardown ─────────────────────────────────────────────────

  show() { if (this.root) this.root.style.display = ''; }
  hide() { if (this.root) this.root.style.display = 'none'; }

  destroy() {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this._onKey);
    this.root?.removeEventListener('click', this._onClick);
    this.root?.parentNode?.removeChild(this.root);
    this.root = null;
    this.cardEls = [];
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  _css() {
    return `
      .pili-select {
        position: absolute; inset: 0; z-index: 5;
        --pili-crimson: ${this.crimson};
        --pili-magenta: ${this.magenta};
        display: grid; place-items: center;
        font-family: system-ui, sans-serif; color: #ffdfe4;
        background:
          radial-gradient(70% 60% at 50% 30%, rgba(60, 2, 14, .95), rgba(5, 1, 10, .98)),
          #05010a;
        user-select: none; -webkit-tap-highlight-color: transparent;
      }
      .pili-select__glass { width: min(92vw, 860px); text-align: center; padding: 24px; }
      .pili-select__title {
        margin: 0 0 6px; font-size: clamp(34px, 7vw, 68px); font-weight: 800;
        letter-spacing: .16em; color: #fff;
        text-shadow: 0 0 16px var(--pili-crimson), 0 0 42px var(--pili-magenta), 0 0 80px var(--pili-crimson);
      }
      .pili-select__prompt {
        margin: 0 0 26px; font-size: 13px; letter-spacing: .42em; text-transform: uppercase;
        color: var(--pili-crimson); text-shadow: 0 0 12px var(--pili-crimson);
      }
      .pili-select__cards { display: flex; gap: clamp(16px, 4vw, 40px); justify-content: center; flex-wrap: wrap; }
      .pili-select__card {
        pointer-events: auto; cursor: pointer;
        width: clamp(200px, 34vw, 260px); padding: 20px 18px 22px;
        background: linear-gradient(180deg, rgba(28, 4, 14, .82), rgba(10, 2, 8, .9));
        border: 1px solid rgba(255, 43, 72, .28); border-radius: 16px;
        color: inherit; font: inherit; text-align: center;
        transition: transform .14s ease, border-color .14s ease, box-shadow .14s ease;
      }
      .pili-select__card:hover { border-color: rgba(255, 43, 108, .6); }
      .pili-select__card.is-selected {
        border-color: var(--pili-crimson);
        box-shadow: 0 0 0 1px var(--pili-crimson), 0 0 28px rgba(255, 43, 72, .55), inset 0 0 30px rgba(255, 43, 72, .12);
        transform: translateY(-4px);
      }
      .pili-select__avatar { position: relative; width: 120px; height: 168px; margin: 0 auto 14px; }
      .pili-select__avatar > span { position: absolute; left: 50%; transform: translateX(-50%); display: block; }
      .av-glow { inset: 0; left: 0; transform: none; border-radius: 50% / 42%;
        box-shadow: 0 0 46px 10px rgba(255, 43, 72, .22); }
      .av-hair  { top: 6px;  width: 56px; height: 36px; border-radius: 28px 28px 8px 8px; }
      .av-head  { top: 18px; width: 42px; height: 46px; border-radius: 21px; }
      .av-torso { top: 60px; width: 66px; height: 62px; border-radius: 24px 24px 12px 12px; }
      .av-belt  { top: 114px; width: 66px; height: 8px; border-radius: 3px; }
      .av-legs  { top: 122px; width: 54px; height: 44px; border-radius: 6px 6px 12px 12px; }
      .pili-select__name {
        font-size: 20px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
        margin-bottom: 8px; color: #fff; text-shadow: 0 0 12px var(--pili-crimson);
      }
      .pili-select__desc { font-size: 13px; line-height: 1.5; color: #e6b9c2; opacity: .92; min-height: 3.2em; }
      .pili-select__play {
        pointer-events: auto; cursor: pointer; margin-top: 30px;
        padding: 13px 44px; font: inherit; font-weight: 800; font-size: 16px;
        letter-spacing: .34em; text-transform: uppercase; color: #fff;
        background: linear-gradient(180deg, var(--pili-crimson), #b8001e);
        border: none; border-radius: 10px;
        box-shadow: 0 0 22px rgba(255, 43, 72, .6), 0 6px 20px rgba(0, 0, 0, .5);
        transition: transform .12s ease, box-shadow .12s ease;
      }
      .pili-select__play:hover { transform: translateY(-2px); box-shadow: 0 0 30px rgba(255, 43, 72, .8); }
      .pili-select__play:active { transform: translateY(0); }
      .pili-select__hint {
        margin-top: 18px; font-size: 11px; letter-spacing: .2em; text-transform: uppercase;
        color: #9a5a68; opacity: .8;
      }
    `;
  }
}
