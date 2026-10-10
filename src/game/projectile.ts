import { sfx } from "../engine/audio";
import { ellipse, line, px, type Ctx } from "../engine/gfx";
import { rand } from "../engine/math";
import { FlashFx, RingFx } from "./effects";
import type { Game } from "./game";
import { P } from "./palette";

const SPEED = 280;
const LIFE = 0.55;

export interface Projectile {
  dead: boolean;
  update(game: Game, dt: number): void;
  draw(ctx: Ctx): void;
}

/** The basic star bolt: fast, twinkly, hits the first thing it touches. */
export class Bolt implements Projectile {
  dead = false;
  private t = 0;
  private vx: number;
  private y0: number;

  constructor(public x: number, public y: number, private dir: number, private dmg = 1, private vy = 0) {
    this.vx = dir * SPEED;
    this.y0 = y;
  }

  update(game: Game, dt: number) {
    this.t += dt;
    if (this.t > LIFE) {
      this.impact(game, false);
      return;
    }
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      this.x += (this.vx * dt) / steps;
      this.y0 += (this.vy * dt) / steps;
      this.y = this.y0 + Math.sin(this.t * 38) * 0.8;
      for (const h of game.hurtables()) {
        const b = h.box();
        if (this.x > b.x0 - 2 && this.x < b.x1 + 2 && this.y > b.y0 - 2 && this.y < b.y1 + 2) {
          h.hurt(game, this.dmg, this.dir, 1, "bolt");
          this.impact(game, true);
          return;
        }
      }
      if (game.world.solid(this.x, this.y)) {
        game.hitTerrain(this.x, this.y, 6);
        this.impact(game, false);
        return;
      }
    }
    game.particles.burst(this.x - this.dir * 3, this.y, {
      count: 2, colors: [P.magicPink, P.magicYellow, P.magicPurple], speed: [5, 25], life: [0.15, 0.35],
      shape: "px", additive: true, spread: 1.5,
    });
    if (Math.random() < 0.25) {
      game.particles.burst(this.x, this.y, {
        count: 1, colors: [P.white], speed: [10, 30], life: [0.25, 0.4], shape: "starSmall", gravity: 40,
      });
    }
  }

  private impact(game: Game, hit: boolean) {
    this.dead = true;
    game.addFx(new FlashFx(this.x, this.y, hit ? 6 : 4, 0.08));
    game.addFx(new RingFx(this.x, this.y, 2, hit ? 15 : 9, 0.2, P.magicYellow));
    game.particles.burst(this.x, this.y, {
      count: hit ? 12 : 7, colors: [P.white, P.magicYellow, P.magicPink], speed: [60, 170],
      life: [0.12, 0.3], shape: "spark", additive: true, drag: 6,
    });
    if (hit) {
      game.particles.burst(this.x, this.y, {
        count: 3, colors: [P.white], speed: [40, 90], angle: [-Math.PI * 0.95, -Math.PI * 0.05], life: [0.3, 0.5],
        shape: "starSmall", gravity: 260,
      });
    } else sfx.poof();
  }

  draw(ctx: Ctx) {
    const x = Math.round(this.x), y = Math.round(this.y);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.45;
    ellipse(ctx, x, y, 6, 5, P.magicPink);
    ctx.restore();
    // Twinkle between a "+" and an "x" star shape.
    const plus = Math.floor(this.t * 24) % 2 === 0;
    const arm = P.magicYellow;
    if (plus) {
      for (let i = 1; i <= 3; i++) {
        px(ctx, x + i, y, arm); px(ctx, x - i, y, arm);
        if (i <= 2) { px(ctx, x, y + i, arm); px(ctx, x, y - i, arm); }
      }
    } else {
      for (let i = 1; i <= 2; i++) {
        px(ctx, x + i, y + i, arm); px(ctx, x - i, y - i, arm);
        px(ctx, x + i, y - i, arm); px(ctx, x - i, y + i, arm);
      }
    }
    ellipse(ctx, x + 0.5, y + 0.5, 1.6, 1.6, P.white);
  }
}

// ---------------------------------------------------------------- Fire

const FIRE_SPEED = 185;
const FIRE_RADIUS = 22;
const FIRE_DAMAGE = 2;

/** A lobbed ball of flame: slight arc, bursts on anything and sets enemies alight. */
export class FireBall implements Projectile {
  dead = false;
  private t = 0;
  private vx: number;
  private vy = -40;

  constructor(public x: number, public y: number, private dir: number, private radius = FIRE_RADIUS) {
    this.vx = dir * FIRE_SPEED;
  }

  update(game: Game, dt: number) {
    this.t += dt;
    if (this.t > 1.1) return this.explode(game);
    const steps = 3;
    for (let i = 0; i < steps; i++) {
      this.vy += (170 * dt) / steps;
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      for (const h of game.hurtables()) {
        const b = h.box();
        if (this.x > b.x0 - 3 && this.x < b.x1 + 3 && this.y > b.y0 - 3 && this.y < b.y1 + 3) return this.explode(game);
      }
      if (game.world.solid(this.x, this.y + 1)) return this.explode(game);
    }
    game.particles.burst(this.x - this.dir * 2, this.y, {
      count: 2, colors: [P.fire, P.fireHi, P.fireDark], speed: [10, 30], angle: [-Math.PI * 0.8, -Math.PI * 0.2],
      life: [0.18, 0.35], size: [1.5, 3], shape: "circle", shrink: true, gravity: -60, spread: 2,
    });
    if (Math.random() < 0.3) {
      game.particles.burst(this.x, this.y - 2, {
        count: 1, colors: [P.smoke], speed: [5, 15], angle: [-Math.PI * 0.7, -Math.PI * 0.3], life: [0.4, 0.6], size: [1.5, 2.5],
        shape: "circle", shrink: true, gravity: -30,
      });
    }
  }

  private explode(game: Game) {
    this.dead = true;
    const { x, y } = this;
    game.addFx(new FlashFx(x, y, 11, 0.1, P.fireHi, P.fire));
    game.addFx(new RingFx(x, y, 4, this.radius + 6, 0.28, P.fire, 1, 2));
    game.particles.burst(x, y, {
      count: 16, colors: [P.fire, P.fireHi, P.fireDark], speed: [40, 140], life: [0.25, 0.5], size: [2, 4.5],
      shape: "circle", shrink: true, drag: 4, gravity: -80, spread: 3,
    });
    game.particles.burst(x, y, {
      count: 14, colors: [P.fireHi, P.white, P.fire], speed: [90, 240], life: [0.15, 0.35], shape: "spark", additive: true, drag: 5,
    });
    game.particles.burst(x, y - 4, {
      count: 6, colors: [P.smoke, "#bdaec6"], speed: [15, 45], angle: [-Math.PI * 0.85, -Math.PI * 0.15], life: [0.6, 1.0],
      size: [2.5, 4.5], shape: "circle", shrink: true, gravity: -40, drag: 2, spread: 5,
    });
    game.particles.burst(x, y, {
      count: 6, colors: [P.fire, P.fireHi], speed: [60, 140], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.5, 0.9],
      gravity: 380, bounce: 0.3,
    });
    game.hitTerrain(x, y, this.radius * 0.6);
    let hits = 0;
    for (const h of game.hurtables()) {
      const b = h.box();
      const cx = Math.max(b.x0, Math.min(x, b.x1));
      const cy = Math.max(b.y0, Math.min(y, b.y1));
      if (Math.hypot(cx - x, cy - y) < this.radius) {
        h.hurt(game, FIRE_DAMAGE, Math.sign(h.x - x) || this.dir, 1.4, "fire");
        hits++;
      }
    }
    game.hitstop(hits ? 5 : 2);
    game.shake(hits ? 0.32 : 0.2);
    sfx.explode();
  }

  draw(ctx: Ctx) {
    const x = Math.round(this.x), y = Math.round(this.y);
    const fl = Math.floor(this.t * 30) % 2;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.4;
    ellipse(ctx, x, y, 7 + fl, 6 + fl, P.fire);
    ctx.restore();
    // Teardrop flame trailing away from the direction of travel.
    ellipse(ctx, x - this.dir * 2, y - 1, 4.5, 3.5, P.outline);
    ellipse(ctx, x, y, 4.5, 4.5, P.outline);
    ellipse(ctx, x - this.dir * 2, y - 1, 3.5, 2.5, P.fireDark);
    ellipse(ctx, x, y, 3.5, 3.5, P.fire);
    ellipse(ctx, x + this.dir * 0.5, y - 0.5, 2.2 - fl * 0.4, 2.2 - fl * 0.4, P.fireHi);
    px(ctx, x + this.dir, y - 1, P.white);
  }
}

// ---------------------------------------------------------------- Ice

const ICE_SPEED = 320;
const ICE_PIERCE = 3;

/** A thin shard that flies straight through up to three targets, freezing them. */
export class IceShard implements Projectile {
  dead = false;
  private t = 0;
  private hit = new Set<object>();

  constructor(public x: number, public y: number, private dir: number, private pierce = ICE_PIERCE) {}

  update(game: Game, dt: number) {
    this.t += dt;
    if (this.t > 0.55) return this.shatter(game);
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      this.x += (this.dir * ICE_SPEED * dt) / steps;
      game.freezeWater(this.x, this.y, 60);
      for (const h of game.hurtables()) {
        if (this.hit.has(h)) continue;
        const b = h.box();
        if (this.x > b.x0 - 2 && this.x < b.x1 + 2 && this.y > b.y0 - 2 && this.y < b.y1 + 2) {
          this.hit.add(h);
          h.hurt(game, 1, this.dir, 0.6, "ice");
          game.addFx(new FlashFx(this.x, this.y, 5, 0.06, P.iceHi, P.ice));
          game.particles.burst(this.x, this.y, {
            count: 8, colors: [P.ice, P.iceHi, P.white], speed: [50, 140], life: [0.15, 0.35], shape: "spark", additive: true, drag: 5,
          });
          if (this.hit.size >= this.pierce) return this.shatter(game);
        }
      }
      if (game.world.solid(this.x, this.y)) {
        game.hitTerrain(this.x, this.y, 6);
        return this.shatter(game);
      }
    }
    if (Math.random() < 0.7) {
      game.particles.burst(this.x - this.dir * 5, this.y + rand(-1, 1), {
        count: 1, colors: [P.iceHi, P.white, P.ice], speed: [5, 20], life: [0.25, 0.5], shape: "px", gravity: 30,
      });
    }
  }

  private shatter(game: Game) {
    this.dead = true;
    sfx.poof();
    game.addFx(new RingFx(this.x, this.y, 2, 9, 0.18, P.iceHi));
    game.particles.burst(this.x, this.y, {
      count: 7, colors: [P.ice, P.iceHi, P.iceDark], speed: [40, 110], angle: [-Math.PI * 0.95, -Math.PI * 0.05],
      life: [0.4, 0.7], size: [1, 2], gravity: 480, bounce: 0.4, shape: "chunk",
    });
  }

  draw(ctx: Ctx) {
    const x = Math.round(this.x), y = Math.round(this.y);
    const d = this.dir;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.35;
    ellipse(ctx, x - d * 2, y, 8, 3.5, P.ice);
    ctx.restore();
    // Long diamond: outline, body, bright spine.
    line(ctx, x - d * 8, y, x + d * 5, y, P.outline);
    line(ctx, x - d * 6, y - 2, x + d * 3, y - 2, P.outline);
    line(ctx, x - d * 6, y + 2, x + d * 3, y + 2, P.outline);
    line(ctx, x - d * 7, y - 1, x + d * 4, y - 1, P.iceHi);
    line(ctx, x - d * 7, y + 1, x + d * 4, y + 1, P.iceDark);
    line(ctx, x - d * 7, y, x + d * 5, y, P.ice);
    px(ctx, x + d * 6, y, P.outline);
    px(ctx, x + d * 3, y - 1, P.white);
    px(ctx, x + d * 1, y - 1, P.white);
  }
}
