/**
 * Constants.js — Single source of truth for every *felt* number in the game.
 *
 * DOCTRINE: nothing that affects game-feel is allowed to hide inside logic.
 * A designer tunes the game by editing this file and nothing else. Every value
 * carries the unit and, where it matters, the perceptual target it encodes.
 *
 * UNITS
 *   - World unit  = 1 "meter". The heroes are ~1.7 units tall.
 *   - Time        = seconds. The simulation is a FIXED 60 Hz step (see Clock.js).
 *   - Angles      = radians unless suffixed _DEG.
 *
 * COORDINATE CONVENTION
 *   +X right, +Y up (Three.js and Rapier2D agree on this). Z is *visual only*:
 *   parallax depth and boss staging. All gameplay resolves on the Z = 0 plane.
 */

export const SIM = {
  /** Fixed simulation timestep. Physics + gameplay always advance by this. */
  FIXED_DT: 1 / 60,
  /** Hard cap on how many fixed steps a single frame may run (spiral-of-death guard). */
  MAX_SUBSTEPS: 5,
  /** Rapier world gravity (units/s²). Only DYNAMIC bodies obey it — the player
   *  is kinematic and integrates its own gravity below, so it can bend the rules
   *  (asymmetric rise/fall, apex hang) that a physics engine will not give you. */
  WORLD_GRAVITY: { x: 0, y: -60 },
};

/**
 * MOVE — horizontal locomotion for the player at *base* size (growth scales these).
 * Accelerations are chosen from "time to reach top speed", which is how it reads
 * to the thumb, not from raw numbers.
 */
export const MOVE = {
  MAX_SPEED: 9.0,            // units/s. Comfortable run for a 1.7u hero.
  GROUND_ACCEL: 90.0,        // → reaches MAX_SPEED in ~0.10s. Snappy but not instant.
  GROUND_DECEL: 120.0,       // → stops from MAX_SPEED in ~0.075s. Crisp stops.
  AIR_ACCEL: 55.0,           // Weaker in air: commit to your jump, but still steer.
  AIR_DECEL: 26.0,           // Air drag is gentle so momentum carries across gaps.
  /** Turn assist: extra decel applied when input opposes current velocity, so a
   *  direction flip feels immediate instead of mushy. Multiplies the active decel. */
  TURN_ASSIST: 1.9,
  /** Below this speed we snap to 0 to avoid sub-pixel creep. */
  STOP_EPSILON: 0.05,
};

/**
 * JUMP — the single most important feel in the game.
 *
 * We author the arc from intent (apex height + time to apex), then DERIVE the
 * gravity and launch velocity. Fall gravity is heavier than rise gravity — the
 * asymmetry is the entire difference between "floaty" and "tight".
 *
 *   g_up  = 2H / t²          v0 = 2H / t = g_up · t
 *   g_dn  = g_up · FALL_MULT
 */
export const JUMP = {
  APEX_HEIGHT: 3.35,         // units. Authored 3.35 → MEASURED effective apex ≈3.24
                             //   after discrete-step integration + apex-hang (the
                             //   analytic parabola slightly under-delivers). Tuned
                             //   with tools/jump-measure.mjs so the level's step-ups
                             //   keep their designed clearance. ~1.9 body-heights.
  TIME_TO_APEX: 0.36,        // s. Under 0.4s keeps it responsive.
  FALL_MULTIPLIER: 1.85,     // fall gravity ÷ rise gravity. The "tight jump" number.

  /** Coyote time: frames after leaving a ledge during which a jump still fires.
   *  Fixes ~80% of "the game ate my input" complaints. 6 frames = 100ms. */
  COYOTE_FRAMES: 6,
  /** Jump buffer: frames before landing during which a jump press is remembered
   *  and auto-fired on touchdown. Pairs with coyote to feel telepathic.
   *  NOTE: the buffered jump is honoured on the frame AFTER touchdown (grounded is
   *  resolved at end-of-step, the jump check is start-of-step), so the effective
   *  window is one less than this constant. 7 here → a true ~6 frames. Verified in
   *  tools/jump-measure.mjs. */
  BUFFER_FRAMES: 7,

  /** Variable height: on early button release while rising, cut upward velocity
   *  to this fraction. Tap = hop, hold = full jump. */
  CUT_MULTIPLIER: 0.45,

  /** Apex hang: near the top of the arc gravity is softened for these many
   *  units/s of |vy|, giving a floaty "hang" that reads as air-control mastery. */
  APEX_HANG_VELOCITY: 2.2,
  APEX_HANG_GRAVITY_MULT: 0.55,

  /** Terminal velocity so long falls stay controllable. */
  TERMINAL_VELOCITY: 34.0,

  /** Coyote/buffer also allow a second "kindness" jump right after a hard land. */
  MAX_AIR_JUMPS: 0,          // 0 = grounded-only. Raise for a double-jump hero variant.
};

/**
 * GROWTH — the core scaling loop. Cocktails and vinyls raise a continuous
 * `growth` charge; scale, weight and every derived stat interpolate from it.
 *
 * Design intent: growing is a POWER FANTASY WITH A COST. You hit harder and
 * reach farther, but you accelerate slower, top out a touch slower, and carry
 * more momentum — the floor turns into a skating rink under a heavy body.
 */
export const GROWTH = {
  /** Charge added per pickup type. Vinyls are the rarer, bigger reward. */
  COCKTAIL_CHARGE: 1.0,
  VINYL_CHARGE: 2.5,
  /** Charge needed to move one full "tier". Purely for readable milestones/SFX. */
  CHARGE_PER_TIER: 6.0,
  /** Charge range that maps onto the scale curve. Past MAX we clamp. */
  CHARGE_MIN: 0.0,
  CHARGE_MAX: 30.0,

  /** Visual + collider scale at min/max charge. */
  SCALE_MIN: 1.0,
  SCALE_MAX: 2.6,
  /** Scale follows target through a critically-damped spring for weighty,
   *  overshoot-free growth. Higher = snappier. */
  SCALE_SMOOTH_OMEGA: 9.0,

  /** Weight is derived from scale (super-linear: doubling size more than doubles
   *  heft). Drives all the inertia math below. */
  WEIGHT_EXPONENT: 1.35,

  /** How base stats bend from light (t=0) to heavy (t=1), t = normalized weight.
   *  Each is a multiplier applied to the MOVE/JUMP base value. */
  // Tuned on tools/growth-measure.mjs. Philosophy: lean INTO the fun cost
  // (momentum — a heavy body is a wrecking ball that's hard to stop/turn) and
  // AWAY from the frustrating cost (a jump so weak the giant is locked out of
  // platforms the level requires). Measured giant: top speed 84%, ~2× stopping
  // slide, apex ~2.9u (still clears the level's 2.85u step-ups).
  MAXSPEED_AT_HEAVY: 0.84,       // big is only a little slower on top speed…
  ACCEL_AT_HEAVY: 0.52,          // …noticeably slower to *get there* (inertia)…
  DECEL_AT_HEAVY: 0.38,          // …and slides much further before stopping (momentum)
  TURN_ASSIST_AT_HEAVY: 0.35,    // heavy bodies really resist a direction change
  AIR_CONTROL_AT_HEAVY: 0.6,     // less steering authority mid-air when massive
  JUMP_VELOCITY_AT_HEAVY: 0.95,  // jumps only a little less high…
  FALL_GRAVITY_AT_HEAVY: 1.15,   // …and drops a bit harder. Reads as "heavy" but fair.

  /** The reward: melee reach scales with body size (slightly super-linear so the
   *  giant form feels genuinely commanding). */
  ATTACK_RANGE_AT_HEAVY: 1.85,
  ATTACK_KNOCKBACK_AT_HEAVY: 2.1,

  /** Collider growth is gated on ceiling clearance (Mario-mushroom rule): we only
   *  let the body expand into space we've shape-cast as empty. */
  CLEARANCE_SKIN: 0.04,
};

/** Player collider + hero silhouette at base scale (a capsule-ish cuboid). */
export const PLAYER = {
  HALF_WIDTH: 0.42,
  HALF_HEIGHT: 0.85,
  /** Attack base reach (units, from body edge) and active window. */
  ATTACK_RANGE: 1.0,
  ATTACK_ACTIVE: 0.12,       // s the hitbox is live
  ATTACK_RECOVERY: 0.18,     // s of recovery before you can act again
  ATTACK_COOLDOWN: 0.28,
  /** Invulnerability window after taking a hit (s). */
  IFRAMES: 0.9,
  MAX_HEALTH: 5,
  /** Retries before a run ends. Carries across levels (not refilled per level). */
  LIVES: 3,
};

/** ICE CUBES — sliding enemies that paint zero-friction zones onto the floor. */
export const ICE = {
  SLIDE_SPEED: 6.5,          // units/s along the ground
  FRICTION_ZONE_LIFETIME: 1.4, // s a melted trail keeps the floor slick
  ZONE_FRICTION: 0.02,       // near-frictionless while active
  BASE_FRICTION: 0.85,       // normal club floor
  /** On the ice, player accel/decel are multiplied by this — the skid. Tuned with
   *  tools/hazard-measure.mjs: 0.16 keeps a base slide of ~2u (clearly slippery)
   *  while a giant's momentum-×-ice slide stays ~3.9u — dramatic but still landable
   *  on a ~4u platform, instead of the 5.2u death-slide 0.12 produced. */
  PLAYER_TRACTION_ON_ICE: 0.16,
};

/** DRUNK PATRONS — erratic sine-wave wanderers with stumbling hitboxes. */
export const DRUNK = {
  BASE_SPEED: 2.4,
  /** Lateral sway: position gets a sine offset. Erratic = two summed sines. */
  SWAY_AMPLITUDE: 1.1,
  SWAY_FREQ_A: 1.7,
  SWAY_FREQ_B: 0.6,          // second, slower sine to break the perfect rhythm
  /** Random stumble: chance/step to lunge, and the lunge impulse. */
  STUMBLE_CHANCE: 0.010,
  STUMBLE_IMPULSE: 5.0,
  STUMBLE_DURATION: 0.35,
  /** Telegraph: the drunk COILS (a visible hesitation, walk nearly halts, lean
   *  back) for this long before the lunge fires — so a ~7u/s dart is readable,
   *  not a cheap instant grab. Verified with tools/drunk-measure.mjs. */
  STUMBLE_WINDUP: 0.18,
  CONTACT_DAMAGE: 1,
  KNOCKBACK: 7.0,
};

/** BROKEN GLASS — floor hazard, damage-over-time while stood in. */
export const GLASS = {
  DOT_PER_SECOND: 1.2,       // health/s while in contact (fractional; HUD floors it)
  TICK_INTERVAL: 0.5,        // apply damage on this cadence
  SLOW_MULT: 0.7,            // wading through glass slows you
};

/** COLLECTIBLES — the little arc + magnet that make pickups feel good. */
export const PICKUP = {
  MAGNET_RADIUS: 2.4,        // base units at which items home toward the player
  /** The magnet WIDENS as the hero grows — the loot-vacuum payoff of the growth
   *  loop. Radius = MAGNET_RADIUS · lerp(1, this, weightT), so a max giant pulls
   *  from ~2.2× as far (≈5.3u). Verified with tools/pickup-measure.mjs. */
  MAGNET_RADIUS_AT_HEAVY: 2.2,
  MAGNET_ACCEL: 40.0,
  BOB_AMPLITUDE: 0.12,
  BOB_FREQ: 2.0,
  SPIN_SPEED: 2.5,           // rad/s for vinyls
};

/**
 * LOOT CRATE — a reinforced case of the good stuff (vinyls). The twist that makes
 * GROWTH a *decision*, not just a feel change: a crate only cracks to a hit hard
 * enough — and melee damage is 2 + tier, so MIN_DAMAGE 4 means you must have grown
 * to tier ≥ 2 to bust it. Small heroes bounce off (a clang); grown heroes get paid.
 * It is NON-SOLID (never blocks the path) so it can't soft-lock a small player —
 * the reward is simply out of reach until you're big enough to earn it.
 */
export const CRATE = {
  HP: 6,
  MIN_DAMAGE: 4,             // needs melee ≥ 4  ⇒  player tier ≥ 2 (dmg = 2 + tier)
  HALF_W: 0.55,
  HALF_H: 0.6,
};

/**
 * BOSS — the DJ Skull Booth. A rhythm-locked, multi-stage fight. Timings are in
 * BEATS (see BeatClock) so every telegraph lands on the music.
 */
export const BOSS = {
  BPM: 128,                  // club-standard four-on-the-floor
  MAX_HEALTH: 150,           // tuned w/ boss-measure.mjs for a ~25-70s TTK band

  /**
   * Each phase is a repeating CYCLE of `cycleBeats`: it ATTACKS for the first
   * `attackBeats`, then DROPS ITS JAW and is EXPOSED for the remainder — that
   * remainder is the only window you can damage it. Keeping the exposed window a
   * constant 2 beats across phases means the punish rhythm stays learnable while
   * the danger escalates (faster waves, denser vinyls, more strobes).
   */
  PHASES: {
    // Phase 1: soundwave shockwaves only. Learnable, fair. 4 attack + 2 exposed.
    ONE: { hpThreshold: 1.00, cycleBeats: 6, attackBeats: 4, shockwaveEveryBeats: 2, shockwaveSpeed: 11 },
    // Phase 2: adds falling vinyls + first strobe blinds.
    TWO: { hpThreshold: 0.66, cycleBeats: 6, attackBeats: 4, shockwaveEveryBeats: 2, shockwaveSpeed: 12,
      vinylEveryBeats: 2, vinylFallSpeed: 14, strobeEveryBeats: 6 },
    // Phase 3: enraged — faster waves, a vinyl every beat, frequent strobes.
    THREE: { hpThreshold: 0.33, cycleBeats: 6, attackBeats: 4, shockwaveEveryBeats: 2, shockwaveSpeed: 13,
      vinylEveryBeats: 1, vinylFallSpeed: 16, strobeEveryBeats: 4 },
  },

  /** Strobe blind: screen floods and contrast inverts for this long; player
   *  vision is degraded but hitboxes still resolve — it tests memory, not luck. */
  STROBE_DURATION: 1.1,
  STROBE_FLASH_HZ: 12,

  /** Exposed window length (beats) = cycleBeats − attackBeats. Kept here for the
   *  HUD / telemetry; the boss derives it from the phase cycle. */
  VULNERABLE_BEATS: 2,
  CONTACT_DAMAGE: 2,
};

/** CAMERA — follow rig with look-ahead, size-aware zoom, and shake budget. */
export const CAMERA = {
  /** Orthographic-ish framing height in world units at base player size. */
  VIEW_HEIGHT: 12.0,
  /** The camera pulls back as the player grows so the giant stays framed. */
  VIEW_HEIGHT_AT_HEAVY: 15.5,
  FOLLOW_LERP: 0.12,         // position smoothing per frame (0..1)
  LOOKAHEAD: 2.6,            // units the camera leads the player's facing/velocity
  LOOKAHEAD_LERP: 0.06,
  /** Deadzone box (on the RAW target, see CameraRig). Y is generous so ordinary
   *  jumps don't bob the camera; X is small so it absorbs idle jitter without
   *  eating much of the look-ahead lead (effective running lead ≈ LOOKAHEAD−DEADZONE_X). */
  DEADZONE_X: 0.4,
  DEADZONE_Y: 1.6,
  /** Perspective camera dolly distance for the 2.5D depth read. */
  DOLLY_Z: 16.0,
  FOV_DEG: 42,
  MAX_SHAKE: 0.9,            // clamps trauma-based shake amplitude (units)
  SHAKE_DECAY: 1.6,         // trauma units/s bled off
};

/**
 * FX — post-processing + juice budget. This is the "saturated crimson club" dial.
 * See PostFX.js / LightingRig.js for how each is consumed.
 */
export const FX = {
  BLOOM: { intensity: 1.35, luminanceThreshold: 0.55, luminanceSmoothing: 0.28, radius: 0.72, mipmapBlur: true },
  CHROMA: { offset: 0.0016, radialModulation: true, modulationOffset: 0.35 },
  VIGNETTE: { darkness: 0.72, offset: 0.28 },
  NOISE: { premultiply: true, opacity: 0.05 },
  SCANLINE: { density: 1.15, opacity: 0.06 },
  /** Crimson color-grade (custom GLSL Effect). Pushes the whole frame toward the
   *  venue's neon crimson while protecting highlights. */
  CRIMSON_GRADE: { tint: [1.0, 0.13, 0.18], strength: 0.34, highlightProtect: 0.7, barrel: 0.12 },
  /** Juice */
  HITSTOP_LIGHT: 0.04,       // s of frozen time on a normal hit
  HITSTOP_HEAVY: 0.11,       // s on a big/growth/boss hit
  SQUASH_JUMP: { x: 0.82, y: 1.24 }, // scale multipliers at launch
  SQUASH_LAND: { x: 1.26, y: 0.72 }, // scale multipliers on touchdown
  SQUASH_RECOVER: 12.0,      // spring omega back to neutral
};

/** INPUT — action names are the contract between InputManager and everything. */
export const ACTIONS = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right',
  UP: 'up',
  DOWN: 'down',
  JUMP: 'jump',
  ATTACK: 'attack',
  DASH: 'dash',
  PAUSE: 'pause',
  CONFIRM: 'confirm',
});

/**
 * Physics collision layers. Rapier uses 16-bit membership | 16-bit filter packed
 * into a u32 collision group. Keep these powers of two.
 */
export const LAYER = Object.freeze({
  WORLD: 0x0001,       // static level geometry
  ONE_WAY: 0x0002,     // one-way platforms
  PLAYER: 0x0004,
  ENEMY: 0x0008,
  HAZARD: 0x0010,
  PICKUP: 0x0020,
  BOSS: 0x0040,
  PROJECTILE: 0x0080,  // vinyls, shockwaves
  SENSOR: 0x0100,
});

/** Named event channels on the global EventBus (decouples systems from each other). */
export const EVENT = Object.freeze({
  PLAYER_JUMP: 'player:jump',
  PLAYER_LAND: 'player:land',
  PLAYER_HURT: 'player:hurt',
  PLAYER_ATTACK: 'player:attack',
  PLAYER_GROW: 'player:grow',           // { tier, scale }
  PLAYER_DIED: 'player:died',
  PICKUP_COLLECTED: 'pickup:collected',  // { kind }
  ENEMY_KILLED: 'enemy:killed',
  BOSS_PHASE: 'boss:phase',              // { phase }
  BOSS_SHOCKWAVE: 'boss:shockwave',      // { x, y }
  BOSS_VINYL: 'boss:vinyl',              // { x, y, vx, vy }
  BOSS_STROBE: 'boss:strobe',            // { on }
  BOSS_VULNERABLE: 'boss:vulnerable',    // { on }
  BOSS_HURT: 'boss:hurt',                // { health }
  BOSS_DEFEATED: 'boss:defeated',
  BEAT: 'audio:beat',                    // { beat, bar }
  CAMERA_SHAKE: 'camera:shake',          // { trauma }
  HITSTOP: 'time:hitstop',               // { seconds }
  STATE_CHANGE: 'game:state',            // { from, to }
});

/**
 * Derived jump physics. Called once at boot and re-derived when growth changes
 * the multipliers, so the arc stays authored-by-intent.
 */
export function deriveJump(heavyT = 0) {
  const H = JUMP.APEX_HEIGHT;
  const t = JUMP.TIME_TO_APEX;
  const riseGravity = (2 * H) / (t * t);
  const v0 = (2 * H) / t;
  const fallGravity = riseGravity * JUMP.FALL_MULTIPLIER;

  // Apply growth weighting.
  const jScale = lerp(1, GROWTH.JUMP_VELOCITY_AT_HEAVY, heavyT);
  const fScale = lerp(1, GROWTH.FALL_GRAVITY_AT_HEAVY, heavyT);

  return {
    riseGravity,
    fallGravity: fallGravity * fScale,
    launchVelocity: v0 * jScale,
    terminal: JUMP.TERMINAL_VELOCITY,
  };
}

export function lerp(a, b, t) {
  return a + (b - a) * clamp01(t);
}

export function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
