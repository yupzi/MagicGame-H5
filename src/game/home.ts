import { ellipse, line, px, rect, type Ctx } from "../engine/gfx";
import { chance, damp, rand } from "../engine/math";
import { drawText, textWidth } from "../engine/font";
import { HeartFx } from "./effects";
import { Boar, Rabbit } from "./enemies";
import type { Game } from "./game";
import { P } from "./palette";
import type { PetKind } from "./spells";
import type { World } from "./world";

const WALL_HW = 24;
const WALL_H = 26;
/** The garden fence runs from here to GARDEN_X1, measured from the cottage. */
const GARDEN_X0 = 38;
const GARDEN_X1 = 146;

/**
 * The witch's cottage at the start of the hills: a round little house with a
 * hat for a roof, smoke from the chimney and a warm window. Walk to the door
 * and press up to go inside. The fenced garden beside it is where befriended
 * animals live.
 */
export class Cottage {
  readonly y: number;
  private doorT = 0; // >0 while the door swings open and shut
  private smokeT = 0;

  constructor(world: World, readonly x: number, y: number) {
    this.y = world.restY(x, y);
  }

  /** Where the witch steps out of the cottage. */
  get doorX() {
    return this.x + 7;
  }

  get gardenX0() {
    return this.x + GARDEN_X0;
  }

  get gardenX1() {
    return this.x + GARDEN_X1;
  }

  /** Ground in the garden (it sits beside the cottage, near its height). */
  groundAt(world: World, x: number) {
    const g = world.groundBelow(x, this.y - 24, 60);
    return g === Infinity ? this.y : g;
  }

  /** Close enough to the door to go in. */
  atDoor(game: Game) {
    const p = game.player;
    return p.alive && p.onGround && Math.abs(p.x - this.doorX) < 9 && Math.abs(p.y - this.y) < 4;
  }

  /** Swing the door open (someone is coming out, or going in). */
  openDoor() {
    this.doorT = 0.7;
  }

  update(game: Game, dt: number) {
    this.doorT = Math.max(0, this.doorT - dt);
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = rand(0.25, 0.5);
      game.particles.burst(this.x + 15, this.y - 47, {
        count: 1, colors: [P.white, P.cloudShade], speed: [6, 14], angle: [-Math.PI * 0.65, -Math.PI * 0.45], life: [1.4, 2.2],
        size: [2, 3.5], shape: "circle", shrink: true, gravity: -12, drag: 0.6,
      });
    }
  }

  draw(ctx: Ctx, time: number, prompt: boolean) {
    const x = this.x, y = this.y;
    const L = x - WALL_HW, R = x + WALL_HW, top = y - WALL_H;

    // Chimney behind the roof.
    rect(ctx, x + 12, y - 48, 7, 14, P.outline);
    rect(ctx, x + 13, y - 47, 5, 13, P.stone);
    rect(ctx, x + 13, y - 47, 5, 2, P.stoneHi);
    rect(ctx, x + 11, y - 49, 9, 2, P.outline);

    // Roof: a squat witch's hat with a bent tip and a star.
    ellipse(ctx, x, top + 1, WALL_HW + 7, 15, P.outline);
    ellipse(ctx, x, top + 1, WALL_HW + 6, 14, P.hatDark);
    ellipse(ctx, x - 1, top - 1, WALL_HW + 4, 12, P.hat);
    ellipse(ctx, x - 9, top - 6, 8, 3, P.hatHi);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const cx = x - 2 - t * t * 9;
        const half = 6 * (1 - t) + 0.6;
        const yy = top - 11 - i;
        if (pass === 0) rect(ctx, cx - half - 1, yy - 1, half * 2 + 2, 3, P.outline);
        else rect(ctx, cx - half, yy, half * 2, 1, i < 3 ? P.hatDark : P.hat);
      }
    }
    const twinkle = Math.sin(time * 3) > 0.6;
    px(ctx, x - 11, top - 25, twinkle ? P.white : P.magicYellow);
    px(ctx, x - 12, top - 24, P.magicYellow); px(ctx, x - 10, top - 24, P.magicYellow); px(ctx, x - 11, top - 23, P.magicYellow);

    // Walls: warm plaster with timber corners, sitting under the brim.
    rect(ctx, L - 1, top + 5, R - L + 2, y - top - 5, P.outline);
    rect(ctx, L, top + 6, R - L, y - top - 6, P.cream);
    rect(ctx, L, top + 6, R - L, 2, "#e8d2b0");
    rect(ctx, L, top + 6, 3, y - top - 6, P.bark);
    rect(ctx, R - 3, top + 6, 3, y - top - 6, P.barkDark);
    // Brim of the hat over the walls.
    ellipse(ctx, x, top + 6, WALL_HW + 9, 3.5, P.outline);
    ellipse(ctx, x, top + 5.5, WALL_HW + 8, 2.5, P.hatDark);
    rect(ctx, x - 18, top + 4, 22, 1, P.hat);

    // Round window with a warm glow and a cross.
    const wx = x - 11, wy = y - 13;
    ellipse(ctx, wx, wy, 6, 6, P.outline);
    ellipse(ctx, wx, wy, 5, 5, P.magicYellow);
    ellipse(ctx, wx - 1, wy - 1, 3, 3, "#fff3b0");
    rect(ctx, wx - 5, wy, 11, 1, P.bark);
    rect(ctx, wx, wy - 5, 1, 11, P.bark);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.14 + 0.04 * Math.sin(time * 2.3);
    ellipse(ctx, wx, wy, 10, 10, P.magicYellow);
    ctx.restore();
    // Flower box under the window.
    rect(ctx, wx - 7, wy + 6, 15, 3, P.outline);
    rect(ctx, wx - 6, wy + 6, 13, 2, P.bark);
    for (let i = 0; i < 4; i++) px(ctx, wx - 5 + i * 4, wy + 5, i % 2 ? P.blossom : P.magicYellow);

    // Arched door; swings inward while someone passes.
    const dx = this.doorX, dh = 17, dw = 11;
    const open = this.doorT > 0 ? Math.sin((this.doorT / 0.7) * Math.PI) : 0;
    rect(ctx, dx - dw / 2 - 1, y - dh, dw + 2, dh, P.outline);
    ellipse(ctx, dx, y - dh, dw / 2 + 1, 4, P.outline);
    rect(ctx, dx - dw / 2, y - dh + 1, dw, dh - 1, open > 0.1 ? "#4a2f3a" : P.bark);
    ellipse(ctx, dx, y - dh + 1, dw / 2, 3, open > 0.1 ? "#4a2f3a" : P.bark);
    if (open > 0.1) {
      // Light spilling out, and the door panel folded to one side.
      rect(ctx, dx - dw / 2 + 2, y - dh + 3, dw - 4, dh - 3, "#ffd98a");
      const pw = Math.max(2, Math.round(dw * (1 - open)));
      rect(ctx, dx - dw / 2, y - dh + 1, pw, dh - 1, P.barkLight);
    } else {
      line(ctx, dx, y - dh + 1, dx, y - 1, P.barkDark);
      px(ctx, dx + 3, y - 8, P.magicYellow);
    }
    rect(ctx, dx - dw / 2 - 2, y - 1, dw + 4, 1, P.stoneDark);

    // Pot plants beside the door.
    for (const ox of [-9, 9]) {
      const ppx = dx + ox;
      rect(ctx, ppx - 2, y - 4, 5, 4, P.outline);
      rect(ctx, ppx - 1, y - 3, 3, 3, "#e58a6a");
      ellipse(ctx, ppx + 0.5, y - 6, 3, 2.5, P.leaf);
      px(ctx, ppx, y - 8, ox < 0 ? P.blossom : P.white);
    }

    if (prompt) {
      const bob = Math.round(Math.sin(time * 6));
      const s = "UP";
      rect(ctx, dx - textWidth(s) / 2 - 2, y - dh - 12 + bob, textWidth(s) + 4, 8, P.outline);
      drawText(ctx, s, dx - textWidth(s) / 2, y - dh - 10 + bob, P.cream, "");
    }
  }

  /** Low picket fence around the garden (decoration; it doesn't stop anyone). */
  drawFence(ctx: Ctx, world: World) {
    const x0 = this.gardenX0, x1 = this.gardenX1;
    for (const ry of [5, 9]) {
      for (let x = x0; x < x1; x++) {
        const g = this.groundAt(world, x);
        px(ctx, x, g - ry - 1, P.outline);
        px(ctx, x, g - ry, P.barkLight);
      }
    }
    for (let x = x0; x <= x1; x += 12) {
      const g = this.groundAt(world, x);
      rect(ctx, x - 2, g - 13, 4, 13, P.outline);
      rect(ctx, x - 1, g - 12, 2, 12, P.bark);
      px(ctx, x - 1, g - 12, P.barkLight);
      px(ctx, x, g - 14, P.outline);
    }
  }
}

// ---------------------------------------------------------------- Pets

/**
 * A friend living in the garden. It borrows the wild creature's drawing but
 * has its own gentle routine: rabbits hop about, boars amble and nap.
 */
export class Pet {
  x: number;
  private z = 0; // height of a hop
  private vz = 0;
  private vx = 0;
  facing = chance(0.5) ? 1 : -1;
  private timer = rand(0.3, 1.5);
  private walkT = 0;
  private napping = false;
  private sx = 1;
  private sy = 1;
  private heartCd = rand(1, 3);
  private body: Rabbit | Boar;

  constructor(readonly kind: PetKind, x: number, private home: Cottage, world: World) {
    this.x = this.clampGarden(x);
    const y = home.groundAt(world, this.x);
    this.body = kind === "rabbit" ? new Rabbit(this.x, y) : new Boar(this.x, y);
    this.body.friend = true;
  }

  /** Arrive with a little hop over the fence. */
  hopIn() {
    this.vz = 160;
    this.sx = 0.8;
    this.sy = 1.25;
  }

  update(game: Game, dt: number) {
    const p = game.player;
    const ground = this.home.groundAt(game.world, this.x);
    const near = p.alive && Math.abs(p.x - this.x) < 26 && Math.abs(p.y - ground) < 30;
    this.timer -= dt;
    this.heartCd -= dt;
    if (near && this.heartCd <= 0) {
      this.heartCd = rand(2.5, 4.5);
      this.facing = Math.sign(p.x - this.x) || this.facing;
      this.sx = 1.2; this.sy = 0.85;
      game.addFx(new HeartFx(this.x, ground - (this.kind === "boar" ? 20 : 16)));
      this.napping = false;
    }
    if (this.kind === "rabbit") this.hop(dt);
    else this.amble(dt);
    // Turn back at the fence.
    const cx = this.clampGarden(this.x);
    if (cx !== this.x) {
      this.x = cx;
      this.facing = cx <= this.home.gardenX0 + 8 ? 1 : -1;
      this.vx = 0;
    }
    this.sx += (1 - this.sx) * damp(10, dt);
    this.sy += (1 - this.sy) * damp(10, dt);
  }

  private hop(dt: number) {
    if (this.z > 0 || this.vz > 0) {
      this.vz -= 520 * dt;
      this.z = Math.max(0, this.z + this.vz * dt);
      this.x += this.vx * dt;
      if (this.z <= 0 && this.vz < 0) {
        this.vz = 0;
        this.vx = 0;
        this.sx = 1.25; this.sy = 0.8;
      }
      return;
    }
    if (this.timer <= 0) {
      this.timer = rand(0.5, 2.2);
      if (chance(0.35)) this.facing = -this.facing;
      this.vz = rand(80, 110);
      this.vx = this.facing * rand(25, 45);
      this.sx = 0.8; this.sy = 1.2;
    }
  }

  private amble(dt: number) {
    if (this.timer <= 0) {
      this.timer = rand(1.5, 4);
      this.napping = chance(0.3);
      if (!this.napping && chance(0.5)) this.facing = -this.facing;
    }
    const walking = !this.napping && this.timer > 1;
    this.vx = walking ? this.facing * 14 : 0;
    this.x += this.vx * dt;
    if (walking) this.walkT += dt * 14 * 0.25 * 4;
    if (this.vz > 0 || this.z > 0) {
      this.vz -= 520 * dt;
      this.z = Math.max(0, this.z + this.vz * dt);
      if (this.z <= 0) this.vz = 0;
    }
  }

  private clampGarden(x: number) {
    return Math.max(this.home.gardenX0 + 8, Math.min(this.home.gardenX1 - 8, x));
  }

  draw(ctx: Ctx, game: Game) {
    const b = this.body;
    b.x = this.x;
    b.y = this.home.groundAt(game.world, this.x) - this.z;
    b.facing = this.facing;
    b.onGround = this.z <= 0;
    b.sx = this.sx;
    b.sy = this.sy * (this.napping ? 0.85 : 1);
    if (b instanceof Boar) b.pose(this.vx !== 0, this.walkT);
    b.draw(ctx, game);
    if (this.napping && this.kind === "boar") {
      const k = (game.time * 0.8 + this.x) % 1;
      drawText(ctx, "Z", this.x - this.facing * 6, b.y - 20 - k * 6, P.cream, "");
    }
  }
}
