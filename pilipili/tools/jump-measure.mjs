/**
 * jump-measure.mjs — a headless, browser-free physics bench for tuning the jump.
 *
 * The whole simulation layer (Player, CharacterMotor, PhysicsWorld, Constants)
 * has zero Three.js dependency, so we can instantiate a Player over a flat floor
 * in Node and step it at an EXACT 1/60 fixed dt — no requestAnimationFrame
 * throttling, no rendering. That gives us the true jump arc to the millimetre so
 * we can tune constants against measured reality instead of guessing.
 *
 * Run from the project root:  node tools/jump-measure.mjs
 */
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { Player } from '../src/entities/Player.js';
import { SIM, JUMP, MOVE, PLAYER, ACTIONS, deriveJump } from '../src/config/Constants.js';

const DT = SIM.FIXED_DT;

// A scriptable stand-in for InputManager (which needs the DOM). Implements only
// the surface Player reads, plus press/hold/release/endStep the bench drives.
function makeInput() {
  return {
    _held: new Set(), _pressed: new Set(), _buffer: new Map(), _step: 0,
    moveX() { return (this._held.has(ACTIONS.RIGHT) ? 1 : 0) - (this._held.has(ACTIONS.LEFT) ? 1 : 0); },
    moveY() { return 0; },
    held(a) { return this._held.has(a); },
    pressed(a) { return this._pressed.has(a); },
    released(a) { return false; },
    consumeBuffered(a, within) {
      const s = this._buffer.get(a);
      if (s != null && this._step - s <= within) { this._buffer.delete(a); return true; }
      return false;
    },
    press(a) { this._pressed.add(a); this._held.add(a); this._buffer.set(a, this._step); },
    hold(a) { this._held.add(a); },
    release(a) { this._held.delete(a); },
    endStep() { this._pressed.clear(); this._step++; },
  };
}

const noopBus = { emit() {}, on() { return () => {}; }, once() { return () => {}; }, off() {} };

async function makeWorld() {
  const physics = new PhysicsWorld();
  await physics.init(SIM.WORLD_GRAVITY);
  return physics;
}

function makeCtx(physics, input) {
  return { physics, input, bus: noopBus, clock: { fixedDt: DT }, renderer: null };
}

/** Settle the player on the ground for a few frames of no input. */
function settle(player, input, frames = 20) {
  for (let i = 0; i < frames; i++) { player.fixedUpdate(DT); player.ctx.physics.step(); input.endStep(); }
}

// ── Scenario runners ────────────────────────────────────────────────────────

async function runJump({ hold, moveRight = false, maxFrames = 240 }) {
  const physics = await makeWorld();
  // Wide flat floor, top at y = 0.
  physics.createStaticBox(0, -1, 200, 1, {});
  const input = makeInput();
  const player = new Player(makeCtx(physics, input), { x: 0, y: PLAYER.HALF_HEIGHT + 0.001 });
  settle(player, input, 20);

  const groundFeet = player.motor.feetY;
  const startX = player.x;
  let launched = false, apex = 0, apexFrame = 0, airFrames = 0, landFrame = -1, launchFrame = 0;

  for (let f = 0; f < maxFrames; f++) {
    if (f === 0) input.press(ACTIONS.JUMP);
    if (moveRight) input.hold(ACTIONS.RIGHT);
    if (!hold) input.release(ACTIONS.JUMP); // tap: release immediately after frame 0

    player.fixedUpdate(DT);
    physics.step();
    input.endStep();

    const feet = player.motor.feetY - groundFeet;
    if (!player.grounded) { if (!launched) { launched = true; launchFrame = f; } airFrames++; }
    if (feet > apex) { apex = feet; apexFrame = f; }
    if (launched && player.grounded && f > launchFrame + 2) { landFrame = f; break; }
  }
  return {
    apexHeight: apex,
    timeToApex: ((apexFrame - launchFrame) * DT),
    airTime: (airFrames * DT),
    horizontal: player.x - startX,
    landFrame,
  };
}

/** Sweep coyote: walk off a ledge, try to jump D frames later; find the max D that works. */
async function measureCoyote() {
  let maxWorking = -1;
  for (let delay = 0; delay <= 12; delay++) {
    const physics = await makeWorld();
    physics.createStaticBox(0, -1, 5, 1, {}); // floor spans x ∈ [-5, 5], top y = 0
    const input = makeInput();
    const player = new Player(makeCtx(physics, input), { x: 4.2, y: PLAYER.HALF_HEIGHT + 0.001 });
    settle(player, input, 20);

    let leftGroundAt = -1, jumped = false;
    for (let f = 0; f < 60; f++) {
      input.hold(ACTIONS.RIGHT); // walk toward and off the edge
      if (leftGroundAt >= 0 && f === leftGroundAt + delay) input.press(ACTIONS.JUMP);
      const vyBefore = player.vy;
      player.fixedUpdate(DT); physics.step(); input.endStep();
      if (leftGroundAt < 0 && !player.grounded) leftGroundAt = f;
      if (leftGroundAt >= 0 && f >= leftGroundAt + delay && player.vy > 3 && vyBefore <= 0) { jumped = true; break; }
    }
    if (jumped) maxWorking = delay; // keep the largest delay that still launched
  }
  return maxWorking;
}

/**
 * Buffer: drop from a height, find the exact landing frame, then re-run pressing
 * JUMP `pre` frames BEFORE that landing and confirm it auto-fires on touchdown.
 * Returns the largest pre-landing lead (frames) that still produces a jump.
 */
async function measureBuffer() {
  // Pass 1: find the natural landing frame with no input.
  let landFrame = -1;
  {
    const physics = await makeWorld();
    physics.createStaticBox(0, -1, 200, 1, {});
    const input = makeInput();
    const player = new Player(makeCtx(physics, input), { x: 0, y: PLAYER.HALF_HEIGHT + 5 });
    for (let f = 0; f < 200; f++) {
      player.fixedUpdate(DT); physics.step(); input.endStep();
      if (player.grounded) { landFrame = f; break; }
    }
  }
  if (landFrame < 0) return -1;

  // Pass 2: for each lead, press JUMP that many frames before landFrame; did we launch?
  let maxWorking = -1;
  for (let pre = 0; pre <= 12; pre++) {
    const physics = await makeWorld();
    physics.createStaticBox(0, -1, 200, 1, {});
    const input = makeInput();
    const player = new Player(makeCtx(physics, input), { x: 0, y: PLAYER.HALF_HEIGHT + 5 });
    let jumped = false;
    for (let f = 0; f < landFrame + 30; f++) {
      if (f === landFrame - pre) input.press(ACTIONS.JUMP);
      player.fixedUpdate(DT); physics.step(); input.endStep();
      if (f >= landFrame && player.vy > 3) { jumped = true; break; }
    }
    if (jumped) maxWorking = pre;
  }
  return maxWorking;
}

// ── Report ──────────────────────────────────────────────────────────────────

function fmt(n, d = 2) { return Number(n).toFixed(d); }

const dj = deriveJump(0);
console.log('── AUTHORED INTENT (analytic) ─────────────────────────────');
console.log(`  APEX_HEIGHT=${JUMP.APEX_HEIGHT}  TIME_TO_APEX=${JUMP.TIME_TO_APEX}s  FALL_MULT=${JUMP.FALL_MULTIPLIER}`);
console.log(`  derived: launchV=${fmt(dj.launchVelocity)}  riseG=${fmt(dj.riseGravity)}  fallG=${fmt(dj.fallGravity)}`);
console.log(`  MAX_SPEED=${MOVE.MAX_SPEED}  coyote=${JUMP.COYOTE_FRAMES}f  buffer=${JUMP.BUFFER_FRAMES}f  cut=${JUMP.CUT_MULTIPLIER}  apexHang<${JUMP.APEX_HANG_VELOCITY}×${JUMP.APEX_HANG_GRAVITY_MULT}`);

const full = await runJump({ hold: true });
const tap = await runJump({ hold: false });
const run = await runJump({ hold: true, moveRight: true });
const coyote = await measureCoyote();
const buffer = await measureBuffer();

console.log('\n── MEASURED (headless, exact 1/60) ────────────────────────');
console.log(`  FULL hold : apex=${fmt(full.apexHeight)}u  t-apex=${fmt(full.timeToApex)}s  airtime=${fmt(full.airTime)}s`);
console.log(`  TAP       : apex=${fmt(tap.apexHeight)}u  (${fmt(100 * tap.apexHeight / full.apexHeight, 0)}% of full)`);
console.log(`  RUN+jump  : apex=${fmt(run.apexHeight)}u  horizontal reach=${fmt(run.horizontal)}u`);
console.log(`  COYOTE    : jump still fires up to ${coyote} frames after leaving ledge (target ${JUMP.COYOTE_FRAMES})`);
console.log(`  BUFFER    : jump fires when pressed up to ${buffer} frames before landing (target ${JUMP.BUFFER_FRAMES})`);

console.log('\n── VERDICT ────────────────────────────────────────────────');
const dApex = full.apexHeight - JUMP.APEX_HEIGHT;
console.log(`  effective apex vs intent: ${dApex >= 0 ? '+' : ''}${fmt(dApex)}u (apex-hang adds float above the analytic parabola)`);
console.log(`  tap→hold range: ${fmt(tap.apexHeight)}u → ${fmt(full.apexHeight)}u  (${fmt(full.apexHeight - tap.apexHeight)}u of expressive control)`);
console.log(`  running reach: ${fmt(run.horizontal)}u  — level's widest normal gap is ~4u, 6u puzzle gap has a catch ledge`);
process.exit(0);
