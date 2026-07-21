/**
 * juice-measure.mjs — the "does every action get confirmed?" bench.
 *
 * Juice doctrine: every impactful moment must feed back to the player. This bench
 * builds a COVERAGE MATRIX — for each gameplay event, which reactor responds
 * (audio SFX / particles), plus the shake+hitstop emitters known from gameplay —
 * and flags any event that is MUTE (no audio, no particles). It also measures the
 * two timed juices: hitstop freeze duration and squash-and-stretch recovery.
 *
 * Run from project root:  node tools/juice-measure.mjs
 */
// Stub a minimal window so AudioEngine feature-detects WebAudio and wires its bus
// (its synth voices stay no-ops because no AudioContext is ever resumed).
globalThis.window = { AudioContext: class {}, addEventListener() {}, removeEventListener() {} };

import * as THREE from 'three';
import { AudioEngine } from '../src/audio/AudioEngine.js';
import { ParticleSystem } from '../src/fx/ParticleSystem.js';
import { Clock } from '../src/core/Clock.js';
import { Player } from '../src/entities/Player.js';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { SIM, FX, EVENT, PLAYER } from '../src/config/Constants.js';

const DT = SIM.FIXED_DT;
const f2 = (n, d = 2) => Number(n).toFixed(d);

// A bus that records which events each subscriber listens to.
function recordingBus() {
  const subs = new Set();
  return { subs, on(evt) { subs.add(evt); return () => {}; }, once() { return () => {}; }, off() {}, emit() {} };
}

// ── Coverage: which events does each reactor subscribe to? ──────────────────
const audioBus = recordingBus();
const audio = new AudioEngine(audioBus); await audio.init();
const partBus = recordingBus();
new ParticleSystem({ bus: partBus, renderer: { scene: new THREE.Scene() }, player: { x: 0, y: 0, facing: 1, motor: { hy: 0.85 } } });

// Shake + hitstop are EMITTED by gameplay (Player / wireBossFX), read from source.
const SHAKE = new Set([EVENT.PLAYER_LAND, EVENT.PLAYER_HURT, EVENT.PLAYER_DIED, EVENT.BOSS_SHOCKWAVE, EVENT.BOSS_HURT, EVENT.BOSS_PHASE, EVENT.BOSS_DEFEATED]);
const HITSTOP = new Set([EVENT.PLAYER_HURT, EVENT.PLAYER_GROW]);

const EVENTS = [
  EVENT.PLAYER_JUMP, EVENT.PLAYER_LAND, EVENT.PLAYER_HURT, EVENT.PLAYER_ATTACK, EVENT.PLAYER_GROW,
  EVENT.PLAYER_DIED, EVENT.PICKUP_COLLECTED, EVENT.ENEMY_KILLED,
  EVENT.BOSS_SHOCKWAVE, EVENT.BOSS_VINYL, EVENT.BOSS_HURT, EVENT.BOSS_PHASE, EVENT.BOSS_VULNERABLE, EVENT.BOSS_DEFEATED,
];

console.log('── JUICE COVERAGE MATRIX ──────────────────────────────────');
console.log('  event                 audio  particle  shake  hitstop');
const mute = [];
for (const e of EVENTS) {
  const a = audioBus.subs.has(e), p = partBus.subs.has(e), s = SHAKE.has(e), h = HITSTOP.has(e);
  const m = (b) => (b ? '  ✓  ' : '  ·  ');
  console.log(`  ${e.padEnd(20)} ${m(a)} ${m(p)}   ${m(s)} ${m(h)}`);
  if (!a && !p && !s && !h) mute.push(e);
  else if (!a && !p) mute.push(e + ' (no sound/particles)');
}
console.log(mute.length ? `\n  ⚠ UNDER-JUICED: ${mute.join(', ')}` : '\n  ✓ every event has feedback');

// ── Hitstop freeze duration ─────────────────────────────────────────────────
function freezeDuration(seconds) {
  const clock = new Clock(); clock.reset(0); clock.hitstop(seconds);
  let now = 0, firstStepAt = -1;
  for (let f = 1; f <= 30 && firstStepAt < 0; f++) { now = f * (1000 / 60); const { steps } = clock.advance(now); if (steps > 0) firstStepAt = now / 1000; }
  return firstStepAt;
}
console.log('\n── HITSTOP (sim freeze on impact) ─────────────────────────');
console.log(`  light hit (${FX.HITSTOP_LIGHT}s): sim frozen ~${f2(freezeDuration(FX.HITSTOP_LIGHT))}s`);
console.log(`  heavy hit (${FX.HITSTOP_HEAVY}s): sim frozen ~${f2(freezeDuration(FX.HITSTOP_HEAVY))}s`);

// ── Squash-and-stretch recovery ─────────────────────────────────────────────
const physics = new PhysicsWorld(); await physics.init(SIM.WORLD_GRAVITY);
physics.createStaticBox(0, -1, 100, 1, {});
const player = new Player({ physics, input: { moveX: () => 0, moveY: () => 0, held: () => false, pressed: () => false, released: () => false, consumeBuffered: () => false }, bus: { emit() {}, on: () => () => {} }, clock: { fixedDt: DT }, renderer: null }, { x: 0, y: PLAYER.HALF_HEIGHT });
player.squashX = FX.SQUASH_LAND.x; player.squashY = FX.SQUASH_LAND.y; // stamp a landing squash
let frames = 0;
while ((Math.abs(1 - player.squashX) > 0.03 || Math.abs(1 - player.squashY) > 0.03) && frames < 120) { player.update(DT); frames++; }
console.log('\n── SQUASH & STRETCH ───────────────────────────────────────');
console.log(`  land squash ${FX.SQUASH_LAND.x}×${FX.SQUASH_LAND.y} → recovers to neutral in ${f2(frames * DT)}s (SQUASH_RECOVER ${FX.SQUASH_RECOVER})`);
console.log(`  jump stretch ${FX.SQUASH_JUMP.x}×${FX.SQUASH_JUMP.y}, hitstop light/heavy ${FX.HITSTOP_LIGHT}/${FX.HITSTOP_HEAVY}s`);
process.exit(0);
