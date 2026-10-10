// Tiny 3x5 bitmap font for in-canvas numbers and labels.
import type { Ctx } from "./gfx";

const G: Record<string, string> = {
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
  "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001010010010",
  "8": "111101111101111", "9": "111101111001111",
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
  E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
  I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
  Q: "010101101110011", R: "110101110101101", S: "011100010001110", T: "111010010010010",
  U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111",
  "+": "000010111010000", "-": "000000111000000", x: "000101010101000", "!": "010010010000010",
  ":": "000010000010000", ".": "000000000000010", "/": "001001010100100", "?": "110001010000010",
  " ": "000000000000000", ">": "100010001010100", "<": "001010100010001", "_": "000000000000111",
};

export function textWidth(s: string, scale = 1) {
  return s.length ? (s.length * 4 - 1) * scale : 0;
}

function glyphs(ctx: Ctx, s: string, x: number, y: number, color: string, scale: number) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  y = Math.round(y);
  for (const ch of s) {
    const bits = G[ch] ?? G[ch.toUpperCase()];
    if (bits) {
      for (let i = 0; i < 15; i++) {
        if (bits[i] === "1") ctx.fillRect(cx + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale);
      }
    }
    cx += 4 * scale;
  }
}

const OUTLINE_OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

/** Text with a 1px outline so it reads on any background. */
export function drawText(ctx: Ctx, s: string, x: number, y: number, color: string, outline = "#3b2a4a", scale = 1) {
  if (outline) {
    for (const [ox, oy] of OUTLINE_OFFSETS) glyphs(ctx, s, x + ox, y + oy, outline, scale);
  }
  glyphs(ctx, s, x, y, color, scale);
}
