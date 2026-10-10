import { sfx } from "../engine/audio";
import { blob, ellipse, px, rect, setOverride, type Ctx } from "../engine/gfx";
import { approach, chance, rand, randInt, sign } from "../engine/math";
import { HeartFx, RingFx } from "./effects";
import { Entity, type HitKind } from "./entity";
import type { Game } from "./game";
import { P } from "./palette";

export type EnemyKind = "slime" | "rabbit" | "boar" | "king";

/** Shared hit reaction: flash, knockback scaled by weight, squash, numbers, death poof. */
export abstract class Enemy extends Entity {
  abstract kind: EnemyKind;
  protected weight = 1;
  protected hurtT = 0; // AI pauses while reeling
  facing = 1;

  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.hurtable = true;
    this.facing = chance(0.5) ? 1 : -1;
  }

  /** Whether touching this enemy hurts the player right now. */
  abstract dealsContactDamage(): boolean;

  burnT = 0;
  private burnTick = 0;
  freezeT = 0;
  shockT = 0;
  rootT = 0;
  protected freezeDur = 2.4;
  protected shockDur = 0.9;
  protected rootDur = 1.8;
  /** Won over by flower magic. */
  friend = false;

  /** Animals are befriended by flower magic instead of hurt by it. */
  get animal() {
    return false;
  }

  /** Frozen, shocked or tangled in vines: no AI, no contact damage. */
  get disabled() {
    return this.freezeT > 0 || this.shockT > 0 || this.rootT > 0;
  }

  hurt(game: Game, dmg: number, dir: number, power: number, kind: HitKind) {
    if (this.dead) return;
    if (kind === "bloom" && this.animal) {
      this.befriend(game);
      return;
    }
    // Your magic just ruffles friends: a startled hop, no harm done.
    if (this.friend && kind !== "burn") {
      this.squash(0.8, 1.2);
      if (this.onGround) this.launch(dir * 40, -90);
      return;
    }
    // Anything but more ice smashes a frozen enemy for bonus damage.
    let shattered = false;
    if (this.freezeT > 0 && kind !== "ice" && kind !== "burn") {
      dmg += 2 + 2 * game.progress.level("shatter");
      this.freezeT = 0;
      shattered = true;
      this.shatterFx(game);
    }
    this.hp -= dmg;
    this.flash = 0.1;
    if (kind === "burn") {
      this.hurtT = Math.max(this.hurtT, 0.12);
      this.squash(1.15, 0.88);
      game.floatText(String(dmg), this.x + rand(-4, 4), this.y - this.h - 4, P.fire);
    } else {
      this.hurtT = 0.3;
      const kb = (130 * power) / this.weight;
      this.launch(dir * kb, -(80 + 50 * power) / Math.sqrt(this.weight));
      this.squash(0.62, 1.38);
      const col = kind === "fire" ? P.fireHi : kind === "ice" ? P.iceHi : kind === "thunder" ? P.volt : kind === "bloom" ? P.leafHi : P.magicYellow;
      game.floatText(String(dmg), this.x, this.y - this.h - 6, shattered ? P.iceHi : col, dmg >= 3);
      if (kind !== "blast") game.hitstop(shattered ? 8 : 4);
      game.shake(shattered ? 0.4 : 0.18);
    }
    this.onHurt(game, dir);
    if (this.hp <= 0) {
      this.die(game, dir);
      return;
    }
    if (kind === "fire") {
      // Each ember level adds two more 0.6s ticks.
      this.burnT = 1.9 + 1.2 * game.progress.level("fire_burn");
      this.burnTick = 0.6;
    } else if (kind === "ice") {
      if (this.freezeT <= 0) sfx.freeze();
      this.freezeT = this.freezeDur + game.progress.level("ice_freeze") * (this.kind === "king" ? 0.3 : 1);
      this.burnT = 0;
    } else if (kind === "thunder") {
      this.shockT = this.shockDur;
    } else if (kind === "bloom") {
      if (this.rootT <= 0) sfx.bloom();
      this.rootT = this.rootDur;
    }
  }

  /** Flower magic on an animal: a heart, and it stops being scared or cross. */
  private befriend(game: Game) {
    this.flash = 0.08;
    this.squash(1.25, 0.8);
    this.calm();
    game.addFx(new HeartFx(this.x, this.y - this.h - 2));
    game.particles.burst(this.x, this.cy, {
      count: 6, colors: [P.blossom, P.blossomHi, P.heart], speed: [20, 60], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.4, 0.7], shape: "px",
    });
    if (!this.friend) {
      this.friend = true;
      game.onBefriend(this);
    } else sfx.heal();
  }

  protected calm() {}

  private shatterFx(game: Game) {
    sfx.shatter();
    game.floatText("SHATTER!", this.x, this.y - this.h - 16, P.iceHi);
    game.addFx(new RingFx(this.x, this.cy, 4, 24, 0.25, P.iceHi, 1, 2));
    game.particles.burst(this.x, this.cy, {
      count: 16, colors: [P.ice, P.iceHi, P.iceDark, P.white], speed: [70, 190], angle: [-Math.PI * 0.95, -Math.PI * 0.05],
      life: [0.5, 0.9], size: [1, 3], gravity: 480, bounce: 0.4, shape: "chunk", spread: this.hw * 0.6,
    });
    game.particles.burst(this.x, this.cy, {
      count: 10, colors: [P.white, P.iceHi], speed: [80, 200], life: [0.15, 0.3], shape: "spark", additive: true, drag: 5,
    });
  }

  update(game: Game, dt: number) {
    if (game.world.inWater(this.x, this.y) || this.fellOut(game.world)) {
      // Knocked (or wandered) into the water: gone with a splash, no drops.
      this.dead = true;
      this.hurtable = false;
      if (!this.fellOut(game.world)) game.splash(this.x, this.y);
      return;
    }
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.burnTick -= dt;
      if (Math.random() < dt * 22) {
        game.particles.burst(this.x + rand(-this.hw, this.hw), this.y - rand(2, this.h), {
          count: 1, colors: [P.fire, P.fireHi, P.fireDark], speed: [10, 30], angle: [-Math.PI * 0.7, -Math.PI * 0.3],
          life: [0.2, 0.45], size: [1.5, 3], shape: "circle", shrink: true, gravity: -90,
        });
      }
      if (this.burnTick <= 0) {
        this.burnTick = 0.6;
        sfx.sizzle();
        this.hurt(game, 1, -this.facing, 0, "burn");
        if (this.dead) return;
      }
    }
    if (this.shockT > 0) this.shockT -= dt;
    if (this.rootT > 0) {
      this.rootT -= dt;
      if (this.rootT <= 0) {
        game.particles.burst(this.x, this.y - 2, {
          count: 6, colors: [P.leaf, P.leafDark, P.leafHi], speed: [20, 50], angle: [-Math.PI, 0], life: [0.4, 0.7], gravity: 120,
        });
      }
    }
    // Friends give off the odd little heart.
    if (this.friend && Math.random() < dt * 0.4) game.addFx(new HeartFx(this.x, this.y - this.h - 2, 0.7));
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      if (this.freezeT <= 0) {
        game.particles.burst(this.x, this.cy, {
          count: 8, colors: [P.ice, P.iceHi], speed: [20, 70], angle: [-Math.PI, 0], life: [0.3, 0.6], gravity: 300, spread: this.hw * 0.5,
        });
      }
    }
    if (this.disabled) {
      this.baseUpdate(game, dt);
      if (this.onGround) this.vx = approach(this.vx, 0, (this.freezeT > 0 ? 250 : 600) * dt);
      this.moveBody(game.world, dt, false);
      return;
    }
    this.act(game, dt);
  }

  protected abstract act(game: Game, dt: number): void;

  /** Ice block / crackle drawn over the creature. */
  drawStatus(ctx: Ctx, game: Game) {
    const b = this.box();
    if (this.rootT > 0 && !(this.rootT < 0.4 && Math.floor(game.time * 20) % 2 === 0)) {
      // Vines coiled round the feet.
      const w = b.x1 - b.x0;
      for (let i = 0; i < 3; i++) {
        const y = Math.round(b.y1 - 2 - i * 3);
        for (let x = Math.round(b.x0 - 1); x <= b.x1 + 1; x++) {
          const on = Math.sin((x - b.x0) * 0.9 + i * 2) > -0.2;
          if (on) px(ctx, x, y + Math.round(Math.sin((x - b.x0) * 0.6 + i) * 1), i === 1 ? P.leafHi : P.leaf);
        }
      }
      px(ctx, b.x0 + w * 0.2, b.y1 - 9, P.leafHi);
      px(ctx, b.x1 - w * 0.2, b.y1 - 8, P.blossom);
    }
    if (this.freezeT > 0) {
      if (this.freezeT < 0.6 && Math.floor(game.time * 20) % 2 === 0) return;
      const x0 = Math.round(b.x0 - 2), y0 = Math.round(b.y0 - 3), w = Math.round(b.x1 - b.x0 + 4), h = Math.round(b.y1 - b.y0 + 3);
      ctx.globalAlpha = 0.5;
      rect(ctx, x0, y0, w, h, P.ice);
      ctx.globalAlpha = 1;
      rect(ctx, x0, y0 - 1, w, 1, P.iceDark);
      rect(ctx, x0, y0 + h, w, 1, P.iceDark);
      rect(ctx, x0 - 1, y0, 1, h, P.iceDark);
      rect(ctx, x0 + w, y0, 1, h, P.iceDark);
      rect(ctx, x0, y0, w, 1, P.iceHi);
      for (let i = 0; i < 3; i++) px(ctx, x0 + 2 + i, y0 + 4 - i, P.white);
      px(ctx, x0 + w - 3, y0 + h - 3, P.white);
    } else if (this.shockT > 0) {
      const cx = this.x, cy = this.cy;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = this.hw + 2;
        let x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * this.h * 0.6;
        for (let s = 0; s < 3; s++) {
          const nx = x + rand(-3, 3), ny = y + rand(-3, 3);
          px(ctx, nx, ny, s === 0 ? P.white : P.volt);
          x = nx; y = ny;
        }
      }
    }
  }

  private die(game: Game, dir: number) {
    this.dead = true;
    this.hurtable = false;
    game.hitstop(7);
    game.shake(0.35);
    sfx.pop();
    game.poof(this.x, this.cy, 10, [P.white, P.cloudShade]);
    game.addFx(new RingFx(this.x, this.cy, 3, 22, 0.25, P.white, 1, 2));
    game.particles.burst(this.x, this.cy, {
      count: 4, colors: [P.white], speed: [60, 120], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.5, 0.8], shape: "star", gravity: 220,
    });
    this.onDeath(game, dir);
  }

  protected baseUpdate(game: Game, dt: number) {
    this.flash = Math.max(0, this.flash - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.updateSquash(dt, 480, 13);
    if (this.onGround && this.hurtT > 0) this.vx = approach(this.vx, 0, 500 * dt);
  }

  protected abstract onHurt(game: Game, dir: number): void;
  protected abstract onDeath(game: Game, dir: number): void;
}

// ---------------------------------------------------------------- Slime

export class Slime extends Enemy {
  kind: EnemyKind = "slime";
  private state: "idle" | "windup" | "air" = "idle";
  private timer = rand(0.3, 1.5);
  private big: boolean;

  /** big: undefined rolls the dice (one in five is big). */
  constructor(x: number, y: number, big?: boolean) {
    super(x, y);
    this.big = big ?? chance(0.2);
    this.hw = this.big ? 9 : 6;
    this.h = this.big ? 14 : 10;
    this.hp = this.maxHp = this.big ? 5 : 3;
    this.weight = this.big ? 1.6 : 1;
  }

  dealsContactDamage() {
    return this.hurtT <= 0;
  }

  protected act(game: Game, dt: number) {
    this.baseUpdate(game, dt);
    const wasGround = this.onGround;
    if (this.onGround && this.hurtT <= 0 && this.state !== "air") this.vx = approach(this.vx, 0, 400 * dt);
    this.moveBody(game.world, dt, false);
    if (!wasGround && this.onGround) {
      this.squash(1.4, 0.65);
      if (this.landSpeed > 100) {
        sfx.land();
        game.particles.burst(this.x, this.y - 1, {
          count: 4, colors: [P.slime, P.slimeHi], speed: [20, 60], angle: [-Math.PI, 0], life: [0.2, 0.4], gravity: 300,
        });
      }
      if (this.state === "air") {
        this.state = "idle";
        this.timer = rand(0.5, 1.3);
      }
    }
    if (this.hurtT > 0) {
      this.state = this.onGround ? "idle" : "air";
      return;
    }
    const p = game.player;
    const dx = p.x - this.x;
    const aggro = p.alive && Math.abs(dx) < 150 && Math.abs(p.y - this.y) < 80;
    this.timer -= dt;
    if (this.state === "idle" && this.onGround && this.timer <= 0) {
      this.state = "windup";
      this.timer = 0.28;
      this.facing = aggro ? sign(dx) || 1 : chance(0.5) ? 1 : -1;
    } else if (this.state === "windup") {
      this.sx = 1.3; this.sy = 0.72;
      if (this.timer <= 0) {
        const spd = aggro ? rand(60, 85) : rand(25, 45);
        this.launch(this.facing * spd, -rand(150, 190));
        this.squash(0.72, 1.35);
        this.state = "air";
      }
    }
    if (this.hitWall && this.state === "air") this.facing = -this.facing;
  }

  protected onHurt(game: Game, dir: number) {
    sfx.hitSoft();
    game.particles.burst(this.x, this.cy, {
      count: 8, colors: [P.slime, P.slimeHi, P.slimeDark], speed: [50, 130],
      angle: dir > 0 ? [-Math.PI * 0.6, 0.2] : [Math.PI - 0.2, Math.PI * 1.6], life: [0.4, 0.7], size: [1, 2.5],
      gravity: 450, bounce: 0.2, shape: "circle",
    });
  }

  protected onDeath(game: Game, dir: number) {
    game.particles.burst(this.x, this.cy, {
      count: 18, colors: [P.slime, P.slimeHi, P.slimeDark], speed: [60, 180], angle: [-Math.PI, 0],
      life: [0.5, 0.9], size: [1.5, 3], gravity: 420, bounce: 0.2, shape: "circle", shrink: true,
    });
    const n = this.big ? randInt(2, 3) : randInt(1, 2);
    for (let i = 0; i < n; i++) game.spawnItem("gel", this.x, this.y - 6, dir);
  }

  draw(ctx: Ctx, game: Game) {
    if (this.flash > 0) setOverride(P.white);
    const s = this.big ? 1.4 : 1;
    const wob = this.state === "idle" && this.onGround ? Math.sin(game.time * 5 + this.x) * 0.06 : 0;
    const rx = 7.5 * s * (this.sx + wob);
    const ry = 7 * s * (this.sy - wob);
    const cy = this.y - ry + 1;
    const y = Math.round(this.y);
    blob(ctx, this.x, cy, rx, ry, P.slimeDark, P.outline, y);
    ellipse(ctx, this.x - 0.5, cy - 1, rx - 1.2, ry - 1.5, P.slime, y - 1);
    ellipse(ctx, this.x - rx * 0.45, cy - ry * 0.5, 1.8 * s, 1.2 * s, P.slimeHi);
    px(ctx, this.x - rx * 0.1, cy - ry * 0.75, P.slimeHi);
    const f = this.facing;
    const ex = this.x + f * 2 * s;
    const ey = cy - 1;
    if (this.hurtT > 0) {
      px(ctx, ex - 2, ey, P.eye); px(ctx, ex - 3, ey - 1, P.eye); px(ctx, ex - 3, ey + 1, P.eye);
      px(ctx, ex + 2, ey, P.eye); px(ctx, ex + 3, ey - 1, P.eye); px(ctx, ex + 3, ey + 1, P.eye);
    } else if (this.state === "windup") {
      rect(ctx, ex - 3, ey + 1, 2, 1, P.eye);
      rect(ctx, ex + 2, ey + 1, 2, 1, P.eye);
    } else {
      rect(ctx, ex - 3, ey - 1, 1, 3, P.eye);
      rect(ctx, ex + 2, ey - 1, 1, 3, P.eye);
    }
    px(ctx, ex, ey + 3, P.slimeDark);
    setOverride(null);
  }
}

// ---------------------------------------------------------------- Rabbit

export class Rabbit extends Enemy {
  kind: EnemyKind = "rabbit";
  private fleeT = 0;
  private hopT = rand(0.2, 1);

  constructor(x: number, y: number) {
    super(x, y);
    this.hw = 5;
    this.h = 10;
    this.hp = this.maxHp = 2;
    this.weight = 0.8;
  }

  dealsContactDamage() {
    return false;
  }

  get animal() {
    return true;
  }

  protected calm() {
    this.fleeT = 0;
  }

  protected act(game: Game, dt: number) {
    this.baseUpdate(game, dt);
    const wasGround = this.onGround;
    this.moveBody(game.world, dt, false);
    if (!wasGround && this.onGround) {
      this.squash(1.25, 0.8);
      this.vx = 0;
    }
    if (this.hurtT > 0) return;
    const p = game.player;
    const dx = p.x - this.x;
    // Strangers bolt when you get close; friends hop along after you.
    const near = p.alive && Math.abs(dx) < 56 && Math.abs(p.y - this.y) < 40;
    if (near && !this.friend) this.fleeT = 2.2;
    this.fleeT -= dt;
    const fleeing = this.fleeT > 0;
    const following = this.friend && !fleeing && p.alive && Math.abs(dx) > 34 && Math.abs(dx) < 180 && Math.abs(p.y - this.y) < 60;
    if (fleeing) this.facing = -(sign(dx) || 1);
    else if (following) this.facing = sign(dx) || 1;
    this.hopT -= dt;
    if (this.onGround && this.hopT <= 0) {
      if (following) {
        this.launch(this.facing * rand(60, 80), -110);
        this.squash(0.8, 1.25);
        this.hopT = rand(0.1, 0.3);
        return;
      }
      if (!fleeing && chance(0.3)) this.facing = -this.facing;
      const spd = fleeing ? rand(100, 125) : rand(28, 45);
      this.launch(this.facing * spd, fleeing ? -140 : -95);
      this.squash(0.8, 1.25);
      this.hopT = fleeing ? 0.05 : rand(0.4, 1.8);
    }
    if (this.hitWall) {
      if (fleeing && this.onGround) this.launch(this.facing * 80, -230);
      else this.facing = -this.facing;
    }
  }

  protected onHurt(game: Game, dir: number) {
    sfx.hitFlesh();
    this.fleeT = 3;
    game.particles.burst(this.x, this.cy, {
      count: 6, colors: [P.bunny, P.bunnyShade], speed: [30, 90], angle: dir > 0 ? [-Math.PI * 0.6, 0.3] : [Math.PI - 0.3, Math.PI * 1.6],
      life: [0.6, 1], gravity: 80, drag: 3,
    });
  }

  /** Rabbits leave nothing behind: soft fur comes from friends in the garden instead. */
  protected onDeath(game: Game, _dir: number) {
    game.particles.burst(this.x, this.cy, {
      count: 12, colors: [P.bunny, P.bunnyShade, P.bunnyEar], speed: [30, 110], life: [0.6, 1.1], gravity: 70, drag: 3,
    });
  }

  draw(ctx: Ctx) {
    if (this.flash > 0) setOverride(P.white);
    const f = this.facing;
    const x = this.x, y = this.y;
    const air = !this.onGround;
    const sy = this.sy, sx = this.sx;
    // Tail, body, head
    blob(ctx, x - f * 5.5 * sx, y - 5 * sy, 2, 2, P.white, P.outline);
    blob(ctx, x - f * 1, y - 4 * sy, 5.5 * sx, 4 * sy, P.bunny, P.outline, Math.round(y));
    ellipse(ctx, x - f * 1.5, y - 2.5 * sy, 4 * sx, 2, P.bunnyShade, Math.round(y));
    const hx = x + f * 3.5 * sx;
    const hy = y - 8 * sy;
    // Ears flop back while hopping
    const earLean = air ? -f * 2 : 0;
    for (const [ox, h] of [[-1, 6], [1.5, 5]] as const) {
      const ex = hx + f * ox;
      rect(ctx, ex - 1 + earLean * 0.5, hy - h - 2, 3, h + 1, P.outline);
      rect(ctx, ex + earLean * 0.5, hy - h - 1, 1, h, P.bunny);
      px(ctx, ex + earLean * 0.5, hy - h + 1, P.bunnyEar);
    }
    blob(ctx, hx, hy, 3.5, 3.2, P.bunny, P.outline);
    px(ctx, hx + f * 1.5, hy - 0.5, P.eye);
    px(ctx, hx + f * 3, hy + 1, P.bunnyEar);
    px(ctx, hx - f * 0.5, hy + 1.5, P.cheek);
    // Feet
    rect(ctx, x - f * 3 - 1, y - 1, 3, 1, P.outline);
    rect(ctx, x + f * 2 - 1, y - 1, 3, 1, P.outline);
    setOverride(null);
  }
}

// ---------------------------------------------------------------- Boar

export class Boar extends Enemy {
  kind: EnemyKind = "boar";
  private state: "wander" | "windup" | "charge" | "stunned" = "wander";
  private timer = rand(1, 3);
  private angry = 0;
  private walkT = 0;
  private moving = false;

  constructor(x: number, y: number) {
    super(x, y);
    this.hw = 11;
    this.h = 14;
    this.hp = this.maxHp = 8;
    this.weight = 3;
  }

  dealsContactDamage() {
    return this.angry > 0 && this.hurtT <= 0 && this.state !== "stunned";
  }

  get animal() {
    return true;
  }

  /** Lets a garden pet puppet the walk cycle. */
  pose(moving: boolean, walkT: number) {
    this.moving = moving;
    this.walkT = walkT;
  }

  protected calm() {
    this.angry = 0;
    if (this.state !== "stunned") {
      this.state = "wander";
      this.timer = 2;
    }
  }

  protected act(game: Game, dt: number) {
    this.baseUpdate(game, dt);
    this.angry = Math.max(0, this.angry - dt);
    this.moveBody(game.world, dt, false);
    if (this.hurtT > 0) return;
    const p = game.player;
    const dx = p.x - this.x;
    this.timer -= dt;
    this.moving = false;

    switch (this.state) {
      case "wander": {
        // A friendly boar trots along behind you.
        if (this.friend && this.angry <= 0 && p.alive && Math.abs(dx) > 40 && Math.abs(dx) < 200 && Math.abs(p.y - this.y) < 60) {
          this.facing = sign(dx) || 1;
          this.vx = approach(this.vx, this.facing * 70, 300 * dt);
          this.moving = true;
          if (this.hitWall && this.onGround) this.launch(this.vx, -200);
          break;
        }
        if (this.timer <= 0) {
          this.timer = rand(1.5, 3.5);
          this.facing = chance(0.5) ? 1 : -1;
        }
        const walking = this.timer > 1;
        this.vx = approach(this.vx, walking ? this.facing * 22 : 0, 200 * dt);
        this.moving = walking;
        if (this.hitWall) this.facing = -this.facing;
        if (this.angry > 0 && p.alive && Math.abs(dx) < 170 && Math.abs(p.y - this.y) < 60) {
          this.state = "windup";
          this.timer = 0.6;
          this.facing = sign(dx) || 1;
          sfx.snort();
        }
        break;
      }
      case "windup":
        this.vx = approach(this.vx, 0, 400 * dt);
        this.sx = 1.1; this.sy = 0.9;
        if (Math.random() < 0.5) game.dust(this.x - this.facing * 8, this.y, 1, -this.facing);
        if (this.timer <= 0) {
          this.state = "charge";
          this.timer = 1.2;
          this.squash(1.3, 0.8);
        }
        break;
      case "charge":
        this.vx = this.facing * 175;
        this.moving = true;
        if (Math.random() < 0.6) game.dust(this.x - this.facing * 9, this.y, 1, -this.facing);
        if (this.hitWall) {
          this.state = "stunned";
          this.timer = 1.0;
          sfx.crash();
          game.shake(0.4);
          this.launch(-this.facing * 60, -120);
          this.squash(0.7, 1.3);
          game.particles.burst(this.x + this.facing * 10, this.y - 10, {
            count: 5, colors: [P.magicYellow], speed: [30, 60], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.6, 0.9], shape: "starSmall", gravity: 100,
          });
        } else if (this.timer <= 0) {
          this.state = "wander";
          this.timer = 0.8;
          this.vx *= 0.5;
        }
        break;
      case "stunned":
        this.vx = approach(this.vx, 0, 300 * dt);
        if (this.timer <= 0) {
          this.state = "wander";
          this.timer = 0.5;
        }
        break;
    }
    if (this.moving && this.onGround) this.walkT += dt * Math.abs(this.vx) * 0.25;
  }

  protected onHurt(game: Game, dir: number) {
    sfx.hitFlesh();
    this.angry = 9;
    if (this.state === "wander") this.timer = 0;
    this.facing = -dir;
    game.particles.burst(this.x, this.cy, {
      count: 6, colors: [P.boar, P.boarDark], speed: [40, 110], angle: dir > 0 ? [-Math.PI * 0.6, 0.2] : [Math.PI - 0.2, Math.PI * 1.6],
      life: [0.5, 0.9], gravity: 100, drag: 2,
    });
  }

  protected onDeath(game: Game, dir: number) {
    game.particles.burst(this.x, this.cy, {
      count: 16, colors: [P.boar, P.boarDark, P.boarSnout], speed: [40, 140], life: [0.6, 1.1], gravity: 100, drag: 2,
    });
    const n = randInt(1, 2);
    for (let i = 0; i < n; i++) game.spawnItem("fur", this.x, this.y - 8, dir);
    game.spawnItem("meat", this.x, this.y - 8, dir);
    game.spawnItem("meat", this.x, this.y - 8, -dir);
  }

  draw(ctx: Ctx, game: Game) {
    if (this.flash > 0) setOverride(P.white);
    const f = this.facing;
    const x = this.x, y = this.y;
    const sx = this.sx, sy = this.sy;
    const leg = this.moving ? Math.sin(this.walkT) * 1.5 : 0;
    // Legs
    for (const [ox, ph] of [[-7, 1], [-3, -1], [4, 1], [8, -1]] as const) {
      const lx = x + f * ox * sx;
      const lift = Math.max(0, leg * ph);
      rect(ctx, lx - 1.5, y - 4 - lift, 3, 4, P.outline);
      rect(ctx, lx - 0.5, y - 4 - lift, 1, 3, P.boarDark);
    }
    // Body
    blob(ctx, x - f * 1, y - 8 * sy, 11 * sx, 6.5 * sy, P.boar, P.outline);
    ellipse(ctx, x - f * 2, y - 12 * sy, 8 * sx, 2.6 * sy, P.boarDark);
    ellipse(ctx, x - f * 0, y - 5.5 * sy, 8 * sx, 2.5 * sy, "#b98363");
    px(ctx, x - f * 12 * sx, y - 11 * sy, P.outline);
    px(ctx, x - f * 13 * sx, y - 12 * sy, P.outline);
    // Head
    const hx = x + f * 9 * sx;
    const hy = y - 8 * sy;
    rect(ctx, hx - f * 1 - 1, hy - 7, 3, 3, P.outline);
    px(ctx, hx - f * 1, hy - 6, P.boarSnout);
    blob(ctx, hx, hy, 5, 4.6, "#bf8a66", P.outline);
    ellipse(ctx, hx - f * 1, hy + 2, 3.5, 1.5, P.boar);
    blob(ctx, hx + f * 4.8, hy + 1, 2.8, 2.2, P.boarSnout, P.outline);
    px(ctx, hx + f * 5, hy + 1, P.boarDark);
    px(ctx, hx + f * 3, hy + 3, P.tusk);
    px(ctx, hx + f * 3, hy + 2, P.tusk);
    const angry = this.angry > 0;
    px(ctx, hx + f * 1.5, hy - 1.5, angry ? P.red : P.eye);
    if (angry) {
      px(ctx, hx + f * 0.5, hy - 3, P.eye);
      px(ctx, hx + f * 1.5, hy - 2.5, P.eye);
    }
    setOverride(null);
    if (angry && Math.floor(game.time * 4) % 2 === 0 && this.state !== "charge") {
      px(ctx, hx - f * 2, hy - 9, P.white);
      px(ctx, hx - f * 3, hy - 10, P.white);
    }
    if (this.state === "stunned") {
      for (let i = 0; i < 3; i++) {
        const a = game.time * 6 + (i * Math.PI * 2) / 3;
        px(ctx, hx + Math.cos(a) * 5, hy - 8 + Math.sin(a) * 1.5, P.magicYellow);
      }
    }
  }
}
