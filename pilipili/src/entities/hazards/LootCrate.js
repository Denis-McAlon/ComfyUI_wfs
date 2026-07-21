import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Color } from 'three';
import { Entity } from '../Entity.js';
import { makeGlowMaterial } from '../../render/shaders/NeonMaterial.js';
import { CRATE, EVENT } from '../../config/Constants.js';

/**
 * LootCrate — a reinforced case of vinyls that only a GROWN hero can crack open.
 *
 * This is where the growth mechanic stops being a feel-knob and becomes a choice:
 * the crate ignores any melee below CRATE.MIN_DAMAGE (a clang + shake), and since
 * attack damage is 2 + tier, that gates it behind a size. Bust it and it drops its
 * loot; the GameplayScene reads our `loot` array on the kill and spawns the pickups.
 *
 * It is deliberately NON-SOLID — no collider, it never blocks movement — so it can
 * never soft-lock a small player who can't open it. It just sits there, glowing,
 * daring you to get bigger. Contract: `harmable` + `onPlayerHit()` + `aabb()`.
 */

// Normalise a JSON loot spec into an array of pickup kinds.
function normalizeLoot(spec) {
  if (Array.isArray(spec)) return spec.map((k) => (k === 'vinyl' ? 'vinyl' : 'cocktail'));
  if (typeof spec === 'number') return Array.from({ length: Math.max(1, spec) }, () => 'vinyl');
  return ['vinyl', 'vinyl'];
}

export class LootCrate extends Entity {
  constructor(ctx, { x, y, loot, hp, minDamage } = {}) {
    super(x, y);
    this.type = 'crate';
    this.ctx = ctx;

    // ── Interaction contract ────────────────────────────────────────────────
    this.harmable = true;      // scene resolves the player's melee against us
    this.hurtsPlayer = false;  // inert — no contact damage
    this.pickup = false;

    this.hp = hp ?? CRATE.HP;
    this.minDamage = minDamage ?? CRATE.MIN_DAMAGE;
    this.loot = normalizeLoot(loot);

    this._hw = CRATE.HALF_W;
    this._hh = CRATE.HALF_H;
    this._flashT = 0;   // white hit-flash timer (a solid hit landed)
    this._clangT = 0;   // "too weak" wobble timer

    this._build(ctx);
  }

  _build(ctx) {
    this.view = new Group();
    this.view.position.z = 0;
    // Contents live under an inner group: Entity.syncView owns view.rotation.z for
    // interpolation, so the clang wobble rides this inner node instead (untouched).
    this._inner = new Group();
    this.view.add(this._inner);

    // Dark crate body.
    this._bodyMat = new MeshStandardMaterial({
      color: new Color(0x1a0f07), emissive: new Color(0x2a0a0c), emissiveIntensity: 0.35,
      roughness: 0.8, metalness: 0.05,
    });
    const body = new Mesh(new BoxGeometry(this._hw * 2, this._hh * 2, this._hw * 1.6), this._bodyMat);
    this._inner.add(body);

    // Crimson neon frame: an X-brace across the face + a top rim, so it reads as a
    // reinforced, breakable case rather than a solid wall.
    this._neon = makeGlowMaterial(0xff1030, 0.9);
    const bar = (w, h, rot, px, py) => {
      const m = new Mesh(new BoxGeometry(w, h, 0.08), this._neon);
      m.rotation.z = rot; m.position.set(px, py, this._hw * 0.82);
      this._inner.add(m); return m;
    };
    const diag = Math.hypot(this._hw, this._hh) * 1.9;
    bar(diag, 0.09, Math.atan2(this._hh, this._hw), 0, 0);
    bar(diag, 0.09, -Math.atan2(this._hh, this._hw), 0, 0);
    bar(this._hw * 2 + 0.04, 0.09, 0, 0, this._hh - 0.04);
    bar(this._hw * 2 + 0.04, 0.09, 0, 0, -this._hh + 0.04);

    // A magenta "loot" pip in the centre — the tell that there's a prize inside.
    this._pip = new Mesh(new BoxGeometry(0.22, 0.22, 0.1), makeGlowMaterial(0xff2b6b, 1.0));
    this._pip.position.set(0, 0, this._hw * 0.9);
    this._inner.add(this._pip);

    ctx.renderer?.scene?.add(this.view);
  }

  aabb() {
    return { x: this.x, y: this.y, hw: this._hw, hh: this._hh };
  }

  /**
   * Melee response. A hit below MIN_DAMAGE just clangs (you're too small); a
   * qualifying hit chips HP and, at zero, breaks the crate open. Returns true when
   * broken so the scene emits the kill VFX and spawns our loot.
   */
  onPlayerHit({ damage = 0 } = {}) {
    if (this.hp <= 0) return false;
    if (damage < this.minDamage) {
      this._clangT = 0.18;                       // "not big enough" wobble
      this.ctx.cameraRig?.addTrauma?.(0.1);
      return false;
    }
    this.hp -= damage;
    this._flashT = 0.12;
    if (this.hp <= 0) { this.destroy(); return true; }
    return false;
  }

  update(frameDt) {
    if (!this.view) return;
    // Solid-hit flash: briefly wash the body emissive white.
    if (this._flashT > 0) {
      this._flashT = Math.max(0, this._flashT - frameDt);
      const k = this._flashT / 0.12;
      this._bodyMat.emissiveIntensity = 0.35 + 2.2 * k;
      this._pip.scale.setScalar(1 + 0.5 * k);
    }
    // Clang wobble: a quick side-to-side shudder that says "too tough for you".
    if (this._clangT > 0) {
      this._clangT = Math.max(0, this._clangT - frameDt);
      this._inner.rotation.z = Math.sin(this._clangT * 90) * 0.06 * (this._clangT / 0.18);
    } else if (this._inner.rotation.z !== 0) {
      this._inner.rotation.z = 0;
    }
  }

  destroy() {
    this._bodyMat?.dispose?.();
    super.destroy();
  }
}
