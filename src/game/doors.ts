import { drawText, textWidth } from "../engine/font";
import { ellipse, px, rect, type Ctx } from "../engine/gfx";
import type { Game } from "./game";
import { parseDest, type MapObj } from "./mapdata";
import { P } from "./palette";

/** pit: fall into it to go through; drop: where you fall in from above (never a way out). */
export type DoorStyle = "hole" | "burrow" | "cave" | "edge" | "pit" | "drop";

/**
 * A way between maps. Walk up to a hole / burrow / cave mouth and press ↑;
 * an "edge" door is an invisible strip (e.g. the end of a tunnel) that takes
 * you through as soon as you walk into it.
 */
export class Door {
  readonly id: string;
  readonly style: DoorStyle;
  readonly dest: [string, string] | null;
  /** Trigger size for edge doors. */
  readonly w: number;
  readonly h: number;

  constructor(readonly x: number, readonly y: number, o: MapObj) {
    this.id = o.id ?? "";
    const style = o.type === "pit" ? "pit" : o.type === "landing" ? "drop" : o.style;
    this.style = (["hole", "burrow", "cave", "edge"].includes(style ?? "") || style === "pit" || style === "drop" ? style : "hole") as DoorStyle;
    this.dest = parseDest(o.to);
    this.w = o.w ?? 16;
    this.h = o.h ?? 40;
  }

  get auto() {
    return this.style === "edge" || this.style === "pit";
  }

  /** The witch is standing in the doorway (or inside the edge strip). */
  touching(game: Game) {
    const p = game.player;
    if (!p.alive || this.style === "drop") return false;
    // Anything that drops into the pit (or below it) goes through.
    if (this.style === "pit") return Math.abs(p.x - this.x) < this.w / 2 && p.y > this.y - this.h;
    if (this.auto) return Math.abs(p.x - this.x) < this.w / 2 && p.y > this.y - this.h && p.y - p.h < this.y;
    return p.onGround && Math.abs(p.x - this.x) < 10 && Math.abs(p.y - this.y) < 6;
  }

  draw(ctx: Ctx, time: number, prompt: boolean) {
    const { x, y } = this;
    switch (this.style) {
      case "hole": this.drawHole(ctx, x, y); break;
      case "burrow": this.drawBurrow(ctx, x, y, time); break;
      case "cave": this.drawCave(ctx, x, y); break;
      case "edge":
      case "pit":
      case "drop":
        return;
    }
    if (prompt) {
      const bob = Math.round(Math.sin(time * 6));
      const s = "UP";
      const top = y - (this.style === "hole" ? 22 : 34);
      rect(ctx, x - textWidth(s) / 2 - 2, top + bob, textWidth(s) + 4, 8, P.outline);
      drawText(ctx, s, x - textWidth(s) / 2, top + 2 + bob, P.cream, "");
    }
  }

  /** A rabbit hole: a little mound of earth with a dark round mouth. */
  private drawHole(ctx: Ctx, x: number, y: number) {
    ellipse(ctx, x, y, 15, 7, P.outline, y);
    ellipse(ctx, x, y, 14, 6, P.dirtDark, y);
    ellipse(ctx, x - 2, y - 2, 11, 4, P.dirt, y - 2);
    ellipse(ctx, x, y - 1, 8, 5, P.outline, y);
    ellipse(ctx, x, y - 1, 7, 4, "#3a2436", y);
    ellipse(ctx, x + 1, y, 5, 2.5, "#24162a", y);
    // Grass tufts on the mound and a pebble.
    for (const [ox, h] of [[-12, 3], [-10, 2], [11, 3], [13, 2]] as const) {
      rect(ctx, x + ox, y - 3 - h, 1, h, P.grass);
      px(ctx, x + ox, y - 4 - h, P.outline);
    }
    px(ctx, x + 9, y - 4, P.pebble);
    px(ctx, x + 10, y - 4, P.pebble);
  }

  /** Inside a burrow: a tunnel mouth with daylight spilling down it. */
  private drawBurrow(ctx: Ctx, x: number, y: number, time: number) {
    ellipse(ctx, x, y - 12, 11, 14, P.outline, y);
    ellipse(ctx, x, y - 12, 10, 13, "#2a1a2a", y);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.18 + 0.05 * Math.sin(time * 2);
    ellipse(ctx, x, y - 14, 7, 11, "#fff2a0", y);
    ctx.globalAlpha = 0.12;
    rect(ctx, x - 4, y - 40, 8, 30, "#fff2a0");
    ctx.restore();
    // Roots curling over the mouth.
    for (let i = -9; i <= 9; i += 3) px(ctx, x + i, y - 25 + Math.abs(i) * 0.4, P.barkDark);
    px(ctx, x - 6, y - 22, P.bark);
    px(ctx, x + 5, y - 23, P.bark);
  }

  /** A dark cave mouth ringed with stone. */
  private drawCave(ctx: Ctx, x: number, y: number) {
    ellipse(ctx, x, y - 12, 14, 16, P.outline, y);
    ellipse(ctx, x, y - 12, 13, 15, P.stoneDark, y);
    ellipse(ctx, x, y - 11, 10, 13, P.outline, y);
    ellipse(ctx, x, y - 11, 9, 12, "#1e1628", y);
    px(ctx, x - 11, y - 18, P.stoneHi);
    px(ctx, x - 10, y - 22, P.stoneHi);
    px(ctx, x + 8, y - 24, P.moss);
    px(ctx, x + 9, y - 24, P.moss);
  }
}
