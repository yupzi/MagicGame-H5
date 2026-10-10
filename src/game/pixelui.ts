import fontUrl from "../assets/fonts/fusion-pixel-12px-zh_hans.woff2";
import type { Look } from "./people";

/**
 * Pixel-art pieces for the speech bubbles: frames, tails, arrows and the
 * Chinese pixel font. Everything is drawn from little ASCII maps at one pixel
 * per world pixel and scaled up with the canvas, so the bubbles have exactly
 * the same chunky pixels as the game.
 *
 * Frames are 9-slices, but we cut and tile them ourselves (`fitFrame`) into
 * one image the exact size of the box, then scale that by a whole number. The
 * browser's own border-image blends pixels across the slice seams when it
 * scales, which leaves faint lines at the corners.
 *
 * Font: Fusion Pixel Font 12px (SIL Open Font License, see
 * src/assets/fonts/fusion-pixel-OFL.txt).
 */

const OUTLINE = "#3b2a4a";

/** ASCII art → canvas. Letters look up `colors`; anything else is see-through. */
function artCanvas(rows: string[], colors: Record<string, string>) {
  const c = document.createElement("canvas");
  c.width = rows[0].length;
  c.height = rows.length;
  const ctx = c.getContext("2d")!;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const col = colors[ch];
    if (!col) return;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  }));
  return c;
}

/** ASCII art → CSS url() for a sprite. */
function art(rows: string[], colors: Record<string, string>) {
  return `url(${artCanvas(rows, colors).toDataURL()})`;
}

/** The same art flipped left-right. */
function mirror(rows: string[]) {
  return rows.map((r) => [...r].reverse().join(""));
}

// ---------------------------------------------------------------- frames

interface FrameDef {
  rows: string[];
  colors: Record<string, string>;
  /** Corner sizes: top, right, bottom, left. The middle part repeats. */
  slice: [number, number, number, number];
}

/** Said out loud: cream, a white highlight top-left, a warm shade and a pink drop shadow. */
const SAY_COLORS = { O: OUTLINE, H: "#ffffff", C: "#fff6e8", S: "#f3dcc4", P: "#b0467a" };
const SAY: FrameDef = {
  rows: [
    "..OOOOO..",
    ".OHHHHHO.",
    "OHCCCCCSO",
    "OHCCCCCSO",
    "OHCCCCCSO",
    "OCCCCCCSO",
    "OCCCCCCSO",
    ".OSSSSSO.",
    "..OOOOO..",
    "..PPPPP..",
  ],
  colors: SAY_COLORS,
  slice: [4, 4, 5, 4],
};
/** The tail: its top two rows open up the frame's shade and outline where it joins. */
const SAY_TAIL = ["SCCCS", "OCCCO", ".OCCO", ".OCO.", "..OO.", "...P."];

/** Thought: lavender with a dotted outline, trailing little dots instead of a tail. */
const THINK_COLORS = { O: OUTLINE, L: "#f1ecfb" };
const THINK: FrameDef = {
  rows: [
    "..O.OO..",
    ".OLLLLO.",
    "OLLLLLLO",
    "OLLLLLLO",
    ".LLLLLL.",
    "OLLLLLLO",
    ".OLLLLO.",
    "..O.OO..",
  ],
  colors: THINK_COLORS,
  slice: [3, 3, 3, 3],
};
const THINK_TAIL = [
  "..OOO.",
  ".OLLLO",
  ".OLLLO",
  "..OOO.",
  "......",
  ".OO...",
  "OLLO..",
  ".OO...",
];

/** Muttering: small and quiet, white with a thin soft shadow. */
const BARK_COLORS = { O: OUTLINE, W: "#ffffff", s: "rgba(59,42,74,0.35)" };
const BARK: FrameDef = {
  rows: [".OOO.", "OWWWO", "OWWWO", "OWWWO", ".OOO.", ".sss."],
  colors: BARK_COLORS,
  slice: [2, 2, 3, 2],
};
const BARK_TAIL = ["WWW", "OWO", ".OO", ".O."];

/** Narration: a night-purple band with dithered edges. */
function captionRows() {
  const rows: string[] = [];
  for (let y = 0; y < 6; y++) {
    let r = "";
    for (let x = 0; x < 6; x++) {
      const edge = x === 0 || x === 5 || y === 0 || y === 5;
      const rim = x === 1 || x === 4 || y === 1 || y === 4;
      r += edge ? ((x + y) % 2 === 0 ? "D" : ".") : rim ? "R" : "D";
    }
    rows.push(r);
  }
  return rows;
}
const CAPTION: FrameDef = { rows: captionRows(), colors: { D: "rgba(28,20,50,0.9)", R: "#4a3a78" }, slice: [2, 2, 2, 2] };

/** A picked choice: a yellow pill. */
const PILL: FrameDef = {
  rows: [".OOO.", "OYYYO", "OYYYO", "OyyyO", ".OOO."],
  colors: { O: OUTLINE, Y: "#ffe478", y: "#f5c94a" },
  slice: [2, 2, 2, 2],
};

/** A name tag in the speaker's own colours. */
function tagFrame(look: Look | null): FrameDef {
  const main = look?.dress ?? "#5a4fb8", shade = look?.dressShade ?? "#433a95";
  return {
    rows: [".OOO.", "OHHHO", "OMMMO", "OSSSO", ".OOO."],
    colors: { O: OUTLINE, H: lighten(main), M: main, S: shade },
    slice: [2, 2, 2, 2],
  };
}

function lighten(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * 0.35);
  return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

export const FRAMES = { say: SAY, think: THINK, bark: BARK, caption: CAPTION, pill: PILL };
export type FrameName = keyof typeof FRAMES | "tag";

const sources = new Map<FrameDef, HTMLCanvasElement>();
const frameCache = new Map<string, string>();

/**
 * The frame cut into its nine pieces and laid out at exactly w×h pixels:
 * corners copied, edges and middle tiled from the corner outwards (so dotted
 * and dithered edges keep their rhythm).
 */
function frameUrl(def: FrameDef, key: string, w: number, h: number) {
  const k = `${key}:${w}x${h}`;
  const hit = frameCache.get(k);
  if (hit) return hit;
  let src = sources.get(def);
  if (!src) sources.set(def, (src = artCanvas(def.rows, def.colors)));
  const [t, r, b, l] = def.slice;
  const mw = src.width - l - r, mh = src.height - t - b;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  // Copies a piece of the source, tiling it to fill the target area.
  const tile = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
    for (let y = 0; y < dh; y += sh) {
      for (let x = 0; x < dw; x += sw) {
        const cw = Math.min(sw, dw - x), ch = Math.min(sh, dh - y);
        ctx.drawImage(src!, sx, sy, cw, ch, dx + x, dy + y, cw, ch);
      }
    }
  };
  const iw = Math.max(0, w - l - r), ih = Math.max(0, h - t - b);
  tile(0, 0, l, t, 0, 0, l, t);
  tile(l + mw, 0, r, t, w - r, 0, r, t);
  tile(0, t + mh, l, b, 0, h - b, l, b);
  tile(l + mw, t + mh, r, b, w - r, h - b, r, b);
  tile(l, 0, mw, t, l, 0, iw, t);
  tile(l, t + mh, mw, b, l, h - b, iw, b);
  tile(0, t, l, mh, 0, t, l, ih);
  tile(l + mw, t, r, mh, w - r, t, r, ih);
  tile(l, t, mw, mh, l, t, iw, ih);
  const url = `url(${out.toDataURL()})`;
  frameCache.set(k, url);
  return url;
}

/**
 * Rounds an element up to whole game pixels (`px` screen pixels each) and
 * gives it a frame drawn at exactly that size. `width` fixes the width
 * instead of measuring it. Returns the size in screen pixels.
 */
export function fitFrame(el: HTMLElement, name: FrameName, px: number, look: Look | null = null, width?: number) {
  el.style.width = width ? `${width}px` : "";
  el.style.height = "";
  const def = name === "tag" ? tagFrame(look) : FRAMES[name];
  const [t, r, b, l] = def.slice;
  const w = Math.max(l + r + 1, Math.ceil(el.offsetWidth / px));
  const h = Math.max(t + b + 1, Math.ceil(el.offsetHeight / px));
  el.style.width = `${w * px}px`;
  el.style.height = `${h * px}px`;
  const key = name === "tag" ? `tag${def.colors.M}${def.colors.S}` : name;
  const url = frameUrl(def, key, w, h);
  if (name === "pill") el.style.setProperty("--pill", url);
  else el.style.backgroundImage = url;
  return { w: w * px, h: h * px };
}

/** Bumped when the pixel font arrives, so bubbles measure themselves again. */
export let fontVersion = 0;

let installed = false;
/** Builds the sprites, adds their CSS and starts loading the pixel font. Safe to call twice. */
export function installPixelUi() {
  if (installed) return;
  installed = true;
  const style = document.createElement("style");
  style.textContent = `
    .bb-tail { background-image: ${art(SAY_TAIL, SAY_COLORS)}; }
    .bb.flip .bb-tail { background-image: ${art(mirror(SAY_TAIL), SAY_COLORS)}; }
    .bb.thought .bb-tail { background-image: ${art(THINK_TAIL, THINK_COLORS)}; }
    .bb.thought.flip .bb-tail { background-image: ${art(mirror(THINK_TAIL), THINK_COLORS)}; }
    .bb.bark:not(.thought) .bb-tail { background-image: ${art(BARK_TAIL, BARK_COLORS)}; }
    .bb.bark.flip:not(.thought) .bb-tail { background-image: ${art(mirror(BARK_TAIL), BARK_COLORS)}; }
    #caption::before, #caption::after { background-image: ${art(["..Y..", "..Y..", "YYWYY", "..Y..", "..Y.."], { Y: "#ffe478", W: "#ffffff" })}; }
    .bb-opt.on::before { background-image: ${art(["OO...", "OPO..", "OPPO.", "OPPPO", "OPPO.", "OPO..", "OO..."], { O: OUTLINE, P: "#ff7ab0" })}; }
    .bb-next { background-image: ${art(["OOOOOOO", "OPPPPPO", ".OPPPO.", "..OPO..", "...O..."], { O: OUTLINE, P: "#ff7ab0" })}; }
    #caption .bb-next { background-image: ${art(["OOOOOOO", "OPPPPPO", ".OPPPO.", "..OPO..", "...O..."], { O: "#120c22", P: "#ffe478" })}; }
  `;
  document.head.appendChild(style);
  const face = new FontFace("FusionPixel", `url(${fontUrl})`);
  face.load().then((f) => {
    document.fonts.add(f);
    fontVersion++;
  }).catch((e) => console.warn("像素字体加载失败，先用系统字体", e));
}
