import {
  Group, Mesh, MeshStandardMaterial, Color,
  IcosahedronGeometry, BoxGeometry, CylinderGeometry, SphereGeometry,
  AdditiveBlending, BackSide,
} from 'three';
import { PLAYER } from './Constants.js';

/**
 * Characters.js — the two playable heroes: their display metadata (for the
 * character-select screen) and a procedural mesh builder (for the scene).
 *
 * The colors below are the single source of truth for BOTH the select-screen UI
 * and the 3D mesh, so a hero's look is defined once. `buildHeroView()` assembles a
 * stylised low-poly humanoid from primitives — no art assets, readable at a glance,
 * with a faint crimson neon rim so the bloom pass catches the silhouette in the
 * dark club.
 */

/**
 * Per-hero metadata straight from the brief. Colors are Three.js hex numbers so
 * the builder can hand them to materials directly (and the CSS layer can format
 * them for swatches).
 *
 *   male  : dark hair, GREY shirt WITH RED DOTS, black shorts.
 *   female: dark hair, BLACK t-shirt, black shorts.
 */
export const CHARACTERS = Object.freeze({
  male: {
    id: 'male',
    name: 'Milo',
    description: 'Cheveux bruns, chemise grise à pois rouges, short noir. Léger et vif sur ses appuis.',
    dots: true, // grey shirt is speckled with little red dots
    hair:   0x1a1418, // near-black dark brown
    top:    0x9aa0a8, // grey shirt
    bottom: 0x0e0e12, // black shorts
    skin:   0xe8b79a, // warm mid skin tone
    accent: 0xff1030, // venue crimson — the neon rim + the shirt dots
  },
  female: {
    id: 'female',
    name: 'Lola',
    description: 'Cheveux bruns, t-shirt noir, short noir. Rapide et féline entre les néons.',
    dots: false,
    hair:   0x1a1418, // near-black dark brown
    top:    0x141319, // black t-shirt
    bottom: 0x0e0e12, // black shorts
    skin:   0xf0c3a8, // warm light skin tone
    accent: 0xff1030, // venue crimson — the neon rim
  },
});

/**
 * buildHeroView(characterId) → THREE.Group
 *
 * Authored at SCALE 1 with the ORIGIN AT THE BODY CENTRE: feet sit at
 * y = -PLAYER.HALF_HEIGHT and the head crown reaches ≈ +PLAYER.HALF_HEIGHT, so the
 * silhouette is ~2·HALF_WIDTH wide × 2·HALF_HEIGHT tall and matches the physics
 * capsule exactly. Player.syncView() owns position, growth scale, squash and the
 * facing flip — this builder must NOT touch them.
 *
 * The +Z face points at the camera (the game views the X–Y plane down -Z), so all
 * front detail (eyes, the male's red dots) lives on +Z.
 */
export function buildHeroView(characterId = 'male') {
  const def = CHARACTERS[characterId] || CHARACTERS.male;

  // Body-frame dimensions, all derived from the collider so the mesh tracks the
  // constants if they ever change.
  const H = PLAYER.HALF_HEIGHT;   // 0.85
  const W = PLAYER.HALF_WIDTH;    // 0.42
  const FH = 2 * H;               // full height (~1.70)
  const FW = 2 * W;               // full width  (~0.84)
  const feetY = -H;               // feet plant at the bottom of the collider

  /** Map a 0..1 fraction "up from the feet" to a world Y inside the body frame. */
  const fy = (frac) => feetY + frac * FH;

  const group = new Group();
  group.name = `hero:${def.id}`;

  // ── Materials ───────────────────────────────────────────────────────────────

  /** A lit body material with a faint crimson emissive so the club's darkness
   *  never swallows the hero and the rim reads as neon-kissed. */
  const bodyMat = (color) => new MeshStandardMaterial({
    color: new Color(color),
    emissive: new Color(def.accent),
    emissiveIntensity: 0.16,    // subtle — a tint, not a light source
    roughness: 0.6,
    metalness: 0.0,
  });

  /** A pure-emissive, additively-blended material for glowing bits (rim, dots) —
   *  toneMapped:false lets it exceed 1.0 so the Bloom pass treats it as light. */
  const glowMat = (color, intensity = 2.4, opacity = 1) => new MeshStandardMaterial({
    color: 0x000000,
    emissive: new Color(color),
    emissiveIntensity: intensity,
    transparent: opacity < 1,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  // ── Small builder helpers ───────────────────────────────────────────────────

  const add = (geo, mat, x, y, z = 0) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };

  /** A back-face "shell" a hair wider than a part: additive crimson that only its
   *  silhouette shows, i.e. a cheap neon rim/fresnel outline for the bloom pass. */
  const addRim = (geo, x, y, z, scale = 1.08) => {
    const m = new Mesh(geo, glowMat(def.accent, 2.2, 0.5));
    m.material.side = BackSide;
    m.position.set(x, y, z);
    m.scale.setScalar(scale);
    group.add(m);
    return m;
  };

  // ── Legs & shoes (skin + black shorts) ──────────────────────────────────────

  const legR = 0.11 * FW;
  const legGeo = new CylinderGeometry(legR, legR * 0.9, 0.30 * FH, 8);
  const shoeGeo = new BoxGeometry(0.20 * FW, 0.06 * FH, 0.34 * FW);
  const legX = 0.15 * FW;
  for (const s of [-1, 1]) {
    add(legGeo, bodyMat(def.skin), s * legX, fy(0.20));          // bare shins
    add(shoeGeo, bodyMat(0x151318), s * legX, fy(0.03), 0.05 * FW); // dark shoes
  }

  // Black shorts: a chunky hip block bridging torso and legs.
  const shortsGeo = new BoxGeometry(0.60 * FW, 0.16 * FH, 0.36 * FW);
  add(shortsGeo, bodyMat(def.bottom), 0, fy(0.40));

  // ── Torso (the shirt) ───────────────────────────────────────────────────────

  const torsoGeo = new BoxGeometry(0.62 * FW, 0.34 * FH, 0.34 * FW);
  const torsoY = fy(0.62);
  add(torsoGeo, bodyMat(def.top), 0, torsoY);
  addRim(torsoGeo, 0, torsoY, 0);           // neon rim on the main mass

  // Male only: a scatter of tiny red emissive dots across the front of the shirt.
  if (def.dots) {
    const dotGeo = new SphereGeometry(0.028 * FW + 0.006, 8, 6);
    const dotMat = glowMat(def.accent, 3.0);
    const frontZ = 0.17 * FW + 0.01;        // just proud of the shirt's +Z face
    const spots = [
      [-0.16, 0.70], [0.12, 0.66], [-0.06, 0.60],
      [0.18, 0.58], [-0.18, 0.54], [0.02, 0.72], [0.08, 0.50],
    ];
    for (const [fx, fh] of spots) add(dotGeo, dotMat, fx * FW, fy(fh), frontZ);
  }

  // ── Arms (short sleeves → skin) ─────────────────────────────────────────────

  const armR = 0.085 * FW;
  const armGeo = new CylinderGeometry(armR, armR * 0.85, 0.34 * FH, 8);
  const sleeveGeo = new CylinderGeometry(armR * 1.35, armR * 1.35, 0.09 * FH, 8);
  const armX = 0.31 * FW + armR;
  for (const s of [-1, 1]) {
    add(armGeo, bodyMat(def.skin), s * armX, fy(0.61));            // bare arm
    add(sleeveGeo, bodyMat(def.top), s * armX, fy(0.75));          // shirt sleeve cap
  }

  // ── Neck & head (skin + dark hair) ──────────────────────────────────────────

  const neckGeo = new CylinderGeometry(0.08 * FW, 0.09 * FW, 0.06 * FH, 8);
  add(neckGeo, bodyMat(def.skin), 0, fy(0.81));

  const headR = 0.115 * FH;
  const headGeo = new IcosahedronGeometry(headR, 2);   // faceted low-poly head
  const headY = fy(0.885);                              // crown lands near +H
  add(headGeo, bodyMat(def.skin), 0, headY);
  addRim(headGeo, 0, headY, 0, 1.1);

  // Hair: a slightly larger dark cap nudged up-and-back so the face (front/lower)
  // stays skin while the top and back read as hair.
  const hairGeo = new IcosahedronGeometry(headR * 1.06, 2);
  add(hairGeo, bodyMat(def.hair), 0, headY + headR * 0.28, -headR * 0.22);

  // Tiny dark eyes on the +Z face for a readable front. Cosmetic.
  const eyeGeo = new SphereGeometry(headR * 0.13, 8, 6);
  const eyeMat = new MeshStandardMaterial({ color: 0x0a0a0d, roughness: 0.9 });
  for (const s of [-1, 1]) add(eyeGeo, eyeMat, s * headR * 0.34, headY + headR * 0.05, headR * 0.9);

  return group;
}
