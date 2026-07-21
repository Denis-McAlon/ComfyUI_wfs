/**
 * PauseMenu.js — the in-game pause overlay.
 *
 * A DOM overlay (the game keeps rendering a FROZEN frame behind it — see Game's
 * paused branch) with Resume / Restart / Quit and a live volume slider. It is
 * dumb: it renders and calls back. Game owns the paused state and the audio; this
 * file never touches gameplay. Mouse-clickable and keyboard-navigable (↑/↓/Enter;
 * Escape is handled by Game so it toggles pause from either side).
 */
const CRIMSON = '#ff2b48';
const ITEMS = [
  { key: 'resume', label: 'Reprendre' },
  { key: 'restart', label: 'Recommencer le niveau' },
  { key: 'quit', label: 'Retour au menu' },
];

export class PauseMenu {
  constructor(ctx, callbacks = {}) {
    this.ctx = ctx;
    this.cb = callbacks;
    this._sel = 0;

    this.root = document.createElement('div');
    this.root.id = 'pause-menu';
    this.root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:5000', 'display:none',
      'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:22px',
      'background:radial-gradient(60% 60% at 50% 45%, rgba(26,2,8,0.82), rgba(5,1,10,0.92))',
      'backdrop-filter:blur(3px)', 'font-family:system-ui,sans-serif', 'color:#ffd9df',
      'letter-spacing:0.12em',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'PAUSE';
    title.style.cssText = `font:800 46px/1 system-ui,sans-serif; letter-spacing:0.35em; color:#fff; text-shadow:0 0 26px ${CRIMSON},0 0 60px #ff1030;`;
    this.root.appendChild(title);

    // Menu buttons.
    this._btns = ITEMS.map((it, i) => {
      const b = document.createElement('button');
      b.textContent = it.label;
      b.dataset.key = it.key;
      b.style.cssText = [
        'min-width:280px', 'padding:14px 26px', 'font:600 17px/1 system-ui,sans-serif',
        'letter-spacing:0.14em', 'text-transform:uppercase', 'cursor:pointer',
        'color:#ffd9df', 'background:rgba(255,16,48,0.08)',
        `border:1px solid rgba(255,43,72,0.5)`, 'border-radius:10px', 'transition:all .12s',
      ].join(';');
      b.addEventListener('mouseenter', () => { this._sel = i; this._paint(); });
      b.addEventListener('click', () => this._activate(i));
      this.root.appendChild(b);
      return b;
    });

    // Volume slider.
    const vol = document.createElement('label');
    vol.style.cssText = 'display:flex; align-items:center; gap:12px; margin-top:10px; font:600 12px/1 system-ui,sans-serif; letter-spacing:0.18em; color:#ff9fb0;';
    const initial = Math.round(((this.ctx?.audio?._volume) ?? 0.9) * 100);
    vol.innerHTML = `VOLUME <input id="pause-vol" type="range" min="0" max="100" value="${initial}" style="accent-color:${CRIMSON}; width:180px;">`;
    this.root.appendChild(vol);
    vol.querySelector('#pause-vol').addEventListener('input', (e) => this.cb.onVolume?.(Number(e.target.value) / 100));

    const hint = document.createElement('div');
    hint.textContent = '↑ ↓  Entrée  ·  Échap pour reprendre';
    hint.style.cssText = 'margin-top:8px; font:500 11px/1 system-ui,sans-serif; letter-spacing:0.16em; color:#7a4b54;';
    this.root.appendChild(hint);

    (document.getElementById('ui') || document.body).appendChild(this.root);

    this._onKey = (e) => {
      if (this.root.style.display === 'none') return;
      if (e.key === 'ArrowDown') { this._sel = (this._sel + 1) % this._btns.length; this._paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { this._sel = (this._sel - 1 + this._btns.length) % this._btns.length; this._paint(); e.preventDefault(); }
      else if (e.key === 'Enter' || e.key === ' ') { this._activate(this._sel); e.preventDefault(); }
    };
    window.addEventListener('keydown', this._onKey);
    this._paint();
  }

  _activate(i) {
    const key = ITEMS[i].key;
    if (key === 'resume') this.cb.onResume?.();
    else if (key === 'restart') this.cb.onRestart?.();
    else if (key === 'quit') this.cb.onQuit?.();
  }

  _paint() {
    this._btns.forEach((b, i) => {
      const on = i === this._sel;
      b.style.background = on ? 'rgba(255,16,48,0.28)' : 'rgba(255,16,48,0.08)';
      b.style.boxShadow = on ? `0 0 22px rgba(255,43,72,0.55)` : 'none';
      b.style.transform = on ? 'scale(1.04)' : 'scale(1)';
      b.style.color = on ? '#fff' : '#ffd9df';
    });
  }

  show() { this._sel = 0; this._paint(); this.root.style.display = 'flex'; }
  hide() { this.root.style.display = 'none'; }
  destroy() { window.removeEventListener('keydown', this._onKey); this.root.remove(); }
}
