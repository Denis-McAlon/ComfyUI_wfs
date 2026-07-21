/**
 * pickup-measure.mjs — headless bench for the collectible MAGNET feel.
 *
 * The collectible is a pure transform-mover, so it runs bare in Node with a mock
 * player. We measure:
 *   - effective COLLECTION RADIUS at base vs giant size (does the vacuum widen as
 *     you grow, as the growth loop promises?)
 *   - RELIABILITY: does a magnetized pickup actually reach the player, or does the
 *     undamped attractor make it orbit/overshoot and never get collected?
 *   - moving-player sweep: how many pickups along a run get vacuumed.
 *
 * Run from project root:  node tools/pickup-measure.mjs
 */
import * as THREE from 'three';
import { Collectible } from '../src/entities/Collectible.js';
import { SIM, PICKUP, PLAYER, GROWTH } from '../src/config/Constants.js';

const DT = SIM.FIXED_DT;
const f2 = (n, d = 2) => Number(n).toFixed(d);
const scene = new THREE.Scene();

// Mock player at a given growth scale (drives magnet radius + collection aabb).
function mockPlayer(scale = 1) {
  const weightT = (() => {
    const w = Math.pow(scale, GROWTH.WEIGHT_EXPONENT);
    const wmin = Math.pow(GROWTH.SCALE_MIN, GROWTH.WEIGHT_EXPONENT);
    const wmax = Math.pow(GROWTH.SCALE_MAX, GROWTH.WEIGHT_EXPONENT);
    return Math.max(0, Math.min(1, (w - wmin) / (wmax - wmin)));
  })();
  return { x: 0, y: 0, scale, weightT, motor: { hx: PLAYER.HALF_WIDTH * scale, hy: PLAYER.HALF_HEIGHT * scale } };
}
const overlap = (a, b) => Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh;
const playerAabb = (p) => ({ x: p.x, y: p.y, hw: p.motor.hx, hh: p.motor.hy });

/** Drop a pickup `dist` to the right of a stationary player; is it collected in `secs`? */
function collectedAt(dist, scale, secs = 3) {
  const player = mockPlayer(scale);
  const ctx = { player, renderer: { scene }, bus: { emit() {} } };
  const pk = new Collectible(ctx, { x: dist, y: 0, kind: 'cocktail' });
  let minDist = dist;
  const steps = Math.round(secs / DT);
  for (let i = 0; i < steps; i++) {
    pk.fixedUpdate(DT);
    minDist = Math.min(minDist, Math.hypot(pk.x - player.x, pk.y - player.y));
    if (overlap(playerAabb(player), pk.aabb())) return { collected: true, t: i * DT, minDist };
  }
  return { collected: false, t: secs, minDist };
}

function effectiveRadius(scale) {
  let maxOk = 0;
  for (let d = 0.5; d <= 9; d += 0.25) if (collectedAt(d, scale).collected) maxOk = d; else if (d > maxOk + 1.5) break;
  return maxOk;
}

console.log('── MAGNET RADIUS by size ──────────────────────────────────');
console.log(`  PICKUP.MAGNET_RADIUS = ${PICKUP.MAGNET_RADIUS}  MAGNET_ACCEL = ${PICKUP.MAGNET_ACCEL}`);
for (const scale of [1.0, 1.6, 2.6]) {
  const p = mockPlayer(scale);
  console.log(`  scale ${f2(scale)} (weightT ${f2(p.weightT)}, body ±${f2(p.motor.hx)}u): effective collection radius ${f2(effectiveRadius(scale))}u`);
}

console.log('\n── RELIABILITY (stationary player, pickup just inside radius) ─');
{
  const r = collectedAt(PICKUP.MAGNET_RADIUS - 0.1, 1.0);
  console.log(`  base: ${r.collected ? `collected in ${f2(r.t)}s` : `NOT collected (min dist ${f2(r.minDist)}u → orbits/overshoots)`}`);
}

console.log('\n── MOVING-PLAYER SWEEP (run right past a row of pickups) ───');
{
  for (const scale of [1.0, 2.6]) {
    const player = mockPlayer(scale);
    const ctx = { player, renderer: { scene }, bus: { emit() {} } };
    // A row of cocktails every 3u at y=0, player runs along y=0.
    const picks = [];
    for (let gx = 4; gx <= 28; gx += 3) picks.push(new Collectible(ctx, { x: gx, y: 0.0, kind: 'cocktail' }));
    let collected = 0;
    const speed = 9; // ~run speed
    for (let i = 0; i < Math.round(4 / DT); i++) {
      player.x += speed * DT;
      for (const pk of picks) {
        if (!pk.alive) continue;
        pk.fixedUpdate(DT);
        if (overlap(playerAabb(player), pk.aabb())) { pk.alive = false; collected++; }
      }
    }
    console.log(`  scale ${f2(scale)}: vacuumed ${collected}/${picks.length} pickups on a fly-by`);
  }
}
process.exit(0);
