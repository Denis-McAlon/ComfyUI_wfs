/**
 * hazard-measure.mjs — headless bench for the ICE and GLASS hazards.
 *
 * Two things to get right, both measured here:
 *   ICE   → skid. Reduced traction (accel/decel) makes you slide. Measure the
 *           stop distance at base and giant size (giant momentum × ice = danger).
 *   GLASS → wade. Should CAP top speed (sticky/slow), NOT reduce decel (that would
 *           make you slippery — the opposite). Measure top speed under each model.
 * Plus unit-checks of the detection contracts (slickAt / contains) and the DoT.
 *
 * Run from project root:  node tools/hazard-measure.mjs
 */
import * as THREE from 'three';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { Player } from '../src/entities/Player.js';
import { IceCube } from '../src/entities/enemies/IceCube.js';
import { BrokenGlass } from '../src/entities/hazards/BrokenGlass.js';
import { SIM, PLAYER, ICE, GLASS, ACTIONS } from '../src/config/Constants.js';

const DT = SIM.FIXED_DT;
const f2 = (n, d = 2) => Number(n).toFixed(d);

// ── Stub ctx for pure-logic entity checks (no physics/GL) ───────────────────
const stubCtx = { renderer: { scene: new THREE.Scene(), lighting: { registerNeon: (m) => m } }, bus: { emit() {} } };

function unitChecks() {
  const out = [];
  // IceCube.slickAt: self footprint + trailing puddles + expiry.
  const ice = new IceCube(stubCtx, { x: 0, y: 0, dir: 1, range: 10 });
  out.push(['ice self @0', ice.slickAt(0) === true]);
  out.push(['ice self @0.4', ice.slickAt(0.4) === true]);
  out.push(['ice not @3 (no trail yet)', ice.slickAt(3) === false]);
  for (let i = 0; i < 30; i++) ice.fixedUpdate(DT); // slide right ~3.25u, dribbling a trail
  out.push(['ice trail behind cube', ice.slickAt(0.0) === true]);   // start point still slick
  out.push([`ice cube moved to ~${f2(ice.x)}`, ice.x > 2]);
  // let the earliest puddle expire
  for (let i = 0; i < Math.ceil(ICE.FRICTION_ZONE_LIFETIME / DT) + 5; i++) ice.fixedUpdate(DT);
  out.push(['ice old puddle re-froze @0', ice.slickAt(0.0) === false]);

  // BrokenGlass.contains: x band × feet band.
  const glass = new BrokenGlass(stubCtx, { x: 5, y: 0, w: 2 });
  out.push(['glass in @ (5,0)', glass.contains(5, 0) === true]);
  out.push(['glass edge @ (6,0)', glass.contains(6, 0) === true]);
  out.push(['glass outside x @ (7,0)', glass.contains(7, 0) === false]);
  out.push(['glass feet too high @ (5,0.5)', glass.contains(5, 0.5) === false]);
  return out;
}

// ── Locomotion under a surface (real physics) ───────────────────────────────
async function spawnGrown(charge) {
  const physics = new PhysicsWorld();
  await physics.init(SIM.WORLD_GRAVITY);
  physics.createStaticBox(0, -1, 400, 1, {});
  const input = {
    _h: new Set(), moveX() { return this._h.has(ACTIONS.RIGHT) ? 1 : 0; }, moveY() { return 0; },
    held(a) { return this._h.has(a); }, pressed() { return false; }, released() { return false; },
    consumeBuffered() { return false; }, hold(a) { this._h.add(a); }, clear() { this._h.clear(); }, endStep() {},
  };
  const ctx = { physics, input, bus: { emit() {}, on() { return () => {}; } }, clock: { fixedDt: DT }, renderer: null };
  const player = new Player(ctx, { x: 0, y: PLAYER.HALF_HEIGHT + 0.001 });
  if (charge > 0) player.addGrowth(charge);
  for (let i = 0; i < 80; i++) { player.fixedUpdate(DT); physics.step(); }
  return { physics, input, player };
}

async function measureLoco(charge, { traction = 1, speed = 1 }) {
  const s = await spawnGrown(charge);
  const set = () => { s.player.tractionMultiplier = traction; s.player.speedMultiplier = speed; };
  const vlog = [];
  for (let f = 0; f < 220; f++) { set(); s.input.hold(ACTIONS.RIGHT); s.player.fixedUpdate(DT); s.physics.step(); vlog.push(Math.abs(s.player.vx)); }
  const topSpeed = Math.max(...vlog);
  const tTop = vlog.findIndex((v) => v >= 0.95 * topSpeed);
  const accelTime = (tTop < 0 ? vlog.length : tTop) * DT;
  const xRel = s.player.x;
  s.input.clear();
  let guard = 0;
  while (Math.abs(s.player.vx) > 0.15 && guard++ < 600) { set(); s.player.fixedUpdate(DT); s.physics.step(); }
  return { topSpeed, accelTime, stopDist: s.player.x - xRel };
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('── HAZARD DETECTION UNIT CHECKS ───────────────────────────');
let allPass = true;
for (const [label, ok] of unitChecks()) { if (!ok) allPass = false; console.log(`  ${ok ? '✓' : '✗ FAIL'}  ${label}`); }
console.log(`  → ${allPass ? 'all detection logic OK' : 'DETECTION BUG'}`);

console.log('\n── LOCOMOTION BY SURFACE (topSpeed / accelTime / stopDist) ─');
console.log(`  ICE traction=${ICE.PLAYER_TRACTION_ON_ICE}   GLASS slow=${GLASS.SLOW_MULT}`);
const scenarios = [
  ['base  normal    ', 0, { traction: 1, speed: 1 }],
  ['base  ICE       ', 0, { traction: ICE.PLAYER_TRACTION_ON_ICE, speed: 1 }],
  ['base  GLASS(spd) ', 0, { traction: 1, speed: GLASS.SLOW_MULT }],
  ['base  GLASS(trac)', 0, { traction: GLASS.SLOW_MULT, speed: 1 }],
  ['giant normal    ', 30, { traction: 1, speed: 1 }],
  ['giant ICE       ', 30, { traction: ICE.PLAYER_TRACTION_ON_ICE, speed: 1 }],
];
for (const [label, charge, mods] of scenarios) {
  const r = await measureLoco(charge, mods);
  console.log(`  ${label}  top ${f2(r.topSpeed)}   accel ${f2(r.accelTime)}s   stop ${f2(r.stopDist)}u`);
}

// ── Glass DoT time-to-death ─────────────────────────────────────────────────
const perTick = GLASS.DOT_PER_SECOND * GLASS.TICK_INTERVAL;
const ticks = Math.ceil(PLAYER.MAX_HEALTH / perTick);
console.log('\n── GLASS DoT ──────────────────────────────────────────────');
console.log(`  ${f2(GLASS.DOT_PER_SECOND)} hp/s, tick ${GLASS.TICK_INTERVAL}s (${f2(perTick)}/tick) → death in ~${f2(ticks * GLASS.TICK_INTERVAL)}s standing still`);
process.exit(0);
