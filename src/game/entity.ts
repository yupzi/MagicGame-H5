import type { Ctx } from "../engine/gfx";
import type { Game } from "./game";
import type { Platform, World } from "./world";

export type HitKind = "bolt" | "blast" | "fire" | "ice" | "thunder" | "burn" | "bloom";

export interface Box {
  x0: number; y0: number; x1: number; y1: number;
}

export const overlap = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/** Max height difference (px) the leading edge may climb before it counts as a wall. */
const WALL_STEP = 6;
/** How far a grounded body snaps down to follow a downhill slope. */
const SNAP_DOWN = 8;

/**
 * Base for everything that lives in the world. Position (x, y) is the bottom
 * centre ("feet"). Squash & stretch is a damped spring back to 1.
 */
export abstract class Entity {
  x = 0; y = 0; vx = 0; vy = 0;
  hw = 5; h = 10;
  gravity = 620; maxFall = 320;
  onGround = false;
  platform: Platform | null = null;
  hitWall = false;
  landSpeed = 0; // vy at the moment of the last landing (0 if none this step)
  dead = false;
  flash = 0; // seconds of white hit-flash remaining
  sx = 1; sy = 1;
  private svx = 0; private svy = 0;

  hurtable = false;
  hp = 1;
  maxHp = 1;

  box(): Box {
    return { x0: this.x - this.hw, y0: this.y - this.h, x1: this.x + this.hw, y1: this.y };
  }
  get cy() { return this.y - this.h / 2; }

  squash(sx: number, sy: number) {
    this.sx = sx; this.sy = sy;
    this.svx = 0; this.svy = 0;
  }

  protected updateSquash(dt: number, k = 520, damping = 16) {
    this.svx += ((1 - this.sx) * k - this.svx * damping) * dt;
    this.svy += ((1 - this.sy) * k - this.svy * damping) * dt;
    this.sx += this.svx * dt;
    this.sy += this.svy * dt;
  }

  /** Something solid in front at (edge) that is too tall to step up, or a low ceiling. */
  private wallAhead(world: World, edge: number) {
    const y = Math.floor(this.y);
    // Compare the ground in the next column with the column the edge is leaving,
    // so a step at the end of a slope counts only its own height.
    const dir = edge > this.x ? 1 : -1;
    const surface = (x: number) => {
      let t = y;
      if (world.solid(x, t - 1)) {
        for (let k = 0; k < 24 && world.solid(x, t - 1); k++) t--;
      } else {
        for (let k = 0; k < 8 && !world.solid(x, t); k++) t++;
      }
      return t;
    };
    const next = surface(edge);
    const rise = Math.max(y - next, 0);
    // In mid-air there may be no ground behind: measure from the feet instead.
    const base = Math.min(surface(edge - dir), y);
    if (rise > WALL_STEP + 8 || base - next > WALL_STEP) return true;
    // Headroom once stepped up.
    const head = y - rise - Math.ceil(this.h);
    for (let yy = y - rise - 2; yy > head; yy -= 3) if (world.solid(edge, yy)) return true;
    if (world.solid(edge, head + 1)) return true;
    return world.blocked(edge, this.y - this.h, this.y - 1);
  }

  /** Moves with gravity against the terrain and (optionally) one-way platforms. */
  protected moveBody(world: World, dt: number, usePlatforms: boolean, dropThrough = false) {
    this.hitWall = false;
    this.landSpeed = 0;

    // Horizontal, 1px at a time so walls are never tunnelled through.
    let remaining = this.vx * dt;
    while (Math.abs(remaining) > 1e-6) {
      const s = Math.sign(remaining) * Math.min(1, Math.abs(remaining));
      const nx = this.x + s;
      const edge = nx + Math.sign(s) * this.hw;
      if (nx - this.hw < 0 || nx + this.hw > world.w || this.wallAhead(world, edge)) {
        this.vx = 0;
        this.hitWall = true;
        break;
      }
      this.x = nx;
      remaining -= s;
      // Walk up slopes (and pop out of any small step we slid into).
      for (let k = 0; k <= WALL_STEP && world.solid(this.x, this.y - 1); k++) this.y = Math.floor(this.y) - 1;
    }

    // Stay glued to the ground/platform while walking.
    if (this.onGround) {
      const p = this.platform;
      if (p) {
        if (this.x < p.x - 1 || this.x > p.x + p.w + 1) {
          this.onGround = false;
          this.platform = null;
        }
      } else if (!world.solid(this.x, this.y)) {
        const g = world.groundBelow(this.x, this.y, SNAP_DOWN + 1);
        if (g !== Infinity) this.y = g;
        else this.onGround = false;
      }
    }

    if (!this.onGround) {
      this.platform = null;
      this.vy = Math.min(this.vy + this.gravity * dt, this.maxFall);
      const prevY = this.y;
      this.y += this.vy * dt;
      if (this.vy >= 0) {
        if (usePlatforms && !dropThrough) {
          for (const p of world.platforms) {
            if (this.x >= p.x && this.x <= p.x + p.w && prevY <= p.y + 0.5 && this.y >= p.y) {
              this.land(p.y, p);
              break;
            }
          }
        }
        if (!this.onGround) {
          const from = Math.floor(prevY);
          const g = world.groundBelow(this.x, from, Math.floor(this.y) - from + 1);
          if (g <= this.y) this.land(g, null);
        }
      } else {
        // Bonk on ceilings.
        const t0 = Math.floor(prevY - this.h), t1 = Math.floor(this.y - this.h);
        for (let t = t0; t >= t1; t--) {
          if (!world.solid(this.x, t)) continue;
          this.y = t + 1 + this.h;
          this.vy = 0;
          break;
        }
      }
    }
  }

  /** Dropped out of the bottom of the map. */
  fellOut(world: World) {
    return this.y > world.h + 24;
  }

  private land(y: number, p: Platform | null) {
    this.landSpeed = this.vy;
    this.y = y;
    this.vy = 0;
    this.onGround = true;
    this.platform = p;
  }

  /** Pops the body off the ground (knockback, jumps). */
  launch(vx: number, vy: number) {
    this.vx = vx;
    this.vy = vy;
    if (vy < 0) {
      this.onGround = false;
      this.platform = null;
    }
  }

  hurt(_game: Game, _dmg: number, _dir: number, _power: number, _kind: HitKind) {}

  abstract update(game: Game, dt: number): void;
  abstract draw(ctx: Ctx, game: Game): void;
}
