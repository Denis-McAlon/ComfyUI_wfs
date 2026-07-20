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

*Tap jump = hop, hold = full jump. The jump honours coyote-time and input
buffering — it's meant to feel like it reads your mind.*

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
