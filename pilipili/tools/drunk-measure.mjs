/**
 * drunk-measure.mjs — headless bench for the DrunkPatron's gait & stumble feel.
 *
 * The patron is a pure transform-mover (no physics/GL), so it runs bare in Node.
 * We measure the things that decide whether he reads as "chaotic but fair":
 *   - stumble RATE (lunges/sec) and lunge DISTANCE
 *   - the STUMBLING HITBOX: does the hurtbox actually extend forward mid-lunge?
 *   - the gait speed profile (does he back-step? top lunge speed?)
 *   - patrol coverage (does he traverse his range, or jitter at the bounds?)
 *   - the 2-hit stagger-kill contract
 *
 * Run from project root:  node tools/drunk-measure.mjs
 */
import * as THREE from 'three';
import { DrunkPatron } from '../src/entities/enemies/DrunkPatron.js';
import { SIM, DRUNK } from '../src/config/Constants.js';

const DT = SIM.FIXED_DT;
const f2 = (n, d = 2) => Number(n).toFixed(d);
const stubCtx = { renderer: { scene: new THREE.Scene() }, bus: { emit() {} } };

function reach(d) { const a = d.aabb(); return { front: a.x + a.hw - d.x, hw: a.hw }; }

// ── Hitbox + kill contract (deterministic parts) ────────────────────────────
console.log('── STUMBLING HITBOX + KILL CONTRACT ───────────────────────');
{
  const d = new DrunkPatron(stubCtx, { x: 0, y: 1, dir: 1, range: 6 });
  const rest = reach(d);
  const dw = new DrunkPatron(stubCtx, { x: 0, y: 1, dir: 1 });
  dw._windupT = DRUNK.STUMBLE_WINDUP;                 // force the coil (telegraph)
  const coil = reach(dw);
  d.onPlayerHit({ knockback: DRUNK.KNOCKBACK, facing: 1 }); // survives (2hp→1), enters stagger-lunge
  const lunge = reach(d);
  console.log(`  resting reach  : front ${f2(rest.front)}u (hw ${f2(rest.hw)})`);
  console.log(`  during coil    : front ${f2(coil.front)}u (hw ${f2(coil.hw)})  → hitbox stays NORMAL while telegraphing: ${coil.hw === 0.5 ? 'OK' : 'BAD'}`);
  console.log(`  lunging reach  : front ${f2(lunge.front)}u (hw ${f2(lunge.hw)})  → +${f2(lunge.front - rest.front)}u forward`);
  const d2 = new DrunkPatron(stubCtx, { x: 0, y: 1 });
  const h1 = d2.onPlayerHit({ facing: 1 }); // 2→1, false
  const h2 = d2.onPlayerHit({ facing: 1 }); // 1→0, true
  console.log(`  2-hit kill     : hit1 killed=${h1}  hit2 killed=${h2}  → ${h1 === false && h2 === true ? 'OK' : 'WRONG'}`);
}

// ── Long-run gait & stumble statistics ──────────────────────────────────────
console.log('\n── GAIT & STUMBLE (60s run) ───────────────────────────────');
{
  const range = 6;
  const d = new DrunkPatron(stubCtx, { x: 0, y: 1, dir: 1, range });
  const SECONDS = 60, steps = Math.round(SECONDS / DT);
  let stumbles = 0, wasLunging = false, lungeStartX = 0;
  let windups = 0, wasWinding = false, lungesTelegraphed = 0, recentlyCoiled = false;
  const lungeDists = [];
  let minStepVx = Infinity, maxStepVx = -Infinity, backSteps = 0;
  let minX = Infinity, maxX = -Infinity;
  let prevX = d.x;

  for (let i = 0; i < steps; i++) {
    d.fixedUpdate(DT);
    const stepVx = (d.x - prevX) / DT; prevX = d.x;
    minStepVx = Math.min(minStepVx, stepVx); maxStepVx = Math.max(maxStepVx, stepVx);
    if (stepVx < -0.05) backSteps++;
    minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x);

    const windingNow = d._windupT > 0;
    if (windingNow && !wasWinding) windups++;
    if (wasWinding && !windingNow) recentlyCoiled = true; // coil just released this frame
    wasWinding = windingNow;

    const lungingNow = d._stumbleT > 0;
    if (lungingNow && !wasLunging) { stumbles++; lungeStartX = d.x; if (recentlyCoiled) lungesTelegraphed++; recentlyCoiled = false; }
    if (!lungingNow && wasLunging) lungeDists.push(Math.abs(d.x - lungeStartX));
    wasLunging = lungingNow;
  }
  const avgLunge = lungeDists.length ? lungeDists.reduce((a, b) => a + b, 0) / lungeDists.length : 0;
  console.log(`  stumble rate   : ${f2(stumbles / SECONDS)} /s  (one every ~${f2(SECONDS / stumbles, 1)}s)`);
  console.log(`  telegraphed    : ${lungesTelegraphed}/${stumbles} lunges preceded by a coil (windup ${DRUNK.STUMBLE_WINDUP}s ≈ reaction budget)`);
  console.log(`  avg lunge dist : ${f2(avgLunge)}u`);
  console.log(`  step speed     : ${f2(minStepVx)} .. ${f2(maxStepVx)} u/s   (BASE ${DRUNK.BASE_SPEED})`);
  console.log(`  back-steps     : ${f2((100 * backSteps) / steps, 0)}% of frames move against heading (drunk sway)`);
  console.log(`  patrol coverage: x ∈ [${f2(minX)}, ${f2(maxX)}]  (range ±${range} → [${-range}, ${range}])`);
  const covers = minX < -range + 1 && maxX > range - 1;
  console.log(`  → ${covers ? 'traverses his range' : 'DOES NOT cover range (stuck?)'}`);
}

console.log('\n── CONTACT ────────────────────────────────────────────────');
console.log(`  contact damage ${DRUNK.CONTACT_DAMAGE}  knockback ${DRUNK.KNOCKBACK}  (player has 5 HP, ${DRUNK.CONTACT_DAMAGE} iframes gate repeats)`);
process.exit(0);
