import { ellipse, line, px, rect, ring, type Ctx } from "../engine/gfx";
import { drawText, textWidth } from "../engine/font";
import { P } from "./palette";
import type { FormId } from "./runes";
import { heartFull } from "./sprites";

const TAU = Math.PI * 2;

export interface Effect {
  layer: "back" | "front";
  /** Returns false when finished. */
  update(dt: number): boolean;
  draw(ctx: Ctx, time: number): void;
}

// 3x3 rune glyphs, picked per slot around the circle.
const RUNES = [
  [[0, 0], [1, 1], [2, 0], [1, 2]],
  [[0, 0], [0, 1], [0, 2], [1, 1], [2, 0]],
  [[1, 0], [0, 1], [2, 1], [1, 2]],
  [[0, 0], [2, 0], [0, 2], [2, 2], [1, 1]],
  [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
  [[0, 2], [1, 1], [2, 0], [2, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
];

export interface CircleStyle {
  ax: number; // horizontal squash (1 = none)
  ay: number; // vertical squash (0.35 = lying on the ground)
  progress: number; // 0..1 how much of the circle is drawn in
  main: string;
  accent: string;
  alpha?: number;
  pulse?: number; // 0..1 white-hot flash
  form?: FormId; // woven spells swap the hexagram for their form's figure
  glyphs?: number; // offset into the rune table, so each element writes its own runes
}

/**
 * Procedural magic circle: counter-rotating rings, a rune band, a hexagram and
 * a core star. Rings "draw themselves in" as progress goes from 0 to 1.
 */
export function drawMagicCircle(ctx: Ctx, cx: number, cy: number, r: number, rot: number, s: CircleStyle) {
  const alpha = s.alpha ?? 1;
  const hot = !!s.pulse && s.pulse > 0.5;

  // A dim "scorched" disc under the lines gives them contrast on grass and dirt.
  ctx.globalAlpha = 0.32 * alpha;
  ellipse(ctx, cx, cy, r * s.ax + 1, r * s.ay + 1, CIRCLE_BACK);
  ctx.globalAlpha = alpha;
  circleLines(ctx, cx, cy, r, rot, s, hot ? P.white : s.main, s.accent);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = (hot ? 0.22 : 0.1) * alpha;
  ellipse(ctx, cx, cy, r * s.ax + 3, r * s.ay + 3, s.main);
  ctx.restore();
  ctx.globalAlpha = 1;
}

const CIRCLE_BACK = "#3d2366";

function circleLines(ctx: Ctx, cx: number, cy: number, r: number, rot: number, s: CircleStyle, main: string, accent: string) {
  const pt = (a: number, rad: number): [number, number] => [cx + Math.cos(a) * rad * s.ax, cy + Math.sin(a) * rad * s.ay];
  const span = s.progress * TAU;
  ring(ctx, cx, cy, r * s.ax, r * s.ay, main, rot, rot + span);
  if (r > 8) ring(ctx, cx, cy, (r - 4) * s.ax, (r - 4) * s.ay, accent, -rot * 1.4, -rot * 1.4 + span);

  // Rune band between the two outer rings.
  if (r > 10) {
    const n = Math.max(6, Math.floor(r * 0.45));
    for (let i = 0; i < n; i++) {
      if (i / n > s.progress) break;
      const [x, y] = pt(rot + (i / n) * TAU, r - 2);
      const glyph = RUNES[(i + (s.glyphs ?? 0)) % RUNES.length];
      for (const [gx, gy] of glyph) px(ctx, x - 1 + gx, y - 1 + gy * Math.max(0.5, s.ay), main);
    }
  }

  if (s.form && s.progress > 0.35 && r > 6) {
    formFigure(ctx, s, cx, cy, r, rot, Math.min(1, (s.progress - 0.35) / 0.5), pt, main, accent);
  } else if (s.progress > 0.35 && r > 6) {
    // Hexagram.
    const k = Math.min(1, (s.progress - 0.35) / 0.5);
    const hr = (r - 5) * 0.95;
    for (let t = 0; t < 2; t++) {
      const base = -rot * 0.8 + t * (Math.PI / 3);
      for (let i = 0; i < 3; i++) {
        const [x0, y0] = pt(base + (i * TAU) / 3, hr);
        const [x1, y1] = pt(base + ((i + 1) * TAU) / 3, hr);
        line(ctx, x0, y0, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, t === 0 ? main : accent);
      }
    }
  }

  if (s.progress > 0.6) {
    ring(ctx, cx, cy, r * 0.38 * s.ax, r * 0.38 * s.ay, main);
    const [x, y] = [Math.round(cx), Math.round(cy)];
    px(ctx, x, y, P.white);
    px(ctx, x - 1, y, accent); px(ctx, x + 1, y, accent);
    px(ctx, x, y - 1, accent); px(ctx, x, y + 1, accent);
  }
}

type Pt = (a: number, rad: number) => [number, number];

/** Polygon through n points on a circle, each edge drawn in up to fraction k. */
function polygon(ctx: Ctx, pt: Pt, n: number, rad: number, base: number, k: number, color: string) {
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pt(base + (i * TAU) / n, rad);
    const [x1, y1] = pt(base + ((i + 1) * TAU) / n, rad);
    line(ctx, x0, y0, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, color);
  }
}

/**
 * The inner figure of a woven circle:
 *   bolt   – a triangle with a smaller one inside, like an arrowhead
 *   ring   – nested rings strung with beads
 *   pillar – two interlocked squares (an eight-point star)
 */
function formFigure(
  ctx: Ctx, s: CircleStyle, cx: number, cy: number, r: number, rot: number, k: number, pt: Pt, main: string, accent: string,
) {
  const hr = (r - 5) * 0.95;
  if (s.form === "bolt") {
    polygon(ctx, pt, 3, hr, -rot * 0.8, k, main);
    polygon(ctx, pt, 3, hr * 0.5, -rot * 0.8 + Math.PI, k, accent);
  } else if (s.form === "ring") {
    const span = k * TAU;
    ring(ctx, cx, cy, hr * 0.85 * s.ax, hr * 0.85 * s.ay, accent, rot * 2, rot * 2 + span);
    ring(ctx, cx, cy, hr * 0.6 * s.ax, hr * 0.6 * s.ay, main, -rot * 2, -rot * 2 + span);
    const beads = 8;
    for (let i = 0; i < beads * k; i++) {
      const [x, y] = pt(rot * 1.5 + (i / beads) * TAU, hr * 0.72);
      px(ctx, x, y, P.white);
    }
  } else if (s.form === "lob") {
    // Pentagram inside a small circle: a thrown charm.
    for (let i = 0; i < 5; i++) {
      const [x0, y0] = pt(-rot * 0.8 + (i * TAU) / 5, hr);
      const [x1, y1] = pt(-rot * 0.8 + (((i + 2) % 5) * TAU) / 5, hr);
      line(ctx, x0, y0, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, main);
    }
    ring(ctx, cx, cy, hr * 0.35 * s.ax, hr * 0.35 * s.ay, accent, rot, rot + k * TAU);
  } else {
    polygon(ctx, pt, 4, hr, -rot * 0.8, k, main);
    polygon(ctx, pt, 4, hr, -rot * 0.8 + Math.PI / 4, k, accent);
  }
}

/** A little heart that floats up and fades (befriending an animal). */
export class HeartFx implements Effect {
  layer: "back" | "front" = "front";
  private t = 0;
  constructor(private x: number, private y: number, private life = 0.9) {}
  update(dt: number) { this.t += dt; return this.t < this.life; }
  draw(ctx: Ctx) {
    const k = this.t / this.life;
    if (k > 0.7 && Math.floor(this.t * 20) % 2 === 0) return;
    const pop = k < 0.15 ? 1 + (0.15 - k) * 4 : 1;
    const y = Math.round(this.y - k * 14);
    const x = Math.round(this.x + Math.sin(this.t * 8) * 1.5);
    const w = Math.round(heartFull.width * pop), h = Math.round(heartFull.height * pop);
    ctx.drawImage(heartFull, x - Math.floor(w / 2), y - h, w, h);
  }
}

/** Expanding shockwave ring. */
export class RingFx implements Effect {
  layer: "back" | "front" = "front";
  private t = 0;
  constructor(
    private x: number, private y: number,
    private r0: number, private r1: number,
    private life: number, private color: string,
    private flat = 1, private thick = 1,
  ) {}
  update(dt: number) { this.t += dt; return this.t < this.life; }
  draw(ctx: Ctx) {
    const k = this.t / this.life;
    const e = 1 - (1 - k) * (1 - k);
    const r = this.r0 + (this.r1 - this.r0) * e;
    for (let i = 0; i < this.thick; i++) {
      if (k > 0.6 && i > 0) break;
      ring(ctx, this.x, this.y, r - i, (r - i) * this.flat, this.color);
    }
  }
}

/** Bright disc that pops on impact and collapses in a few frames. */
export class FlashFx implements Effect {
  layer: "back" | "front" = "front";
  private t = 0;
  constructor(private x: number, private y: number, private r: number, private life = 0.1, private color = P.white, private rim = P.magicYellow) {}
  update(dt: number) { this.t += dt; return this.t < this.life; }
  draw(ctx: Ctx) {
    const k = 1 - this.t / this.life;
    const r = this.r * (0.4 + k * 0.6);
    ellipse(ctx, this.x, this.y, r, r, this.color);
    if (k > 0.5) ring(ctx, this.x, this.y, r + 2, r + 2, this.rim);
  }
}

/** Small upright circle that blooms in front of the wand when casting a bolt. */
export class CastCircleFx implements Effect {
  layer: "back" | "front" = "front";
  private t = 0;
  constructor(
    private x: number, private y: number, private dir: number, private life = 0.2,
    private main = P.magicPink, private accent = P.magicYellow, private size = 9,
    private form?: FormId, private glyphs = 0,
  ) {}
  update(dt: number) { this.t += dt; return this.t < this.life; }
  draw(ctx: Ctx, time: number) {
    const k = this.t / this.life;
    const r = this.size * (0.45 + 0.55 * Math.min(1, k * 3));
    drawMagicCircle(ctx, this.x + this.dir * k * 3, this.y, r, time * 8 * this.dir, {
      ax: 0.35, ay: 1, progress: Math.min(1, k * 4), main: this.main, accent: this.accent, alpha: 1 - k * k,
      form: this.form, glyphs: this.glyphs,
    });
  }
}

/** Flat woven circle drawn on the ground: blooms in, lingers, fades. */
export class GroundCircleFx implements Effect {
  layer: "back" | "front" = "back";
  private t = 0;
  constructor(
    private x: number, private y: number, private r: number, private life: number,
    private main: string, private accent: string, private form?: FormId, private glyphs = 0,
  ) {}
  update(dt: number) { this.t += dt; return this.t < this.life; }
  draw(ctx: Ctx, time: number) {
    const k = this.t / this.life;
    drawMagicCircle(ctx, this.x, this.y, this.r * (0.6 + 0.4 * Math.min(1, k * 5)), time * 3, {
      ax: 1, ay: 0.3, progress: Math.min(1, k * 4), main: this.main, accent: this.accent,
      alpha: k > 0.6 ? (1 - k) / 0.4 : 1, form: this.form, glyphs: this.glyphs,
    });
  }
}

/** Pillar of starlight erupting from a ground circle. */
export class PillarFx implements Effect {
  layer: "back" | "front" = "front";
  private t = 0;
  constructor(private x: number, private y: number, private w: number, private life: number, private height = 150) {}
  update(dt: number) { this.t += dt; return this.t < this.life; }
  draw(ctx: Ctx, time: number) {
    const k = this.t / this.life;
    const rise = Math.min(1, this.t / 0.07);
    const h = this.height * rise;
    const w = this.w * (k < 0.15 ? 1.25 : 1 - (k - 0.15) * 0.95);
    if (w < 0.5) return;
    const top = this.y - h;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.35 * (1 - k);
    rect(ctx, this.x - w - 3, top, w * 2 + 6, h, P.magicPink);
    ctx.globalAlpha = 0.6 * (1 - k * 0.5);
    rect(ctx, this.x - w, top, w * 2, h, P.magicPink);
    ctx.restore();
    const cw = Math.max(1, w * 0.55);
    rect(ctx, this.x - cw, top, cw * 2, h, k < 0.5 ? P.white : P.magicYellow);
    // Rings climbing the beam.
    for (let i = 0; i < 4; i++) {
      const yy = this.y - ((time * 220 + i * 37) % h);
      ring(ctx, this.x, yy, w + 3, 2, P.white);
    }
    ellipse(ctx, this.x, this.y, w * 1.8, 4 * (1 - k) + 1, P.white);
  }
}

/** Rising damage/pickup numbers with a pop-in. */
export class FloatText implements Effect {
  layer: "back" | "front" = "front";
  private t = 0;
  private vy = -55;
  constructor(private text: string, private x: number, private y: number, private color: string, private life = 0.7, private big = false) {}
  update(dt: number) {
    this.t += dt;
    this.vy *= Math.exp(-5 * dt);
    this.y += this.vy * dt;
    return this.t < this.life;
  }
  draw(ctx: Ctx) {
    if (this.t > this.life * 0.7 && Math.floor(this.t * 30) % 2 === 0) return;
    const scale = this.big || this.t < 0.06 ? 2 : 1;
    const w = textWidth(this.text, scale);
    drawText(ctx, this.text, Math.round(this.x - w / 2), Math.round(this.y), this.t < 0.05 ? P.white : this.color, P.outline, scale);
  }
}

/** Flat sigil that opens in the sky right before a lightning strike. */
export class SkySigilFx implements Effect {
  layer: "back" | "front" = "front";
  private t = 0;
  constructor(private x: number, private y: number, private life: number) {}
  update(dt: number) { this.t += dt; return this.t < this.life; }
  draw(ctx: Ctx, time: number) {
    const k = this.t / this.life;
    drawMagicCircle(ctx, this.x, this.y, 8 + k * 10, time * 9, {
      ax: 1, ay: 0.3, progress: Math.min(1, k * 1.6), main: P.volt, accent: P.voltBlue, alpha: 1, pulse: k > 0.8 ? 1 : 0,
    });
  }
}

/**
 * Jagged lightning between two points. The path re-rolls every couple of
 * frames so it crackles, and it fattens up for the first instant of the hit.
 */
export class LightningFx implements Effect {
  layer: "back" | "front" = "front";
  private t = 0;
  private pts: [number, number][] = [];
  private branches: [number, number][][] = [];
  private rollT = 0;
  constructor(private x0: number, private y0: number, private x1: number, private y1: number, private life = 0.28, private width = 2) {
    this.roll();
  }
  private roll() {
    const n = Math.max(4, Math.round(Math.hypot(this.x1 - this.x0, this.y1 - this.y0) / 9));
    const nx = -(this.y1 - this.y0), ny = this.x1 - this.x0;
    const nl = Math.hypot(nx, ny) || 1;
    this.pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const j = i === 0 || i === n ? 0 : (Math.random() * 2 - 1) * 6;
      this.pts.push([this.x0 + (this.x1 - this.x0) * t + (nx / nl) * j, this.y0 + (this.y1 - this.y0) * t + (ny / nl) * j]);
    }
    this.branches = [];
    for (let b = 0; b < 2; b++) {
      const i = 1 + Math.floor(Math.random() * (n - 1));
      let [x, y] = this.pts[i];
      const br: [number, number][] = [[x, y]];
      const side = Math.random() < 0.5 ? -1 : 1;
      for (let s = 0; s < 3; s++) {
        x += side * (3 + Math.random() * 6);
        y += (this.y1 - this.y0) / n * 0.8;
        br.push([x, y]);
      }
      this.branches.push(br);
    }
  }
  update(dt: number) {
    this.t += dt;
    this.rollT -= dt;
    if (this.rollT <= 0) {
      this.rollT = 0.035;
      this.roll();
    }
    return this.t < this.life;
  }
  draw(ctx: Ctx) {
    const k = this.t / this.life;
    if (k > 0.55 && Math.floor(this.t * 40) % 2 === 0) return;
    const w = Math.max(0, Math.round(this.width * (k < 0.2 ? 1.5 : 1 - k)));
    const poly = (pts: [number, number][], color: string, thick: number) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        for (let o = -thick; o <= thick; o++) line(ctx, ax + o, ay, bx + o, by, color);
      }
    };
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5 * (1 - k);
    poly(this.pts, P.voltBlue, w + 2);
    ctx.restore();
    poly(this.pts, P.volt, w);
    for (const b of this.branches) poly(b, P.volt, 0);
    poly(this.pts, P.white, Math.max(0, w - 1));
  }
}
