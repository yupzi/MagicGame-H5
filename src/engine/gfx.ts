// Pixel-precise drawing helpers. Every shape snaps to whole pixels so the
// low-resolution canvas stays crisp when scaled up.
export type Ctx = CanvasRenderingContext2D;

let override: string | null = null;
/** While set, every fill uses this colour (used for hit-flash silhouettes). */
export function setOverride(color: string | null) {
  override = color;
}
const col = (c: string) => override ?? c;

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = col(color);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function px(ctx: Ctx, x: number, y: number, color: string) {
  ctx.fillStyle = col(color);
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** Filled ellipse built from horizontal spans. `maxY` clips the bottom (flat-bottomed blobs). */
export function ellipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, maxY = Infinity) {
  if (rx <= 0.2 || ry <= 0.2) return;
  ctx.fillStyle = col(color);
  const top = Math.round(cy - ry);
  const bot = Math.min(Math.round(cy + ry), maxY);
  for (let y = top; y < bot; y++) {
    const dy = (y + 0.5 - cy) / ry;
    const t = 1 - dy * dy;
    if (t <= 0) continue;
    const half = rx * Math.sqrt(t);
    const x0 = Math.round(cx - half);
    const x1 = Math.round(cx + half);
    if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, 1);
  }
}

/** Ellipse with a 1px outline. */
export function blob(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, fill: string, outline: string, maxY = Infinity) {
  ellipse(ctx, cx, cy, rx + 1, ry + 1, outline, maxY === Infinity ? Infinity : maxY + 1);
  ellipse(ctx, cx, cy, rx, ry, fill, maxY);
}

export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string) {
  ctx.fillStyle = col(color);
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 2000; i++) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Ellipse outline plotted point by point; `from`/`to` are angles for partial arcs. */
export function ring(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, from = 0, to = Math.PI * 2) {
  if (rx < 0.5 && ry < 0.5) return;
  ctx.fillStyle = col(color);
  const steps = Math.max(8, Math.ceil(Math.max(rx, ry) * 7 * ((to - from) / (Math.PI * 2))));
  let lx = NaN, ly = NaN;
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * ry);
    if (x !== lx || y !== ly) ctx.fillRect(x, y, 1, 1);
    lx = x; ly = y;
  }
}

export type Sprite = HTMLCanvasElement;

/** Build a sprite from an ASCII map. '.' is transparent. */
export function makeSprite(rows: string[], palette: Record<string, string>): Sprite {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

/** Same silhouette, single colour. */
export function tintSprite(src: Sprite, color: string): Sprite {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  const g = c.getContext("2d")!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export function drawSprite(ctx: Ctx, spr: Sprite, x: number, y: number, flip = false) {
  x = Math.round(x); y = Math.round(y);
  if (!flip) {
    ctx.drawImage(spr, x, y);
  } else {
    ctx.save();
    ctx.translate(x + spr.width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(spr, 0, 0);
    ctx.restore();
  }
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}
