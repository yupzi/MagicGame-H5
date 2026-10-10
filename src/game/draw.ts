import { rect, type Ctx } from "../engine/gfx";
import { P } from "./palette";

/** Draws `shape` in outline colour nudged 1px each way, then in `fill`: an outline for any shape. */
export function outlined(shape: (dx: number, dy: number, c: string) => void, fill: string) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) shape(dx, dy, P.outline);
  shape(0, 0, fill);
}

/** Rows y0..y1, each `half(t)` wide either side of cx + `shift(t)` (t runs 0 at the top to 1 at the bottom). */
export function spans(ctx: Ctx, cx: number, y0: number, y1: number, half: (t: number) => number, shift: (t: number) => number, dx: number, dy: number, c: string) {
  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0);
    const h = half(t);
    rect(ctx, cx + shift(t) - h + dx, y + dy, h * 2, 1, c);
  }
}
