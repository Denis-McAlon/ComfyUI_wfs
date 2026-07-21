/**
 * level-analyze.mjs — solvability + pacing analysis for a level, using the REAL
 * measured jump envelope (not a guess).
 *
 * It simulates a running jump for the base hero AND a max-grown giant (whose arc
 * is lower and shorter), builds the reachable (dx, dy) envelope from the actual
 * trajectory, then does a reachability BFS over the level's platforms (jumps +
 * falls) to answer the questions that decide whether a level is shippable:
 *   - Can you reach the boss arena at all? (soft-lock detection, base AND giant)
 *   - Is every pickup reachable?
 *   - Is the teaching order sane (mechanics introduced solo before combined)?
 *   - How does hazard density ramp across the level?
 *
 * Run from project root:  node tools/level-analyze.mjs
 */
const LEVEL_ID = process.argv[2] || 'level_01_backroom';
const level = (await import(new URL(`../src/world/levels/${LEVEL_ID}.json`, import.meta.url), { with: { type: 'json' } })).default;
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { Player } from '../src/entities/Player.js';
import { SIM, PLAYER, ACTIONS } from '../src/config/Constants.js';

const DT = SIM.FIXED_DT;
const f2 = (n, d = 2) => Number(n).toFixed(d);

// ── Measure a running-jump trajectory → reachable envelope ──────────────────
async function jumpEnvelope(charge) {
  const physics = new PhysicsWorld();
  await physics.init(SIM.WORLD_GRAVITY);
  physics.createStaticBox(0, -1, 400, 1, {});
  const input = {
    _h: new Set(), moveX() { return this._h.has(ACTIONS.RIGHT) ? 1 : 0; }, moveY() { return 0; },
    held(a) { return this._h.has(a); }, pressed() { return false; }, released() { return false; },
    _buf: false, consumeBuffered(a) { if (a === ACTIONS.JUMP && this._buf) { this._buf = false; return true; } return false; },
    hold(a) { this._h.add(a); }, buf() { this._buf = true; }, endStep() {},
  };
  const ctx = { physics, input, bus: { emit() {}, on: () => () => {} }, clock: { fixedDt: DT }, renderer: null };
  const player = new Player(ctx, { x: 0, y: PLAYER.HALF_HEIGHT + 0.001 });
  if (charge > 0) player.addGrowth(charge);
  for (let i = 0; i < 80; i++) { player.fixedUpdate(DT); physics.step(); }
  // Run up to speed.
  for (let i = 0; i < 40; i++) { input.hold(ACTIONS.RIGHT); player.fixedUpdate(DT); physics.step(); }
  // Launch: buffer a jump, hold it and RIGHT, record trajectory from lift-off.
  const x0 = player.x, feet0 = player.motor.feetY;
  input.buf();
  const traj = [];
  for (let f = 0; f < 200; f++) {
    input.hold(ACTIONS.RIGHT); input.hold(ACTIONS.JUMP);
    player.fixedUpdate(DT); physics.step();
    traj.push({ dx: player.x - x0, dy: player.motor.feetY - feet0 });
    if (f > 4 && player.grounded) break;
  }
  const apex = Math.max(...traj.map((p) => p.dy));
  const maxRange = Math.max(...traj.map((p) => p.dx));
  // Farthest horizontal distance reachable at-or-above a given rise height.
  const maxDxAtHeight = (riseY) => {
    let best = -Infinity;
    for (const p of traj) if (p.dy >= riseY - 0.02) best = Math.max(best, p.dx);
    return best; // -Infinity if the arc never reaches that height
  };
  return { apex, maxRange, maxDxAtHeight, speed: player._stats.maxSpeed };
}

// ── Platform helpers ────────────────────────────────────────────────────────
const P = level.platforms.map((p, i) => ({ i, ...p, left: p.x - p.w / 2, right: p.x + p.w / 2, top: p.y + p.h / 2 }));
const spawnPlat = P.filter((p) => level.spawn.x >= p.left && level.spawn.x <= p.right && p.top <= level.spawn.y)
  .sort((a, b) => b.top - a.top)[0];

/** Can you get from A to B (jump either direction, or fall)? */
function canReach(A, B, env, margin = 0.4) {
  // Horizontal gap between nearest edges (0 if they overlap).
  let gap;
  if (B.left > A.right) gap = B.left - A.right;        // B to the right
  else if (B.right < A.left) gap = A.left - B.right;   // B to the left
  else gap = 0;                                        // x-overlap
  const rise = B.top - A.top;
  // Fall: dropping onto a lower, horizontally-close platform is generous.
  if (rise < -0.3 && gap <= env.maxRange) return true;
  // Jump: must clear both the height and the horizontal distance at that height.
  if (rise > env.apex - 0.05) return false;            // too tall to jump onto
  const reach = env.maxDxAtHeight(Math.max(0, rise));
  return gap + margin <= reach;
}

function reachableSet(env) {
  const seen = new Set([spawnPlat.i]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const A of P) if (seen.has(A.i)) {
      for (const B of P) if (!seen.has(B.i) && canReach(A, B, env)) { seen.add(B.i); grew = true; }
    }
  }
  return seen;
}

// ── Run analysis ────────────────────────────────────────────────────────────
const base = await jumpEnvelope(0);
const giant = await jumpEnvelope(30);
console.log('── JUMP ENVELOPES (measured) ──────────────────────────────');
console.log(`  base : apex ${f2(base.apex)}u  maxRange ${f2(base.maxRange)}u  runSpeed ${f2(base.speed)}`);
console.log(`  giant: apex ${f2(giant.apex)}u  maxRange ${f2(giant.maxRange)}u  runSpeed ${f2(giant.speed)}`);

for (const [name, env] of [['BASE', base], ['GIANT', giant]]) {
  const reach = reachableSet(env);
  const goal = P.find((p) => level.bossArenaX >= p.left && level.bossArenaX <= p.right);
  const canFinish = goal && reach.has(goal.i);
  console.log(`\n── REACHABILITY: ${name} ──────────────────────────────────`);
  console.log(`  reachable platforms: ${reach.size}/${P.length}`);
  const unreached = P.filter((p) => !reach.has(p.i)).map((p) => `#${p.i}@x${p.x}(top${f2(p.top)})`);
  if (unreached.length) console.log(`  UNREACHED: ${unreached.join(', ')}`);
  console.log(`  boss arena (x${level.bossArenaX}) reachable: ${canFinish ? 'YES ✓' : 'NO ✗ SOFT-LOCK'}`);

  // Pickup reachability: is each pickup within jump reach of a reachable platform?
  const bad = [];
  for (const pk of level.pickups) {
    const ok = P.some((p) => reach.has(p.i)
      && pk.x >= p.left - env.maxRange && pk.x <= p.right + env.maxRange
      && pk.y <= p.top + env.apex + 0.6 && pk.y >= p.top - 3);
    if (!ok) bad.push(`${pk.kind}@(${pk.x},${pk.y})`);
  }
  console.log(`  pickups reachable: ${level.pickups.length - bad.length}/${level.pickups.length}${bad.length ? '  MISSED: ' + bad.join(', ') : ' ✓'}`);
}

// ── Teaching order + pacing ─────────────────────────────────────────────────
console.log('\n── TEACHING ORDER (first appearance, left→right) ──────────');
const marks = [...level.enemies.map((e) => ({ x: e.x, t: e.type })), ...level.hazards.map((h) => ({ x: h.x, t: 'glass' }))]
  .sort((a, b) => a.x - b.x);
const firstSeen = {};
for (const m of marks) if (!(m.t in firstSeen)) firstSeen[m.t] = m.x;
console.log('  ' + Object.entries(firstSeen).map(([t, x]) => `${t}@x${x}`).join('  →  '));
// Combined encounters: same x-neighbourhood, different types.
const combos = [];
for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) {
  if (marks[j].x - marks[i].x < 3 && marks[i].t !== marks[j].t) combos.push(`${marks[i].t}+${marks[j].t}@x~${marks[i].x}`);
}
console.log(`  combined encounters: ${combos.length ? combos.join(', ') : 'none'}`);
const soloBeforeCombo = combos.every((c) => {
  const [a, b] = c.split('@')[0].split('+'); const cx = +c.split('x~')[1];
  return firstSeen[a] < cx && firstSeen[b] < cx;
});
console.log(`  → each mechanic taught SOLO before any combo: ${combos.length === 0 || soloBeforeCombo ? 'YES ✓' : 'NO ✗'}`);

console.log('\n── HAZARD DENSITY (per 20u segment) ───────────────────────');
const seg = 20;
for (let s = 0; s < level.width; s += seg) {
  const n = marks.filter((m) => m.x >= s && m.x < s + seg).length;
  console.log(`  x[${String(s).padStart(3)}-${String(s + seg).padStart(3)}]  ${'█'.repeat(n) || '·'}  (${n})`);
}
process.exit(0);
