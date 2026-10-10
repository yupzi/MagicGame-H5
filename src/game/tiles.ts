/**
 * Terrain is painted on an 8px tile grid. Each tile byte is (material << 4) | shape.
 * Shapes describe how much of the tile is filled: floors fill up from the bottom,
 * ceilings hang down from the top, with heights at the left and right edge in
 * half-tile steps (0, 4 or 8 px). That gives flat tops, half blocks, 45° and
 * 22.5° slopes, all of which the physics walks up smoothly.
 */
export const TILE = 8;

export const enum Mat {
  None = 0,
  Grass = 1, // earth with a grassy top: the hills
  Dirt = 2, // bare earth: burrows and tunnels
  Stone = 3, // rock: ruins and caves
  Soft = 4, // crumbly earth that magic can break
  Water = 5, // not solid: you sink (and lose half a heart)
  Plank = 6, // one-way ledge: jump up through it, stand on top
  Air = 7, // carves holes out of a map's rolling hill line
}

export const MATERIALS: { id: Mat; name: string; key: string }[] = [
  { id: Mat.Grass, name: "草地", key: "1" },
  { id: Mat.Dirt, name: "泥土", key: "2" },
  { id: Mat.Stone, name: "岩石", key: "3" },
  { id: Mat.Soft, name: "软土（可打碎）", key: "4" },
  { id: Mat.Water, name: "水", key: "5" },
  { id: Mat.Plank, name: "单向平台", key: "6" },
  { id: Mat.Air, name: "挖空（起伏线）", key: "7" },
];

/** Materials whose tiles are solid ground. */
export const isGround = (m: Mat) => m === Mat.Grass || m === Mat.Dirt || m === Mat.Stone || m === Mat.Soft;

export interface Shape {
  /** Filled from the top (ceiling piece) instead of from the bottom. */
  ceil: boolean;
  /** Filled height at the left and right edge, in px (0, 4 or 8). */
  l: number;
  r: number;
  name: string;
}

/** Index 0 is unused (a tile byte of 0 is empty). */
export const SHAPES: Shape[] = [
  { ceil: false, l: 0, r: 0, name: "" },
  { ceil: false, l: 8, r: 8, name: "实心" },
  { ceil: false, l: 4, r: 4, name: "半块" },
  { ceil: false, l: 0, r: 8, name: "45° 上坡" },
  { ceil: false, l: 8, r: 0, name: "45° 下坡" },
  { ceil: false, l: 0, r: 4, name: "缓坡 ↗ 低" },
  { ceil: false, l: 4, r: 8, name: "缓坡 ↗ 高" },
  { ceil: false, l: 8, r: 4, name: "缓坡 ↘ 高" },
  { ceil: false, l: 4, r: 0, name: "缓坡 ↘ 低" },
  { ceil: true, l: 4, r: 4, name: "顶·半块" },
  { ceil: true, l: 0, r: 8, name: "顶·45°" },
  { ceil: true, l: 8, r: 0, name: "顶·45° 反" },
  { ceil: true, l: 0, r: 4, name: "顶·缓坡 低" },
  { ceil: true, l: 4, r: 8, name: "顶·缓坡 高" },
  { ceil: true, l: 8, r: 4, name: "顶·缓坡 反高" },
  { ceil: true, l: 4, r: 0, name: "顶·缓坡 反低" },
];

export const FULL = 1;

export const tileMat = (t: number): Mat => t >> 4;
export const tileShape = (t: number) => t & 15;
export const makeTile = (mat: Mat, shape: number) => (mat === Mat.None ? 0 : (mat << 4) | (shape || FULL));

/** Water and planks only come as full tiles. */
export function normalizeTile(mat: Mat, shape: number) {
  if (mat === Mat.Water || mat === Mat.Plank) return makeTile(mat, FULL);
  return makeTile(mat, shape);
}

/** Whether pixel (px, py) inside a tile (0..7) is filled for the given shape. */
export function shapeCovers(shape: number, px: number, py: number) {
  const s = SHAPES[shape];
  if (!s) return false;
  // Height of the fill at this pixel column, sampled at the pixel centre.
  const t = (px + 0.5) / TILE;
  const h = s.l + (s.r - s.l) * t;
  const fill = Math.round(h);
  return s.ceil ? py < fill : py >= TILE - fill;
}

// ---------------------------------------------------------------- row encoding

/** Run-length encodes one row of tiles as "hex*count" tokens: compact and diff-friendly. */
export function encodeRow(row: ArrayLike<number>) {
  const out: string[] = [];
  let i = 0;
  while (i < row.length) {
    const v = row[i];
    let n = 1;
    while (i + n < row.length && row[i + n] === v) n++;
    const hex = v.toString(16).padStart(2, "0");
    out.push(n === 1 ? hex : `${hex}*${n}`);
    i += n;
  }
  return out.join(" ");
}

export function decodeRow(s: string, w: number, into: Uint8Array, offset: number) {
  let x = 0;
  for (const tok of s.split(" ")) {
    if (!tok) continue;
    const [hex, count] = tok.split("*");
    const v = parseInt(hex, 16) & 255;
    const n = count ? parseInt(count, 10) : 1;
    for (let k = 0; k < n && x < w; k++) into[offset + x++] = v;
  }
}
