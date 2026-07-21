# 🌶️ Le PiliPili — Neon Club Platformer

A highly stylized **2.5D platformer** set inside *Le PiliPili*, the crimson-lit
music bar in Mimizan. Grow by collecting **cocktails** and **vinyls**, slide on
**ice cubes**, dodge **drunk patrons** and **broken glass**, and take down the
**DJ Skull Booth** in a rhythm-locked final battle.

Stack: **Three.js** (WebGL2) · **Rapier2D** (WASM physics) · **pmndrs/postprocessing**
(bloom / chromatic aberration / glitch / CRT) · **Vite**.

> Full system design in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Quickstart

```bash
cd pilipili
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle → dist/ (base:'./', drops into any static host)
```

Requires Node 18+ and a WebGL2 browser.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move | ← → / A D | Left stick / D-pad |
| Jump (variable height) | Space / Z / K | A |
| Attack | X / J / L | X |
| Dash (reserved) | Shift / C | RB / RT |
| Pause | Esc / P | Start |
| **Debug/feel overlay** | **F1** | — |

*Tap jump = hop, hold = full jump. The jump honours coyote-time and input
buffering — it's meant to feel like it reads your mind.*

**Tuning the jump (P0).** Press **F1** in-game for a live readout — state,
velocity, and the last jump's *measured* apex & air-time (measured in the fixed
sim, so it's identical on any display refresh rate). For headless numbers, run
`node tools/jump-measure.mjs` — it drives the real Player/physics over a flat
floor at an exact 1/60 step and prints the full arc (apex, time-to-apex, tap↔hold
range, coyote & buffer windows). Current tuned arc: apex ≈3.2u, coyote 6f,
buffer 6f. Change a value in `Constants.js`, re-run the bench, feel it with F1.

Dev console hook: `window.__game` is exposed — e.g. `__game.ctx.player.addGrowth(20)`
to test the giant form instantly.

---

## What's implemented

- **Fixed-timestep engine** (60 Hz sim + interpolated render), generic FSM,
  EventBus, hitstop/time-scale.
- **Player**: full game-feel stack (coyote, buffer, asymmetric gravity, apex
  hang, variable height, turn assist) + the **growth engine** (spring scale →
  weight → every stat, clearance-gated collider resize, size-scaled reach).
- **Kinematic collide-and-slide** motor over Rapier (one-way platforms,
  auto-step, snap-to-ground).
- **Enemies/hazards**: ice cubes (slick zones), drunk patrons (sine wander +
  stumble), broken glass (DoT), collectibles (magnet).
- **DJ Skull Booth boss**: 3 beat-locked phases (shockwaves → falling vinyls +
  strobe → enraged), vulnerability window, procedural skull with glowing eyes +
  chili (GLTF-swap hook).
- **Visual pipeline**: HDR bloom, chromatic aberration, custom crimson-grade
  GLSL, ACES, shockwave distortion, glitch, scanlines/vignette/grain; crimson
  lighting rig with flicker + strobe; pooled particles; trauma-shake camera with
  look-ahead and size-zoom.
- **Procedural audio** (no asset files) + deterministic **BeatClock**.
- Character select (male/female heroes), HUD, JSON-driven levels.

---

## Tuning — the craft lives in `src/config/Constants.js`

Everything that affects *feel* is a named constant there. The high-value knobs:

| Want… | Edit |
| --- | --- |
| Snappier / floatier jump | `JUMP.TIME_TO_APEX`, `JUMP.FALL_MULTIPLIER` (1.5–2.0) |
| More forgiving jump | `JUMP.COYOTE_FRAMES`, `JUMP.BUFFER_FRAMES` (5–8) |
| How different "big" feels | `GROWTH.*_AT_HEAVY` multipliers |
| Ice slipperiness | `ICE.PLAYER_TRACTION_ON_ICE` |
| Neon intensity / grade | `FX.BLOOM`, `FX.CRIMSON_GRADE` |
| Boss difficulty / tempo | `BOSS.BPM`, `BOSS.PHASES.*` |

Re-derive the jump arc from intent with `deriveJump()` — set the apex height and
time-to-apex; gravity and launch velocity fall out.

---

## Measurement benches — tune on data, not vibes

The whole simulation layer is Three.js-free, so every feel system can be driven
headless at an exact 1/60 step and *measured*. Each pass below was tuned against
its bench and then verified in a real headless browser. Re-run any of them after
a change:

| Command | Measures | Guards against |
| --- | --- | --- |
| `npm run measure:jump` | apex, time-to-apex, coyote/buffer windows, tap↔hold range, run reach | floaty/off-by-one jump |
| `npm run measure:growth` | top speed, accel time, stop/turn slide, apex & reach by size | growth that doesn't grow / bad inertia |
| `npm run measure:boss` | attack↔expose cycle, vulnerability windows, TTK & phases by tier | an unwinnable or trivial boss |
| `npm run measure:hazard` | ice skid + glass wade by size, detection unit-checks, DoT | slippery-vs-sticky mix-ups, death-slides |
| `npm run measure:drunk` | stumble rate, lunge distance, telegraph, hitbox, patrol coverage | cheap un-telegraphed lunges |
| `npm run analyze` | **level solvability** for base AND giant, pickup reach, teaching order, density | soft-locks, unreachable rewards |

`npm run analyze` verified `level_01_backroom` is fully solvable for both the base
hero and a max-grown giant (15/15 platforms, 18/18 pickups, boss reachable),
teaches each mechanic solo before combining them, and ramps hazard density in a
clean tension arch. Run it whenever you edit a level's geometry.

---

## Swapping in real art

The scaffold ships **procedural** meshes so it runs with zero assets. Production
swap points:

- **Boss skull** → `DjSkullBoss.loadModel(url)` loads a GLTF; name nodes
  `Jaw`, `EyeL/EyeR`, `Chili` in your DCC and wire them where noted.
- **Heroes** → replace `buildHeroView()` in `config/Characters.js` with a
  skinned GLTF + `AnimationMixer`; keep the origin at body centre.
- **Levels** → author `src/world/levels/*.json` (`platforms`, `enemies`,
  `pickups`, `hazards`, `spawn`, `bossArenaX`); `Level.js` builds colliders +
  neon meshes from them.

---

## Roadmap (prototyping phases)

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §1 and the "Next Steps
Framework" in the design brief. Phase 1 target: **one playable room + the boss,
tuned to feel**, everything else stubbed procedurally.

---

## Credit / IP note

*Le PiliPili* and its skull-booth logo are the venue's own identity; this is a
fan/tribute game scaffold. Ship with the venue's blessing before any public
release using their marks.
