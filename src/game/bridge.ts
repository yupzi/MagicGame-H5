import { sfx } from "../engine/audio";
import { line, px, rect, type Ctx } from "../engine/gfx";
import type { Game } from "./game";
import { P } from "./palette";
import type { Platform, World } from "./world";

const PLANK = 6; // plank width including its 1px seam
const BUILD_TIME = 0.9;
const ROPE = "#e0bd82";
const ROPE_DARK = "#b08a58";

/**
 * A plank bridge with rope rails. While its story condition doesn't hold it is
 * broken: two stubs on the banks and planks dangling into the gap. Once the
 * condition holds (say the script runs `!flag bridge`) the planks drop into
 * place one by one and the deck becomes walkable.
 */
export class Bridge {
  built: boolean;
  /** Build animation, 0..1 (1 = finished). */
  private buildT = 1;
  private platforms: Platform[] = [];
  private lastPlank = -1;
  readonly x0: number;
  readonly x1: number;

  constructor(
    private world: World,
    x: number,
    /** Top of the deck. */
    readonly y: number,
    readonly w: number,
    /** Story flags that mean "repaired" (see condMet). */
    readonly cond: string,
    built: boolean,
  ) {
    this.x0 = Math.round(x - w / 2);
    this.x1 = this.x0 + Math.round(w);
    this.built = built;
    this.setPlatforms();
  }

  private get planks() {
    return Math.max(2, Math.round((this.x1 - this.x0 - 6) / PLANK));
  }

  /** How far each broken stub reaches out from its bank. */
  private get stub() {
    return Math.min(18, Math.round(this.w * 0.2));
  }

  private setPlatforms() {
    for (const p of this.platforms) {
      const i = this.world.platforms.indexOf(p);
      if (i >= 0) this.world.platforms.splice(i, 1);
    }
    const seed = this.x0;
    this.platforms = this.built
      ? [{ x: this.x0, y: this.y, w: this.x1 - this.x0, seed, bridge: true }]
      : [
          { x: this.x0, y: this.y, w: this.stub + 3, seed, bridge: true },
          { x: this.x1 - this.stub - 3, y: this.y, w: this.stub + 3, seed, bridge: true },
        ];
    this.world.platforms.push(...this.platforms);
  }

  update(game: Game, dt: number) {
    const want = game.storyCond(this.cond);
    if (want !== this.built) {
      this.built = want;
      this.buildT = want ? 0 : 1;
      this.lastPlank = -1;
      this.setPlatforms();
      if (!want) sfx.breakWood();
    }
    if (this.buildT < 1) {
      this.buildT = Math.min(1, this.buildT + dt / BUILD_TIME);
      const n = Math.floor(this.buildT * this.planks);
      for (let i = this.lastPlank + 1; i < n; i++) {
        const cx = this.x0 + 3 + i * PLANK + PLANK / 2;
        game.dust(cx, this.y, 2, 0);
        if (i % 2 === 0) sfx.hitWood();
      }
      this.lastPlank = n - 1;
      if (this.buildT >= 1) {
        sfx.unlock();
        game.shake(0.15);
      }
    }
  }

  draw(ctx: Ctx, time: number) {
    const { x0, x1, y } = this;
    const n = this.planks;
    // Posts at both banks, sunk into the ground.
    for (const px0 of [x0, x1 - 3]) post(ctx, px0, y);

    if (this.built) {
      const shown = this.buildT * n;
      for (let i = 0; i < n; i++) {
        const k = shown - i; // how far along this plank's drop is
        if (k <= 0) break;
        const drop = k >= 1 ? 0 : Math.round((1 - k) * -6);
        plank(ctx, x0 + 3 + i * PLANK, y + drop, i);
      }
      if (this.buildT >= 1) rect(ctx, x0 + 3, y + 4, x1 - x0 - 6, 1, P.barkDark);
      // Rope rails sagging between the posts, with hangers down to the deck.
      rope(ctx, x0 + 1, y - 9, x1 - 2, y - 9, Math.min(6, this.w / 20), this.buildT, y);
    } else {
      const s = this.stub;
      const count = Math.max(1, Math.floor(s / PLANK));
      for (let i = 0; i < count; i++) plank(ctx, x0 + 3 + i * PLANK, y, i, i === count - 1);
      for (let i = 0; i < count; i++) plank(ctx, x1 - 3 - (i + 1) * PLANK, y, i + 7, i === count - 1);
      // Left: the rail rope snapped and hangs into the gap with a plank swinging on it.
      const sway = Math.sin(time * 1.6) * 1.5;
      const lx = x0 + 3 + count * PLANK, ly = y + 12;
      const hx = lx + 6 + sway, hy = ly + 4;
      rope(ctx, x0 + 1, y - 9, hx, hy, 3, 1, null);
      swingPlank(ctx, hx, hy, sway);
      // Right: a short frayed end, and another plank hanging from the deck edge.
      const rx = x1 - 3 - count * PLANK;
      rope(ctx, x1 - 2, y - 9, rx - 4, y + 2, 2, 1, null);
      const sway2 = Math.sin(time * 1.3 + 2) * 1.2;
      line(ctx, rx - 1, y + 3, rx - 3 + sway2, y + 10, ROPE_DARK);
      swingPlank(ctx, rx - 3 + sway2, y + 10, -sway2);
    }
  }
}

function post(ctx: Ctx, x: number, y: number) {
  rect(ctx, x - 1, y - 12, 5, 28, P.outline);
  rect(ctx, x, y - 11, 3, 26, P.bark);
  rect(ctx, x, y - 11, 1, 26, P.barkLight);
  rect(ctx, x - 1, y - 12, 5, 2, P.barkDark);
  px(ctx, x + 1, y - 13, P.outline);
}

/** One deck plank; a broken one has a splintered end. */
function plank(ctx: Ctx, x: number, y: number, i: number, broken = false) {
  const w = PLANK - 1;
  const tone = (i * 5) % 3;
  rect(ctx, x - 1, y - 1, w + 2, 5, P.outline);
  rect(ctx, x, y, w, 3, tone === 0 ? P.barkLight : "#d49c6e");
  rect(ctx, x, y + 2, w, 1, P.bark);
  px(ctx, x + 1 + (i % 3), y + 1, P.bark); // wood grain
  if (broken) {
    // Jagged splinters where the rest snapped off.
    px(ctx, x + w, y, P.outline);
    px(ctx, x + w + 1, y + 1, P.barkLight);
    px(ctx, x + w + 2, y + 1, P.outline);
    px(ctx, x + w + 1, y + 2, P.outline);
  }
}

/** A plank dangling from a rope, tilted by `tilt`. */
function swingPlank(ctx: Ctx, x: number, y: number, tilt: number) {
  const dx = Math.round(tilt * 0.6);
  for (let k = 0; k < 7; k++) {
    const yy = y + k;
    const xx = Math.round(x + (dx * k) / 7);
    rect(ctx, xx - 2, yy, 5, 1, P.outline);
  }
  for (let k = 1; k < 6; k++) {
    const yy = y + k;
    const xx = Math.round(x + (dx * k) / 7);
    rect(ctx, xx - 1, yy, 3, 1, k % 3 === 0 ? P.bark : P.barkLight);
  }
}

/**
 * A sagging rope from (ax, ay) to (bx, by). `reach` (0..1) draws only the first
 * part of it; with a deck at `deckY`, hangers drop from the rope to the deck.
 */
function rope(ctx: Ctx, ax: number, ay: number, bx: number, by: number, sag: number, reach: number, deckY: number | null) {
  const len = Math.max(1, Math.round(Math.abs(bx - ax)));
  const end = Math.round(len * reach);
  const dir = Math.sign(bx - ax) || 1;
  for (let i = 0; i <= end; i++) {
    const t = i / len;
    const x = Math.round(ax + dir * i);
    const yy = Math.round(ay + (by - ay) * t + sag * Math.sin(Math.PI * t));
    px(ctx, x, yy + 1, P.outline);
    px(ctx, x, yy, i % 4 === 0 ? ROPE_DARK : ROPE);
    if (deckY !== null && i > 3 && i < len - 3 && i % 12 === 0) {
      for (let h = yy + 2; h < deckY - 1; h++) px(ctx, x, h, ROPE_DARK);
    }
  }
}
