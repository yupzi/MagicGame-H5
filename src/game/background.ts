import { ellipse, makeCanvas, ring, type Ctx } from "../engine/gfx";
import { makeRng } from "../engine/math";
import type { Backdrop } from "./mapdata";
import { P } from "./palette";
import { cloudPuff } from "./world";

const TILE = 640;
const TAU = Math.PI * 2;

interface Layer {
  canvas: HTMLCanvasElement;
  factor: number;
  drift: number;
  baseY: number;
}

/** Periodic height function so every layer tiles seamlessly every TILE px. */
function wave(x: number, terms: [number, number, number][]) {
  let v = 0;
  for (const [k, amp, ph] of terms) v += Math.sin((TAU * k * x) / TILE + ph) * amp;
  return v;
}

export class Background {
  private sky: HTMLCanvasElement;
  private layers: Layer[] = [];

  constructor(private vw: number, private vh: number, readonly kind: Backdrop = "sky") {
    const rng = makeRng(7);
    if (kind === "burrow") {
      this.sky = this.makeBurrow();
      this.layers.push({ canvas: this.makeTunnel(rng, 0.3), factor: 0.22, drift: 0, baseY: 0 });
      this.layers.push({ canvas: this.makeRoots(rng), factor: 0.45, drift: 0, baseY: 0 });
      return;
    }
    this.sky = this.makeSky();
    this.layers.push({ canvas: this.makeClouds(rng), factor: 0.06, drift: 4, baseY: 0 });
    this.layers.push({ canvas: this.makeMountains(), factor: 0.12, drift: 0, baseY: 20 });
    this.layers.push({ canvas: this.makeHills(rng, 0.3), factor: 0.28, drift: 0, baseY: 44 });
    this.layers.push({ canvas: this.makeHills(rng, 0.5), factor: 0.46, drift: 0, baseY: 66 });
  }

  /** Dark earth, lighter towards the middle: kept dim so the carved earth in front reads clearly. */
  private makeBurrow() {
    const [c, g] = makeCanvas(this.vw, this.vh);
    const bands = ["#2e1d33", "#35223a", "#3c2740", "#422b44", "#3c2740", "#35223a", "#2e1d33"];
    const bandH = Math.ceil(this.vh / bands.length);
    for (let i = 0; i < bands.length; i++) {
      g.fillStyle = bands[i];
      g.fillRect(0, i * bandH, this.vw, bandH);
      if (i > 0) {
        g.fillStyle = bands[i - 1];
        for (let x = 0; x < this.vw; x++) if (x % 2 === 0) g.fillRect(x, i * bandH, 1, 1);
      }
    }
    return c;
  }

  /** Far tunnel walls: lumpy ceiling and floor silhouettes with a few pebbles. */
  private makeTunnel(rng: () => number, depth: number) {
    const [c, g] = makeCanvas(TILE, 180);
    const col = "#4a3048", hi = "#573a52";
    const top: [number, number, number][] = [[3, 9, 0.3], [7, 4, 1.7], [11, 2, 0.4]];
    const bot: [number, number, number][] = [[2, 8, 1.1], [5, 5, 2.4], [13, 2, 0.9]];
    for (let x = 0; x < TILE; x++) {
      const t = Math.round(26 + wave(x, top) * (1 + depth));
      const b = Math.round(150 + wave(x, bot) * (1 + depth));
      g.fillStyle = col;
      g.fillRect(x, 0, 1, t);
      g.fillRect(x, b, 1, 180 - b);
      g.fillStyle = hi;
      g.fillRect(x, t - 1, 1, 1);
      g.fillRect(x, b, 1, 1);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = rng() < 0.5 ? "#664660" : "#3e2840";
      g.fillRect(Math.floor(rng() * TILE), rng() < 0.5 ? Math.floor(rng() * 20) : 158 + Math.floor(rng() * 20), 2, 1);
    }
    return c;
  }

  /** Nearer layer: roots dangling from the ceiling. */
  private makeRoots(rng: () => number) {
    const [c, g] = makeCanvas(TILE, 180);
    for (let i = 0; i < 16; i++) {
      const x0 = Math.floor(rng() * TILE);
      const len = 20 + rng() * 50;
      let x = x0;
      for (let y = 0; y < len; y++) {
        x += Math.sin(y * 0.2 + i) * 0.35;
        const w = y < len * 0.5 ? 2 : 1;
        for (const ox of [0, TILE, -TILE]) {
          g.fillStyle = "#5a3c48";
          g.fillRect(Math.round(x) + ox, y, w, 1);
        }
      }
      // A little glowing bud at some tips.
      if (rng() < 0.4) {
        g.fillStyle = "#ffd98a";
        g.fillRect(Math.round(x), Math.round(len), 1, 1);
      }
    }
    return c;
  }

  private makeSky() {
    const [c, g] = makeCanvas(this.vw, this.vh);
    const bands = ["#8fd0ff", "#9dd7ff", "#acdeff", "#bce5ff", "#cbecff", "#daf2ff", "#e6f7ff"];
    const bandH = Math.ceil(this.vh / bands.length);
    for (let i = 0; i < bands.length; i++) {
      g.fillStyle = bands[i];
      g.fillRect(0, i * bandH, this.vw, bandH);
      // Checker dither across each band seam.
      if (i > 0) {
        g.fillStyle = bands[i - 1];
        for (let x = 0; x < this.vw; x++) if (x % 2 === 0) g.fillRect(x, i * bandH, 1, 1);
        for (let x = 0; x < this.vw; x++) if (x % 4 === 1) g.fillRect(x, i * bandH + 1, 1, 1);
      }
    }
    // Soft sun with halo rings.
    const sx = this.vw - 58, sy = 30;
    g.globalAlpha = 0.25;
    ellipse(g, sx, sy, 22, 22, "#fffbe0");
    g.globalAlpha = 0.45;
    ellipse(g, sx, sy, 15, 15, "#fffbe0");
    g.globalAlpha = 1;
    ellipse(g, sx, sy, 10, 10, "#fff6c8");
    ellipse(g, sx - 2, sy - 2, 6, 6, "#fffdf0");
    g.globalAlpha = 0.5;
    ring(g, sx, sy, 27, 27, "#ffffff");
    g.globalAlpha = 1;
    return c;
  }

  private makeClouds(rng: () => number) {
    const [c, g] = makeCanvas(TILE, 120);
    for (let i = 0; i < 7; i++) {
      const x = (i / 7) * TILE + rng() * 50;
      const y = 22 + rng() * 55;
      const s = 7 + rng() * 9;
      for (const ox of [0, TILE, -TILE]) cloudPuff(g, x + ox, y, s, P.cloud, P.cloudShade, null);
    }
    return c;
  }

  private makeMountains() {
    const [c, g] = makeCanvas(TILE, 180);
    const terms: [number, number, number][] = [[3, 16, 0.3], [5, 9, 1.2], [9, 4, 2.1], [2, 8, 0.7]];
    for (let x = 0; x < TILE; x++) {
      const top = Math.round(78 + wave(x, terms));
      const slope = wave(x + 1, terms) - wave(x - 1, terms);
      for (let y = top; y < 180; y++) {
        const dd = y - top;
        let col = "#b7c3f2";
        if (dd < 3 && top < 72) col = "#f2f4ff";
        else if (slope > 0.4 && dd < 40) col = "#a5b1e6";
        else if (dd === 0) col = "#d5dcff";
        if (dd > 60) col = (x + y) % 2 ? "#aebaee" : "#b7c3f2";
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  private makeHills(rng: () => number, depth: number) {
    const [c, g] = makeCanvas(TILE, 180);
    const near = depth > 0.4;
    const base = near ? "#8ed6a4" : "#a9e2c4";
    const top = near ? "#b3ecc0" : "#c6f0da";
    const tree = near ? "#74c290" : "#95d4b4";
    const treeHi = near ? "#8fd6a4" : "#aee2c8";
    const terms: [number, number, number][] = near
      ? [[2, 12, 0.5], [4, 7, 2.0], [7, 3, 1.1]]
      : [[3, 10, 1.4], [5, 6, 0.2], [8, 3, 2.6]];
    const baseY = near ? 100 : 92;
    const heights: number[] = [];
    for (let x = 0; x < TILE; x++) heights.push(Math.round(baseY + wave(x, terms)));

    // Round tree silhouettes sitting on the hill line.
    const count = near ? 14 : 20;
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rng() * TILE);
      const r = (near ? 7 : 5) + rng() * 5;
      const hy = heights[x];
      for (const ox of [0, TILE, -TILE]) {
        g.fillStyle = tree;
        g.fillRect(x + ox - 1, hy - r, 2, r);
        ellipse(g, x + ox, hy - r - r * 0.5, r, r * 0.9, tree);
        ellipse(g, x + ox - r * 0.3, hy - r - r * 0.8, r * 0.45, r * 0.35, treeHi);
      }
    }
    for (let x = 0; x < TILE; x++) {
      const t = heights[x];
      g.fillStyle = top;
      g.fillRect(x, t, 1, 2);
      g.fillStyle = base;
      g.fillRect(x, t + 2, 1, 180 - t - 2);
      if ((x + t) % 2 === 0 && near) {
        g.fillStyle = "#83cc9a";
        g.fillRect(x, t + 40 + ((x * 13) % 7), 1, 1);
      }
    }
    return c;
  }

  /** vw/vh may be larger than the game view (the editor zooms out): the sky stretches, layers repeat. */
  draw(ctx: Ctx, camX: number, camY: number, time: number, vw = this.vw, vh = this.vh) {
    ctx.drawImage(this.sky, 0, 0, vw, vh);
    for (const L of this.layers) {
      const off = camX * L.factor + time * L.drift;
      const x0 = -(((off % TILE) + TILE) % TILE);
      const y = Math.round(L.baseY - camY * L.factor * 0.5);
      const lh = L.canvas.height;
      for (let x = Math.round(x0); x < vw; x += TILE) {
        ctx.drawImage(L.canvas, x, y);
        // Taller views: carry the layer's bottom row down.
        if (this.kind === "sky" && y + lh < vh) ctx.drawImage(L.canvas, 0, lh - 1, TILE, 1, x, y + lh, TILE, vh - y - lh);
      }
    }
  }
}
