import { ellipse, makeCanvas, type Ctx } from "../engine/gfx";
import { clamp } from "../engine/math";
import type { Backdrop, Curve, MapData, MapKind, MapObj } from "./mapdata";
import { P } from "./palette";
import { decodeRow, encodeRow, isGround, Mat, shapeCovers, TILE, tileMat, tileShape } from "./tiles";

/** What each pixel of the collision mask holds. */
export const enum Px {
  Air = 0,
  Solid = 1,
  Water = 2,
  Ice = 3, // frozen water surface: solid until it melts
}

/** curveY value for columns the hill line doesn't reach. */
export const NO_GROUND = 0x7fff;
/** ceilY value for columns the ceiling line doesn't reach. */
export const NO_CEIL = -1;

/** A wall (gate) that stops bodies until it is opened. */
export interface Barrier {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  closed: boolean;
}

export interface Platform {
  x: number;
  y: number;
  w: number;
  seed: number;
  /** Grown by a spell (ice pillar, vine leaf, mushroom, lily pad): the spell draws it, not as a cloud. */
  spell?: "ice" | "vine" | "mushroom" | "lily";
  /** A one-way plank painted into the terrain (drawn with the terrain). */
  plank?: boolean;
  /** Mushrooms fling whoever lands on them upward. */
  bouncy?: boolean;
  /** Part of a placed bridge (the bridge draws it). */
  bridge?: boolean;
  /** Game time of the last bounce, for the squish animation. */
  bounced?: number;
}

/** One stretch of open water surface; ice[k] is seconds of ice left over column x0 + k. */
export interface Pool {
  x0: number;
  x1: number;
  y: number;
  ice: Float32Array;
}

const ICE_LIFE = 18;
const ICE_DEPTH = 3;
/** How far the depth shading looks for open air (px). */
const DEPTH_CAP = 120;

/**
 * Earth colour bands by depth below the surface (px), shared by the hills and
 * the caves under them so a cave picks up the colours of the ground above it.
 * Deeper down the earth turns cooler.
 */
const EARTH: [number, string][] = [[0, P.dirt], [22, P.dirtDark], [55, P.dirtDeep], [95, P.dirtDeeper], [140, "#9a6a5c"], [190, "#8c6c74"]];

function earth(k: number, x: number, y: number) {
  let i = 0;
  while (i < EARTH.length - 1 && k >= EARTH[i + 1][0]) i++;
  // Checker dither just above the next band.
  if (i < EARTH.length - 1 && k >= EARTH[i + 1][0] - 3 && (x + y) % 2 === 0) return EARTH[i + 1][1];
  return EARTH[i][1];
}

/** How much wider a light shaft gets per px it falls. */
const LIGHT_SPREAD = 0.16;

/** Left and right edge of a light shaft at its widest (its bottom). */
export function lightSpan(o: MapObj, h: number): [number, number] {
  const half = (o.w ?? 24) / 2 + h * LIGHT_SPREAD;
  return [o.x - half, o.x + half];
}

const isEarth = (m: Mat) => m === Mat.Dirt || m === Mat.Grass;

/** Strata seams wander a little instead of running dead level. */
const wobble = (x: number) => Math.round(Math.sin(x * 0.07) * 2 + Math.sin(x * 0.021) * 3);

const LIGHT = "#fff0d0";
const SHADOW = "#2a1a2e";
const mixCache = new Map<string, string>();
/** a blended towards b by t, as hex (cached: terrain painting asks for the same few mixes a lot). */
function mixHex(a: string, b: string, t: number) {
  const key = a + b + t;
  let out = mixCache.get(key);
  if (!out) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    out = "#" + ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, "0")).join("");
    mixCache.set(key, out);
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Cheap deterministic hash so re-rendering a patch of terrain gives the same speckles. */
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The side-view terrain of one map. Tiles are rasterised into a per-pixel
 * collision mask (solid / water / ice) so bodies can walk up slopes pixel by
 * pixel, and into a pre-rendered canvas for drawing.
 */
export class World {
  readonly id: string;
  readonly name: string;
  readonly kind: MapKind;
  readonly bg: Backdrop;
  readonly tw: number;
  readonly th: number;
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  readonly mask: Uint8Array;
  readonly platforms: Platform[] = [];
  readonly barriers: Barrier[] = [];
  pools: Pool[] = [];
  readonly canvas: HTMLCanvasElement;
  private g: Ctx;
  /** Zone names along x (overworld maps): [startX, name], sorted. */
  zones: [number, string][] = [];
  private pillars: MapObj[] = [];
  /** Light shafts falling in through holes in the ground. */
  private lights: MapObj[] = [];
  private lightCache = new Map<string, HTMLCanvasElement>();
  /** Ground height of the rolling hill line per pixel column (null: tiles only). */
  curveY: Int16Array | null = null;
  /** Bottom of the ceiling line per pixel column: earth above it (null: no ceiling line). */
  ceilY: Int16Array | null = null;

  constructor(readonly map: MapData) {
    this.id = map.id;
    this.name = map.name;
    this.kind = map.kind;
    this.bg = map.bg;
    this.tw = map.w;
    this.th = map.h;
    this.w = map.w * TILE;
    this.h = map.h * TILE;
    this.tiles = new Uint8Array(this.tw * this.th);
    for (let ty = 0; ty < this.th; ty++) decodeRow(map.rows[ty] ?? "", this.tw, this.tiles, ty * this.tw);
    this.mask = new Uint8Array(this.w * this.h);
    this.computeCurve();
    this.readObjects();
    this.rasterize(0, 0, this.tw, this.th);
    this.rebuildWater();
    this.rebuildPlanks();
    [this.canvas, this.g] = makeCanvas(this.w, this.h);
    this.renderRegion(0, 0, this.w, this.h);
  }

  private readObjects() {
    this.zones = this.map.objects
      .filter((o) => o.type === "zone")
      .map((o): [number, string] => [o.x, o.name ?? ""])
      .sort((a, b) => a[0] - b[0]);
    this.pillars = this.map.objects.filter((o) => o.type === "pillar");
    this.lights = this.map.objects.filter((o) => o.type === "light");
  }

  // ------------------------------------------------------------- queries

  tileAt(tx: number, ty: number) {
    if (tx < 0 || ty < 0 || tx >= this.tw || ty >= this.th) return 0;
    return this.tiles[ty * this.tw + tx];
  }

  private px(x: number, y: number) {
    return this.mask[y * this.w + x];
  }

  /** Solid terrain (or ice) at a pixel. The map's sides are walls; above and below is open. */
  solid(x: number, y: number) {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || xi >= this.w) return true;
    if (yi < 0 || yi >= this.h) return false;
    const v = this.mask[yi * this.w + xi];
    return v === Px.Solid || v === Px.Ice;
  }

  water(x: number, y: number) {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || xi >= this.w || yi < 0 || yi >= this.h) return false;
    return this.mask[yi * this.w + xi] === Px.Water;
  }

  /** First solid pixel at or below y in column x (Infinity if none within max). */
  groundBelow(x: number, y: number, max = this.h) {
    const xi = clamp(Math.floor(x), 0, this.w - 1);
    let yi = Math.max(0, Math.floor(y));
    const end = Math.min(this.h, yi + max);
    for (; yi < end; yi++) {
      const v = this.mask[yi * this.w + xi];
      if (v === Px.Solid || v === Px.Ice) return yi;
    }
    return Infinity;
  }

  /** First thing (ground, ice or open water) at or below y in column x. */
  surfaceBelow(x: number, y: number, max = this.h): { y: number; water: boolean } | null {
    const xi = clamp(Math.floor(x), 0, this.w - 1);
    let yi = Math.max(0, Math.floor(y));
    const end = Math.min(this.h, yi + max);
    for (; yi < end; yi++) {
      const v = this.mask[yi * this.w + xi];
      if (v !== Px.Air) return { y: yi, water: v === Px.Water };
    }
    return null;
  }

  /** Where something standing near (x, y) would rest: pops up out of the ground, or drops down onto it. */
  restY(x: number, y: number) {
    let yi = Math.floor(y);
    if (this.solid(x, yi)) {
      for (let k = 0; k < 96 && this.solid(x, yi - 1); k++) yi--;
      return yi;
    }
    const g = this.groundBelow(x, yi);
    if (g !== Infinity) return g;
    const s = this.surfaceBelow(x, yi);
    return s ? s.y : y;
  }

  /** The first thing under (x, y) within range is open water: the lake mist won't let you float. */
  overWater(x: number, y: number, range = 220) {
    return !!this.surfaceBelow(x, y, range)?.water;
  }

  /** Sunk below the surface of open water (feet at y). */
  inWater(x: number, y: number) {
    return this.water(x, y - 1);
  }

  /** Water surface right under (or around) a point in water, for splashes. */
  waterTop(x: number, y: number) {
    let yi = Math.floor(y);
    for (let k = 0; k < 80 && this.water(x, yi - 1); k++) yi--;
    return yi;
  }

  /** Any open water within dx of (x, y) at foot level. */
  waterNear(x: number, y: number, dx: number) {
    for (let ox = -dx; ox <= dx; ox += 4) {
      const s = this.surfaceBelow(x + ox, y - 2, 12);
      if (s?.water) return true;
    }
    return false;
  }

  zoneAt(x: number) {
    let name = this.name;
    for (const [zx, n] of this.zones) if (x >= zx) name = n;
    return name;
  }

  addBarrier(x0: number, x1: number, y0: number, y1: number): Barrier {
    const b = { x0, x1, y0, y1, closed: true };
    this.barriers.push(b);
    return b;
  }

  /** A closed gate covers column x somewhere between y0 and y1. */
  blocked(x: number, y0: number, y1 = y0) {
    for (const b of this.barriers) if (b.closed && x >= b.x0 && x <= b.x1 && y1 >= b.y0 && y0 <= b.y1) return true;
    return false;
  }

  // ------------------------------------------------------------- water and ice

  private rebuildWater() {
    const old = this.pools;
    this.pools = [];
    for (let ty = 0; ty < this.th; ty++) {
      let run = -1;
      for (let tx = 0; tx <= this.tw; tx++) {
        const surf = tx < this.tw && tileMat(this.tileAt(tx, ty)) === Mat.Water && tileMat(this.tileAt(tx, ty - 1)) !== Mat.Water;
        if (surf && run < 0) run = tx;
        if (!surf && run >= 0) {
          const x0 = run * TILE, x1 = tx * TILE;
          this.pools.push({ x0, x1, y: ty * TILE, ice: new Float32Array(x1 - x0) });
          run = -1;
        }
      }
    }
    // Keep ice that is still over water after an edit.
    for (const p of old) {
      for (let k = 0; k < p.ice.length; k++) if (p.ice[k] > 0) this.setIce(p.x0 + k, p.y, p.ice[k]);
    }
  }

  private poolAt(x: number, y: number) {
    return this.pools.find((p) => x >= p.x0 && x < p.x1 && p.y === y);
  }

  private setIce(x: number, surfaceY: number, t: number) {
    const p = this.poolAt(x, surfaceY);
    if (!p) return false;
    const k = x - p.x0;
    const fresh = p.ice[k] <= 0;
    p.ice[k] = t;
    for (let d = 0; d < ICE_DEPTH; d++) {
      const i = (surfaceY + d) * this.w + x;
      if (this.mask[i] === Px.Water) this.mask[i] = Px.Ice;
    }
    return fresh;
  }

  /**
   * Freezes open water around x into a walkable ice sheet for a while. Looks for a
   * water surface from a little above y down to `range` below it.
   */
  freezeAt(x: number, y: number, half = 10, range = 60) {
    let fresh = false;
    for (let i = Math.floor(x - half); i <= x + half; i++) {
      const s = this.surfaceBelow(i, y - 6, range + 6);
      if (!s) continue;
      // Already frozen here: top up the timer.
      const sy = s.water ? s.y : this.poolSurfaceAt(i, s.y);
      if (sy === null) continue;
      if (this.setIce(i, sy, ICE_LIFE)) fresh = true;
    }
    return fresh;
  }

  /** If (x, y) is ice sitting on a pool, the pool's surface y. */
  private poolSurfaceAt(x: number, y: number) {
    for (const p of this.pools) if (x >= p.x0 && x < p.x1 && y >= p.y && y < p.y + ICE_DEPTH && p.ice[x - p.x0] > 0) return p.y;
    return null;
  }

  update(dt: number) {
    for (const p of this.pools) {
      for (let k = 0; k < p.ice.length; k++) {
        if (p.ice[k] <= 0) continue;
        p.ice[k] -= dt;
        if (p.ice[k] > 0) continue;
        for (let d = 0; d < ICE_DEPTH; d++) {
          const i = (p.y + d) * this.w + p.x0 + k;
          if (this.mask[i] === Px.Ice) this.mask[i] = Px.Water;
        }
      }
    }
  }

  /** Water and any ice on it; drawn in front of entities. */
  drawWater(ctx: Ctx, time: number, camX: number, camY: number, vw: number, vh: number) {
    const tx0 = Math.max(0, Math.floor(camX / TILE)), tx1 = Math.min(this.tw, Math.ceil((camX + vw) / TILE) + 1);
    const ty0 = Math.max(0, Math.floor(camY / TILE)), ty1 = Math.min(this.th, Math.ceil((camY + vh) / TILE) + 1);
    ctx.globalAlpha = 0.72;
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        if (tileMat(this.tileAt(tx, ty)) !== Mat.Water) continue;
        // Buried under the hill line: nothing to show.
        if (this.curveY && this.curveY[tx * TILE + 4] <= ty * TILE) continue;
        if (this.ceilY && this.ceilY[tx * TILE + 4] > ty * TILE + 4) continue;
        const surface = tileMat(this.tileAt(tx, ty - 1)) !== Mat.Water;
        const deep = tileMat(this.tileAt(tx, ty - 1)) === Mat.Water && tileMat(this.tileAt(tx, ty - 2)) === Mat.Water;
        ctx.fillStyle = deep ? "#4f94d8" : "#6fb8f0";
        ctx.fillRect(tx * TILE, ty * TILE + (surface ? 2 : 0), TILE, surface ? TILE - 2 : TILE);
      }
    }
    ctx.globalAlpha = 1;
    for (const p of this.pools) {
      const x0 = Math.max(p.x0, Math.floor(camX) - 2), x1 = Math.min(p.x1, camX + vw + 2);
      if (x1 <= x0 || p.y < camY - 8 || p.y > camY + vh + 8) continue;
      const top = p.y;
      for (let x = x0; x < x1; x++) {
        const t = p.ice[x - p.x0];
        if (t > 0) {
          if (t < 3 && Math.floor(time * 8 + x * 0.05) % 2 === 0 && (x * 7) % 5 === 0) continue;
          ctx.fillStyle = P.outline; ctx.fillRect(x, top - 1, 1, 1);
          ctx.fillStyle = (x + Math.floor(x / 9)) % 9 === 0 ? P.white : P.iceHi; ctx.fillRect(x, top, 1, 1);
          ctx.fillStyle = P.ice; ctx.fillRect(x, top + 1, 1, 1);
          ctx.fillStyle = P.iceDark; ctx.fillRect(x, top + 2, 1, 1);
          if (t < 3 && (x * 13) % 7 === 0) { ctx.fillStyle = P.iceDark; ctx.fillRect(x, top + 1, 1, 1); }
        } else {
          const wave = Math.sin(x * 0.2 + time * 3) + Math.sin(x * 0.07 - time * 1.7);
          const wy = top + 1 + (wave > 0.6 ? 0 : 1);
          ctx.fillStyle = "#d8f2ff"; ctx.fillRect(x, wy, 1, 1);
          if ((x + Math.floor(time * 12)) % 23 === 0) { ctx.fillStyle = P.white; ctx.fillRect(x, wy + 3, 2, 1); }
        }
      }
    }
  }

  // ------------------------------------------------------------- editing

  /** Paints tiles; call refresh() afterwards with the touched tile rectangle. */
  setTile(tx: number, ty: number, t: number) {
    if (tx < 0 || ty < 0 || tx >= this.tw || ty >= this.th) return false;
    const i = ty * this.tw + tx;
    if (this.tiles[i] === t) return false;
    this.tiles[i] = t;
    return true;
  }

  /** Re-derives collision, water, planks and the picture for a tile rectangle (inclusive-exclusive). */
  refresh(tx0: number, ty0: number, tx1: number, ty1: number) {
    tx0 = clamp(tx0, 0, this.tw); tx1 = clamp(tx1, 0, this.tw);
    ty0 = clamp(ty0, 0, this.th); ty1 = clamp(ty1, 0, this.th);
    if (tx1 <= tx0 || ty1 <= ty0) return;
    this.rasterize(tx0, ty0, tx1, ty1);
    this.rebuildWater();
    this.rebuildPlanks();
    // Depth shading reaches a way into the ground, so repaint a generous margin.
    const m = 64;
    this.renderRegion(tx0 * TILE - m, ty0 * TILE - m, tx1 * TILE + m, ty1 * TILE + m);
  }

  /** Objects changed (zones, decorative pillars, light shafts): redraw what depends on them. */
  refreshObjects() {
    const before = [...this.pillars, ...this.lights];
    this.readObjects();
    for (const p of [...before, ...this.pillars, ...this.lights]) {
      if (p.type === "light") {
        // Moss grows where the light lands.
        const [x0, x1] = lightSpan(p, p.h ?? 120);
        this.renderRegion(x0 - 4, p.y, x1 + 4, p.y + (p.h ?? 120) + 4);
        continue;
      }
      const h = p.h ?? 36;
      this.renderRegion(p.x - 12, p.y - h - 8, p.x + 12, p.y + 4);
    }
  }

  /** Writes the tiles back into the map data (for saving). */
  storeRows() {
    const rows: string[] = [];
    for (let ty = 0; ty < this.th; ty++) rows.push(encodeRow(this.tiles.subarray(ty * this.tw, (ty + 1) * this.tw)));
    this.map.rows = rows;
  }

  // ------------------------------------------------------------- building

  /**
   * The rolling hill line, the way the old hills were made: cosine curves between
   * points, straight steps at cliffs, and small bumps (fading out near the line's
   * ends so neighbouring maps meet at the same height). Columns outside the first
   * and last point hold NO_GROUND.
   */
  private computeCurve() {
    this.curveY = this.computeLine(this.map.curve, NO_GROUND, false);
    this.ceilY = this.computeLine(this.map.ceil, NO_CEIL, true);
  }

  /** One line's height per pixel column; `none` outside its first and last point. Ceilings get rockier bumps. */
  private computeLine(c: Curve | undefined, none: number, rocky: boolean) {
    if (!c || c.pts.length === 0) return null;
    const pts = [...c.pts].sort((a, b) => a[0] - b[0]);
    // The line runs from its first point to its last: no ground outside them.
    const first = pts[0][0], last = pts[pts.length - 1][0];
    const out = new Int16Array(this.w).fill(none);
    let i = 0;
    for (let x = Math.max(0, first); x < Math.min(this.w, last + 1); x++) {
      while (i < pts.length - 1 && x >= pts[i + 1][0]) i++;
      const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
      let base: number, calm: boolean;
      if (a === b) {
        base = a[1];
        calm = true;
      } else {
        const t = (x - a[0]) / Math.max(1, b[0] - a[0]);
        base = b[2]?.includes("c") ? a[1] : a[1] + ((b[1] - a[1]) * (1 - Math.cos(Math.PI * t))) / 2;
        calm = !!a[2]?.includes("f");
      }
      let micro = 0;
      if (c.noise && !calm) {
        const edge = Math.max(0, Math.min(1, (x - first) / 24, (last - x) / 24));
        micro = rocky
          ? (Math.sin(x * 0.11 + 2) * 1.5 + Math.sin(x * 0.031) * 2.5 + Math.sin(x * 0.37) * 0.7) * edge
          : (Math.sin(x * 0.09) * 1.2 + Math.sin(x * 0.023 + 1) * 2) * edge;
      }
      out[x] = Math.round(base + micro);
    }
    return out;
  }

  /** The hill line changed: redo collision and picture for columns x0..x1 (px). */
  refreshCurve(x0: number, x1: number) {
    this.computeCurve();
    const tx0 = clamp(Math.floor(x0 / TILE) - 1, 0, this.tw), tx1 = clamp(Math.ceil(x1 / TILE) + 1, 0, this.tw);
    this.rasterize(tx0, 0, tx1, this.th);
    this.rebuildWater();
    this.rebuildPlanks();
    this.renderRegion(tx0 * TILE - 64, 0, tx1 * TILE + 64, this.h);
  }

  private rasterize(tx0: number, ty0: number, tx1: number, ty1: number) {
    const cy = this.curveY, ce = this.ceilY;
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        const t = this.tiles[ty * this.tw + tx];
        const mat = tileMat(t), shape = tileShape(t);
        for (let py = 0; py < TILE; py++) {
          const y = ty * TILE + py;
          const row = y * this.w + tx * TILE;
          for (let px = 0; px < TILE; px++) {
            const hill = (!!cy && y >= cy[tx * TILE + px]) || (!!ce && y < ce[tx * TILE + px]);
            const covers = mat !== Mat.None && shapeCovers(shape, px, py);
            let v = hill ? Px.Solid : Px.Air;
            if (mat === Mat.Air) {
              if (covers) v = Px.Air;
            } else if (mat === Mat.Water) {
              if (!hill) v = Px.Water;
            } else if (mat !== Mat.None && mat !== Mat.Plank && covers) v = Px.Solid;
            this.mask[row + px] = v;
          }
        }
      }
    }
  }

  /** What a solid pixel is made of: its tile, else grassy hill under an overworld hill line, else earth. */
  private matAt(x: number, y: number): Mat {
    const m = tileMat(this.tiles[Math.floor(y / TILE) * this.tw + Math.floor(x / TILE)]);
    if (isGround(m)) return m;
    const cy = this.curveY;
    return this.kind === "overworld" && cy && cy[x] !== NO_GROUND && y >= cy[x] ? Mat.Grass : Mat.Dirt;
  }

  /** How far below the surface a pixel lies, for the earth bands. */
  private depthAt(x: number, y: number) {
    if (this.map.depth !== undefined) return y + this.map.depth;
    const cy = this.curveY;
    if (this.kind === "overworld" && cy && cy[x] !== NO_GROUND) return Math.max(0, y - cy[x]);
    return y;
  }

  /** Brightness (0..1) of the light shafts at a pixel. */
  private lightAt(x: number, y: number) {
    let best = 0;
    for (const L of this.lights) {
      const h = L.h ?? 120;
      const dy = y - L.y;
      if (dy < 0 || dy > h) continue;
      const half = (L.w ?? 24) / 2 + dy * LIGHT_SPREAD;
      const e = 1 - Math.abs(x - L.x) / half;
      if (e > 0) best = Math.max(best, Math.min(1, e * 1.6) * (1 - dy / h));
    }
    return best;
  }

  private rebuildPlanks() {
    for (let i = this.platforms.length - 1; i >= 0; i--) if (this.platforms[i].plank) this.platforms.splice(i, 1);
    for (let ty = 0; ty < this.th; ty++) {
      let run = -1;
      for (let tx = 0; tx <= this.tw; tx++) {
        const on = tx < this.tw && tileMat(this.tileAt(tx, ty)) === Mat.Plank;
        if (on && run < 0) run = tx;
        if (!on && run >= 0) {
          this.platforms.push({ x: run * TILE, y: ty * TILE, w: (tx - run) * TILE, seed: tx, plank: true });
          run = -1;
        }
      }
    }
  }

  /** Paints the terrain picture for a pixel rectangle. */
  private renderRegion(rx0: number, ry0: number, rx1: number, ry1: number) {
    rx0 = clamp(Math.floor(rx0), 0, this.w); rx1 = clamp(Math.ceil(rx1), 0, this.w);
    ry0 = clamp(Math.floor(ry0), 0, this.h); ry1 = clamp(Math.ceil(ry1), 0, this.h);
    const rw = rx1 - rx0, rh = ry1 - ry0;
    if (rw <= 0 || rh <= 0) return;

    // Distance-to-air over a margin around the region (Chebyshev chamfer), for depth bands.
    const ex0 = Math.max(0, rx0 - DEPTH_CAP), ex1 = Math.min(this.w, rx1 + DEPTH_CAP);
    const ey0 = Math.max(0, ry0 - DEPTH_CAP), ey1 = Math.min(this.h, ry1 + DEPTH_CAP);
    const ew = ex1 - ex0, eh = ey1 - ey0;
    const dist = new Uint8Array(ew * eh);
    const up = new Uint8Array(ew * eh);
    const terrain = (x: number, y: number) => this.px(x, y) === Px.Solid;
    for (let y = 0; y < eh; y++) {
      for (let x = 0; x < ew; x++) {
        const i = y * ew + x;
        if (!terrain(ex0 + x, ey0 + y)) continue;
        let d = DEPTH_CAP;
        if (x > 0) d = Math.min(d, dist[i - 1] + 1);
        if (y > 0) {
          d = Math.min(d, dist[i - ew] + 1);
          if (x > 0) d = Math.min(d, dist[i - ew - 1] + 1);
          if (x < ew - 1) d = Math.min(d, dist[i - ew + 1] + 1);
        }
        dist[i] = d;
        up[i] = y > 0 ? Math.min(255, up[i - ew] + 1) : 40;
      }
    }
    for (let y = eh - 1; y >= 0; y--) {
      for (let x = ew - 1; x >= 0; x--) {
        const i = y * ew + x;
        if (!dist[i]) continue;
        let d = dist[i];
        if (x < ew - 1) d = Math.min(d, dist[i + 1] + 1);
        if (y < eh - 1) {
          d = Math.min(d, dist[i + ew] + 1);
          if (x < ew - 1) d = Math.min(d, dist[i + ew + 1] + 1);
          if (x > 0) d = Math.min(d, dist[i + ew - 1] + 1);
        }
        dist[i] = d;
      }
    }

    const img = this.g.createImageData(rw, rh);
    const data = img.data;
    const cache = new Map<string, [number, number, number]>();
    const put = (x: number, y: number, hex: string) => {
      if (x < rx0 || y < ry0 || x >= rx1 || y >= ry1) return;
      let rgb = cache.get(hex);
      if (!rgb) { rgb = hexToRgb(hex); cache.set(hex, rgb); }
      const i = ((y - ry0) * rw + (x - rx0)) * 4;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    };
    const isAir = (x: number, y: number) => x >= 0 && y >= 0 && x < this.w && y < this.h && !terrain(x, y);

    for (let y = ry0; y < ry1; y++) {
      for (let x = rx0; x < rx1; x++) {
        if (!terrain(x, y)) continue;
        const ei = (y - ey0) * ew + (x - ex0);
        const d = dist[ei];
        const dd = up[ei] - 1; // how far below the open air straight above
        const mat = this.matAt(x, y);
        if (isAir(x - 1, y) || isAir(x + 1, y) || isAir(x, y - 1) || isAir(x, y + 1)) {
          put(x, y, P.outline);
          continue;
        }
        put(x, y, this.shade(mat, x, y, d, dd));
      }
    }

    // Pebbles and strata specks deep in the earth.
    for (let y = ry0; y < ry1; y++) {
      for (let x = rx0; x < rx1; x++) {
        if (hash(x, y) > 0.0045 || !terrain(x, y) || !terrain(x + 2, y + 1)) continue;
        const d = dist[(y - ey0) * ew + (x - ex0)];
        const mat = this.matAt(x, y);
        if (d < 10 || (mat !== Mat.Grass && mat !== Mat.Dirt)) continue;
        let hi = d < 30 ? P.pebble : d < 60 ? P.dirt : P.dirtDark;
        let lo = d < 30 ? P.dirtDark : d < 60 ? P.dirtDeep : P.dirtDeeper;
        if (mat === Mat.Dirt || this.kind === "room") {
          const c = this.earthAt(x, y);
          hi = mixHex(c, LIGHT, 0.35);
          lo = mixHex(c, SHADOW, 0.3);
        }
        if (hash(y, x) < 0.6) {
          put(x, y, hi); put(x + 1, y, hi); put(x, y + 1, lo); put(x + 1, y + 1, lo);
        } else {
          put(x, y, lo); put(x + 1, y, lo); put(x + 2, y, lo);
        }
      }
    }

    this.paintStones(put, rx0, ry0, rx1, ry1);
    this.paintRoots(put, rx0, ry0, rx1, ry1);

    // Grass hanging over the rim where grassy ground drops away.
    for (let x = Math.max(2, rx0 - 3); x < Math.min(this.w - 2, rx1 + 3); x++) {
      for (let y = Math.max(1, ry0 - 8); y < Math.min(this.h - 8, ry1); y++) {
        if (!terrain(x, y) || !isAir(x, y - 1) || this.matAt(x, y) !== Mat.Grass) continue;
        for (const dir of [-1, 1]) {
          if (!isAir(x + dir, y) || !isAir(x + dir, y + 3) || !isAir(x + dir, y + 7)) continue;
          // Strands curling over the edge: longest on the wall face, shorter further out.
          const n = 5 + Math.floor(hash(x, y + 5) * 4);
          const strands: [number, number][] = [[0, n], [dir, n - 2], [dir * 2, Math.floor(n / 3)]];
          for (const [ox, len] of strands) {
            for (let k = 1; k <= len; k++) put(x + ox, y + k, k === len ? P.grassDark : k % 3 === 0 ? P.grassMid : P.grass);
            if (ox !== 0) put(x + ox, y, P.outline);
          }
        }
      }
    }

    // Grass tufts, flowers and (in forests) little mushrooms along grassy tops.
    const flowerCols = [P.white, P.blossom, P.magicYellow, "#b9c8ff"];
    for (let x = rx0; x < rx1; x++) {
      for (let y = Math.max(1, ry0); y < Math.min(this.h, ry1 + 8); y++) {
        if (!terrain(x, y) || terrain(x, y - 1) || this.px(x, y - 1) !== Px.Air) continue;
        if (this.matAt(x, y) !== Mat.Grass) continue;
        // Skip steep spots: both neighbours should be near this height.
        if (!terrain(x - 1, y + 2) || !terrain(x + 1, y + 2) || terrain(x - 1, y - 3) || terrain(x + 1, y - 3)) continue;
        const r = hash(x, y * 3 + 1);
        const forest = this.zoneAt(x).includes("森林");
        if (forest && r > 0.975) {
          const stem = 2 + Math.floor(hash(x, y + 7) * 2);
          for (let k = 1; k <= stem; k++) put(x, y - k, P.cream);
          const cy = y - stem - 1;
          for (let dx = -2; dx <= 2; dx++) put(x + dx, cy, P.outline);
          for (let dx = -1; dx <= 1; dx++) { put(x + dx, cy - 1, "#ff6b7d"); put(x + dx, cy, "#e0485c"); }
          put(x, cy - 2, P.outline); put(x - 2, cy - 1, P.outline); put(x + 2, cy - 1, P.outline);
          put(x - 1, cy - 1, P.white);
        } else if (r < (forest ? 0.3 : 0.18)) {
          const hgt = 1 + Math.floor(hash(x + 5, y) * 3);
          for (let k = 1; k <= hgt; k++) put(x, y - k, k === hgt ? P.grassHi : P.grass);
          put(x, y - hgt - 1, P.outline);
        } else if (r < 0.21) {
          const stem = 3 + Math.floor(hash(x, y + 9) * 3);
          for (let k = 1; k <= stem; k++) put(x, y - k, P.grassDark);
          const fc = flowerCols[Math.floor(hash(x + 3, y + 3) * flowerCols.length)];
          const fy = y - stem - 1;
          put(x, fy, P.magicYellow === fc ? "#ff9f4a" : P.magicYellow);
          put(x - 1, fy, fc); put(x + 1, fy, fc); put(x, fy - 1, fc); put(x, fy + 1, fc);
        }
      }
    }

    // One-way planks: a wooden ledge along the top of each tile.
    for (const p of this.platforms) {
      if (!p.plank || p.x > rx1 || p.x + p.w < rx0 || p.y > ry1 || p.y + 5 < ry0) continue;
      for (let x = p.x; x < p.x + p.w; x++) {
        const end = x === p.x || x === p.x + p.w - 1;
        put(x, p.y, P.outline);
        put(x, p.y + 1, end ? P.outline : P.barkLight);
        put(x, p.y + 2, end ? P.outline : (x - p.x) % 12 === 5 ? P.barkDark : P.bark);
        put(x, p.y + 3, P.outline);
        if ((x - p.x) % 12 === 3 && !end) put(x, p.y + 1, P.barkDark);
      }
    }

    this.g.putImageData(img, rx0, ry0);

    // Broken pillars (decoration).
    this.g.save();
    this.g.beginPath();
    this.g.rect(rx0, ry0, rw, rh);
    this.g.clip();
    for (const p of this.pillars) {
      const h = p.h ?? 36;
      if (p.x + 10 < rx0 || p.x - 10 > rx1 || p.y < ry0 || p.y - h - 6 > ry1) continue;
      this.drawPillar(this.g, p.x, p.y, h, !!p.broken);
    }
    this.g.restore();
  }

  /** Colour of an interior terrain pixel. d: distance to any air; dd: depth under the air straight above. */
  private shade(mat: Mat, x: number, y: number, d: number, dd: number) {
    const checker = (x + y) % 2 === 0;
    switch (mat) {
      case Mat.Grass: {
        const gd = 5 + Math.round(1.4 * Math.sin(x * 0.45) + Math.sin(x * 0.13));
        if (dd <= 2) return (x * 7 + y * 3) % 11 === 0 ? P.grass : P.grassHi;
        if (dd <= gd) return dd === gd ? P.grassMid : P.grass;
        if (dd === gd + 1) return P.grassDark;
        // Under the grass of a cave room: the same carved earth as below the hills.
        if (this.kind === "room") return this.carved(x, y, d, dd, checker);
        // Hills band by depth below the surface, so narrow islands keep level strata.
        return earth(Math.max(dd, 8) - 6, x, y);
      }
      case Mat.Dirt:
        return this.carved(x, y, d, dd, checker);
      case Mat.Soft: {
        // Crumbly blocks: seams on the tile grid, speckled fill.
        const lx = x % TILE, ly = y % TILE;
        if (lx === 0 || ly === 0) return P.dirtDeep;
        if (lx === 1 || ly === 1) return "#f7c995";
        return hash(x, y) < 0.18 ? P.dirtDark : (lx + ly) % 5 === 0 ? P.pebble : "#e8a86c";
      }
      case Mat.Stone: {
        if (dd <= 1) return P.stoneHi;
        const row = Math.floor(y / 6);
        if (y % 6 === 0) return P.stoneDark;
        if ((x + (row % 2) * 5) % 10 === 0) return P.stoneDark;
        if (d > 40) return checker ? P.stoneDeep : P.stoneDark;
        if (d > 14) return checker && d < 18 ? P.stoneDark : "#a4a4c4";
        return (x + y * 3) % 17 === 0 ? P.stoneHi : P.stone;
      }
      default:
        return P.dirt;
    }
  }

  /**
   * Earth carved into a cave: floors catch a little light (moss where a shaft
   * lands), ceilings sit in shadow, walls are a touch darker.
   */
  private carved(x: number, y: number, d: number, dd: number, checker: boolean) {
    const c = this.earthAt(x, y);
    if (dd <= 2) {
      if (this.lights.length && this.lightAt(x, y - 3) > 0.15) return dd <= 1 ? "#b6e07a" : P.moss;
      return mixHex(c, LIGHT, dd <= 1 ? 0.32 : 0.16);
    }
    const dn = this.airBelow(x, y, 4);
    if (dn) return dn === 4 && checker ? c : mixHex(c, SHADOW, dn === 1 ? 0.4 : dn === 2 ? 0.28 : 0.18);
    if (d <= 3) return mixHex(c, SHADOW, d === 2 ? 0.25 : 0.12);
    return c;
  }

  /** Earth band colour of a pixel, by its depth below the surface. */
  private earthAt(x: number, y: number) {
    return earth(this.depthAt(x, y) - 6 + wobble(x), x, y);
  }

  /** 1..max: how many px of earth lie between (x, y) and the open air under it, counting the outline; 0: none that close. */
  private airBelow(x: number, y: number, max: number) {
    for (let k = 1; k <= max; k++) {
      const yy = y + k + 1;
      if (yy >= this.h) return 0;
      if (this.px(x, yy) === Px.Air) return k;
    }
    return 0;
  }

  /** Every pixel of a box is earth (no air, no other material). */
  private allEarth(x0: number, y0: number, x1: number, y1: number) {
    if (x0 < 0 || y0 < 0 || x1 >= this.w || y1 >= this.h) return false;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.px(x, y) !== Px.Solid || !isEarth(this.matAt(x, y))) return false;
    return true;
  }

  /**
   * Stones set in the earth: more and bigger further down, cooler in colour. One
   * chance per cell of a jittered grid, so they spread out evenly instead of clumping.
   */
  private paintStones(put: (x: number, y: number, c: string) => void, rx0: number, ry0: number, rx1: number, ry1: number) {
    const SW = 26, SH = 20;
    for (let cy = Math.floor((ry0 - 10) / SH); cy <= Math.floor((ry1 + 10) / SH); cy++) {
      for (let cx = Math.floor((rx0 - 12) / SW); cx <= Math.floor((rx1 + 12) / SW); cx++) {
        const sx = cx * SW + 5 + Math.floor(hash(cx, cy * 7 + 1) * (SW - 10));
        const sy = cy * SH + 4 + Math.floor(hash(cy, cx * 5 + 2) * (SH - 8));
        if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) continue;
        const depth = this.depthAt(sx, sy);
        if (hash(cx * 3 + 11, cy) > clamp((depth - 30) / 220, 0, 0.45)) continue;
        const size = hash(cx, cy + 99);
        const rx = clamp(Math.floor(2 + depth / 75 + (size - 0.5) * 2.4), 2, 6);
        const ry = Math.max(2, Math.round(rx * 0.75));
        if (!this.allEarth(sx - rx - 3, sy - ry - 3, sx + rx + 3, sy + ry + 3)) continue;
        // Chunky rounded blobs (a squarish ellipse), outlined, lit from the top left.
        const inside = (dx: number, dy: number) => Math.abs(dx / (rx + 0.5)) ** 2.6 + Math.abs(dy / (ry + 0.5)) ** 2.6 <= 1;
        const deep = depth > 150;
        const warm = hash(cy, cx + 31) < 0.5;
        const body = deep ? (warm ? "#a098b4" : "#948caa") : warm ? "#b4acc4" : "#a8a0bc";
        const hi = mixHex(body, "#ffffff", 0.35), low = mixHex(body, SHADOW, 0.18), rim = "#4f3d57";
        for (let dy = -ry; dy <= ry; dy++) {
          for (let dx = -rx; dx <= rx; dx++) {
            if (!inside(dx, dy)) continue;
            let c = body;
            if (!inside(dx - 1, dy) || !inside(dx + 1, dy) || !inside(dx, dy - 1) || !inside(dx, dy + 1)) c = rim;
            else if (!inside(dx, dy - 2) && dx < rx / 3) c = hi;
            else if (!inside(dx, dy + 2)) c = low;
            put(sx + dx, sy + dy, c);
          }
        }
        // A soft shadow under it.
        for (let dx = -rx + 1; dx <= rx - 1; dx++) if (!inside(dx, ry + 1) && inside(dx, ry)) put(sx + dx, sy + ry + 1, mixHex(this.earthAt(sx + dx, sy + ry + 1), SHADOW, 0.25));
      }
    }
  }

  /** Roots near the surface: hanging from earthen ceilings, and (in rooms) threading down through the top of the earth. */
  private paintRoots(put: (x: number, y: number, c: string) => void, rx0: number, ry0: number, rx1: number, ry1: number) {
    const solidAt = (x: number, y: number) => x >= 0 && y >= 0 && x < this.w && y < this.h && this.px(x, y) === Px.Solid;
    for (let x = Math.max(2, rx0); x < Math.min(this.w - 2, rx1); x++) {
      if (hash(x, 4242) > 0.045) continue;
      for (let y = Math.max(1, ry0 - 24); y < Math.min(this.h - 1, ry1); y++) {
        if (!solidAt(x, y) || this.px(x, y + 1) !== Px.Air) continue;
        if (!solidAt(x - 2, y) || !solidAt(x + 2, y)) continue; // ceilings only, not walls
        const depth = this.depthAt(x, y);
        if (!isEarth(this.matAt(x, y)) || depth > 120) continue;
        const len = 4 + Math.floor(hash(x, y) * (depth < 60 ? 16 : 9));
        let rx = x;
        for (let k = 1; k <= len; k++) {
          if (solidAt(rx, y + k)) break;
          put(rx, y + k, k === len ? P.barkLight : P.barkDark);
          if (k % 3 === 0 && hash(x + k, y) < 0.5) rx += hash(k, x) < 0.5 ? -1 : 1;
        }
      }
    }
    if (this.kind !== "room") return;
    for (let x = Math.max(0, rx0 - 4); x < Math.min(this.w, rx1 + 4); x++) {
      if (hash(x, 777) > 0.02) continue;
      const start = 8 + Math.floor(hash(x, 778) * 28) - (this.map.depth ?? 0);
      const len = 20 + Math.floor(hash(x, 779) * 35);
      let rx = x;
      for (let k = 0; k < len; k++) {
        const y = start + k;
        if (y < 0) continue;
        if (!solidAt(rx, y + 3)) break;
        if (solidAt(rx - 2, y) && solidAt(rx + 2, y) && solidAt(rx, y - 2) && isEarth(this.matAt(rx, y))) put(rx, y, mixHex(this.earthAt(rx, y), P.bark, 0.45));
        if (k % 4 === 0) rx += hash(x, k) < 0.5 ? -1 : 1;
      }
    }
  }

  /** Light shafts, drawn over the backdrop and behind the terrain, with dust drifting in them. */
  drawLights(ctx: Ctx, time: number, camX: number, camY: number, vw: number, vh: number) {
    for (const L of this.lights) {
      const w = L.w ?? 24, h = L.h ?? 120;
      const [x0, x1] = lightSpan(L, h);
      if (x1 < camX || x0 > camX + vw || L.y > camY + vh || L.y + h < camY) continue;
      const c = this.lightCanvas(w, h);
      ctx.drawImage(c, Math.round(L.x - c.width / 2), L.y);
      const motes = Math.round(h / 12);
      for (let i = 0; i < motes; i++) {
        const t = (hash(i, L.x) + time * (0.03 + hash(L.x, i) * 0.04)) % 1;
        const dy = t * h;
        const half = w / 2 + dy * LIGHT_SPREAD;
        const mx = L.x + (hash(i * 3, L.y) * 2 - 1) * half * 0.8 + Math.sin(time * 0.9 + i * 1.7) * 2;
        ctx.globalAlpha = Math.min(1, t * 6, (1 - t) * 3) * 0.9;
        ctx.fillStyle = "#fff4d0";
        ctx.fillRect(Math.round(mx), Math.round(L.y + dy), 1, 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  /** A shaft's soft cone: brightest down the middle and at the top, in dithered steps. */
  private lightCanvas(w: number, h: number) {
    const key = `${w},${h}`;
    let c = this.lightCache.get(key);
    if (c) return c;
    const half = Math.ceil(w / 2 + h * LIGHT_SPREAD) + 1;
    const ch = Math.max(1, Math.round(h));
    const [canvas, g] = makeCanvas(half * 2, ch);
    const img = g.createImageData(half * 2, ch);
    for (let y = 0; y < ch; y++) {
      const hw = w / 2 + y * LIGHT_SPREAD;
      for (let x = 0; x < half * 2; x++) {
        const e = 1 - Math.abs(x + 0.5 - half) / hw;
        if (e <= 0) continue;
        const l = Math.min(1, e * 1.3) * (1 - y / ch) * Math.min(1, (y + 2) / 14);
        const steps = 6;
        let q = Math.floor(l * steps) / steps;
        const f = (l * steps) % 1;
        // Ordered dither between steps.
        if (f > [0.125, 0.625, 0.875, 0.375][(x % 2) + (y % 2) * 2]) q += 1 / steps;
        if (q <= 0) continue;
        const i = (y * half * 2 + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 240; img.data[i + 2] = 200; img.data[i + 3] = Math.round(q * 0.28 * 255);
      }
    }
    g.putImageData(img, 0, 0);
    c = canvas;
    this.lightCache.set(key, c);
    return c;
  }

  private drawPillar(g: Ctx, x: number, ground: number, h: number, broken: boolean) {
    const top = ground - h;
    g.fillStyle = P.outline;
    g.fillRect(x - 6, top - 1, 12, h + 1);
    g.fillRect(x - 8, ground - 4, 16, 4);
    if (!broken) g.fillRect(x - 8, top - 4, 16, 4);
    g.fillStyle = P.stone;
    g.fillRect(x - 5, top, 10, h);
    g.fillStyle = P.stoneHi;
    g.fillRect(x - 5, top, 2, h);
    g.fillStyle = P.stoneDark;
    for (let i = 0; i < 3; i++) g.fillRect(x - 1 + i * 2, top + 2, 1, h - 4);
    g.fillRect(x + 3, top, 2, h);
    g.fillStyle = P.stone;
    g.fillRect(x - 7, ground - 3, 14, 2);
    if (!broken) g.fillRect(x - 7, top - 3, 14, 2);
    else {
      // Jagged top and a little moss.
      g.fillStyle = P.outline;
      g.fillRect(x - 2, top - 3, 3, 3);
      g.fillStyle = P.stone;
      g.fillRect(x - 1, top - 2, 1, 2);
    }
    g.fillStyle = P.moss;
    g.fillRect(x - 5, top, 4, 1);
    g.fillRect(x + 2, ground - 5, 3, 1);
  }

  draw(ctx: Ctx, camX: number, camY: number, vw: number, vh: number) {
    const sx = Math.max(0, Math.floor(camX));
    const sy = Math.max(0, Math.floor(camY));
    const w = Math.min(vw + 2, this.w - sx);
    const h = Math.min(vh + 2, this.h - sy);
    if (w > 0 && h > 0) ctx.drawImage(this.canvas, sx, sy, w, h, sx, sy, w, h);
  }

  drawPlatforms(ctx: Ctx, time: number) {
    for (const p of this.platforms) {
      if (p.spell || p.plank || p.bridge) continue;
      const bob = Math.round(Math.sin(time * 1.5 + p.seed) * 0.6);
      const cx = p.x + p.w / 2;
      const y = p.y + bob;
      const n = Math.max(3, Math.round(p.w / 12));
      // Outline pass, then fill pass, so the puffs merge into one cloud.
      for (let pass = 0; pass < 2; pass++) {
        const grow = pass === 0 ? 1 : 0;
        const col = pass === 0 ? P.outline : P.cloudShade;
        ellipse(ctx, cx, y + 5, p.w / 2 + grow, 5 + grow, col);
        for (let i = 0; i < n; i++) {
          const px = p.x + 5 + (i * (p.w - 10)) / (n - 1);
          const r = 5 + ((i * 37 + p.seed) % 3);
          ellipse(ctx, px, y + 3, r + grow, r - 1 + grow, col);
        }
      }
      for (let i = 0; i < n; i++) {
        const px = p.x + 5 + (i * (p.w - 10)) / (n - 1);
        const r = 5 + ((i * 37 + p.seed) % 3);
        ellipse(ctx, px, y + 2, r - 1, r - 2, P.cloud);
      }
      ellipse(ctx, cx - p.w / 5, y, 3, 1.5, P.white);
    }
  }
}

/** A lonely cloud puff, used by the parallax background too. */
export function cloudPuff(ctx: Ctx, x: number, y: number, s: number, fill: string, shade: string, outline: string | null) {
  const parts = [[-s * 1.1, 0, s * 0.8], [0, -s * 0.35, s], [s * 1.0, 0, s * 0.75], [s * 0.4, s * 0.25, s * 0.8]];
  if (outline) for (const [ox, oy, r] of parts) ellipse(ctx, x + ox, y + oy, r + 1, r * 0.75 + 1, outline);
  for (const [ox, oy, r] of parts) ellipse(ctx, x + ox, y + oy + 1, r, r * 0.75, shade);
  for (const [ox, oy, r] of parts) ellipse(ctx, x + ox, y + oy - 1, r * 0.9, r * 0.65, fill);
}
