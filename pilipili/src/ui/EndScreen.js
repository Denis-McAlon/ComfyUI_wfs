import { formatTime } from '../core/SaveSystem.js';

/**
 * EndScreen.js — the victory / game-over overlay.
 *
 * A DOM overlay shown by EndState after the boss falls (win) or the last life is
 * lost (lose). It themes itself to the outcome (searing white-gold for a win,
 * deep crimson for a loss), shows a flavour line, the run's time and growth tier
 * with any new records, and offers one button back to character select. Dumb +
 * self-contained, like the other UI overlays; it calls back, never touches gameplay.
 */
const COPY = {
  win: {
    title: 'VICTOIRE',
    line: 'Tu as fait tomber le DJ Skull. Le PiliPili est à toi.',
    accent: '#ffd76a', glow: '#ff6a3d', button: 'Rejouer',
  },
  lose: {
    title: 'GAME OVER',
    line: 'La nuit a eu raison de toi. Encore un verre ?',
    accent: '#ff4864', glow: '#ff1030', button: 'Réessayer',
  },
};

export class EndScreen {
  constructor(ctx, { outcome = 'lose', tier = 0, timeMs = 0, records = {}, best = {}, onContinue } = {}) {
    this.ctx = ctx;
    this.onContinue = onContinue;
    const c = COPY[outcome] || COPY.lose;

    this.root = document.createElement('div');
    this.root.id = 'end-screen';
    this.root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:5200', 'display:flex',
      'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:20px',
      `background:radial-gradient(70% 70% at 50% 42%, rgba(20,2,8,0.86), rgba(5,1,10,0.96))`,
      'backdrop-filter:blur(3px)', 'font-family:system-ui,sans-serif', 'color:#ffd9df',
      'letter-spacing:0.14em', 'text-align:center', 'padding:24px',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = c.title;
    title.style.cssText = `font:800 58px/1 system-ui,sans-serif; letter-spacing:0.32em; color:${c.accent}; text-shadow:0 0 30px ${c.glow},0 0 70px ${c.glow};`;
    this.root.appendChild(title);

    const line = document.createElement('div');
    line.textContent = c.line;
    line.style.cssText = 'max-width:520px; font:500 15px/1.6 system-ui,sans-serif; color:#ffb9c4;';
    this.root.appendChild(line);

    // Stats block: run time (wins only) + growth tier, each with a best + record badge.
    const stats = document.createElement('div');
    stats.style.cssText = 'display:flex; flex-direction:column; gap:7px; margin-top:6px; font:600 13px/1.1 system-ui,sans-serif; letter-spacing:0.16em; color:#ff9fb0;';
    const badge = (on) => on ? `  <span style="color:${c.accent};text-shadow:0 0 12px ${c.glow}">NOUVEAU RECORD !</span>` : '';
    if (outcome === 'win') {
      stats.innerHTML += `<div>TEMPS  ${formatTime(timeMs)}${badge(records.newBestTime)}</div>`;
      stats.innerHTML += `<div style="color:#7a5b64">Meilleur temps  ${formatTime(best.timeMs)}</div>`;
    }
    stats.innerHTML += `<div>TAILLE MAX  ·  Tier ${tier}${badge(records.newBestTier)}</div>`;
    stats.innerHTML += `<div style="color:#7a5b64">Meilleur tier  ${best.tier ?? 0}</div>`;
    this.root.appendChild(stats);

    this.btn = document.createElement('button');
    this.btn.textContent = c.button;
    this.btn.dataset.key = 'continue';
    this.btn.style.cssText = [
      'margin-top:16px', 'min-width:240px', 'padding:15px 30px',
      'font:700 17px/1 system-ui,sans-serif', 'letter-spacing:0.18em', 'text-transform:uppercase',
      'cursor:pointer', 'color:#fff', `background:${hexA(c.glow, 0.16)}`,
      `border:1px solid ${hexA(c.accent, 0.6)}`, 'border-radius:11px',
      `box-shadow:0 0 26px ${hexA(c.glow, 0.5)}`, 'transition:transform .12s',
    ].join(';');
    this.btn.addEventListener('mouseenter', () => { this.btn.style.transform = 'scale(1.05)'; });
    this.btn.addEventListener('mouseleave', () => { this.btn.style.transform = 'scale(1)'; });
    this.btn.addEventListener('click', () => this.onContinue?.());
    this.root.appendChild(this.btn);

    this._onKey = (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && this.root.isConnected) { this.onContinue?.(); e.preventDefault(); }
    };
    window.addEventListener('keydown', this._onKey);
    (document.getElementById('ui') || document.body).appendChild(this.root);
  }

  destroy() { window.removeEventListener('keydown', this._onKey); this.root.remove(); }
}

/** #rrggbb + alpha → rgba() string (small helper, avoids a CSS var dependency). */
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
