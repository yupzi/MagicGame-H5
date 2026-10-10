import { sfx } from "../engine/audio";
import { ellipse, line, px, rect, ring, type Ctx } from "../engine/gfx";
import { clamp, rand } from "../engine/math";
import { FlashFx, GroundCircleFx, LightningFx, PillarFx, RingFx, SkySigilFx, type Effect } from "./effects";
import type { Entity } from "./entity";
import type { Game } from "./game";
import { Gate } from "./gates";
import { P } from "./palette";
import type { Player } from "./player";
import type { Projectile } from "./projectile";
import { Resource } from "./resources";
import { ELEMENTS, type ElementId } from "./runes";
import type { Platform } from "./world";

/** Star-chart damage bonuses apply to every form of their element. */
export function elementDamage(game: Game, el: ElementId, base: number) {
  if (el === "star") return base + game.progress.level("star_dmg");
  if (el === "thunder") return base + game.progress.level("thunder_dmg");
  return base;
}

function boxDist(h: Entity, x: number, y: number) {
  const b = h.box();
  return Math.hypot(clamp(x, b.x0, b.x1) - x, clamp(y, b.y0, b.y1) - y);
}

/** Where a lightning arc should land: gates are world-tall, so aim for their crystal. */
function aimY(h: Entity) {
  return h instanceof Gate ? h.y - 26 : h.cy;
}

/** Everything whose box comes within r of (x, y). */
function within(game: Game, x: number, y: number, r: number) {
  return game.hurtables().filter((h) => boxDist(h, x, y) < r);
}

/** Things that stand in the world for a while (ice pillars, vines, mushrooms). */
interface Standing {
  dead: boolean;
  wither(): void;
}

const standing = new Map<string, Standing[]>();

/** Registers a new standing thing; the oldest of its kind withers once there are more than max. */
function stand(key: string, s: Standing, max: number) {
  const list = (standing.get(key) ?? []).filter((x) => !x.dead);
  list.push(s);
  while (list.length > max) list.shift()!.wither();
  standing.set(key, list);
}

/** Ground (or water surface) under (x, y), used by lobbed seeds. */
function surfaceAt(game: Game, x: number, y: number) {
  return game.world.surfaceBelow(x, y - 6, 300) ?? { y, water: false };
}

// ================================================================ Ring

const RING_R: Record<ElementId, number> = { star: 34, fire: 30, ice: 36, thunder: 46, flower: 40 };
const RING_LIFE = 0.3;

/** A burst that expands from the caster and touches everything in reach once. */
export class RingSpell implements Projectile {
  dead = false;
  private t = 0;
  private r = 0;
  private x: number;
  private y: number;
  private readonly rMax: number;
  private hit = new Set<Entity>();

  constructor(game: Game, private p: Player, private el: ElementId) {
    this.x = p.x;
    this.y = p.cy;
    this.rMax = RING_R[el] * (el === "fire" ? 1 + 0.25 * game.progress.level("fire_radius") : 1);
    const info = ELEMENTS[el];
    game.addFx(new GroundCircleFx(p.x, p.y, this.rMax * 0.7, 0.55, info.main, info.accent, "ring", info.glyphs));
    game.addFx(new FlashFx(this.x, this.y, 10, 0.08, P.white, info.main));
    if (el === "star") sfx.bolt();
    else if (el === "fire") sfx.fireCast();
    else if (el === "ice") sfx.iceCast();
    else if (el === "thunder") sfx.thunderCharge();
    else {
      sfx.bloom();
      game.healPlayer(1);
      game.bloomArea(p.x, p.y, this.rMax);
      game.addFx(new FlowerPatchFx(game, p.x, p.y, this.rMax, 7));
    }
    game.shake(el === "flower" ? 0.08 : 0.2);
  }

  update(game: Game, dt: number) {
    this.t += dt;
    const k = Math.min(1, this.t / RING_LIFE);
    this.x = this.p.x;
    this.y = this.p.cy;
    this.r = this.rMax * (1 - (1 - k) * (1 - k));
    for (const h of game.hurtables()) {
      if (this.hit.has(h) || boxDist(h, this.x, this.y) > this.r) continue;
      this.hit.add(h);
      this.strike(game, h);
    }
    if (this.el === "ice") {
      for (let x = this.x - this.r; x <= this.x + this.r; x += 4) game.freezeWater(x, this.p.y, 40);
    }
    const info = ELEMENTS[this.el];
    const soft = this.el === "fire" || this.el === "flower";
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      game.particles.burst(this.x + Math.cos(a) * this.r, this.y + Math.sin(a) * this.r, {
        count: 1, colors: [info.main, info.accent, P.white], speed: [10, 40], life: [0.15, 0.35],
        size: [1.5, 3], shape: soft ? "circle" : "px", shrink: soft, additive: !soft, gravity: this.el === "fire" ? -60 : 0,
      });
    }
    if (this.t >= RING_LIFE) this.dead = true;
  }

  private strike(game: Game, h: Entity) {
    const dir = Math.sign(h.x - this.x) || this.p.facing;
    switch (this.el) {
      case "star":
        h.hurt(game, elementDamage(game, "star", 1), dir, 2.4, "bolt");
        break;
      case "fire":
        h.hurt(game, 2, dir, 1.2, "fire");
        game.particles.burst(h.x, h.cy, {
          count: 6, colors: [P.fire, P.fireHi, P.fireDark], speed: [30, 80], life: [0.25, 0.45], size: [1.5, 3],
          shape: "circle", shrink: true, gravity: -80,
        });
        break;
      case "ice":
        h.hurt(game, 1, dir, 0.4, "ice");
        break;
      case "thunder":
        game.addFx(new LightningFx(this.x, this.y, h.x, aimY(h), 0.2, 1));
        h.hurt(game, elementDamage(game, "thunder", 2), dir, 0.8, "thunder");
        sfx.zap();
        break;
      case "flower":
        h.hurt(game, 1, dir, 0.3, "bloom");
        break;
    }
  }

  draw(ctx: Ctx) {
    const info = ELEMENTS[this.el];
    const k = this.t / RING_LIFE;
    const r = this.r;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.22 * (1 - k);
    ellipse(ctx, this.x, this.y, r, r, info.main);
    ctx.restore();
    ring(ctx, this.x, this.y, r, r, k < 0.6 ? P.white : info.accent);
    ring(ctx, this.x, this.y, r - 1, r - 1, info.main);
    if (k < 0.5) ring(ctx, this.x, this.y, r - 2, r - 2, info.main);
  }
}

// ================================================================ Pillar

const SIGIL = 0.14; // the ground circle draws itself before anything rises
const PILLAR_LIFE: Record<ElementId, number> = { star: 0.35, fire: 1.5, ice: 7, thunder: 3.6, flower: 10 };
const ICE_H = 20;
const ICE_HW = 8;
const VINE_STEP = 22; // height between leaf pads
const VINE_PADS = 3;

/** Something that erupts from a circle on the ground in front of the caster. */
export class PillarSpell implements Projectile, Standing {
  dead = false;
  private t = 0;
  private erupted = false;
  private life: number;
  private tick = 0;
  private cooldowns = new Map<Entity, number>();
  private platforms: Platform[] = [];
  private readonly onWater: boolean;

  constructor(game: Game, private x: number, private y: number, private el: ElementId, private dir: number) {
    this.life = PILLAR_LIFE[el];
    this.onWater = game.world.water(x, y);
    const info = ELEMENTS[el];
    game.addFx(new GroundCircleFx(x, y, 13, SIGIL + 0.45, info.main, info.accent, "pillar", info.glyphs));
    sfx.sigil();
  }

  private get age() {
    return this.t - SIGIL;
  }

  wither() {
    this.life = Math.min(this.life, Math.max(0, this.age) + 0.3);
  }

  update(game: Game, dt: number) {
    this.t += dt;
    if (!this.erupted) {
      if (this.t < SIGIL) return;
      this.erupted = true;
      this.erupt(game);
    }
    for (const [h, c] of this.cooldowns) this.cooldowns.set(h, c - dt);
    this.tick -= dt;
    if (this.el === "fire") this.updateGeyser(game);
    else if (this.el === "ice") this.updateIce(game);
    else if (this.el === "thunder") this.updateRod(game);
    if (this.age >= this.life) this.finish(game);
  }

  /** Everything touching an upright box above the circle. */
  private touching(game: Game, hw: number, h: number) {
    return game.hurtables().filter((e) => {
      const b = e.box();
      return b.x1 > this.x - hw && b.x0 < this.x + hw && b.y1 > this.y - h && b.y0 < this.y + 4;
    });
  }

  private addPlatform(game: Game, p: Platform) {
    this.platforms.push(p);
    game.world.platforms.push(p);
  }

  private erupt(game: Game) {
    const info = ELEMENTS[this.el];
    game.addFx(new FlashFx(this.x, this.y - 4, 8, 0.08, P.white, info.main));
    game.addFx(new RingFx(this.x, this.y, 3, 20, 0.3, info.accent, 0.3, 1));
    switch (this.el) {
      case "star": {
        game.addFx(new PillarFx(this.x, this.y, 5, 0.35, 70));
        sfx.bolt();
        game.shake(0.25);
        for (const h of this.touching(game, 12, 70)) {
          h.hurt(game, elementDamage(game, "star", 2), Math.sign(h.x - this.x) || this.dir, 2.6, "bolt");
        }
        game.particles.burst(this.x, this.y - 10, {
          count: 14, colors: [P.white, P.magicYellow, P.magicPink], speed: [60, 180], angle: [-Math.PI * 0.8, -Math.PI * 0.2],
          life: [0.2, 0.45], shape: "spark", additive: true, drag: 4,
        });
        break;
      }
      case "fire":
        sfx.explode();
        game.shake(0.2);
        break;
      case "ice": {
        sfx.freeze();
        game.shake(0.25);
        for (const h of this.touching(game, ICE_HW + 2, ICE_H + 4)) {
          h.hurt(game, 1, Math.sign(h.x - this.x) || this.dir, 1.2, "ice");
        }
        this.popCaster(game, ICE_H);
        this.addPlatform(game, { x: this.x - ICE_HW, y: this.y - ICE_H, w: ICE_HW * 2, seed: 0, spell: "ice" });
        stand("ice", this, 2);
        game.particles.burst(this.x, this.y - ICE_H, {
          count: 10, colors: [P.white, P.iceHi, P.ice], speed: [40, 120], angle: [-Math.PI * 0.9, -Math.PI * 0.1],
          life: [0.3, 0.6], shape: "px", gravity: 200,
        });
        if (this.onWater) game.splash(this.x, this.y);
        break;
      }
      case "thunder":
        sfx.zap();
        game.particles.burst(this.x, this.y - 24, {
          count: 10, colors: [P.white, P.volt, P.voltBlue], speed: [40, 120], life: [0.15, 0.3], shape: "spark", additive: true, drag: 5,
        });
        break;
      case "flower": {
        sfx.bloom();
        for (const h of this.touching(game, 12, 30)) h.hurt(game, 1, Math.sign(h.x - this.x) || this.dir, 0.3, "bloom");
        game.bloomArea(this.x, this.y, 24);
        // Leaf pads zig-zag up the stem.
        for (let i = 1; i <= VINE_PADS; i++) {
          const side = i % 2 ? -1 : 1;
          this.addPlatform(game, { x: this.x + side * 5 - 8, y: this.y - VINE_STEP * i, w: 16, seed: i, spell: "vine" });
        }
        stand("vine", this, 1);
        break;
      }
    }
  }

  /** Don't trap the caster inside something that just rose: pop them up. */
  private popCaster(game: Game, h: number) {
    const p = game.player;
    if (Math.abs(p.x - this.x) < ICE_HW + p.hw && p.y > this.y - h && p.y <= this.y + 2) p.launch(p.vx, -170);
  }

  private updateGeyser(game: Game) {
    const h = this.fireHeight();
    if (this.tick <= 0) {
      this.tick = 0.15;
      for (const e of this.touching(game, 11, h)) {
        if ((this.cooldowns.get(e) ?? 0) > 0) continue;
        // Trees and rocks only get singed once, so a geyser isn't a harvest machine.
        this.cooldowns.set(e, e instanceof Resource ? 99 : 0.45);
        e.hurt(game, 1, Math.sign(e.x - this.x) || this.dir, 0.5, "fire");
      }
      if (Math.random() < 0.5) sfx.sizzle();
    }
    game.particles.burst(this.x + rand(-5, 5), this.y - rand(0, h), {
      count: 2, colors: [P.fire, P.fireHi, P.fireDark], speed: [20, 60], angle: [-Math.PI * 0.65, -Math.PI * 0.35],
      life: [0.2, 0.4], size: [1.5, 3.5], shape: "circle", shrink: true, gravity: -120,
    });
    if (Math.random() < 0.2) {
      game.particles.burst(this.x, this.y - h, {
        count: 1, colors: [P.smoke], speed: [5, 15], angle: [-Math.PI * 0.7, -Math.PI * 0.3], life: [0.5, 0.8], size: [2, 3],
        shape: "circle", shrink: true, gravity: -30,
      });
    }
  }

  private fireHeight() {
    const a = this.age;
    const rise = Math.min(1, a / 0.1);
    const fall = a > this.life - 0.3 ? Math.max(0, (this.life - a) / 0.3) : 1;
    return 46 * rise * fall;
  }

  private updateIce(game: Game) {
    const left = this.life - this.age;
    if (left < 1 && Math.random() < 0.3) {
      game.particles.burst(this.x + rand(-ICE_HW, ICE_HW), this.y - rand(0, ICE_H), {
        count: 1, colors: [P.iceHi, P.white], speed: [5, 15], angle: [Math.PI * 0.4, Math.PI * 0.6], life: [0.3, 0.5], shape: "px", gravity: 200,
      });
    }
  }

  private updateRod(game: Game) {
    if (this.tick > 0) return;
    this.tick = 0.55;
    const tipY = this.y - 26;
    let best: Entity | null = null;
    let bd = 70;
    for (const e of game.enemies) {
      if (e.dead || !e.hurtable) continue;
      const d = boxDist(e, this.x, tipY);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (!best) {
      for (const g of game.gates) if (g.hurtable && boxDist(g, this.x, tipY) < 70) best = g;
    }
    if (!best) return;
    game.addFx(new LightningFx(this.x, tipY, best.x, aimY(best), 0.18, 1));
    game.addFx(new FlashFx(best.x, aimY(best), 6, 0.06, P.white, P.volt));
    best.hurt(game, elementDamage(game, "thunder", 1), Math.sign(best.x - this.x) || this.dir, 0.6, "thunder");
    sfx.zap();
  }

  private finish(game: Game) {
    this.dead = true;
    for (const p of this.platforms) game.removePlatform(p);
    if (this.el === "ice" && this.platforms.length) {
      game.particles.burst(this.x, this.y - ICE_H / 2, {
        count: 12, colors: [P.ice, P.iceHi, P.iceDark], speed: [30, 100], angle: [-Math.PI * 0.95, -Math.PI * 0.05],
        life: [0.4, 0.7], size: [1, 2], gravity: 480, bounce: 0.4, shape: "chunk",
      });
      sfx.poof();
      if (this.onWater) game.splash(this.x, this.y);
    } else if (this.el === "flower") {
      game.particles.burst(this.x, this.y - VINE_STEP * 1.5, {
        count: 14, colors: [P.leaf, P.leafHi, P.leafDark], speed: [20, 60], life: [0.6, 1], gravity: 60, drag: 2.5, spread: 20,
      });
    } else if (this.el === "thunder") {
      game.poof(this.x, this.y - 12, 5, [P.smoke, P.cream]);
    }
    this.platforms = [];
  }

  draw(ctx: Ctx) {
    if (!this.erupted) return;
    if (this.el === "fire") this.drawGeyser(ctx);
    else if (this.el === "ice") this.drawIce(ctx);
    else if (this.el === "thunder") this.drawRod(ctx);
    else if (this.el === "flower") this.drawVine(ctx);
  }

  private drawGeyser(ctx: Ctx) {
    const h = this.fireHeight();
    if (h < 1) return;
    const t = this.t;
    // Soft heat glow pooled at the base rather than a hard box.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.2 + 0.08 * Math.sin(t * 40);
    ellipse(ctx, this.x, this.y - 4, 12, 6, P.fire);
    ctx.restore();
    for (let yy = 0; yy < h; yy += 2) {
      const u = yy / h;
      const w = 3 + (1 - u) * 3 + Math.sin(yy * 0.5 + t * 32) * 1.2;
      const sway = Math.sin(yy * 0.2 + t * 12) * u * 2;
      rect(ctx, this.x + sway - w, this.y - yy - 2, w * 2, 2, u > 0.75 ? P.fireDark : P.fire);
      rect(ctx, this.x + sway - w * 0.45, this.y - yy - 2, w * 0.9, 2, u > 0.5 ? P.fireHi : P.white);
    }
  }

  private drawIce(ctx: Ctx) {
    const a = this.age;
    const left = this.life - a;
    if (left < 0.8 && Math.floor(a * 16) % 2 === 0) return;
    const grow = Math.min(1, a / 0.08);
    const top = Math.round(this.y - ICE_H * grow);
    const bottom = Math.round(this.y + (this.onWater ? 6 : 1));
    const x0 = Math.round(this.x - ICE_HW), x1 = Math.round(this.x + ICE_HW);
    rect(ctx, x0 - 1, top - 1, x1 - x0 + 2, bottom - top + 1, P.outline);
    rect(ctx, x0, top, x1 - x0, bottom - top, P.ice);
    rect(ctx, x0, top, 3, bottom - top, P.iceHi);
    rect(ctx, x1 - 3, top, 3, bottom - top, P.iceDark);
    rect(ctx, x0, top, x1 - x0, 2, P.white);
    // Facets.
    line(ctx, x0 + 4, top + 4, x0 + 7, top + 10, P.iceHi);
    line(ctx, x0 + 9, top + 11, x0 + 12, top + 17, P.iceHi);
    px(ctx, x0 + 2, top + 3, P.white);
    if (this.onWater) {
      ctx.globalAlpha = 0.5;
      rect(ctx, x0, bottom - 6, x1 - x0, 6, "#6fb8f0");
      ctx.globalAlpha = 1;
    }
  }

  private drawRod(ctx: Ctx) {
    const a = this.age;
    const left = this.life - a;
    if (left < 0.5 && Math.floor(a * 20) % 2 === 0) return;
    const rise = Math.min(1, a / 0.08);
    const top = this.y - 26 * rise;
    const x = Math.round(this.x);
    rect(ctx, x - 2, top, 4, this.y - top, P.outline);
    rect(ctx, x - 1, top, 2, this.y - top, P.stone);
    px(ctx, x - 1, top + 2, P.stoneHi);
    // Little crossbars and a crystal cap.
    rect(ctx, x - 4, top + 8, 8, 1, P.outline);
    rect(ctx, x - 3, top + 14, 6, 1, P.outline);
    ellipse(ctx, x, top - 1, 3, 3, P.outline);
    ellipse(ctx, x, top - 1, 2, 2, Math.floor(this.t * 12) % 2 ? P.volt : P.white);
    ellipse(ctx, this.x, this.y, 5, 1.5, P.outline);
    // Crackle around the tip.
    for (let i = 0; i < 3; i++) {
      const ang = this.t * 9 + i * 2.1;
      px(ctx, x + Math.cos(ang) * 5, top - 1 + Math.sin(ang * 1.3) * 4, i === 0 ? P.white : P.volt);
    }
  }

  private drawVine(ctx: Ctx) {
    const a = this.age;
    const left = this.life - a;
    if (left < 0.8 && Math.floor(a * 14) % 2 === 0) return;
    const grow = Math.min(1, a / 0.35);
    const topY = this.y - VINE_STEP * VINE_PADS * grow;
    // Wavy stem, outline pass then fill.
    for (let pass = 0; pass < 2; pass++) {
      for (let y = this.y; y > topY; y--) {
        const sx = this.x + Math.sin((this.y - y) * 0.14 + this.t * 2) * 3;
        if (pass === 0) rect(ctx, sx - 2, y, 4, 1, P.outline);
        else {
          rect(ctx, sx - 1, y, 2, 1, P.leaf);
          if ((this.y - y) % 5 === 0) px(ctx, sx - 1, y, P.leafHi);
        }
      }
    }
    // Leaf pads (they're the platforms) and a bud on top.
    for (const p of this.platforms) {
      if (p.y < topY - 1) continue;
      const cx = p.x + p.w / 2;
      ellipse(ctx, cx, p.y + 2, p.w / 2 + 1, 3.5, P.outline);
      ellipse(ctx, cx, p.y + 2, p.w / 2, 2.5, P.leaf);
      ellipse(ctx, cx - 2, p.y + 1, p.w / 4, 1, P.leafHi);
      line(ctx, cx - p.w / 2 + 3, p.y + 3, cx + p.w / 2 - 3, p.y + 3, P.leafDark);
    }
    if (grow >= 1) {
      const bx = this.x + Math.sin(VINE_STEP * VINE_PADS * 0.14 + this.t * 2) * 3;
      ellipse(ctx, bx, topY - 3, 3, 3, P.outline);
      ellipse(ctx, bx, topY - 3, 2, 2, P.blossom);
      px(ctx, bx, topY - 3, P.magicYellow);
    }
  }
}

// ================================================================ Petal (flower bolt)

/** A drifting petal that tangles enemies in vines and befriends animals. */
export class PetalBolt implements Projectile {
  dead = false;
  private t = 0;
  private y0: number;
  private watered = new Set<Resource>();

  constructor(public x: number, public y: number, private dir: number) {
    this.y0 = y;
  }

  update(game: Game, dt: number) {
    this.t += dt;
    if (this.t > 0.6) return this.pop(game);
    for (let i = 0; i < 3; i++) {
      this.x += (this.dir * 230 * dt) / 3;
      this.y = this.y0 + Math.sin(this.t * 14) * 2.5;
      for (const h of game.hurtables()) {
        const b = h.box();
        if (this.x > b.x0 - 2 && this.x < b.x1 + 2 && this.y > b.y0 - 3 && this.y < b.y1 + 3) {
          // Plants get a sprinkle as the petal drifts through them.
          if (h instanceof Resource) {
            if (!this.watered.has(h)) {
              this.watered.add(h);
              h.nourish(game);
            }
            continue;
          }
          h.hurt(game, 1, this.dir, 0.3, "bloom");
          return this.pop(game);
        }
      }
      if (game.world.solid(this.x, this.y) || game.world.blocked(this.x, this.y)) return this.pop(game);
    }
    if (Math.random() < 0.6) {
      game.particles.burst(this.x - this.dir * 3, this.y, {
        count: 1, colors: [P.blossom, P.blossomHi, P.leafHi], speed: [5, 20], life: [0.3, 0.6], shape: "px", gravity: 30,
      });
    }
  }

  private pop(game: Game) {
    this.dead = true;
    game.addFx(new RingFx(this.x, this.y, 2, 10, 0.2, P.blossom));
    game.particles.burst(this.x, this.y, {
      count: 8, colors: [P.blossom, P.blossomHi, P.leaf], speed: [30, 90], life: [0.4, 0.8], gravity: 60, drag: 3,
    });
  }

  draw(ctx: Ctx) {
    const x = Math.round(this.x), y = Math.round(this.y);
    const flip = Math.floor(this.t * 10) % 2 === 0;
    ellipse(ctx, x, y, flip ? 3.5 : 2.5, flip ? 2.5 : 3.5, P.outline);
    ellipse(ctx, x, y, flip ? 2.5 : 1.5, flip ? 1.5 : 2.5, P.blossom);
    px(ctx, x - (flip ? 1 : 0), y - 1, P.blossomHi);
  }
}

// ================================================================ Lob

const LOB_VX = 110;
const LOB_VY = -190;
const LOB_G = 520;

/** A thrown charm that arcs through the air and does its thing where it lands. */
export class LobSpell implements Projectile {
  dead = false;
  private t = 0;
  private vx: number;
  private vy = LOB_VY;
  private spin = 0;

  constructor(public x: number, public y: number, private el: ElementId, private dir: number, carry: number) {
    this.vx = dir * LOB_VX + carry * 0.35;
    sfx.lob();
  }

  update(game: Game, dt: number) {
    this.t += dt;
    this.spin += dt * 14 * this.dir;
    const w = game.world;
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      const prevY = this.y;
      this.vy += (LOB_G * dt) / steps;
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      // Hit a wall or a closed gate: drop straight down in front of it.
      if (this.x < 2 || this.x > w.w - 2 || w.blocked(this.x, this.y) || w.solid(this.x, prevY - 1)) {
        this.x = clamp(this.x - Math.sign(this.vx) * 3, 2, w.w - 2);
        return this.land(game, surfaceAt(game, this.x, prevY));
      }
      if (this.vy < 0 && w.solid(this.x, this.y)) {
        this.y = prevY;
        this.vy = 0;
      }
      // Burst early on anything it touches (flower seeds sail past friends).
      for (const h of game.hurtables()) {
        if (h instanceof Resource) continue;
        const b = h.box();
        if (this.x > b.x0 - 2 && this.x < b.x1 + 2 && this.y > b.y0 - 2 && this.y < b.y1 + 2) {
          if (this.el === "flower") h.hurt(game, 1, this.dir, 0.3, "bloom");
          return this.land(game, surfaceAt(game, this.x, this.y));
        }
      }
      if (this.vy > 0) {
        for (const p of w.platforms) {
          if (this.x >= p.x && this.x <= p.x + p.w && prevY <= p.y && this.y >= p.y) {
            this.y = p.y;
            return this.land(game, { y: p.y, water: false });
          }
        }
        const s = w.surfaceBelow(this.x, prevY, Math.ceil(this.y - prevY) + 1);
        if (s && this.y >= s.y) {
          this.y = s.y;
          return this.land(game, s);
        }
      }
      if (this.y > w.h + 20) {
        this.dead = true;
        return;
      }
    }
    const info = ELEMENTS[this.el];
    if (Math.random() < 0.7) {
      game.particles.burst(this.x, this.y, {
        count: 1, colors: [info.main, info.accent, P.white], speed: [5, 20], life: [0.2, 0.4], shape: "px", additive: this.el !== "flower",
      });
    }
  }

  private land(game: Game, s: { y: number; water: boolean }) {
    this.dead = true;
    const x = this.x, y = s.y;
    const info = ELEMENTS[this.el];
    game.addFx(new GroundCircleFx(x, y, 12, 0.4, info.main, info.accent, "lob", info.glyphs));
    if (this.el === "star" || this.el === "fire") game.hitTerrain(x, y + 2, 12);
    switch (this.el) {
      case "star": {
        game.addFx(new FlashFx(x, y - 5, 9, 0.08));
        game.addFx(new RingFx(x, y - 5, 3, 24, 0.25, P.magicYellow));
        for (const h of within(game, x, y - 6, 22)) {
          h.hurt(game, elementDamage(game, "star", 1), Math.sign(h.x - x) || this.dir, 1.4, "bolt");
        }
        game.particles.burst(x, y - 4, {
          count: 7, colors: [P.white, P.magicYellow], speed: [60, 140], angle: [-Math.PI * 0.95, -Math.PI * 0.05],
          life: [0.4, 0.7], shape: "starSmall", gravity: 300,
        });
        sfx.poof();
        game.shake(0.18);
        break;
      }
      case "fire":
        game.addFx(new FlashFx(x, y - 4, 8, 0.08, P.fireHi, P.fire));
        sfx.explode();
        game.shake(0.2);
        if (s.water) {
          game.poof(x, y - 3, 8, [P.white, P.smoke]);
          sfx.sizzle();
        } else {
          for (const h of within(game, x, y - 5, 14)) h.hurt(game, 1, Math.sign(h.x - x) || this.dir, 0.8, "fire");
          game.projectiles.push(new FirePatch(x, y));
        }
        break;
      case "ice":
        sfx.freeze();
        game.addFx(new RingFx(x, y, 4, 30, 0.35, P.iceHi, 0.3, 2));
        for (const h of within(game, x, y - 6, 24)) h.hurt(game, 1, Math.sign(h.x - x) || this.dir, 0.3, "ice");
        game.world.freezeAt(x, y, 20, 30);
        game.particles.burst(x, y - 2, {
          count: 14, colors: [P.white, P.iceHi, P.ice], speed: [30, 110], angle: [-Math.PI * 0.95, -Math.PI * 0.05],
          life: [0.3, 0.6], shape: "px", gravity: 250,
        });
        break;
      case "thunder": {
        const skyY = Math.max(game.camY - 4, y - 110);
        game.addFx(new SkySigilFx(x, skyY, 0.2));
        sfx.thunderCharge();
        game.after(0.2, () => {
          game.addFx(new LightningFx(x, skyY, x, y, 0.3, 2));
          game.addFx(new FlashFx(x, y - 4, 10, 0.1, P.white, P.volt));
          game.whiteFlash = 0.05;
          game.shake(0.35);
          sfx.thunder();
          for (const h of within(game, x, y - 10, 22)) {
            h.hurt(game, elementDamage(game, "thunder", 2), Math.sign(h.x - x) || this.dir, 1, "thunder");
          }
        });
        break;
      }
      case "flower":
        sfx.bloom();
        game.bloomArea(x, y, 20);
        game.projectiles.push(new Sprout(game, x, y, s.water));
        break;
    }
  }

  draw(ctx: Ctx) {
    const info = ELEMENTS[this.el];
    const x = Math.round(this.x), y = Math.round(this.y);
    if (this.el === "flower") {
      // A seed with a little leaf.
      ellipse(ctx, x, y, 3, 2.5, P.outline);
      ellipse(ctx, x, y, 2, 1.5, P.bark);
      px(ctx, x + Math.round(Math.cos(this.spin) * 2), y - 2, P.leafHi);
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.4;
    ellipse(ctx, x, y, 5, 5, info.main);
    ctx.restore();
    ellipse(ctx, x, y, 3, 3, P.outline);
    ellipse(ctx, x, y, 2, 2, info.main);
    px(ctx, x + Math.round(Math.cos(this.spin)), y + Math.round(Math.sin(this.spin)), P.white);
  }
}

/** Flames left burning on the ground by a firebomb. */
class FirePatch implements Projectile {
  dead = false;
  private t = 0;
  private tick = 0;
  private cooldowns = new Map<Entity, number>();
  private static readonly LIFE = 2.6;
  private static readonly HW = 18;

  constructor(private x: number, private y: number) {}

  update(game: Game, dt: number) {
    this.t += dt;
    this.tick -= dt;
    for (const [h, c] of this.cooldowns) this.cooldowns.set(h, c - dt);
    if (this.tick <= 0) {
      this.tick = 0.15;
      for (const e of game.hurtables()) {
        const b = e.box();
        if (b.x1 < this.x - FirePatch.HW || b.x0 > this.x + FirePatch.HW || b.y1 < this.y - 12 || b.y0 > this.y + 2) continue;
        if ((this.cooldowns.get(e) ?? 0) > 0) continue;
        this.cooldowns.set(e, e instanceof Resource ? 99 : 0.5);
        e.hurt(game, 1, Math.sign(e.x - this.x) || 1, 0.3, "fire");
      }
    }
    if (Math.random() < 0.8) {
      game.particles.burst(this.x + rand(-FirePatch.HW, FirePatch.HW), this.y - 1, {
        count: 1, colors: [P.fire, P.fireHi, P.fireDark], speed: [10, 40], angle: [-Math.PI * 0.65, -Math.PI * 0.35],
        life: [0.2, 0.45], size: [1.5, 3], shape: "circle", shrink: true, gravity: -100,
      });
    }
    if (this.t >= FirePatch.LIFE) this.dead = true;
  }

  draw(ctx: Ctx) {
    const fade = Math.min(1, (FirePatch.LIFE - this.t) / 0.4);
    for (let i = -FirePatch.HW; i <= FirePatch.HW; i += 3) {
      const h = (3 + Math.sin(i * 1.7 + this.t * 20) * 2 + (1 - Math.abs(i) / FirePatch.HW) * 4) * fade;
      if (h < 1) continue;
      rect(ctx, this.x + i - 1, this.y - h, 3, h, P.fire);
      rect(ctx, this.x + i, this.y - h * 0.6, 1, h * 0.6, P.fireHi);
    }
    rect(ctx, this.x - FirePatch.HW, this.y - 1, FirePatch.HW * 2, 1, P.fireDark);
  }
}

// ================================================================ Sprout (mushroom / lily pad)

const SPROUT_LIFE = 12;

/** What a flower seed grows into: a bouncy mushroom on land, a lily pad on water. */
class Sprout implements Projectile, Standing {
  dead = false;
  private t = 0;
  private life = SPROUT_LIFE;
  private platform: Platform;

  constructor(private game: Game, private x: number, private y: number, private lily: boolean) {
    this.platform = lily
      ? { x: x - 11, y: y - 1, w: 22, seed: 0, spell: "lily" }
      : { x: x - 9, y: y - 11, w: 18, seed: 0, spell: "mushroom", bouncy: true };
    game.world.platforms.push(this.platform);
    stand(lily ? "lily" : "mushroom", this, lily ? 3 : 2);
    game.particles.burst(x, y - 4, {
      count: 10, colors: [P.leaf, P.leafHi, P.blossom], speed: [30, 90], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.4, 0.7], gravity: 150,
    });
    if (lily) game.splash(x, y);
  }

  wither() {
    this.life = Math.min(this.life, this.t + 0.3);
  }

  update(game: Game, dt: number) {
    this.t += dt;
    if (this.t >= this.life) {
      this.dead = true;
      game.removePlatform(this.platform);
      game.poof(this.x, this.y - 5, 6, this.lily ? [P.leaf, P.leafHi] : [P.blossom, P.cream]);
    }
  }

  draw(ctx: Ctx) {
    const left = this.life - this.t;
    if (left < 1 && Math.floor(this.t * 14) % 2 === 0) return;
    const grow = Math.min(1, this.t / 0.2);
    const x = this.x, y = this.y;
    if (this.lily) {
      ellipse(ctx, x, y, 12 * grow, 3, P.outline);
      ellipse(ctx, x, y - 0.5, 11 * grow, 2, P.leaf);
      ellipse(ctx, x - 3, y - 1, 4 * grow, 1, P.leafHi);
      line(ctx, x, y - 1, x + 5 * grow, y + 1, P.leafDark);
      if (grow >= 1) {
        ellipse(ctx, x + 6, y - 2, 2, 2, P.outline);
        ellipse(ctx, x + 6, y - 2, 1.5, 1.5, P.blossom);
      }
      return;
    }
    // Squish after a bounce.
    const since = this.game.time - (this.platform.bounced ?? -9);
    const squish = since < 0.25 ? Math.sin((since / 0.25) * Math.PI) * 3 : 0;
    const capY = y - 11 * grow + squish;
    rect(ctx, x - 4, capY, 8, y - capY, P.outline);
    rect(ctx, x - 3, capY, 6, y - capY, P.cream);
    ellipse(ctx, x, capY, 11 * grow + squish * 0.5, 6 * grow - squish * 0.3, P.outline);
    ellipse(ctx, x, capY, 10 * grow + squish * 0.5, 5 * grow - squish * 0.3, P.blossomDark);
    ellipse(ctx, x, capY - 1, 9 * grow, 3.5 * grow, P.blossom);
    if (grow >= 1) {
      ellipse(ctx, x - 4, capY - 1, 1.5, 1, P.white);
      ellipse(ctx, x + 3, capY - 2, 1.2, 1, P.white);
      px(ctx, x + 6, capY, P.white);
    }
  }
}

// ================================================================ Flower patch

/** Little flowers that pop up around a blossom ring and fade after a while. */
class FlowerPatchFx implements Effect {
  layer: "back" | "front" = "back";
  private t = 0;
  private flowers: { x: number; y: number; delay: number; col: string }[] = [];

  constructor(game: Game, cx: number, cy: number, r: number, private life: number) {
    const cols = [P.blossom, P.white, P.magicYellow, P.blossomHi, P.magicPurple];
    for (let i = 0; i < 12; i++) {
      const x = cx + rand(-r, r);
      const s = game.world.surfaceBelow(x, cy - 16, 40);
      if (!s || s.water) continue;
      this.flowers.push({ x: Math.round(x), y: s.y, delay: Math.abs(x - cx) / r * 0.3, col: cols[i % cols.length] });
    }
  }

  update(dt: number) {
    this.t += dt;
    return this.t < this.life;
  }

  draw(ctx: Ctx) {
    const fade = this.life - this.t;
    for (const f of this.flowers) {
      const k = clamp((this.t - f.delay) / 0.2, 0, 1);
      if (k <= 0 || (fade < 1 && Math.floor(this.t * 12 + f.x) % 2 === 0)) continue;
      const h = Math.round(4 * k);
      rect(ctx, f.x, f.y - h, 1, h, P.leafDark);
      if (k >= 1) {
        px(ctx, f.x - 1, f.y - h - 1, f.col);
        px(ctx, f.x + 1, f.y - h - 1, f.col);
        px(ctx, f.x, f.y - h - 2, f.col);
        px(ctx, f.x, f.y - h, f.col);
        px(ctx, f.x, f.y - h - 1, P.magicYellow);
      }
    }
  }
}
