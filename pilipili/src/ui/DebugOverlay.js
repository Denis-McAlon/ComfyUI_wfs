/**
 * DebugOverlay.js — a live game-feel readout for tuning the jump BY FEEL.
 *
 * Toggle with F1. It polls window.__game every frame (zero coupling to the rest
 * of the engine — instantiate it once and forget it) and shows the numbers a
 * designer actually tunes against: current velocity/state, and — crucially — the
 * MEASURED apex height and air-time of the last jump. Change a value in
 * Constants.js, jump, and watch the arc respond. This is the bridge between the
 * headless bench (tools/jump-measure.mjs) and tuning with a controller in hand.
 */
export class DebugOverlay {
  constructor() {
    this.visible = false;
    this.el = document.createElement('div');
    this.el.id = 'jump-debug';
    this.el.style.cssText = [
      'position:fixed', 'top:10px', 'right:10px', 'z-index:9999',
      'font:12px/1.5 ui-monospace,Menlo,Consolas,monospace',
      'color:#ff7a8a', 'background:rgba(10,1,6,0.82)',
      'border:1px solid rgba(255,32,72,0.4)', 'border-radius:8px',
      'padding:10px 12px', 'pointer-events:none', 'white-space:pre',
      'text-shadow:0 0 8px rgba(255,16,48,0.6)', 'display:none',
      'min-width:210px', 'backdrop-filter:blur(2px)',
    ].join(';');
    document.body.appendChild(this.el);

    this._onKey = (e) => { if (e.key === 'F1' || e.code === 'F1') { e.preventDefault(); this.toggle(); } };
    window.addEventListener('keydown', this._onKey);

    this._raf = this._tick.bind(this);
    requestAnimationFrame(this._raf);
  }

  toggle() { this.visible = !this.visible; this.el.style.display = this.visible ? 'block' : 'none'; }

  _tick() {
    const p = window.__game?.ctx?.player;
    if (p && this.visible) this._render(p);
    requestAnimationFrame(this._raf);
  }

  _render(p) {
    const f2 = (n) => (n ?? 0).toFixed(2);
    // apex/air are measured in the fixed sim (Player telemetry), so the readout is
    // identical on a 30 Hz or 144 Hz display — trustworthy for tuning by feel.
    this.el.textContent =
      `── JUMP DEBUG (F1) ──\n` +
      `state    : ${p.state}\n` +
      `grounded : ${p.grounded}\n` +
      `vx / vy  : ${f2(p.vx)} / ${f2(p.vy)}\n` +
      `last jump: apex ${f2(p.lastJumpApex)}u  air ${f2(p.lastJumpAir)}s\n` +
      `size     : x${f2(p.scale)}  tier ${p.tier}\n` +
      `weightT  : ${f2(p.weightT)}  traction ${f2(p.tractionMultiplier)}\n` +
      `maxSpeed : ${f2(p.stats?.maxSpeed)}  reach ${f2(p.stats?.attackRange * p.scale)}\n` +
      `health   : ${p.health}   facing ${p.facing > 0 ? '→' : '←'}\n` +
      `pos      : ${f2(p.x)}, ${f2(p.y)}`;
  }

  destroy() {
    window.removeEventListener('keydown', this._onKey);
    this.el.remove();
  }
}
