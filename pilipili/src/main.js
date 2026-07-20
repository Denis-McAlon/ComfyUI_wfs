import { Game } from './core/Game.js';

/**
 * main.js — bootstrap. Wait for the DOM, spin up the Game (which awaits the
 * Rapier WASM, the WebGL context and audio), then start the loop. Any init
 * failure is surfaced on the boot splash rather than dying silently.
 */
async function boot() {
  const canvas = document.getElementById('game');
  const splash = document.getElementById('boot');
  try {
    const game = new Game(canvas);
    await game.init();
    splash?.remove();
    game.start();
    // Expose for live tuning from the console: `__game.ctx.player.charge = 20`.
    window.__game = game;
  } catch (err) {
    console.error('[PiliPili] boot failed:', err);
    if (splash) splash.textContent = 'Erreur de démarrage — voir la console.';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
