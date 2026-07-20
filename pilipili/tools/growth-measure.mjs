/**
 * growth-measure.mjs — headless bench for tuning the GROWTH engine's feel.
 *
 * Same trick as jump-measure.mjs: the sim layer has no Three.js dependency, so we
 * grow a real Player over a flat floor and measure — at several sizes — the two
 * things that make growth read as "a power fantasy WITH A COST":
 *   POWER : attack reach, and how big/heavy the body gets.
 *   COST  : inertia (time to reach top speed), momentum (stopping + turn-around
 *           distance), the small top-speed penalty, and a heavier jump.
 *
 * If the giant slides so far it can't be placed near a ledge, or accelerates so
 * slowly it feels dead, the numbers say so here — before anyone plays it.
 *
 * Run from project root:  node tools/growth-measure.mjs
 */
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { Player } from '../src/entities/Player.js';
import { SIM, PLAYER, GROWTH, ACTIONS, EVENT } from '../src/config/Constants.js';

const DT = SIM.FIXED_DT;

function makeInput() {
  return {
    _held: new Set(), _pressed: new Set(), _buffer: new Map(), _step: 0,
    moveX() { return (this._held.has(ACTIONS.RIGHT) ? 1 : 0) - (this._held.has(ACTIONS.LEFT) ? 1 : 0); },
    moveY() { return 0; },
    held(a) { return this._held.has(a); },
    pressed(a) { return this._pressed.has(a); },
    released() { return false; },
    consumeBuffered(a, within) { const s = this._buffer.get(a); if (s != null && this._step - s <= within) { this._buffer.delete(a); return true; } return false; },
    press(a) { this._pressed.add(a); this._held.add(a); this._buffer.set(a, this._step); },
    hold(a) { this._held.add(a); }, release(a) { this._held.delete(a); }, clear() { this._held.clear(); },
    endStep() { this._pressed.clear(); this._step++; },
  };
}
function makeBus() { const last = {}; return { emit(t, p) { last[t] = p; }, on() { return () => {}; }, once() { return () => {}; }, off() {}, _last: last }; }

async function spawnGrown(charge) {
  const physics = new PhysicsWorld();
  await physics.init(SIM.WORLD_GRAVITY);
  physics.createStaticBox(0, -1, 400, 1, {}); // wide flat floor, top at y=0
  const input = makeInput();
  const bus = makeBus();
  const ctx = { physics, input, bus, clock: { fixedDt: DT }, renderer: null };
  const player = new Player(ctx, { x: 0, y: PLAYER.HALF_HEIGHT + 0.001 });
  if (charge > 0) player.addGrowth(charge);
  // Settle: land + let the scale spring + collider resize converge.
  for (let i = 0; i < 80; i++) { player.fixedUpdate(DT); physics.step(); input.endStep(); }
  return { physics, input, player, bus };
}

const step = (s) => { s.player.fixedUpdate(DT); s.physics.step(); s.input.endStep(); };

async function measure(charge) {
  // --- top speed + acceleration (inertia) ---
  let s = await spawnGrown(charge);
  const scale = s.player.scale, weightT = s.player.weightT;
  const vlog = [];
  for (let f = 0; f < 200; f++) { s.input.hold(ACTIONS.RIGHT); step(s); vlog.push(Math.abs(s.player.vx)); }
  const topSpeed = Math.max(...vlog);
  const tTop = vlog.findIndex((v) => v >= 0.95 * topSpeed);
  const accelTime = (tTop < 0 ? vlog.length : tTop) * DT;

  // --- stopping distance (momentum) --- continue then release
  const xRel = s.player.x;
  s.input.clear();
  let guard = 0;
  while (Math.abs(s.player.vx) > 0.15 && guard++ < 400) step(s);
  const stopDist = s.player.x - xRel;

  // --- turn-around overshoot (momentum on reversal) ---
  s = await spawnGrown(charge);
  for (let f = 0; f < 120; f++) { s.input.hold(ACTIONS.RIGHT); step(s); } // reach top speed →
  const xFlip = s.player.x;
  s.input.clear();
  guard = 0;
  while (s.player.vx > 0 && guard++ < 400) { s.input.hold(ACTIONS.LEFT); step(s); } // now push LEFT
  const turnOvershoot = s.player.x - xFlip;

  // --- jump apex at this size (heavier = lower/harder) ---
  s = await spawnGrown(charge);
  const groundFeet = s.player.motor.feetY;
  let apex = 0;
  for (let f = 0; f < 200; f++) {
    if (f === 0) s.input.press(ACTIONS.JUMP);
    s.input.hold(ACTIONS.JUMP);
    step(s);
    apex = Math.max(apex, s.player.motor.feetY - groundFeet);
    if (f > 5 && s.player.grounded) break;
  }

  // --- attack reach (the reward) ---
  s = await spawnGrown(charge);
  s.player.attack();
  const box = s.bus._last[EVENT.PLAYER_ATTACK];
  const bodyHalf = s.player.motor.hx;
  const reachFromCenter = box ? (box.x + box.hw) - s.player.x : 0;

  return { charge, scale, weightT, topSpeed, accelTime, stopDist, turnOvershoot, apex, bodyHalf, reachFromCenter,
    damage: box?.damage, knockback: box?.knockback };
}

const f2 = (n, d = 2) => Number(n).toFixed(d);

console.log('── GROWTH MODEL (tunables) ────────────────────────────────');
console.log(`  scale ${GROWTH.SCALE_MIN}..${GROWTH.SCALE_MAX}  weightExp ${GROWTH.WEIGHT_EXPONENT}`);
console.log(`  @heavy: maxSpeed×${GROWTH.MAXSPEED_AT_HEAVY} accel×${GROWTH.ACCEL_AT_HEAVY} decel×${GROWTH.DECEL_AT_HEAVY} turn×${GROWTH.TURN_ASSIST_AT_HEAVY} reach×${GROWTH.ATTACK_RANGE_AT_HEAVY}`);
console.log('\ncharge  scale  wT    topSpd  accelT  stopDist  turnOver  apex   reach  dmg');
const rows = [];
for (const c of [0, 4, 10, 20, 30]) rows.push(await measure(c));
for (const r of rows) {
  console.log(
    `${String(r.charge).padStart(4)}   ${f2(r.scale)}   ${f2(r.weightT)}  ${f2(r.topSpeed).padStart(5)}   ${f2(r.accelTime)}s   ${f2(r.stopDist).padStart(5)}u   ${f2(r.turnOvershoot).padStart(5)}u   ${f2(r.apex)}u  ${f2(r.reachFromCenter)}u  ${r.damage}`,
  );
}
const small = rows[0], big = rows[rows.length - 1];
console.log('\n── SMALL → GIANT deltas ───────────────────────────────────');
console.log(`  top speed : ${f2(small.topSpeed)} → ${f2(big.topSpeed)}  (${f2(100 * big.topSpeed / small.topSpeed, 0)}%)`);
console.log(`  accel time: ${f2(small.accelTime)}s → ${f2(big.accelTime)}s  (${f2(big.accelTime / small.accelTime, 1)}× slower to top speed = inertia)`);
console.log(`  stop dist : ${f2(small.stopDist)}u → ${f2(big.stopDist)}u  (${f2(big.stopDist / Math.max(0.01, small.stopDist), 1)}× = momentum/slide)`);
console.log(`  turn over : ${f2(small.turnOvershoot)}u → ${f2(big.turnOvershoot)}u`);
console.log(`  jump apex : ${f2(small.apex)}u → ${f2(big.apex)}u  (heavier drops harder)`);
console.log(`  reach     : ${f2(small.reachFromCenter)}u → ${f2(big.reachFromCenter)}u  (${f2(big.reachFromCenter / small.reachFromCenter, 1)}× = the reward)`);
console.log(`  body half : ${f2(small.bodyHalf)}u → ${f2(big.bodyHalf)}u`);
process.exit(0);
