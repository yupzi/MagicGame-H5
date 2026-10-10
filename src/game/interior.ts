import { sfx } from "../engine/audio";
import { ellipse, line, px, rect, type Ctx } from "../engine/gfx";
import { drawText, textWidth } from "../engine/font";
import type { Input } from "../engine/input";
import { approach, clamp } from "../engine/math";
import { drawMagicCircle } from "./effects";
import type { Game } from "./game";
import { drawHud } from "./hud";
import { P } from "./palette";
import { ELEMENTS } from "./runes";

const FLOOR = 150;
const X_MIN = 24, X_MAX = 302;
const WALK = 72;

type Spot = "bed" | "desk" | "loom" | "door";

const SPOTS: { id: Spot; x: number; reach: number; tip: string }[] = [
  { id: "bed", x: 48, reach: 30, tip: "小床 · 按 ↑ 睡觉：进入新的一天，回满体力并存档。花园里的朋友会准备礼物。" },
  { id: "desk", x: 120, reach: 16, tip: "书桌 · 按 ↑ 翻开魔法星盘" },
  { id: "loom", x: 226, reach: 16, tip: "编织台 · 按 ↑ 编织符文" },
  { id: "door", x: 290, reach: 14, tip: "门 · 按 ↑ 出门" },
];

const WINDOW = { x0: 152, x1: 200, y0: 42, y1: 90 };
const SLEEP_TIME = 2.6;

/**
 * Inside the cottage: one warm room, drawn as a single screen. The witch walks
 * left and right; pressing up at a piece of furniture uses it.
 */
export class CottageInterior {
  open = false;
  private x = 290;
  private facing = -1;
  private vx = 0;
  private runT = 0;
  private t = 0;
  private sleepT = -1; // >= 0 while sleeping
  private slept = false;
  private msg: string | null = null;
  private msgT = 0;

  constructor(private game: Game) {}

  /** Step inside through the door. */
  enter() {
    this.open = true;
    this.x = 286;
    this.facing = -1;
    this.vx = 0;
    this.sleepT = -1;
    this.msg = null;
  }

  close() {
    this.open = false;
    this.game.ui.setTip(null);
  }

  private spot(): (typeof SPOTS)[number] | null {
    for (const s of SPOTS) if (Math.abs(this.x - s.x) < s.reach) return s;
    return null;
  }

  update(dt: number, input: Input) {
    this.t += dt;
    const game = this.game;
    if (this.sleepT >= 0) return this.updateSleep(dt);
    this.msgT = Math.max(0, this.msgT - dt);

    const move = (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0);
    if (move) this.facing = move;
    this.vx = approach(this.vx, move * WALK, (move ? 700 : 900) * dt);
    this.x = clamp(this.x + this.vx * dt, X_MIN, X_MAX);
    if (Math.abs(this.vx) > 5) this.runT += dt * (Math.abs(this.vx) / 96);

    const s = this.spot();
    game.ui.setTip(this.msgT > 0 ? this.msg : s ? s.tip : null);

    if (input.pressed("menu")) {
      game.ui.setTip(null);
      return game.tree.show();
    }
    if (input.pressed("weave")) {
      game.ui.setTip(null);
      return game.weave.show();
    }
    const use = input.pressed("up") || input.pressed("bolt") || input.pressed("confirm");
    if (!use || !s) return;
    switch (s.id) {
      case "bed":
        this.sleepT = 0;
        this.slept = false;
        game.ui.setTip(null);
        sfx.bookClose();
        break;
      case "desk":
        game.ui.setTip(null);
        game.tree.show();
        break;
      case "loom":
        game.ui.setTip(null);
        game.weave.show();
        break;
      case "door":
        sfx.bookClose();
        game.leaveHome();
        break;
    }
  }

  private updateSleep(dt: number) {
    this.sleepT += dt;
    if (!this.slept && this.sleepT >= 0.6) {
      this.slept = true;
      const gifts = this.game.nextDay();
      this.msg = gifts > 0 ? `第 ${this.game.progress.day} 天 · 早上好！花园里的朋友们准备了 ${gifts} 份礼物。` : `第 ${this.game.progress.day} 天 · 早上好！体力已经恢复，进度已保存。`;
    }
    if (this.sleepT >= SLEEP_TIME) {
      this.sleepT = -1;
      this.x = 78;
      this.facing = 1;
      this.msgT = 4;
      sfx.heal();
    }
  }

  // ------------------------------------------------------------------ drawing

  draw(ctx: Ctx) {
    const game = this.game;
    const vw = game.viewW, vh = game.viewH;
    const t = this.t;

    // Wall: warm planks, a beam across the top.
    rect(ctx, 0, 0, vw, FLOOR, "#f3d19a");
    for (let x = 8; x < vw; x += 16) rect(ctx, x, 16, 1, FLOOR - 16, "#e2bb82");
    rect(ctx, 0, 0, vw, 14, "#7a4f3e");
    rect(ctx, 0, 14, vw, 3, P.barkDark);
    for (let x = 30; x < vw; x += 70) rect(ctx, x, 0, 6, 17, P.barkDark);
    rect(ctx, 0, FLOOR - 4, vw, 4, P.bark);
    rect(ctx, 0, FLOOR - 4, vw, 1, P.barkLight);

    // Floor boards and a round rug.
    rect(ctx, 0, FLOOR, vw, vh - FLOOR, "#b0764f");
    for (let y = FLOOR + 6; y < vh; y += 7) rect(ctx, 0, y, vw, 1, "#94603f");
    for (let i = 0; i < 12; i++) rect(ctx, (i * 53) % vw, FLOOR + 1 + (i % 4) * 7, 1, 6, "#94603f");
    ellipse(ctx, 176, FLOOR + 10, 50, 8, P.outline);
    ellipse(ctx, 176, FLOOR + 10, 49, 7, P.blossomDark);
    ellipse(ctx, 176, FLOOR + 10, 42, 5, P.blossom);
    ellipse(ctx, 176, FLOOR + 10, 30, 3, P.blossomHi);

    this.drawWindow(ctx);
    this.drawLamp(ctx, t);
    this.drawBed(ctx);
    this.drawDesk(ctx, t);
    this.drawLoom(ctx, t);
    this.drawDoor(ctx);
    this.drawShelf(ctx);

    // The witch (tucked in bed while sleeping).
    if (this.sleepT < 0) {
      game.player.drawAt(ctx, game, Math.round(this.x), FLOOR, this.facing, this.vx, this.runT);
      const s = this.spot();
      if (s) {
        const bob = Math.round(Math.sin(t * 6));
        const label = "UP";
        const lx = Math.round(this.x - textWidth(label) / 2);
        rect(ctx, lx - 2, FLOOR - 40 + bob, textWidth(label) + 4, 8, P.outline);
        drawText(ctx, label, lx, FLOOR - 38 + bob, P.cream, "");
      }
    }

    drawHud(ctx, game, vw);

    if (this.sleepT >= 0) this.drawSleep(ctx);
  }

  private drawWindow(ctx: Ctx) {
    const { x0, x1, y0, y1 } = WINDOW;
    const w = x1 - x0, h = y1 - y0;
    rect(ctx, x0 - 3, y0 - 3, w + 6, h + 6, P.outline);
    rect(ctx, x0 - 2, y0 - 2, w + 4, h + 4, P.bark);
    // Outside: sky, a hill, the fence and whoever lives in the garden.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    rect(ctx, x0, y0, w, h, "#8fd3ff");
    rect(ctx, x0, y0 + h * 0.55, w, 2, "#b8e6ff");
    ellipse(ctx, x0 + 14, y0 + 12, 7, 3, P.white);
    ellipse(ctx, x0 + 36, y0 + 20, 5, 2, P.white);
    const gy = y1 - 12;
    ellipse(ctx, x0 + 30, gy + 6, 34, 10, "#9ad99a");
    rect(ctx, x0, gy, w, y1 - gy, P.leaf);
    rect(ctx, x0, gy, w, 1, P.leafHi);
    for (let x = x0 + 3; x < x1; x += 8) rect(ctx, x, gy - 5, 2, 5, P.barkLight);
    rect(ctx, x0, gy - 3, w, 1, P.barkLight);
    const pets = this.game.progress.pets;
    pets.forEach((kind, i) => {
      const phase = this.t * (kind === "rabbit" ? 0.35 : 0.15) + i * 0.37;
      const u = (Math.sin(phase * Math.PI * 2) + 1) / 2;
      const px0 = Math.round(x0 + 5 + u * (w - 10));
      if (kind === "rabbit") {
        const hop = Math.round(Math.abs(Math.sin(this.t * 4 + i)) * 2);
        rect(ctx, px0 - 2, gy - 3 - hop, 4, 3, P.bunny);
        px(ctx, px0 - 1, gy - 5 - hop, P.bunny);
        px(ctx, px0 + 1, gy - 5 - hop, P.bunny);
      } else {
        rect(ctx, px0 - 3, gy - 4, 6, 4, P.boar);
        px(ctx, px0 + 3, gy - 2, P.boarSnout);
      }
    });
    ctx.restore();
    // Frame cross and sill.
    rect(ctx, x0 + w / 2 - 1, y0, 2, h, P.bark);
    rect(ctx, x0, y0 + h / 2 - 1, w, 2, P.bark);
    rect(ctx, x0 - 5, y1 + 2, w + 10, 4, P.outline);
    rect(ctx, x0 - 4, y1 + 2, w + 8, 3, P.barkLight);
    ellipse(ctx, x0 + 4, y1, 3, 3, P.leaf);
    px(ctx, x0 + 4, y1 - 3, P.blossom);
  }

  private drawLamp(ctx: Ctx, t: number) {
    const x = 176, y = 26;
    line(ctx, x, 14, x, y - 4, P.outline);
    ellipse(ctx, x, y, 6, 4, P.outline);
    ellipse(ctx, x, y - 1, 5, 3, P.magicPink);
    ellipse(ctx, x, y + 2, 3, 2, "#fff3b0");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // Soft pool of light: a few faint layers instead of one hard disc.
    const flick = 0.01 * Math.sin(t * 2);
    for (const [r, a] of [[34, 0.03], [24, 0.04], [14, 0.06]] as const) {
      ctx.globalAlpha = a + flick;
      ellipse(ctx, x, y + 6, r, r * 0.7, P.magicYellow);
    }
    ctx.restore();
  }

  private drawBed(ctx: Ctx) {
    const y = FLOOR;
    const x0 = 20, x1 = 78;
    // Headboard with a heart cut-out.
    rect(ctx, x0 - 1, y - 30, 8, 30, P.outline);
    rect(ctx, x0, y - 29, 6, 29, P.bark);
    px(ctx, x0 + 2, y - 24, P.heart); px(ctx, x0 + 4, y - 24, P.heart); px(ctx, x0 + 3, y - 23, P.heart);
    rect(ctx, x1 - 3, y - 16, 5, 16, P.outline);
    rect(ctx, x1 - 2, y - 15, 3, 15, P.barkDark);
    // Frame, mattress, blanket, pillow.
    rect(ctx, x0 + 5, y - 10, x1 - x0 - 6, 6, P.outline);
    rect(ctx, x0 + 6, y - 9, x1 - x0 - 8, 4, P.bark);
    rect(ctx, x0 + 6, y - 15, x1 - x0 - 8, 6, P.white);
    rect(ctx, x0 + 22, y - 16, x1 - x0 - 24, 9, P.outline);
    rect(ctx, x0 + 23, y - 15, x1 - x0 - 26, 7, P.magicPurple);
    for (let i = 0; i < 5; i++) px(ctx, x0 + 26 + i * 6, y - 12 + (i % 2), P.magicYellow);
    ellipse(ctx, x0 + 14, y - 16, 7, 3.5, P.outline);
    ellipse(ctx, x0 + 14, y - 16.5, 6, 2.5, P.white);
    if (this.sleepT >= 0) {
      // A sleepy lump of white hair and the hat on the bedpost.
      ellipse(ctx, x0 + 14, y - 19, 5, 4, P.outline);
      ellipse(ctx, x0 + 14, y - 19, 4, 3, P.hair);
      ellipse(ctx, x0 + 36, y - 16, 12, 4, P.magicPurple);
    }
    // Little rug by the bed.
    rect(ctx, x0 + 8, y + 2, 30, 3, "#c9a0ff");
  }

  private drawDesk(ctx: Ctx, t: number) {
    const y = FLOOR, x = 120;
    // Legs and top.
    rect(ctx, x - 16, y - 18, 3, 18, P.outline);
    rect(ctx, x + 13, y - 18, 3, 18, P.outline);
    rect(ctx, x - 15, y - 17, 1, 17, P.barkDark);
    rect(ctx, x + 14, y - 17, 1, 17, P.barkDark);
    rect(ctx, x - 19, y - 21, 38, 4, P.outline);
    rect(ctx, x - 18, y - 20, 36, 2, P.bark);
    // Open grimoire with a glowing star chart.
    rect(ctx, x - 9, y - 25, 18, 5, P.outline);
    rect(ctx, x - 8, y - 24, 7, 3, P.cream);
    rect(ctx, x + 1, y - 24, 7, 3, P.cream);
    const glow = 0.5 + 0.5 * Math.sin(t * 3);
    px(ctx, x - 5, y - 23, glow > 0.5 ? P.magicYellow : P.magicPink);
    px(ctx, x + 4, y - 23, P.magicPurple);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.15 + 0.1 * glow;
    ellipse(ctx, x, y - 26, 9, 5, P.magicPurple);
    ctx.restore();
    // Candle and a stack of books.
    rect(ctx, x + 11, y - 27, 3, 6, P.cream);
    px(ctx, x + 12, y - 28 - (Math.floor(t * 8) % 2), P.fireHi);
    rect(ctx, x - 17, y - 24, 6, 3, P.heart);
    rect(ctx, x - 16, y - 27, 5, 3, P.ice);
    // The calendar on the wall.
    const label = `DAY ${this.game.progress.day}`;
    const w = textWidth(label) + 8;
    rect(ctx, x - w / 2 - 1, 30, w + 2, 14, P.outline);
    rect(ctx, x - w / 2, 31, w, 12, P.white);
    rect(ctx, x - w / 2, 31, w, 3, P.heart);
    drawText(ctx, label, x - textWidth(label) / 2, 36, P.outline, "");
  }

  private drawLoom(ctx: Ctx, t: number) {
    const y = FLOOR, x = 226;
    // Round table on a pedestal.
    rect(ctx, x - 2, y - 14, 5, 14, P.outline);
    rect(ctx, x - 1, y - 13, 3, 13, P.barkDark);
    rect(ctx, x - 8, y - 2, 17, 2, P.outline);
    ellipse(ctx, x, y - 15, 13, 3.5, P.outline);
    ellipse(ctx, x, y - 15.5, 12, 2.5, P.bark);
    // The current spell's circle hovers over it.
    const w = this.game.progress.current;
    const col = ELEMENTS[w.el];
    drawMagicCircle(ctx, x, y - 30 + Math.sin(t * 2) * 1.5, 10, t * 1.2, {
      ax: 1, ay: 1, progress: 1, main: col.main, accent: col.accent, form: w.form, glyphs: col.glyphs, alpha: 0.9,
    });
    // Yarn basket.
    ellipse(ctx, x + 18, y - 3, 6, 3, P.outline);
    ellipse(ctx, x + 18, y - 3.5, 5, 2, P.barkLight);
    ellipse(ctx, x + 16, y - 6, 2.5, 2.5, P.blossom);
    ellipse(ctx, x + 20, y - 6, 2.5, 2.5, P.ice);
  }

  private drawDoor(ctx: Ctx) {
    const y = FLOOR, x = 290, w = 20, h = 34;
    rect(ctx, x - w / 2 - 2, y - h, w + 4, h, P.outline);
    ellipse(ctx, x, y - h, w / 2 + 2, 6, P.outline);
    rect(ctx, x - w / 2, y - h + 1, w, h - 1, P.bark);
    ellipse(ctx, x, y - h + 1, w / 2, 5, P.bark);
    line(ctx, x, y - h - 3, x, y - 1, P.barkDark);
    px(ctx, x + 5, y - 16, P.magicYellow);
    // Daylight under the door.
    rect(ctx, x - w / 2 + 1, y - 1, w - 2, 1, "#fff3b0");
  }

  private drawShelf(ctx: Ctx) {
    const y = 60, x0 = 208, x1 = 250;
    rect(ctx, x0, y, x1 - x0, 3, P.outline);
    rect(ctx, x0 + 1, y, x1 - x0 - 2, 2, P.barkLight);
    const jars = [P.fire, P.leaf, P.magicPink, P.ice];
    jars.forEach((c, i) => {
      const jx = x0 + 5 + i * 10;
      rect(ctx, jx - 3, y - 8, 7, 8, P.outline);
      rect(ctx, jx - 2, y - 7, 5, 7, P.white);
      rect(ctx, jx - 2, y - 4, 5, 4, c);
      rect(ctx, jx - 2, y - 9, 5, 1, P.bark);
    });
    // A potted fern in the corner.
    rect(ctx, 256, FLOOR - 8, 9, 8, P.outline);
    rect(ctx, 257, FLOOR - 7, 7, 7, "#e58a6a");
    for (let i = 0; i < 5; i++) ellipse(ctx, 255 + i * 3, FLOOR - 12 - (i % 2) * 3, 3, 2, i % 2 ? P.leaf : P.leafDark);
  }

  private drawSleep(ctx: Ctx) {
    const vw = this.game.viewW, vh = this.game.viewH;
    const s = this.sleepT;
    const dark = s < 0.6 ? s / 0.6 : s > SLEEP_TIME - 0.6 ? (SLEEP_TIME - s) / 0.6 : 1;
    ctx.fillStyle = `rgba(24,16,44,${0.92 * dark})`;
    ctx.fillRect(0, 0, vw, vh);
    if (dark > 0.6) {
      // Moon, stars and drifting Zs.
      ellipse(ctx, vw / 2 + 60, 44, 9, 9, "#fff3b0");
      ellipse(ctx, vw / 2 + 57, 42, 2, 2, "#f0dc90");
      ellipse(ctx, vw / 2 + 63, 47, 1.5, 1.5, "#f0dc90");
      for (let i = 0; i < 12; i++) px(ctx, (i * 71) % vw, 20 + ((i * 37) % 70), i % 3 ? "#6a5a90" : P.white);
      for (let i = 0; i < 3; i++) {
        const k = (s * 0.7 + i / 3) % 1;
        drawText(ctx, "Z", 60 + i * 6 + k * 10, 120 - k * 40, P.cream, "", i === 2 ? 2 : 1);
      }
    }
  }
}
