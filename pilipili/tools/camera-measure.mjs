/**
 * camera-measure.mjs — headless bench for the follow-camera feel.
 *
 * CameraRig is Three.js but GL-free to construct, so we drive it with a mock
 * target and measure the four things that make a 2D camera feel good (and the
 * ways they go wrong):
 *   - FOLLOW: catches up smoothly, and — critically — frame-rate INDEPENDENTLY
 *     (60fps and 30fps must land the same place over the same wall-clock).
 *   - LOOK-AHEAD: leads the player in their facing direction by ~LOOKAHEAD.
 *   - DEADZONE: tiny target moves don't shove the camera (no seasick drift).
 *   - TRAUMA SHAKE: amplitude scales with trauma² and decays to zero; roll sane.
 *   - SIZE ZOOM: dolly pulls back as the hero grows (weightT 0→1).
 *
 * Run from project root:  node tools/camera-measure.mjs
 */
import { CameraRig } from '../src/render/CameraRig.js';
import { CAMERA, EVENT } from '../src/config/Constants.js';

const f2 = (n, d = 2) => Number(n).toFixed(d);
const mockBus = () => ({ _h: {}, on(t, fn) { this._h[t] = fn; }, emit(t, p) { this._h[t]?.(p); } });
const target = (x = 0, y = 0, facing = 1, weightT = 0) => ({ x, y, facing, weightT });

function rig() { const bus = mockBus(); const r = new CameraRig(bus); r.resize(16 / 9); return { r, bus }; }

// ── FOLLOW convergence + LOOK-AHEAD ─────────────────────────────────────────
console.log('── FOLLOW + LOOK-AHEAD (60fps) ────────────────────────────');
{
  const { r } = rig();
  const t = target(0, 0, 1, 0);
  r.follow(t);
  for (let i = 0; i < 240; i++) r.update(1 / 60, i / 60); // settle at x=0
  t.x = 20; // jump the target 20u right
  const xs = [];
  for (let i = 0; i < 600; i++) { r.update(1 / 60, i / 60); xs.push(r._pos.x); }
  const final = xs[xs.length - 1];
  const framesToCatch = xs.findIndex((x) => Math.abs(x - final) < 0.5);
  console.log(`  settle time after 20u jump: ${framesToCatch < 0 ? '>600' : f2(framesToCatch / 60) + 's'} (${framesToCatch}f)`);
  console.log(`  steady running lead (facing +1): ${f2(final - 20)}u  (≈ LOOKAHEAD ${CAMERA.LOOKAHEAD} − DEADZONE_X ${CAMERA.DEADZONE_X})`);
  // Flip facing → lead should swing negative (camera leads the new direction).
  t.facing = -1;
  for (let i = 0; i < 600; i++) r.update(1 / 60, i / 60);
  console.log(`  lead after facing flip:  ${f2(r._pos.x - t.x)}u`);
}

// ── FRAME-RATE INDEPENDENCE ─────────────────────────────────────────────────
console.log('\n── FRAME-RATE INDEPENDENCE (1.0s wall, target at x=20) ─────');
{
  const runAt = (fps) => {
    const { r } = rig(); const t = target(0, 0, 1, 0); r.follow(t);
    for (let i = 0; i < 200; i++) r.update(1 / 60, 0);   // settle at 0
    t.x = 20;
    const dt = 1 / fps, steps = Math.round(1.0 / dt);
    for (let i = 0; i < steps; i++) r.update(dt, i * dt);
    return r._pos.x;
  };
  const a = runAt(60), b = runAt(30), c = runAt(144);
  console.log(`  camera x after 1s:  60fps ${f2(a)}   30fps ${f2(b)}   144fps ${f2(c)}`);
  console.log(`  max divergence: ${f2(Math.max(a, b, c) - Math.min(a, b, c))}u  ${Math.max(a, b, c) - Math.min(a, b, c) < 0.5 ? '✓ frame-rate independent' : '✗ FRAME-RATE DEPENDENT'}`);
}

// ── DEADZONE ────────────────────────────────────────────────────────────────
console.log('\n── DEADZONE ───────────────────────────────────────────────');
{
  const { r } = rig(); const t = target(0, 0, 1, 0); r.follow(t);
  for (let i = 0; i < 300; i++) r.update(1 / 60, 0); // settle (includes look-ahead)
  const base = r._pos.x;
  t.x = 0.5; // nudge less than DEADZONE_X
  for (let i = 0; i < 120; i++) r.update(1 / 60, 0);
  console.log(`  target nudged 0.5u (< deadzone ${CAMERA.DEADZONE_X}) → camera moved ${f2(r._pos.x - base)}u  ${Math.abs(r._pos.x - base) < 0.3 ? '✓ absorbed' : '✗ jittery'}`);
}

// ── TRAUMA SHAKE ────────────────────────────────────────────────────────────
console.log('\n── TRAUMA SHAKE ───────────────────────────────────────────');
{
  const { r, bus } = rig(); const t = target(0, 0, 1, 0); r.follow(t);
  for (let i = 0; i < 120; i++) r.update(1 / 60, 0);
  const cx = r._pos.x;
  bus.emit(EVENT.CAMERA_SHAKE, { trauma: 0.9 });
  let maxOff = 0, maxRoll = 0, decayFrames = 0;
  for (let i = 0; i < 240; i++) {
    r.update(1 / 60, i / 60);
    const off = Math.abs(r.camera.position.x - r._pos.x);
    maxOff = Math.max(maxOff, off); maxRoll = Math.max(maxRoll, Math.abs(r.camera.rotation.z));
    if (r.trauma > 0.001) decayFrames = i;
  }
  console.log(`  trauma 0.9 → max offset ${f2(maxOff)}u (cap ${CAMERA.MAX_SHAKE}), max roll ${f2(maxRoll)}rad`);
  console.log(`  shake decays to zero in ${f2(decayFrames / 60)}s  (SHAKE_DECAY ${CAMERA.SHAKE_DECAY}/s → expect ~${f2(0.9 / CAMERA.SHAKE_DECAY)}s)`);
}

// ── SIZE ZOOM ───────────────────────────────────────────────────────────────
console.log('\n── SIZE ZOOM (dolly distance by growth) ───────────────────');
{
  const measureZoom = (wT) => {
    const { r } = rig(); const t = target(0, 0, 1, wT); r.follow(t);
    for (let i = 0; i < 400; i++) r.update(1 / 60, 0);
    return r._pos.z;
  };
  const z0 = measureZoom(0), z1 = measureZoom(1);
  console.log(`  dolly z: base(weightT 0) ${f2(z0)}   giant(weightT 1) ${f2(z1)}   → +${f2(z1 - z0)}u pull-back`);
  console.log(`  frames a view height of ~${CAMERA.VIEW_HEIGHT}→${CAMERA.VIEW_HEIGHT_AT_HEAVY}u as the hero grows`);
}
process.exit(0);
