import { sfx } from "../engine/audio";
import { ellipse, line, px, rect, type Ctx } from "../engine/gfx";
import { damp, rand } from "../engine/math";
import { drawMagicCircle } from "./effects";
import type { Game } from "./game";
import { P } from "./palette";
import type { FormId } from "./runes";

const READ_TIME = 1.4;

/**
 * An ancient standing stone with a magic circle carved into its face.
 * Walk up to one to copy its form rune into your grimoire.
 *
 * `decay` is how far gone the stone is. The deeper into the hills, the more
 * the carvings crack, dim and seep — nobody ever says why.
 *   0 – clean, softly glowing
 *   1 – cracked and mossy, the circle has a gap until you trace it
 *   2 – shattered, the circle flickers grey and something green oozes out
 */
export class RuneTablet {
  learned: boolean;
  private readT = -1;
  private glow = 0;

  constructor(readonly x: number, readonly y: number, readonly form: FormId | null, readonly decay: 0 | 1 | 2, learned: boolean) {
    this.learned = learned;
  }

  near(game: Game) {
    const p = game.player;
    return p.alive && Math.abs(p.x - this.x) < 20 && Math.abs(p.y - this.y) < 24;
  }

  update(game: Game, dt: number) {
    const near = this.near(game);
    this.glow += ((near ? 1 : 0) - this.glow) * damp(6, dt);
    if (!this.form || this.learned) return;
    if (this.readT < 0) {
      if (!near) return;
      this.readT = 0;
      sfx.tabletHum();
    }
    this.readT += dt / READ_TIME;
    // Motes lift off the carving while it traces itself.
    if (Math.random() < 0.6) {
      const a = Math.random() * Math.PI * 2;
      game.particles.burst(this.x + Math.cos(a) * 7, this.y - 15 + Math.sin(a) * 7, {
        count: 1, colors: [P.magicPink, P.magicYellow, P.white], speed: [10, 30], angle: [-Math.PI * 0.7, -Math.PI * 0.3],
        life: [0.4, 0.7], shape: "px", additive: true,
      });
    }
    if (this.readT >= 1) {
      this.learned = true;
      game.onTabletRead(this);
    }
  }

  draw(ctx: Ctx, time: number) {
    const { x, y } = this;
    const broken = this.decay >= 2;
    // Slab: rounded top, darker right side. The broken one lost its upper corner.
    const top = y - 28;
    const L = x - 9, R = x + 9;
    rect(ctx, L - 1, top + 3, R - L + 2, y - top - 3, P.outline);
    if (broken) {
      ellipse(ctx, x - 3, top + 7, 7, 5, P.outline);
    } else {
      ellipse(ctx, x, top + 4, 10, 5, P.outline);
    }
    rect(ctx, L, top + 4, R - L, y - top - 4, P.stone);
    rect(ctx, R - 4, top + 4, 4, y - top - 4, P.stoneDark);
    rect(ctx, L, top + 4, 2, y - top - 4, P.stoneHi);
    if (broken) {
      ellipse(ctx, x - 3, top + 7, 6, 4, P.stone);
      // Jagged break across the top right.
      rect(ctx, x + 2, top + 3, R - x - 1, 7, P.outline);
      line(ctx, x - 1, top + 5, x + 3, top + 9, P.outline);
      line(ctx, x + 3, top + 9, R, top + 8, P.outline);
    } else {
      ellipse(ctx, x, top + 4, 9, 4, P.stone);
      ellipse(ctx, x - 3, top + 2, 3, 1, P.stoneHi);
    }
    rect(ctx, L - 2, y - 2, R - L + 4, 2, P.outline);
    rect(ctx, L - 1, y - 2, R - L + 2, 1, P.stoneDark);

    if (this.decay >= 1) {
      // Cracks and moss.
      line(ctx, x + 4, top + 12, x + 1, top + 18, P.outline);
      line(ctx, x + 1, top + 18, x + 3, top + 23, P.outline);
      for (let i = 0; i < 5; i++) px(ctx, L + 1 + ((i * 5) % 12), top + 4 + (i % 2), i % 2 ? P.leaf : P.leafDark);
      px(ctx, R - 1, y - 4, P.leaf);
      px(ctx, L, y - 3, P.leafDark);
    }

    // The carved circle.
    const cx = x - (broken ? 1 : 0), cy = y - 14;
    const reading = this.readT >= 0 && !this.learned;
    let progress = 1, main = P.magicPurple, accent = "#8a6ab8", alpha = 0.8, pulse = 0;
    if (broken) {
      progress = 0.72;
      main = "#7a6a90";
      accent = "#5a4a6e";
      alpha = Math.random() < 0.08 ? 0.2 : 0.7;
    } else if (reading) {
      progress = Math.min(1, this.readT * 1.2);
      main = P.magicYellow;
      accent = P.magicPink;
      alpha = 1;
      pulse = this.readT > 0.9 ? 1 : 0;
    } else if (!this.learned && this.form) {
      // Waiting to be read: an unfinished circle that breathes.
      progress = this.decay >= 1 ? 0.8 : 0.9;
      main = P.magicPink;
      accent = P.magicPurple;
      alpha = 0.65 + 0.3 * Math.sin(time * 3);
    } else {
      alpha = 0.6 + 0.4 * this.glow;
    }
    drawMagicCircle(ctx, cx, cy, 7, broken ? 0.4 : time * 0.6, {
      ax: 1, ay: 1, progress, main, accent, alpha, pulse, form: broken ? undefined : this.form ?? undefined,
    });

    if (broken) {
      // Something green seeps from the break and drips down the face.
      const drip = (time * 6) % 14;
      rect(ctx, x + 3, top + 9, 2, 5, P.slime);
      px(ctx, x + 3, top + 9, P.slimeHi);
      px(ctx, x + 4, top + 14 + Math.floor(drip), P.slime);
      ellipse(ctx, x + 6, y - 1, 3, 1, P.slime);
      px(ctx, x + 5, y - 2, P.slimeHi);
    }
  }
}

/**
 * A huge circle drawn wrong, scorched into the floor of the slime king's
 * hollow. Its ring never closes, and the gap is where the slime comes from.
 * Once the king is gone it slowly takes on colour again.
 */
export class ScarCircle {
  constructor(readonly x: number, readonly y: number) {}

  draw(ctx: Ctx, time: number, healed: boolean) {
    const r = 64;
    if (healed) {
      drawMagicCircle(ctx, this.x, this.y, r, time * 0.05, {
        ax: 1, ay: 0.22, progress: 1, main: P.blossomHi, accent: P.magicPink, alpha: 0.45,
      });
      return;
    }
    drawMagicCircle(ctx, this.x, this.y, r, 0.9, {
      ax: 1, ay: 0.22, progress: 0.83, main: "#6a5a80", accent: "#4e4266", alpha: 0.85,
    });
    // Ooze pooling at the open end of the ring.
    const a = 0.9 + 0.83 * Math.PI * 2;
    const gx = this.x + Math.cos(a) * r, gy = this.y + Math.sin(a) * r * 0.22;
    ellipse(ctx, gx, gy, 6, 2, P.slimeDark);
    ellipse(ctx, gx - 1, gy - 0.5, 4, 1.2, P.slime);
    if (Math.floor(time * 2) % 3 === 0) px(ctx, gx + rand(-3, 3), gy - 1, P.slimeHi);
  }
}
