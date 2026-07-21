import {
  Group, Mesh, BoxGeometry, MeshStandardMaterial, Color,
} from 'three';
import { NeonMaterial } from '../render/shaders/NeonMaterial.js';
import { LAYER } from '../config/Constants.js';

// Level geometry is authored as JSON and imported statically so Vite bundles it
// at build time (zero runtime fetch, works offline / in an itch.io zip). `load()`
// is therefore SYNCHRONOUS — GameplayScene.enter() can call it inline.
import level01 from './levels/level_01_backroom.json';
import level02 from './levels/level_02_maindeck.json';
import level03 from './levels/level_03_lafosse.json';
import bossArena from './levels/boss_arena.json';

/** Registry of every shippable level, keyed by the id PlayState/BossState pass. */
const LEVELS = {
  level_01_backroom: level01,
  level_02_maindeck: level02,
  level_03_lafosse: level03,
  boss_arena: bossArena,
};

// ── Look constants ───────────────────────────────────────────────────────────
// Platforms are dark, near-black glass volumes lit only by a neon strip along
// their walkable edge — the whole venue is carved out of black by neon (see
// LightingRig). One-way platforms glow magenta so the player reads "pass-through".
const SOLID_NEON = 0xff1030;   // house crimson
const ONEWAY_NEON = 0xff2b6b;  // magenta — the "you can jump through me" tell
const BOX_DEPTH = 1.8;         // Z thickness for the 2.5D parallax read
const BOX_Z = -1.0;            // pushed behind the gameplay plane (player renders in front)

/**
 * Level.js — turns a level JSON into (a) Rapier static colliders and (b) matching
 * neon-lit meshes, and hands GameplayScene the spawn/enemy/pickup/hazard data it
 * needs. It owns NOTHING about gameplay rules; it is purely "build the room, then
 * tear it down".
 *
 * The contract with GameplayScene is exact — `load()` returns:
 *   { spawn:{x,y}, bossArenaX, enemies:[...], pickups:[...], hazards:[...], width, height }
 * with the entity arrays passed straight through from the JSON (the scene owns
 * their interpretation via ENEMY_CTOR / Collectible / BrokenGlass).
 *
 * JSON PLATFORM CONVENTION: each platform is { x, y, w, h, oneWay? } where (x,y) is
 * the CENTRE and (w,h) are FULL sizes. Rapier wants half-extents, so we pass w/2,h/2.
 */
export class Level {
  constructor(ctx) {
    this.ctx = ctx;
    this.data = null;
    this._colliders = [];   // Rapier colliders to remove on unload
    this._meshes = [];      // THREE.Group per platform to remove + dispose
    this._materials = [];   // shared materials to dispose once on unload
  }

  /**
   * Build the chosen level. Synchronous by design.
   * @param {string} levelId key into LEVELS
   * @returns {{spawn:{x:number,y:number}, bossArenaX:(number|null), enemies:Array, pickups:Array, hazards:Array, width:number, height:number}}
   */
  load(levelId) {
    const data = LEVELS[levelId] || level01;
    if (!LEVELS[levelId]) console.warn(`[Level] unknown level "${levelId}", falling back to level_01_backroom`);
    this.data = data;

    const scene = this.ctx?.renderer?.scene;
    const lighting = this.ctx?.renderer?.lighting;

    // Shared materials: one dark body + one neon per platform KIND. Sharing keeps
    // the LightingRig's neon tick list to two entries per level instead of one per
    // platform, and lets a single dispose() free them on unload.
    const darkMat = new MeshStandardMaterial({
      color: 0x0a0710, roughness: 0.85, metalness: 0.05,
      emissive: new Color(0x140309), emissiveIntensity: 0.25,
    });
    const solidNeon = new NeonMaterial({ color: SOLID_NEON, intensity: 2.8, flicker: 0.05, rim: 1.6 });
    const onewayNeon = new NeonMaterial({ color: ONEWAY_NEON, intensity: 2.6, flicker: 0.14, rim: 1.4 });
    // Register the neon so LightingRig animates its flicker in sync with the venue.
    lighting?.registerNeon?.(solidNeon);
    lighting?.registerNeon?.(onewayNeon);
    this._materials.push(darkMat, solidNeon, onewayNeon);

    for (const plat of data.platforms || []) {
      const { x, y, w, h, oneWay } = plat;
      const hx = w / 2;
      const hy = h / 2;

      // (a) Physics collider — one-way platforms get the directional pass-through
      //     collider; everything else is solid world geometry.
      const col = oneWay
        ? this.ctx.physics.createOneWayPlatform(x, y, hx, hy)
        : this.ctx.physics.createStaticBox(x, y, hx, hy, { layer: LAYER.WORLD });
      this._colliders.push(col);

      // (b) Matching mesh: a dark box + neon edge strips on its front face.
      if (scene) {
        const group = this._buildPlatformMesh(w, h, oneWay ? onewayNeon : solidNeon, darkMat);
        group.position.set(x, y, BOX_Z);
        scene.add(group);
        this._meshes.push(group);
      }
    }

    // Return EXACTLY the shape GameplayScene consumes; arrays pass straight through.
    return {
      name: data.name ?? null,        // human-readable level title (for HUD/debug)
      spawn: data.spawn || { x: 0, y: 2 },
      bossArenaX: data.bossArenaX ?? null,
      next: data.next ?? null,        // next level id, or 'boss', or null (→ boss)
      enemies: data.enemies || [],
      pickups: data.pickups || [],
      hazards: data.hazards || [],
      width: data.width ?? 100,
      height: data.height ?? 20,
    };
  }

  /**
   * Build one platform's visual: a dark glass box framed by two thin neon strips
   * (top edge = the walkable rim, bottom edge = a grounding underglow). Both strips
   * share the passed-in neon material so they flicker together and dispose once.
   */
  _buildPlatformMesh(w, h, neonMat, darkMat) {
    const group = new Group();
    const frontZ = BOX_DEPTH / 2; // local Z of the face turned toward the camera

    // Dark body.
    const body = new Mesh(new BoxGeometry(w, h, BOX_DEPTH), darkMat);
    group.add(body);

    // Top neon strip — sits on the walkable edge and blooms hardest (the "rim").
    const top = new Mesh(new BoxGeometry(w + 0.04, 0.1, 0.1), neonMat);
    top.position.set(0, h / 2 - 0.02, frontZ);
    group.add(top);

    // Bottom neon strip — a subtler underglow so the slab reads as a lit object.
    const bottom = new Mesh(new BoxGeometry(w + 0.02, 0.07, 0.07), neonMat);
    bottom.position.set(0, -h / 2 + 0.02, frontZ);
    group.add(bottom);

    return group;
  }

  /**
   * Tear the room down: remove every collider from the physics world and every
   * mesh from the scene, disposing the per-platform geometries and the shared
   * materials so nothing leaks across a level reload.
   *
   * (Note: LightingRig exposes no "unregister" for neon materials, so a disposed
   * material lingers as a harmless no-op in its tick list — a known limitation of
   * the frozen engine, not a growing GPU cost, since the GL program is freed here.)
   */
  unload() {
    for (const col of this._colliders) this.ctx.physics.removeCollider(col);
    this._colliders.length = 0;

    const scene = this.ctx?.renderer?.scene;
    for (const group of this._meshes) {
      scene?.remove(group);
      group.traverse((obj) => { obj.geometry?.dispose?.(); });
    }
    this._meshes.length = 0;

    for (const mat of this._materials) mat.dispose?.();
    this._materials.length = 0;

    this.data = null;
  }
}
