import { px, rect, type Ctx } from "../engine/gfx";
import type { Game } from "./game";
import { LOOKS, Npc, type Expr, type Look } from "./people";
import { P } from "./palette";
import { fitFrame, fontVersion, installPixelUi } from "./pixelui";

/**
 * Speech bubbles that float over people's heads in the world. They are DOM
 * elements (so they can use a Chinese pixel font), drawn with pixel-art frames
 * (pixelui.ts) and re-placed every frame from world coordinates onto the
 * game's pixel grid.
 */

/** Who a line floats over: someone on the map, the witch, or nobody in view. */
export type Anchor = Npc | "player" | null;

/** A line being said right now, for mouths, faces and the little emote icons. */
export interface Speech {
  anchor: Anchor;
  expr: Expr;
  /** Text still typing out: the mouth moves. */
  typing: boolean;
  /** Seconds since the line began. */
  t: number;
}

/** The witch's own name in the script. */
export const PLAYER_NAME = LOOKS.ariri?.name ?? "阿梨梨";

/** A line wrapped in brackets — 阿梨梨: （要打招呼……） — is a thought, not said out loud. */
export function splitThought(text: string) {
  const m = text.match(/^\s*[（(]([\s\S]*)[）)]\s*$/);
  return m ? { thought: true, text: m[1] } : { thought: false, text };
}

/**
 * The speaker called `who` in the script: the witch, or the person with that
 * name on this map (the one being talked to first, then whoever is closest).
 */
export function findAnchor(game: Game, who: string | null, prefer?: Npc | null): Anchor {
  if (!who) return null;
  if (who === PLAYER_NAME) return "player";
  if (prefer && prefer.look.name === who) return prefer;
  const p = game.player;
  let best: Npc | null = null;
  for (const n of game.npcs) {
    if (n.look.name !== who) continue;
    if (!best || Math.abs(n.x - p.x) < Math.abs(best.x - p.x)) best = n;
  }
  return best;
}

/** How far each kind of hat sticks up above the head. */
const HAT_HEIGHT: Record<string, number> = { witch: 7, tall: 9, straw: 1, helmet: 1 };

/** How far above the feet a bubble's tail points for someone with this look. */
export function headHeight(look: Look) {
  return 26 + look.tall + (HAT_HEIGHT[look.hat] ?? 0);
}

/** World position just above the speaker's hat, where the bubble's tail points. */
export function headOf(game: Game, a: Anchor) {
  if (!a) return null;
  if (a === "player") return { x: game.player.x, y: game.player.y - 31 - game.stagecraft.playerHop };
  return { x: a.x, y: a.y - a.hop - headHeight(a.look) };
}

/** Where each kind of tail's tip ends up, in game pixels below the bubble's bottom edge. */
const TAIL_DROP = { say: 3, thought: 9, bark: 1 };

export class Bubble {
  readonly el: HTMLDivElement;
  private box: HTMLDivElement;
  readonly nameEl: HTMLDivElement;
  private said: HTMLSpanElement;
  private unsaid: HTMLSpanElement;
  readonly choicesEl: HTMLDivElement;
  /** Where the tail points, in world pixels; null puts the box at the bottom of the screen. */
  head: { x: number; y: number } | null = null;
  visible = false;
  /** When it was last shown: newer bubbles keep their spot, older ones get nudged up. */
  order = 0;
  private static counter = 0;
  /** Bumped when the words change, so the box measures itself again. */
  private content = 0;
  private sizedFor = "";
  private look: Look | null = null;
  /** Snapped outer size in screen pixels. */
  w = 0;
  h = 0;

  constructor(host: HTMLElement, cls: string) {
    installPixelUi();
    this.el = document.createElement("div");
    this.el.className = `bb ${cls}`;
    this.el.innerHTML = `<div class="bb-pop"><div class="bb-box"><div class="bb-text"><span></span><span class="bb-unsaid"></span><i class="bb-next"></i></div>`
      + `<div class="bb-choices"></div></div><div class="bb-name"></div><i class="bb-tail"></i></div>`;
    this.box = this.el.querySelector(".bb-box")!;
    this.nameEl = this.el.querySelector(".bb-name")!;
    [this.said, this.unsaid] = [...this.el.querySelectorAll<HTMLSpanElement>(".bb-text span")];
    this.choicesEl = this.el.querySelector(".bb-choices")!;
    host.appendChild(this.el);
  }

  /** A name tag in the speaker's colours (empty hides it). */
  setName(name: string, look: Look | null = null) {
    if (this.nameEl.textContent === name && this.look === look) return;
    this.nameEl.textContent = name;
    this.look = look;
    this.content++;
  }

  /**
   * New words: the box is sized for all of them straight away and they
   * appear with `reveal`, so the bubble doesn't grow while typing.
   */
  setText(text: string) {
    this.said.textContent = "";
    this.unsaid.textContent = text;
    this.content++;
  }

  reveal(n: number) {
    const said = this.said.textContent!;
    if (said.length === n) return;
    const all = said + this.unsaid.textContent!;
    this.said.textContent = all.slice(0, n);
    this.unsaid.textContent = all.slice(n);
  }

  setChoices(html: string) {
    this.choicesEl.innerHTML = html;
    this.content++;
  }

  /** Shows the bubble with a little pop (again, if it moves to a new speaker). */
  show(pop: boolean) {
    if (!this.visible || pop) this.order = ++Bubble.counter;
    this.visible = true;
    this.el.classList.add("show");
    if (pop) {
      this.el.classList.remove("pop");
      void this.el.offsetWidth; // restart the animation
      this.el.classList.add("pop");
    }
  }

  hide() {
    this.visible = false;
    this.el.classList.remove("show", "pop", "done", "choosing");
  }

  mode(m: { thought?: boolean; free?: boolean }) {
    this.el.classList.toggle("thought", !!m.thought);
    this.el.classList.toggle("free", !!m.free);
  }

  get tail(): keyof typeof TAIL_DROP {
    const c = this.el.classList;
    return c.contains("thought") ? "thought" : c.contains("bark") ? "bark" : "say";
  }

  /**
   * Rounds the box, its name tag and its choices up to whole game pixels and
   * draws their frames at exactly that size (only when something changed).
   */
  size(px: number, freeW: number) {
    const c = this.el.classList;
    const free = c.contains("free");
    const key = `${px}|${fontVersion}|${this.content}|${free ? freeW : 0}|${c.contains("thought")}|${c.contains("choosing")}`;
    if (key === this.sizedFor) return;
    this.sizedFor = key;
    // Choices: whole-pixel heights first (they add up to the box's), then the
    // box, then each choice's highlight at the width the box gave it.
    const opts = [...this.choicesEl.querySelectorAll<HTMLElement>(".bb-opt")];
    for (const o of opts) {
      o.style.width = o.style.height = "";
      o.style.height = `${Math.ceil(o.offsetHeight / px) * px}px`;
    }
    const frame = c.contains("thought") ? "think" : c.contains("bark") ? "bark" : "say";
    ({ w: this.w, h: this.h } = fitFrame(this.box, frame, px, null, free ? Math.floor(freeW / px) * px : undefined));
    for (const o of opts) fitFrame(o, "pill", px);
    if (this.nameEl.textContent) fitFrame(this.nameEl, "tag", px, this.look);
  }
}

/**
 * Puts every visible bubble over its speaker's head on the game's pixel
 * grid, keeps it inside the screen, and stacks bubbles that would overlap
 * (the newest stays lowest).
 */
export function layoutBubbles(bubbles: Bubble[], canvas: HTMLCanvasElement, camX: number, camY: number, vw: number) {
  // Returns one game pixel in screen pixels.
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const px = Math.max(1, Math.round(W / vw));
  const host = canvas.parentElement!;
  if (host.style.getPropertyValue("--px") !== `${px}px`) {
    // The 12px pixel font at a whole multiple: about half a game pixel per font pixel.
    const ts = Math.max(1, Math.round(px / 2));
    host.style.setProperty("--px", `${px}px`);
    host.style.setProperty("--fs", `${12 * ts}px`);
    host.style.setProperty("--lh", `${14 * ts}px`);
  }
  const g = (v: number) => Math.round(v / px) * px; // onto the pixel grid
  const placed: { b: Bubble; x: number; y: number }[] = [];
  for (const b of bubbles.filter((b) => b.visible).sort((a, c) => a.order - c.order)) {
    b.size(px, W * 0.84);
    const { w, h } = b;
    if (!b.head) {
      b.el.style.transform = `translate(${g((W - w) / 2)}px, ${g(H - h - px * 4)}px)`;
      continue;
    }
    const sx = (b.head.x - camX) * px, sy = (b.head.y - camY) * px;
    const x = g(Math.min(Math.max(px * 2, sx - w / 2), W - w - px * 2));
    const y = g(Math.max(px * 12, sy - h - TAIL_DROP[b.tail] * px));
    const tx = g(Math.min(Math.max(px * 6, sx - x), w - px * 6));
    b.el.style.setProperty("--tx", `${tx}px`);
    b.el.classList.toggle("flip", tx > w / 2);
    placed.push({ b, x, y });
  }
  // Oldest first: anything that would overlap a newer bubble moves above it.
  for (let i = placed.length - 1; i >= 0; i--) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], c = placed[j];
      if (a.x < c.x + c.b.w && c.x < a.x + a.b.w && a.y < c.y + c.b.h + px * 3 && c.y < a.y + a.b.h) a.y = c.y - a.b.h - px * 12;
    }
  }
  for (const p of placed) p.b.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  return px;
}

/** Is this world point on screen (with a margin)? */
export function onScreen(pt: { x: number; y: number }, camX: number, camY: number, vw: number, vh: number, m = 8) {
  return pt.x > camX - m && pt.x < camX + vw + m && pt.y > camY - 40 && pt.y < camY + vh + 40;
}

/** Tiny emote icons as pixel maps; every lit pixel gets a one-pixel outline. */
const EMOTES: Record<Exclude<Expr, "normal">, { rows: string[]; colors: Record<string, string> }> = {
  sweat: { rows: ["..a..", ".aab.", "abbbb", "wbbbb", ".bbb."], colors: { a: "#bfe8ff", b: "#7cc8f5", w: "#ffffff" } },
  surprised: { rows: ["y", "y", "y", "y", ".", "y"], colors: { y: "#ffe478" } },
  angry: { rows: ["rr.rr", "r...r", ".....", "r...r", "rr.rr"], colors: { r: "#ff4d6a" } },
  happy: { rows: ["wp.pp", "ppppp", ".ppp.", "..p.."], colors: { p: "#ff8ab8", w: "#ffffff" } },
  sleepy: { rows: ["zzzz", "..z.", ".z..", "zzzz"], colors: { z: "#e6dcf7" } },
  smug: { rows: ["..y..", "..y..", "yyyyy", "..y..", "..y.."], colors: { y: "#ffe478" } },
};

/**
 * The feeling of a line, drawn as a tiny icon next to the speaker's head:
 * a sweat drop, a "!", an anger mark... `t` is seconds since the line began.
 */
export function drawEmote(ctx: Ctx, x0: number, headY: number, facing: number, expr: Expr, t: number) {
  if (expr === "normal") return;
  const e = EMOTES[expr];
  const w = e.rows[0].length, h = e.rows.length;
  const pop = t < 0.12 ? Math.round((0.12 - t) * 25) : 0;
  const drift = expr === "sweat" ? Math.floor(t * 2.5) % 3 : expr === "sleepy" ? -(Math.floor(t * 2) % 3) : Math.round(Math.sin(t * 6) * 0.6);
  const x = Math.round(x0 - facing * 9 - w / 2);
  const y = Math.round(headY + 2 - h / 2 - pop + drift);
  const lit: [number, number, string][] = [];
  e.rows.forEach((row, j) => [...row].forEach((ch, i) => { if (e.colors[ch]) lit.push([x + i, y + j, e.colors[ch]]); }));
  for (const [lx, ly] of lit) rect(ctx, lx - 1, ly - 1, 3, 3, P.outline);
  for (const [lx, ly, c] of lit) px(ctx, lx, ly, c);
}
