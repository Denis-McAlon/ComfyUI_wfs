import { Group, Mesh, CylinderGeometry, ConeGeometry, MeshStandardMaterial, Color } from 'three';
import { Entity } from './Entity.js';
import { makeGlowMaterial } from '../render/shaders/NeonMaterial.js';
import { PICKUP, GROWTH } from '../config/Constants.js';

/**
 * Collectible — a floating cocktail or vinyl that feeds the growth engine. It
 * idles with a gentle bob (vinyls also spin on their face), and once a nearby
 * player crosses the magnet radius it homes toward them, so a big, hungry hero
 * vacuums up loot from a wider reach.
 *
 * We only MOVE and expose `pickup` / `kind` / `charge` / `aabb()`; the
 * GameplayScene does the actual collection (player.addGrowth + destroy) on
 * overlap — this entity never touches the player directly.
 */

const HW = 0.4;
const HH = 0.5;

export class Collectible extends Entity {
  constructor(ctx, { x, y, kind = 'cocktail' } = {}) {
    super(x, y);
    this.type = 'pickup';
    this.ctx = ctx;

    // ── Interaction contract ────────────────────────────────────────────────
    this.pickup = true;
    this.kind = kind === 'vinyl' ? 'vinyl' : 'cocktail';
    // Vinyls are the rarer, bigger reward (see GROWTH charges).
    this.charge = this.kind === 'vinyl' ? GROWTH.VINYL_CHARGE : GROWTH.COCKTAIL_CHARGE;

    // Bob / magnet state.
    this._t = Math.random() * Math.PI * 2; // random phase so a row won't bob in lockstep
    this._baseY = y;
    this.vx = 0;
    this.vy = 0;

    // ── View ────────────────────────────────────────────────────────────────
    this.view = new Group();
    this.view.position.z = 0;
    if (this.kind === 'vinyl') this._buildVinyl();
    else this._buildCocktail();
    ctx.renderer.scene.add(this.view);
  }

  _buildVinyl() {
    // Dark record disc, face-on to the camera (cylinder axis rotated onto Z).
    const disc = new Mesh(
      new CylinderGeometry(0.4, 0.4, 0.05, 28),
      new MeshStandardMaterial({ color: new Color(0x0a0a0d), emissive: new Color(0x160a0c), emissiveIntensity: 0.3, roughness: 0.4 }),
    );
    disc.rotation.x = Math.PI / 2;
    // Crimson glowing centre label.
    const label = new Mesh(new CylinderGeometry(0.14, 0.14, 0.06, 20), makeGlowMaterial(0xff1030, 0.95));
    label.rotation.x = Math.PI / 2;
    // A small off-centre spindle mark so the spin actually reads on a round disc.
    const mark = new Mesh(new CylinderGeometry(0.03, 0.03, 0.07, 8), makeGlowMaterial(0xffd0d6, 0.9));
    mark.rotation.x = Math.PI / 2;
    mark.position.set(0.09, 0.09, 0);
    this.view.add(disc, label, mark);
  }

  _buildCocktail() {
    // A little martini: bowl (wide top, point down) + glowing liquid + stem/foot.
    const glassMat = new MeshStandardMaterial({
      color: new Color(0x223033), emissive: new Color(0x8fd8ff), emissiveIntensity: 0.25,
      transparent: true, opacity: 0.5, roughness: 0.1,
    });
    const bowl = new Mesh(new ConeGeometry(0.24, 0.30, 18, 1, true), glassMat);
    bowl.rotation.z = Math.PI;      // flip apex-down (martini bowl)
    bowl.position.y = 0.16;
    // Glowing crimson liquid nested in the bowl.
    const liquid = new Mesh(new ConeGeometry(0.18, 0.20, 16), makeGlowMaterial(0xff1030, 0.95));
    liquid.rotation.z = Math.PI;
    liquid.position.y = 0.16;
    // Stem + foot.
    const stem = new Mesh(new CylinderGeometry(0.02, 0.02, 0.22, 8), glassMat);
    stem.position.y = -0.06;
    const foot = new Mesh(new CylinderGeometry(0.12, 0.12, 0.03, 16), glassMat);
    foot.position.y = -0.18;
    this.view.add(bowl, liquid, stem, foot);
  }

  fixedUpdate(dt) {
    this.snapshot();
    this._t += dt;

    const player = this.ctx.player;
    let magnetized = false;
    if (player) {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < PICKUP.MAGNET_RADIUS) {
        magnetized = true;
        // Accelerate toward the player and integrate — a homing vacuum.
        const inv = dist > 1e-4 ? 1 / dist : 0;
        this.vx += dx * inv * PICKUP.MAGNET_ACCEL * dt;
        this.vy += dy * inv * PICKUP.MAGNET_ACCEL * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this._baseY = this.y; // keep the bob continuous should the magnet release
      }
    }
    if (!magnetized) {
      // Idle hover around the spawn height; horizontal position holds still.
      this.vx = 0;
      this.vy = 0;
      this.y = this._baseY + PICKUP.BOB_AMPLITUDE * Math.sin(this._t * PICKUP.BOB_FREQ);
    }

    // Vinyls spin on their face; syncView interpolates this.angle → rotation.z.
    if (this.kind === 'vinyl') this.angle += PICKUP.SPIN_SPEED * dt;
  }

  aabb() {
    return { x: this.x, y: this.y, hw: HW, hh: HH };
  }
}
