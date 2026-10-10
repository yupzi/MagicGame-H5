import { sfx } from "../engine/audio";
import { ellipse, line, px, rect, setOverride, type Ctx } from "../engine/gfx";
import { chance, makeRng, randInt } from "../engine/math";
import { RingFx } from "./effects";
import { Entity, type HitKind } from "./entity";
import type { Game } from "./game";
import { P } from "./palette";

type State = "alive" | "stump" | "growing";

/**
 * Harvestable props. They wobble, flash and spit debris on every hit, drop a
 * few items as you work on them, burst when broken and regrow later.
 */
export abstract class Resource extends Entity {
  state: State = "alive";
  protected shakeT = 0;
  protected shakeDir = 1;
  protected regrowT = 0;
  protected growK = 1;
  protected seed: number;
  protected abstract regrowTime: number;
  protected abstract hitColor: string;

  constructor(x: number, y: number, seed: number) {
    super();
    this.x = x;
    this.y = y;
    this.seed = seed;
    this.hurtable = true;
  }

  private nourishCd = 0;

  /** Flower magic: a stump regrows on the spot; a living plant perks up. */
  nourish(game: Game) {
    if (this.nourishCd > 0 || this.state === "growing") return;
    this.nourishCd = 2;
    if (this.state === "stump") {
      this.state = "growing";
      this.growK = 0;
    } else {
      this.squash(1.1, 0.92);
      this.onNourish(game);
    }
    game.particles.burst(this.x, this.y - Math.min(this.h, 20) / 2, {
      count: 8, colors: [P.leafHi, P.blossom, P.white], speed: [15, 45], angle: [-Math.PI * 0.85, -Math.PI * 0.15],
      life: [0.5, 0.9], shape: "px", gravity: -20, spread: 6,
    });
  }

  protected onNourish(_game: Game) {}

  /** Overnight, every stump starts growing back. */
  regrowNow() {
    if (this.state !== "stump") return;
    this.state = "growing";
    this.growK = 0;
  }

  hurt(game: Game, dmg: number, dir: number, power: number, kind: HitKind) {
    if (kind === "bloom") return this.nourish(game);
    if (this.state !== "alive") return;
    this.hp -= dmg;
    this.flash = 0.07;
    this.shakeT = 0.35;
    this.shakeDir = dir;
    game.floatText(String(dmg), this.x + dir * 3, this.y - this.h - 6, this.hitColor, dmg >= 3);
    if (kind !== "blast") game.hitstop(3);
    game.shake(0.12 + 0.05 * power);
    this.onHit(game, dir);
    if (this.hp <= 0) {
      this.state = "stump";
      this.hurtable = false;
      this.regrowT = this.regrowTime;
      game.hitstop(6);
      game.shake(0.35);
      game.addFx(new RingFx(this.x, this.y - 4, 4, 26, 0.3, P.white, 0.4, 2));
      this.onBreak(game, dir);
    }
  }

  update(game: Game, dt: number) {
    this.nourishCd = Math.max(0, this.nourishCd - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.shakeT = Math.max(0, this.shakeT - dt);
    this.updateSquash(dt, 700, 18);
    if (this.state === "stump") {
      this.regrowT -= dt;
      if (this.regrowT <= 0 && Math.abs(game.player.x - this.x) > 50) {
        this.state = "growing";
        this.growK = 0;
      }
    } else if (this.state === "growing") {
      this.growK += dt * 0.9;
      if (this.growK >= 1) {
        this.growK = 1;
        this.state = "alive";
        this.hurtable = true;
        this.hp = this.maxHp;
        this.squash(1.2, 0.85);
        game.particles.burst(this.x, this.y - this.h / 2, {
          count: 8, colors: [P.white, P.magicYellow], speed: [20, 60], life: [0.3, 0.6], shape: "starSmall", gravity: 40, spread: 6,
        });
      }
    }
  }

  protected shakeX() {
    return Math.sin(this.shakeT * 70) * this.shakeT * 9 * this.shakeDir;
  }

  protected abstract onHit(game: Game, dir: number): void;
  protected abstract onBreak(game: Game, dir: number): void;
}

export class Tree extends Resource {
  protected regrowTime = 30;
  protected hitColor = P.leafHi;
  private R: number;
  private trunkH: number;
  private blossom: boolean;
  hasApples: boolean;
  private applesLeft = 0;

  constructor(x: number, y: number, seed: number) {
    super(x, y, seed);
    const rng = makeRng(seed);
    this.R = 11 + Math.floor(rng() * 4);
    this.trunkH = 14 + Math.floor(rng() * 6);
    this.blossom = rng() < 0.25;
    this.hasApples = !this.blossom && rng() < 0.4;
    this.applesLeft = this.hasApples ? 2 : 0;
    this.hw = 8;
    this.h = this.trunkH + this.R;
    this.hp = this.maxHp = 5;
  }

  private leafCols() {
    return this.blossom ? [P.blossom, P.blossomHi, P.blossomDark] : [P.leaf, P.leafHi, P.leafDark];
  }

  protected onHit(game: Game, dir: number) {
    sfx.hitWood();
    this.squash(0.92, 1.06);
    const cy = this.y - this.trunkH;
    game.particles.burst(this.x + dir * -3, this.y - 8, {
      count: 6, colors: [P.bark, P.barkLight, P.barkDark], speed: [60, 140],
      angle: dir > 0 ? [-Math.PI * 0.85, -Math.PI * 0.45] : [-Math.PI * 0.55, -Math.PI * 0.15],
      life: [0.6, 1.1], size: [1, 2], gravity: 520, bounce: 0.4, shape: "chunk",
    });
    game.particles.burst(this.x, cy - this.R * 0.5, {
      count: 8, colors: this.leafCols(), speed: [20, 70], life: [0.8, 1.4], gravity: 60, drag: 2.5, spread: this.R * 0.8,
    });
    if (chance(game.dropChance(0.45))) game.spawnItem("wood", this.x, this.y - 10, -dir);
    if (this.applesLeft > 0 && chance(0.3)) {
      this.applesLeft--;
      game.spawnItem("apple", this.x + randInt(-6, 6), cy - this.R * 0.3, 0);
    }
  }

  protected onBreak(game: Game, dir: number) {
    sfx.breakWood();
    const cy = this.y - this.trunkH - this.R * 0.5;
    game.particles.burst(this.x, cy, {
      count: 36, colors: this.leafCols(), speed: [40, 160], life: [0.8, 1.6], gravity: 90, drag: 2.2, spread: this.R,
    });
    game.particles.burst(this.x, cy, {
      count: 8, colors: this.leafCols(), speed: [30, 90], life: [0.3, 0.5], size: [3, 6], shape: "circle", shrink: true, drag: 4, spread: this.R * 0.6,
    });
    game.particles.burst(this.x, this.y - 10, {
      count: 12, colors: [P.bark, P.barkLight, P.barkDark], speed: [80, 180], angle: [-Math.PI * 0.9, -Math.PI * 0.1],
      life: [0.7, 1.2], size: [1, 3], gravity: 520, bounce: 0.45, shape: "chunk",
    });
    game.particles.burst(this.x, cy, {
      count: 5, colors: [P.white], speed: [60, 120], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.5, 0.8], shape: "star", gravity: 200,
    });
    const n = randInt(3, 4);
    for (let i = 0; i < n; i++) game.spawnItem("wood", this.x, this.y - 12, dir);
    for (let i = 0; i < this.applesLeft; i++) game.spawnItem("apple", this.x, cy, 0);
    this.applesLeft = 0;
  }

  /** Flower magic coaxes fruit out of green trees (and petals out of pink ones). */
  protected onNourish(game: Game) {
    const cy = this.y - this.trunkH - this.R * 0.5;
    if (this.blossom) {
      game.particles.burst(this.x, cy, {
        count: 14, colors: this.leafCols(), speed: [20, 70], life: [0.9, 1.5], gravity: 50, drag: 2.5, spread: this.R,
      });
      return;
    }
    this.hasApples = true;
    if (this.applesLeft < 2) this.applesLeft++;
  }

  update(game: Game, dt: number) {
    const before = this.state;
    super.update(game, dt);
    if (before === "growing" && this.state === "alive") this.applesLeft = this.hasApples ? 2 : 0;
  }

  draw(ctx: Ctx) {
    const x = this.x, y = this.y;
    if (this.state === "stump") {
      rect(ctx, x - 5, y - 6, 10, 6, P.outline);
      rect(ctx, x - 4, y - 5, 8, 5, P.bark);
      rect(ctx, x - 4, y - 5, 8, 1, P.barkLight);
      px(ctx, x - 1, y - 5, P.barkDark); px(ctx, x + 1, y - 5, P.barkDark);
      return;
    }
    const k = this.state === "growing" ? this.growK : 1;
    if (this.flash > 0) setOverride(P.white);
    const sh = this.shakeX();
    const th = this.trunkH * k;
    // Trunk
    rect(ctx, x - 4, y - th - 1, 8, th + 1, P.outline);
    rect(ctx, x - 3, y - th, 6, th, P.bark);
    rect(ctx, x - 3, y - th, 1, th, P.barkLight);
    rect(ctx, x + 2, y - th, 1, th, P.barkDark);
    px(ctx, x - 4, y - 1, P.outline); px(ctx, x + 4, y - 1, P.outline);
    rect(ctx, x - 5, y - 1, 1, 1, P.outline); rect(ctx, x + 4, y - 1, 2, 1, P.outline);
    // Canopy: several puffs merged under one outline
    const R = this.R * k;
    const [main, hi, dark] = this.leafCols();
    const cx = x + sh;
    const cy = y - th - R * 0.55;
    const puffs: [number, number, number][] = [
      [0, 0, R], [-R * 0.72, R * 0.28, R * 0.68], [R * 0.72, R * 0.28, R * 0.68], [R * 0.1, -R * 0.55, R * 0.72],
    ];
    const sx = this.sx, sy = this.sy;
    for (const [ox, oy, r] of puffs) ellipse(ctx, cx + ox * sx, cy + oy * sy, r * sx + 1, r * 0.9 * sy + 1, P.outline);
    for (const [ox, oy, r] of puffs) ellipse(ctx, cx + ox * sx, cy + oy * sy, r * sx, r * 0.9 * sy, dark);
    for (const [ox, oy, r] of puffs) ellipse(ctx, cx + ox * sx - 0.5, cy + oy * sy - 1.5, (r - 1) * sx, (r * 0.9 - 1.5) * sy, main);
    for (const [ox, oy, r] of puffs) ellipse(ctx, cx + (ox - r * 0.3) * sx, cy + (oy - r * 0.4) * sy, r * 0.35 * sx, r * 0.22 * sy, hi);
    if (this.hasApples && this.applesLeft > 0 && k >= 1) {
      const spots: [number, number][] = [[-R * 0.5, R * 0.1], [R * 0.45, -R * 0.1], [R * 0.05, R * 0.45]];
      for (let i = 0; i < this.applesLeft + 1 && i < spots.length; i++) {
        const [ax, ay] = spots[i];
        ellipse(ctx, cx + ax, cy + ay, 2.2, 2.2, P.outline);
        ellipse(ctx, cx + ax, cy + ay, 1.5, 1.5, P.red);
        px(ctx, cx + ax - 1, cy + ay - 1, P.white);
      }
    }
    setOverride(null);
  }
}

export class Rock extends Resource {
  protected regrowTime = 40;
  protected hitColor = P.stoneHi;
  private mossy: boolean;
  private cracks: [number, number][][] = [];

  constructor(x: number, y: number, seed: number) {
    super(x, y, seed);
    const rng = makeRng(seed);
    this.mossy = rng() < 0.5;
    this.hw = 11;
    this.h = 16;
    this.hp = this.maxHp = 7;
    for (let c = 0; c < 3; c++) {
      let cx = -6 + rng() * 12, cy = -13 + rng() * 5;
      const pts: [number, number][] = [[cx, cy]];
      for (let i = 0; i < 3; i++) {
        cx += -3 + rng() * 6;
        cy += 2 + rng() * 2;
        pts.push([cx, cy]);
      }
      this.cracks.push(pts);
    }
  }

  protected onHit(game: Game, dir: number) {
    sfx.hitStone();
    this.squash(1.06, 0.95);
    game.particles.burst(this.x - dir * 6, this.y - 10, {
      count: 6, colors: [P.stone, P.stoneDark, P.stoneHi], speed: [70, 150],
      angle: dir > 0 ? [-Math.PI * 0.9, -Math.PI * 0.5] : [-Math.PI * 0.5, -Math.PI * 0.1],
      life: [0.6, 1.0], size: [1, 2], gravity: 560, bounce: 0.5, shape: "chunk",
    });
    game.particles.burst(this.x - dir * 8, this.y - 10, {
      count: 7, colors: [P.white, P.magicYellow], speed: [100, 220], life: [0.1, 0.25], shape: "spark", additive: true, drag: 5,
    });
    game.particles.burst(this.x, this.y - 2, {
      count: 3, colors: [P.cream, P.stoneHi], speed: [10, 40], angle: [-Math.PI, 0], life: [0.3, 0.5], size: [2, 4], shape: "circle", shrink: true, drag: 3, spread: 6,
    });
    if (chance(game.dropChance(0.35))) game.spawnItem("stone", this.x, this.y - 12, -dir);
  }

  protected onBreak(game: Game, dir: number) {
    sfx.breakStone();
    game.particles.burst(this.x, this.y - 8, {
      count: 18, colors: [P.stone, P.stoneDark, P.stoneHi, P.stoneDeep], speed: [80, 200], angle: [-Math.PI * 0.95, -Math.PI * 0.05],
      life: [0.7, 1.3], size: [1, 3], gravity: 560, bounce: 0.5, shape: "chunk", spread: 6,
    });
    game.particles.burst(this.x, this.y - 4, {
      count: 10, colors: [P.cream, P.stoneHi, P.white], speed: [20, 70], angle: [-Math.PI, 0],
      life: [0.4, 0.8], size: [3, 6], shape: "circle", shrink: true, drag: 3, spread: 8,
    });
    game.particles.burst(this.x, this.y - 10, {
      count: 4, colors: [P.white], speed: [60, 120], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.5, 0.8], shape: "star", gravity: 200,
    });
    const n = randInt(3, 4);
    for (let i = 0; i < n; i++) game.spawnItem("stone", this.x, this.y - 12, dir);
    if (chance(game.progress.level("lucky") ? 0.7 : 0.3)) game.spawnItem("crystal", this.x, this.y - 12, dir);
  }

  draw(ctx: Ctx) {
    const x = this.x, y = this.y;
    if (this.state === "stump") {
      ellipse(ctx, x - 5, y - 1, 3, 2, P.outline, y);
      ellipse(ctx, x - 5, y - 1, 2, 1.5, P.stone, y);
      ellipse(ctx, x + 4, y - 1, 2.5, 2, P.outline, y);
      ellipse(ctx, x + 4, y - 1, 1.5, 1.5, P.stoneDark, y);
      return;
    }
    const k = this.state === "growing" ? this.growK : 1;
    if (this.flash > 0) setOverride(P.white);
    const sh = this.shakeX() * 0.5;
    const sx = this.sx * k, sy = this.sy * k;
    const cx = x + sh;
    const lumps: [number, number, number, number][] = [[0, -8, 12, 9], [6, -5, 7, 6], [-7, -4, 6, 5]];
    for (const [ox, oy, rx, ry] of lumps) ellipse(ctx, cx + ox * sx, y + oy * sy, rx * sx + 1, ry * sy + 1, P.outline, y);
    for (const [ox, oy, rx, ry] of lumps) ellipse(ctx, cx + ox * sx, y + oy * sy, rx * sx, ry * sy, P.stoneDark, y);
    for (const [ox, oy, rx, ry] of lumps) ellipse(ctx, cx + (ox - 1) * sx, y + (oy - 1.5) * sy, (rx - 1.5) * sx, (ry - 1.5) * sy, P.stone, y);
    ellipse(ctx, cx - 4 * sx, y - 13 * sy, 3.5 * sx, 1.6 * sy, P.stoneHi);
    px(ctx, cx + 3 * sx, y - 12 * sy, P.stoneHi);
    if (this.mossy && k >= 1) {
      ellipse(ctx, cx + 2, y - 16.5 * sy, 6, 1.8, P.moss);
      px(ctx, cx - 3, y - 15 * sy, P.moss); px(ctx, cx + 6, y - 15 * sy, P.moss); px(ctx, cx + 6, y - 14 * sy, P.moss);
    }
    const dmg = 1 - this.hp / this.maxHp;
    const shown = Math.min(3, Math.floor(dmg * 3.99));
    for (let c = 0; c < shown; c++) {
      const pts = this.cracks[c];
      for (let i = 0; i < pts.length - 1; i++) {
        line(ctx, cx + pts[i][0] * sx, y + pts[i][1] * sy, cx + pts[i + 1][0] * sx, y + pts[i + 1][1] * sy, P.stoneDeep);
      }
    }
    setOverride(null);
  }
}

export class CrystalNode extends Resource {
  protected regrowTime = 55;
  protected hitColor = P.crystalHi;
  private shards: [number, number, number, number][]; // offsetX, width, height, lean

  constructor(x: number, y: number, seed: number) {
    super(x, y, seed);
    this.hw = 8;
    this.h = 15;
    this.hp = this.maxHp = 4;
    const rng = makeRng(seed);
    this.shards = [
      [-5, 3, 9 + rng() * 3, -2],
      [5, 3, 8 + rng() * 3, 2],
      [0, 4, 14 + rng() * 3, 0],
    ];
  }

  protected onHit(game: Game, dir: number) {
    sfx.hitCrystal();
    this.squash(0.9, 1.1);
    game.particles.burst(this.x, this.y - 8, {
      count: 10, colors: [P.crystal, P.crystalHi, P.white, P.magicPurple], speed: [60, 160], life: [0.3, 0.6],
      shape: "px", additive: true, drag: 3, gravity: 120,
    });
    game.particles.burst(this.x - dir * 4, this.y - 8, {
      count: 4, colors: [P.crystal, P.crystalDark], speed: [60, 130], angle: [-Math.PI * 0.9, -Math.PI * 0.1],
      life: [0.6, 1], size: [1, 2], gravity: 520, bounce: 0.5, shape: "chunk",
    });
    if (chance(game.dropChance(0.3))) game.spawnItem("crystal", this.x, this.y - 12, -dir);
  }

  protected onBreak(game: Game, dir: number) {
    sfx.breakCrystal();
    game.particles.burst(this.x, this.y - 8, {
      count: 30, colors: [P.crystal, P.crystalHi, P.white, P.magicPurple, P.magicCyan], speed: [60, 220], life: [0.4, 0.9],
      shape: "spark", additive: true, drag: 3,
    });
    game.particles.burst(this.x, this.y - 8, {
      count: 6, colors: [P.white], speed: [50, 120], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.6, 0.9], shape: "star", gravity: 150,
    });
    const n = randInt(2, 3);
    for (let i = 0; i < n; i++) game.spawnItem("crystal", this.x, this.y - 12, dir);
  }

  update(game: Game, dt: number) {
    super.update(game, dt);
    if (this.state === "alive" && Math.random() < dt * 2) {
      game.particles.burst(this.x + (Math.random() - 0.5) * 14, this.y - 4 - Math.random() * 12, {
        count: 1, colors: [P.white, P.crystalHi], speed: [3, 10], angle: [-Math.PI * 0.7, -Math.PI * 0.3], life: [0.4, 0.8],
        shape: "starSmall",
      });
    }
  }

  draw(ctx: Ctx, game: Game) {
    const x = this.x, y = this.y;
    if (this.state === "stump") {
      rect(ctx, x - 4, y - 2, 8, 2, P.outline);
      rect(ctx, x - 3, y - 2, 6, 1, P.crystalDark);
      return;
    }
    const k = this.state === "growing" ? this.growK : 1;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.18 + 0.06 * Math.sin(game.time * 3 + this.seed);
    ellipse(ctx, x, y - 7, 13 * k, 10 * k, P.crystal);
    ctx.restore();
    if (this.flash > 0) setOverride(P.white);
    const sh = this.shakeX() * 0.4;
    for (let pass = 0; pass < 2; pass++) {
      for (const [ox, w, hgt, lean] of this.shards) {
        const H = hgt * k * this.sy;
        const W = w * this.sx;
        for (let i = 0; i < H; i++) {
          const t = i / H; // 0 at the base, 1 at the tip
          const half = t > 0.7 ? W * (1 - t) / 0.3 : W;
          const cxr = x + sh + ox + lean * t;
          const yy = y - i - 1;
          if (pass === 0) rect(ctx, cxr - half - 1, yy - 1, half * 2 + 2, 3, P.outline);
          else {
            rect(ctx, cxr - half, yy, half, 1, P.crystal);
            rect(ctx, cxr, yy, half, 1, P.crystalDark);
            if (i % 4 === 1 && half > 1) px(ctx, cxr - half + 1, yy, P.crystalHi);
          }
        }
      }
    }
    setOverride(null);
  }
}
