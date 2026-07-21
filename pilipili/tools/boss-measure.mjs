/**
 * boss-measure.mjs — headless bench for the DJ Skull Booth fight's TIMING & fairness.
 *
 * The boss builds Three.js meshes, but those are CPU-only objects (no WebGL
 * context needed to construct geometries/materials), so with a stubbed renderer
 * we can run the real fight FSM + BeatClock in Node and measure what actually
 * matters for a rhythm boss:
 *   - the attack/expose CYCLE: how long the punish window is and how often it comes
 *   - REACTION budget: telegraph lead + shockwave travel time
 *   - TIME-TO-KILL at several arrival sizes (does growth matter? is it winnable?)
 *
 * Run from project root:  node tools/boss-measure.mjs
 */
import * as THREE from 'three';
import { EventBus } from '../src/core/EventBus.js';
import { DjSkullBoss } from '../src/entities/boss/DjSkullBoss.js';
import { BeatClock } from '../src/audio/BeatClock.js';
import { SIM, BOSS, PLAYER, EVENT } from '../src/config/Constants.js';

const DT = SIM.FIXED_DT;
const BEAT_SEC = 60 / BOSS.BPM;

function makeCtx(bus) {
  const scene = new THREE.Scene();
  const stub = new Proxy({}, { get: () => () => {} }); // absorbs any method call
  return {
    bus,
    renderer: { scene, lighting: { registerNeon: (m) => m }, postfx: stub, cameraRig: stub },
    player: { x: -7, y: 1 },
    clock: { fixedDt: DT },
    audio: { playMusic() {}, stopMusic() {} },
  };
}

/** Run the fight with a "perfect" player that hits every vulnerability window at
 *  the attack cadence. Returns TTK and structural facts. `tier` sets player damage. */
function runFight(tier, maxSeconds = 240) {
  const bus = new EventBus();
  const ctx = makeCtx(bus);
  const boss = new DjSkullBoss(ctx, { x: 0, y: 4 });
  const clock = new BeatClock(bus, BOSS.BPM);
  clock.start();

  let defeated = false, t = 0, hits = 0, atk = 0;
  const phases = new Set();
  const vulnWindows = [];
  let vulnStart = -1;
  const playerDmg = 2 + tier; // matches Player.attack: 2 + growth tier

  bus.on(EVENT.BOSS_DEFEATED, () => { defeated = true; });
  bus.on(EVENT.BOSS_PHASE, ({ phase }) => phases.add(phase));
  bus.on(EVENT.BOSS_VULNERABLE, ({ on }) => {
    if (on) vulnStart = t;
    else if (vulnStart >= 0) { vulnWindows.push(t - vulnStart); vulnStart = -1; }
  });

  const maxSteps = Math.round(maxSeconds / DT);
  for (let i = 0; i < maxSteps && !defeated; i++) {
    clock.fixedUpdate(DT);
    boss.fixedUpdate(DT);
    // Perfect player: while the boss is exposed, land a hit every ATTACK_COOLDOWN.
    if (boss.vulnerable) {
      atk += DT;
      if (atk >= PLAYER.ATTACK_COOLDOWN) { atk -= PLAYER.ATTACK_COOLDOWN; if (boss.takeDamage(playerDmg)) hits++; }
    } else atk = PLAYER.ATTACK_COOLDOWN; // ready to swing the instant a window opens
    t += DT;
  }
  const avgVuln = vulnWindows.length ? vulnWindows.reduce((a, b) => a + b, 0) / vulnWindows.length : 0;
  return { tier, playerDmg, defeated, ttk: defeated ? t : Infinity, beats: t / BEAT_SEC, hits,
    everVulnerable: vulnWindows.length > 0, vulnCount: vulnWindows.length, avgVuln,
    phasesReached: phases.size ? Math.max(...phases) : 0 };
}

/** Log the phase-1 rhythm (no damage → stays in phase 1) for the first N beats. */
function logRhythm(beats = 16) {
  const bus = new EventBus();
  const ctx = makeCtx(bus);
  const boss = new DjSkullBoss(ctx, { x: 0, y: 4 });
  const clock = new BeatClock(bus, BOSS.BPM);
  clock.start();
  const log = [];
  bus.on(EVENT.BEAT, ({ beat }) => log.push(`b${beat}`));
  bus.on(EVENT.BOSS_SHOCKWAVE, () => { log[log.length - 1] += ' SHOCKWAVE'; });
  bus.on(EVENT.BOSS_VULNERABLE, ({ on }) => { log[log.length - 1] += on ? ' [EXPOSED' : ' closed]'; });
  const steps = Math.round((beats * BEAT_SEC) / DT);
  for (let i = 0; i < steps; i++) { clock.fixedUpdate(DT); boss.fixedUpdate(DT); }
  return log;
}

const f2 = (n, d = 2) => (Number.isFinite(n) ? Number(n).toFixed(d) : '∞');

console.log('── BOSS TIMING ────────────────────────────────────────────');
console.log(`  BPM ${BOSS.BPM}  → beat ${f2(BEAT_SEC)}s   HP ${BOSS.MAX_HEALTH}   contact dmg ${BOSS.CONTACT_DAMAGE}`);
console.log(`  shockwave speed ${BOSS.PHASES.ONE.shockwaveSpeed}  → travel boss→player(7u) ≈ ${f2(7 / BOSS.PHASES.ONE.shockwaveSpeed)}s reaction`);

console.log('\n── PHASE-1 RHYTHM (first 16 beats, no damage) ─────────────');
console.log('  ' + logRhythm(16).join('\n  '));

console.log('\n── TIME-TO-KILL (perfect player, by arrival tier) ─────────');
console.log('tier  dmg/hit  windows  avgWin  phases  hits   TTK');
for (const tier of [0, 2, 3, 5]) {
  const r = runFight(tier);
  console.log(
    `${String(r.tier).padStart(3)}    ${String(r.playerDmg).padStart(4)}    ${String(r.vulnCount).padStart(5)}   ${f2(r.avgVuln)}s    ${r.phasesReached}/3   ${String(r.hits).padStart(4)}   ${f2(r.ttk)}s`,
  );
}
console.log('\n  (perfect play = lower bound; real players miss windows → ~1.5-2x)');
process.exit(0);
