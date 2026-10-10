import { sfx } from "../engine/audio";
import { ellipse, line, px, rect, ring, setOverride, type Ctx } from "../engine/gfx";
import { lerp, rand } from "../engine/math";
import { RingFx } from "./effects";
import { Entity, type HitKind } from "./entity";
import type { Game } from "./game";
import { P } from "./palette";
import type { Barrier, World } from "./world";

/**
 * crack   – cracked rock pillar, broken by the charged starlight pillar
 * bramble – thorn wall, burnt away by fire
 * sealed  – ancient gate, woken by thunder
 * seal    – pink force wall that locks the boss arena during the fight
 */
export type GateKind = "crack" | "bramble" | "sealed" | "seal";

const HALF: Record<GateKind, number> = { crack: 11, bramble: 13, sealed: 13, seal: 3 };
const HINT_TAG: Record<GateKind, string> = { crack: "?", bramble: "?", sealed: "?", seal: "" };

/** A wall from the ground up to the ceiling (or the sky) that only one kind of magic can open. */
export class Gate extends Entity {
  state: "closed" | "opening" | "open" = "closed";
  readonly barrier: Barrier;
  /** Where the wall ends at the top: the ceiling above, or the top of the map. */
  readonly top: number;
  private openT = 0;
  private shakeT = 0;
  private hintCd = 0;
  private glow = 0;

  constructor(world: World, readonly kind: GateKind, x: number, y: number, readonly id: string) {
    super();
    this.x = x;
    this.y = world.restY(x, y);
    let top = this.y - 1;
    while (top > 0 && !world.solid(x, top - 1)) top--;
    this.top = top;
    this.hw = HALF[kind];
    this.h = this.y - top;
    this.barrier = world.addBarrier(x - this.hw, x + this.hw, top, this.y);
    this.hurtable = kind !== "seal";
    this.hp = this.maxHp = 6;
    if (kind === "seal") this.setClosed(false);
  }

  /** Already opened in a previous session. */
  forceOpen() {
    this.state = "open";
    this.barrier.closed = false;
    this.hurtable = false;
  }

  /** For the arena seal only. */
  setClosed(closed: boolean) {
    this.barrier.closed = closed;
    this.state = closed ? "closed" : "open";
    this.openT = 0;
  }

  hurt(game: Game, dmg: number, dir: number, _power: number, kind: HitKind) {
    if (this.state !== "closed" || this.kind === "seal") return;
    this.flash = 0.06;
    this.shakeT = 0.25;
    const works = (this.kind === "crack" && kind === "blast")
      || (this.kind === "bramble" && kind === "fire")
      || (this.kind === "sealed" && kind === "thunder");
    if (!works) return this.nope(game, dir);

    if (this.kind === "crack") {
      this.hp -= dmg;
      sfx.hitStone();
      game.shake(0.3);
      this.chips(game, 10);
      if (this.hp <= 0) this.open(game);
    } else {
      this.open(game);
    }
  }

  private nope(game: Game, dir: number) {
    if (this.kind === "bramble") {
      sfx.hitWood();
      game.particles.burst(this.x - dir * this.hw, this.y - rand(10, 40), {
        count: 5, colors: [P.leaf, P.leafDark, P.leafHi], speed: [20, 60], life: [0.6, 1], gravity: 60, drag: 2.5,
      });
    } else {
      sfx.hitStone();
      this.chips(game, 3);
    }
    if (this.hintCd <= 0) {
      this.hintCd = 0.8;
      game.floatText(HINT_TAG[this.kind], this.x - dir * (this.hw + 6), game.player.y - 30, P.cream, true);
    }
  }

  private chips(game: Game, n: number) {
    const p = game.player;
    game.particles.burst(this.x - Math.sign(this.x - p.x) * this.hw, p.y - 12, {
      count: n, colors: [P.stone, P.stoneDark, P.stoneHi], speed: [60, 150], angle: [-Math.PI * 0.95, -Math.PI * 0.05],
      life: [0.5, 0.9], size: [1, 2.5], gravity: 520, bounce: 0.4, shape: "chunk",
    });
  }

  private open(game: Game) {
    this.state = "opening";
    this.openT = 0;
    this.hurtable = false;
    if (this.kind === "bramble") sfx.burnUp();
    else if (this.kind === "sealed") sfx.rumble();
    else sfx.breakStone();
    game.hitstop(8);
    game.shake(0.7);
    if (this.kind === "crack") this.finish(game);
  }

  private finish(game: Game) {
    this.state = "open";
    this.barrier.closed = false;
    const cy = game.player.y - 20;
    game.addFx(new RingFx(this.x, cy, 6, 40, 0.4, P.white, 1, 2));
    if (this.kind === "crack") {
      game.particles.burst(this.x, cy, {
        count: 40, colors: [P.stone, P.stoneDark, P.stoneHi, P.stoneDeep], speed: [80, 240], angle: [-Math.PI, 0],
        life: [0.7, 1.3], size: [1, 3.5], gravity: 560, bounce: 0.45, shape: "chunk", spread: 12,
      });
      game.particles.burst(this.x, this.y - 6, {
        count: 16, colors: [P.cream, P.stoneHi, P.white], speed: [20, 90], angle: [-Math.PI, 0],
        life: [0.5, 1], size: [3, 7], shape: "circle", shrink: true, drag: 3, spread: 10,
      });
      for (let i = 0; i < 3; i++) game.spawnItem("stone", this.x, this.y - 20, 0);
      game.spawnItem("crystal", this.x, this.y - 20, 0);
    } else if (this.kind === "bramble") {
      game.particles.burst(this.x, cy, {
        count: 40, colors: [P.smoke, "#5a4a60", P.fireDark], speed: [20, 90], life: [0.8, 1.6], size: [2, 5],
        shape: "circle", shrink: true, gravity: -50, drag: 2, spread: 20,
      });
    }
    game.particles.burst(this.x, cy, {
      count: 8, colors: [P.white], speed: [60, 140], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.6, 1], shape: "star", gravity: 200,
    });
    sfx.unlock();
    game.onGateOpened(this);
  }

  update(game: Game, dt: number) {
    this.flash = Math.max(0, this.flash - dt);
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.hintCd -= dt;
    this.glow = Math.max(0, this.glow - dt);
    if (this.state !== "opening") return;
    this.openT += dt;
    if (this.kind === "bramble") {
      // Flames race up the thorns, then it all crumbles to ash.
      for (let i = 0; i < 4; i++) {
        game.particles.burst(this.x + rand(-this.hw, this.hw), this.y - rand(0, 110), {
          count: 1, colors: [P.fire, P.fireHi, P.fireDark], speed: [10, 40], angle: [-Math.PI * 0.7, -Math.PI * 0.3],
          life: [0.3, 0.6], size: [2, 4.5], shape: "circle", shrink: true, gravity: -120,
        });
      }
      if (Math.random() < dt * 10) sfx.sizzle();
      if (this.openT > 1.3) this.finish(game);
    } else if (this.kind === "sealed") {
      if (Math.random() < 0.5) game.dust(this.x + rand(-this.hw, this.hw), this.y, 1, 0);
      game.shake(0.06);
      if (this.openT > 1.4) this.finish(game);
    }
  }

  draw(ctx: Ctx, game: Game) {
    if (this.state === "open") return;
    const top = Math.max(this.top, Math.floor(game.camY) - 2);
    const sh = Math.round(Math.sin(this.shakeT * 70) * this.shakeT * 6);
    if (this.flash > 0) setOverride(P.white);
    switch (this.kind) {
      case "crack": this.drawCrack(ctx, top, sh); break;
      case "bramble": this.drawBramble(ctx, top, sh, game.time); break;
      case "sealed": this.drawSealed(ctx, top, sh, game.time); break;
      case "seal": this.drawSeal(ctx, top, game.time); break;
    }
    setOverride(null);
  }

  private drawCrack(ctx: Ctx, top: number, sh: number) {
    const x = this.x + sh, y = this.y, w = this.hw;
    rect(ctx, x - w - 1, top, w * 2 + 2, y - top, P.outline);
    rect(ctx, x - w, top, w * 2, y - top, P.stoneDark);
    rect(ctx, x - w, top, w * 2 - 3, y - top, P.stone);
    rect(ctx, x - w, top, 2, y - top, P.stoneHi);
    // Brick seams.
    for (let yy = y - 9; yy > top; yy -= 11) {
      rect(ctx, x - w, yy, w * 2, 1, P.stoneDark);
      const off = Math.floor(yy / 11) % 2 ? -3 : 4;
      rect(ctx, x + off, yy - 10, 1, 10, P.stoneDark);
    }
    // The big crack, glowing a little so it reads as "hit me with magic".
    const dmg = 1 - this.hp / this.maxHp;
    const pts: [number, number][] = [[x - 2, y - 58], [x + 3, y - 46], [x - 3, y - 34], [x + 4, y - 22], [x - 1, y - 10], [x + 2, y]];
    for (let i = 0; i < pts.length - 1; i++) line(ctx, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], P.stoneDeep);
    for (let i = 1; i < pts.length - 1; i += 2) px(ctx, pts[i][0], pts[i][1], P.magicPink);
    if (dmg > 0.2) {
      line(ctx, x + 3, y - 46, x + w - 1, y - 52, P.stoneDeep);
      line(ctx, x - 3, y - 34, x - w + 1, y - 28, P.stoneDeep);
      line(ctx, x + 4, y - 22, x + w - 2, y - 14, P.stoneDeep);
    }
    ellipse(ctx, x + 6, y - 2, 3, 1.5, P.moss);
  }

  private drawBramble(ctx: Ctx, top: number, sh: number, time: number) {
    const burning = this.state === "opening";
    const k = burning ? Math.min(1, this.openT / 1.1) : 0;
    const vine = burning ? (k > 0.5 ? P.outline : P.barkDark) : P.leafDark;
    const vineHi = burning ? (k > 0.5 ? P.barkDark : P.fireDark) : P.leaf;
    const x0 = this.x + sh;
    const bottom = this.y;
    // Background mass so there are no gaps to see through.
    rect(ctx, x0 - this.hw, top, this.hw * 2, bottom - top, burning ? "#4a3040" : "#2f5a45");
    for (let v = 0; v < 5; v++) {
      const base = x0 - this.hw + 2 + v * ((this.hw * 2 - 4) / 4);
      for (let y = top; y < bottom; y++) {
        const sway = Math.sin(y * 0.09 + v * 1.9) * 3 + (burning ? 0 : Math.sin(time * 1.5 + v) * 0.5);
        const vx = base + sway;
        rect(ctx, vx - 2, y, 4, 1, P.outline);
        rect(ctx, vx - 1, y, 2, 1, vine);
        px(ctx, vx - 1, y, vineHi);
        // Thorns
        if ((y + v * 7) % 9 === 0) {
          const side = (y + v) % 2 ? 1 : -1;
          px(ctx, vx + side * 2, y, P.outline);
          px(ctx, vx + side * 3, y - 1, burning ? P.fireHi : P.cream);
        }
        // Leaves and the odd berry
        if (!burning && (y * 3 + v * 11) % 23 === 0) {
          ellipse(ctx, vx + ((y + v) % 2 ? 3 : -3), y, 2, 1.3, P.leafHi);
        }
        if (!burning && (y * 5 + v * 13) % 61 === 0) {
          px(ctx, vx + 1, y + 1, P.blossom);
          px(ctx, vx + 2, y + 1, P.blossomDark);
        }
      }
    }
    if (burning) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.35 * (1 - k * 0.5);
      rect(ctx, x0 - this.hw - 2, top, this.hw * 2 + 4, bottom - top, P.fire);
      ctx.restore();
    }
  }

  private drawSealed(ctx: Ctx, top: number, sh: number, time: number) {
    const sink = this.state === "opening" ? Math.pow(Math.min(1, this.openT / 1.4), 2) * (this.y - top) : 0;
    const x = this.x + sh + (sink > 0 ? Math.round(Math.sin(time * 60)) : 0), y = this.y, w = this.hw;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - w - 3, top, w * 2 + 6, y - top);
    ctx.clip();
    const t = top + sink;
    rect(ctx, x - w - 1, t, w * 2 + 2, y - top, P.outline);
    rect(ctx, x - w, t, w * 2, y - top, "#8a86b8");
    rect(ctx, x - w, t, 3, y - top, "#b8b4e0");
    rect(ctx, x + w - 3, t, 3, y - top, "#6a6694");
    // Carved runes all the way up.
    for (let yy = y + sink - 50; yy > t; yy -= 16) {
      rect(ctx, x - 4, yy, 8, 1, "#5a5680");
      px(ctx, x - 4, yy - 2, "#5a5680"); px(ctx, x + 3, yy + 2, "#5a5680");
      px(ctx, x, yy - 4, "#5a5680"); px(ctx, x, yy + 4, "#5a5680");
    }
    // The heart crystal.
    const cy = y - 26 + sink;
    const awake = this.state === "opening";
    const col = awake ? P.volt : "#9b7fd0";
    const pulse = awake ? 1 : 0.5 + 0.5 * Math.sin(time * 2.5);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = awake ? 0.6 : 0.15 + pulse * 0.1;
    ellipse(ctx, x, cy, 10, 12, awake ? P.volt : P.magicPurple);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    for (let i = -8; i <= 8; i++) {
      const half = Math.round(5 * (1 - Math.abs(i) / 8.5)) + 1;
      rect(ctx, x - half - 1, cy + i, half * 2 + 2, 1, P.outline);
    }
    for (let i = -7; i <= 7; i++) {
      const half = Math.round(5 * (1 - Math.abs(i) / 8.5));
      rect(ctx, x - half, cy + i, half, 1, awake ? P.voltHi : "#c9b0ff");
      rect(ctx, x, cy + i, half, 1, col);
    }
    px(ctx, x - 2, cy - 3, P.white);
    ctx.restore();
    if (awake) ring(ctx, x, cy, 8 + (time * 40) % 14, 8 + (time * 40) % 14, P.volt);
  }

  private drawSeal(ctx: Ctx, top: number, time: number) {
    const x = this.x, y = this.y;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.35 + 0.1 * Math.sin(time * 6);
    rect(ctx, x - 4, top, 8, y - top, P.magicPink);
    ctx.globalAlpha = 0.8;
    for (let yy = y - ((time * 30) % 12); yy > top; yy -= 12) {
      rect(ctx, x - 2, yy, 4, 1, P.white);
      px(ctx, x + (Math.floor(yy / 12) % 2 ? 2 : -3), yy - 5, P.magicYellow);
    }
    ctx.restore();
    rect(ctx, x, top, 1, y - top, P.white);
  }
}

/** Wooden signpost; walking up to it shows a hint under the game screen. */
export class Sign {
  constructor(readonly x: number, readonly y: number, readonly text: string) {}

  draw(ctx: Ctx, near: boolean, time: number) {
    const x = this.x, y = this.y;
    rect(ctx, x - 2, y - 12, 4, 12, P.outline);
    rect(ctx, x - 1, y - 12, 2, 12, P.bark);
    const by = y - 20 + (near ? Math.round(Math.sin(time * 6) * 0.8 - 0.5) : 0);
    rect(ctx, x - 9, by - 1, 18, 11, P.outline);
    rect(ctx, x - 8, by, 16, 9, P.barkLight);
    rect(ctx, x - 8, by + 8, 16, 1, P.bark);
    rect(ctx, x - 6, by + 2, 12, 1, P.barkDark);
    rect(ctx, x - 6, by + 5, 8, 1, P.barkDark);
    if (near) {
      px(ctx, x, by - 5, P.magicYellow);
      px(ctx, x, by - 4, P.magicYellow);
      px(ctx, x, by - 2, P.magicYellow);
    }
  }
}

/** Checkpoint: a stone lantern that lights up as you pass. You respawn at the last one lit. */
export class Lantern {
  lit = false;
  private litT = 0;

  /** id is unique across all maps; "home" is the one at the garden gate. */
  constructor(readonly x: number, readonly y: number, readonly id: string) {}

  light(game: Game) {
    this.lit = true;
    this.litT = 0.6;
    sfx.checkpoint();
    game.addFx(new RingFx(this.x, this.y - 16, 3, 22, 0.35, P.magicYellow));
    game.particles.burst(this.x, this.y - 16, {
      count: 12, colors: [P.magicYellow, P.white, P.magicPink], speed: [30, 90], life: [0.3, 0.6], shape: "px", additive: true, drag: 3,
    });
  }

  update(game: Game, dt: number) {
    this.litT = Math.max(0, this.litT - dt);
    if (this.lit && Math.random() < dt * 3) {
      game.particles.burst(this.x + rand(-2, 2), this.y - 17, {
        count: 1, colors: [P.magicYellow, P.white], speed: [4, 12], angle: [-Math.PI * 0.7, -Math.PI * 0.3], life: [0.5, 1], shape: "px", additive: true,
      });
    }
  }

  draw(ctx: Ctx, time: number) {
    const x = this.x, y = this.y;
    // Base and post
    rect(ctx, x - 5, y - 4, 10, 4, P.outline);
    rect(ctx, x - 4, y - 3, 8, 3, P.stone);
    rect(ctx, x - 2, y - 12, 4, 9, P.outline);
    rect(ctx, x - 1, y - 12, 2, 9, P.stoneDark);
    // Lamp house and roof
    rect(ctx, x - 5, y - 21, 10, 9, P.outline);
    const lampCol = this.lit ? (this.litT > 0 ? P.white : P.magicYellow) : "#4a3a60";
    rect(ctx, x - 4, y - 20, 8, 7, P.stone);
    rect(ctx, x - 2, y - 19, 4, 5, lampCol);
    rect(ctx, x - 7, y - 24, 14, 3, P.outline);
    rect(ctx, x - 6, y - 23, 12, 1, P.stoneHi);
    rect(ctx, x - 1, y - 26, 2, 2, P.outline);
    if (this.lit) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.18 + 0.06 * Math.sin(time * 5 + x);
      ellipse(ctx, x, y - 16, lerp(10, 16, this.litT), lerp(10, 16, this.litT), P.magicYellow);
      ctx.restore();
    }
  }
}
