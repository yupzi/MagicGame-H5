import { drawSprite, type Ctx } from "../engine/gfx";
import { Entity } from "./entity";
import type { Game } from "./game";
import { itemSprites, itemSpritesWhite, type ItemType } from "./sprites";

const MAGNET_RANGE = 44;
const LIFETIME = 50;

/** A dropped material. Bounces out, rests with a bob, then gets vacuumed up. */
export class Item extends Entity {
  private age = 0;
  private magnet = false;
  private bobPhase = Math.random() * 10;
  /** Garden gifts wait for you however long you're away. */
  keep = false;

  constructor(public type: ItemType, x: number, y: number, vx: number, vy: number) {
    super();
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.hw = 3;
    this.h = 6;
    this.gravity = 520;
    this.maxFall = 260;
  }

  update(game: Game, dt: number) {
    this.age += dt;
    if (this.keep) this.age = Math.min(this.age, 1);
    if (this.age > LIFETIME) {
      this.dead = true;
      return;
    }
    const p = game.player;
    const dx = p.x - this.x;
    const dy = p.y - 7 - (this.y - 3);
    const d = Math.hypot(dx, dy);
    if (this.age > 0.45 && p.alive && (this.magnet || d < MAGNET_RANGE * (1 + 0.4 * game.progress.level("magnet")))) {
      this.magnet = true;
      const pull = 1100 + this.age * 200;
      this.vx += (dx / d) * pull * dt;
      this.vy += (dy / d) * pull * dt;
      const k = Math.exp(-5 * dt);
      this.vx *= k;
      this.vy *= k;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (d < 8) {
        this.dead = true;
        game.collect(this);
      }
      return;
    }
    this.moveBody(game.world, dt, true);
    if (this.fellOut(game.world)) {
      this.dead = true;
      return;
    }
    if (game.world.inWater(this.x, this.y)) {
      this.dead = true;
      game.particles.burst(this.x, game.world.waterTop(this.x, this.y), {
        count: 5, colors: ["#d8f2ff", "#ffffff"], speed: [30, 80], angle: [-Math.PI * 0.8, -Math.PI * 0.2], life: [0.3, 0.5], gravity: 400,
      });
      return;
    }
    if (this.landSpeed > 70) {
      this.launch(this.vx * 0.6, -this.landSpeed * 0.42);
    } else if (this.onGround) {
      this.vx *= Math.exp(-8 * dt);
    }
    if (this.hitWall) this.vx = -this.vx * 0.5;
  }

  draw(ctx: Ctx, game: Game) {
    if (this.age > LIFETIME - 5 && Math.floor(this.age * 10) % 2 === 0) return;
    const spr = this.age < 0.06 ? itemSpritesWhite[this.type] : itemSprites[this.type];
    const bob = this.onGround && !this.magnet ? Math.round(Math.sin(game.time * 4 + this.bobPhase) * 0.8 - 0.5) : 0;
    drawSprite(ctx, spr, this.x - spr.width / 2, this.y - spr.height + bob);
  }
}
