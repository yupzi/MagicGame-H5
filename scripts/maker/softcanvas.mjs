// A tiny software 2D canvas: just enough of CanvasRenderingContext2D for the
// game's pre-rendered pictures (terrain, parallax layers, light shafts), so they
// can be baked to PNG in Node with the game's own drawing code.
import { deflateSync } from "node:zlib";

function parseColor(s) {
  s = String(s).trim();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map((v) => parseFloat(v));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  throw new Error("softcanvas: unknown colour " + s);
}

class Ctx2D {
  constructor(canvas) {
    this.canvas = canvas;
    this._fill = [0, 0, 0, 1];
    this._fillStyle = "#000000";
    this.globalAlpha = 1;
    this.globalCompositeOperation = "source-over";
    this.imageSmoothingEnabled = false;
    this._tx = 0; this._ty = 0; this._sx = 1; this._sy = 1;
    this._clip = null;
    this._stack = [];
    this._path = [];
  }
  set fillStyle(v) { this._fillStyle = v; this._fill = parseColor(v); }
  get fillStyle() { return this._fillStyle; }
  save() { this._stack.push([this._tx, this._ty, this._sx, this._sy, this._clip, this.globalAlpha, this.globalCompositeOperation, this._fillStyle]); }
  restore() {
    const s = this._stack.pop();
    if (!s) return;
    [this._tx, this._ty, this._sx, this._sy, this._clip, this.globalAlpha, this.globalCompositeOperation] = s;
    this.fillStyle = s[7];
  }
  translate(x, y) { this._tx += x * this._sx; this._ty += y * this._sy; }
  scale(x, y) { this._sx *= x; this._sy *= y; }
  beginPath() { this._path = []; }
  rect(x, y, w, h) { this._path.push([x, y, w, h]); }
  clip() {
    const r = this._path[this._path.length - 1];
    if (!r) return;
    let x0 = Math.round(this._tx + r[0] * this._sx), y0 = Math.round(this._ty + r[1] * this._sy);
    let x1 = Math.round(this._tx + (r[0] + r[2]) * this._sx), y1 = Math.round(this._ty + (r[1] + r[3]) * this._sy);
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (this._clip) {
      x0 = Math.max(x0, this._clip[0]); y0 = Math.max(y0, this._clip[1]);
      x1 = Math.min(x1, this._clip[2]); y1 = Math.min(y1, this._clip[3]);
    }
    this._clip = [x0, y0, x1, y1];
  }
  _bounds(x, y, w, h) {
    let x0 = Math.round(this._tx + x * this._sx), x1 = Math.round(this._tx + (x + w) * this._sx);
    let y0 = Math.round(this._ty + y * this._sy), y1 = Math.round(this._ty + (y + h) * this._sy);
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    const c = this._clip ?? [0, 0, this.canvas.width, this.canvas.height];
    return [Math.max(x0, c[0], 0), Math.max(y0, c[1], 0), Math.min(x1, c[2], this.canvas.width), Math.min(y1, c[3], this.canvas.height)];
  }
  _blend(i, r, g, b, a) {
    const d = this.canvas.data;
    if (this.globalCompositeOperation === "source-in") {
      const da = d[i + 3] / 255;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.round(a * da * 255);
      return;
    }
    if (a >= 1) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; return; }
    if (a <= 0) return;
    const da = d[i + 3] / 255;
    const oa = a + da * (1 - a);
    d[i] = Math.round((r * a + d[i] * da * (1 - a)) / oa);
    d[i + 1] = Math.round((g * a + d[i + 1] * da * (1 - a)) / oa);
    d[i + 2] = Math.round((b * a + d[i + 2] * da * (1 - a)) / oa);
    d[i + 3] = Math.round(oa * 255);
  }
  fillRect(x, y, w, h) {
    const [x0, y0, x1, y1] = this._bounds(x, y, w, h);
    const [r, g, b, a0] = this._fill;
    const a = a0 * this.globalAlpha;
    const W = this.canvas.width;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this._blend((yy * W + xx) * 4, r, g, b, a);
  }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x, y, w, h) {
    const out = this.createImageData(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const sx = x + xx, sy = y + yy;
      if (sx < 0 || sy < 0 || sx >= this.canvas.width || sy >= this.canvas.height) continue;
      const si = (sy * this.canvas.width + sx) * 4, di = (yy * w + xx) * 4;
      for (let k = 0; k < 4; k++) out.data[di + k] = this.canvas.data[si + k];
    }
    return out;
  }
  putImageData(img, x, y) {
    for (let yy = 0; yy < img.height; yy++) for (let xx = 0; xx < img.width; xx++) {
      const dx = x + xx, dy = y + yy;
      if (dx < 0 || dy < 0 || dx >= this.canvas.width || dy >= this.canvas.height) continue;
      const si = (yy * img.width + xx) * 4, di = (dy * this.canvas.width + dx) * 4;
      for (let k = 0; k < 4; k++) this.canvas.data[di + k] = img.data[si + k];
    }
  }
  drawImage(src, ...a) {
    let sx = 0, sy = 0, sw = src.width, sh = src.height, dx, dy, dw, dh;
    if (a.length === 2) { [dx, dy] = a; dw = sw; dh = sh; }
    else if (a.length === 4) { [dx, dy, dw, dh] = a; }
    else { [sx, sy, sw, sh, dx, dy, dw, dh] = a; }
    const [x0, y0, x1, y1] = this._bounds(dx, dy, dw, dh);
    const ox = this._tx + dx * this._sx, oy = this._ty + dy * this._sy;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const u = Math.floor(sx + ((xx + 0.5 - ox) / (dw * this._sx)) * sw);
      const v = Math.floor(sy + ((yy + 0.5 - oy) / (dh * this._sy)) * sh);
      if (u < 0 || v < 0 || u >= src.width || v >= src.height) continue;
      const si = (v * src.width + u) * 4;
      const sa = src.data[si + 3] / 255;
      if (sa <= 0) continue;
      this._blend((yy * this.canvas.width + xx) * 4, src.data[si], src.data[si + 1], src.data[si + 2], sa * this.globalAlpha);
    }
  }
}

export class SoftCanvas {
  constructor(w = 300, h = 150) { this._w = w; this._h = h; this.data = new Uint8ClampedArray(w * h * 4); this._ctx = null; }
  get width() { return this._w; }
  set width(v) { this._w = v; this.data = new Uint8ClampedArray(this._w * this._h * 4); }
  get height() { return this._h; }
  set height(v) { this._h = v; this.data = new Uint8ClampedArray(this._w * this._h * 4); }
  getContext() { return (this._ctx ??= new Ctx2D(this)); }

  /** Encodes the canvas as a PNG (RGBA, no filtering). */
  toPNG() {
    const w = this._w, h = this._h;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 4 + 1)] = 0;
      Buffer.from(this.data.buffer, this.data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
    }
    const chunk = (type, body) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
      const td = Buffer.concat([Buffer.from(type), body]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
    ]);
  }

  /** A sub-rectangle as a new canvas. */
  crop(x, y, w, h) {
    const c = new SoftCanvas(w, h);
    c.getContext().putImageData(this.getContext().getImageData(x, y, w, h), 0, 0);
    return c;
  }
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Makes `document.createElement("canvas")` hand out soft canvases. */
export function installDom() {
  globalThis.document = { createElement: (tag) => { if (tag !== "canvas") throw new Error("softcanvas: only <canvas>"); return new SoftCanvas(); } };
  globalThis.HTMLCanvasElement = SoftCanvas;
}
