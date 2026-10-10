import { drawSprite, px, rect, type Ctx } from "../engine/gfx";
import { drawText, textWidth } from "../engine/font";
import type { Game } from "./game";
import { P } from "./palette";
import { ELEMENTS, type FormId } from "./runes";
import { heartEmpty, heartFull, heartHalf, heartHalfWhite, iconSprites, ITEM_ORDER, itemSprites } from "./sprites";

export function drawHud(ctx: Ctx, game: Game, vw: number) {
  const p = game.player;

  // Hearts (hp counts halves); the one that just lost a piece flashes after a hit.
  const lost = Math.floor(Math.max(0, p.hp) / 2);
  for (let i = 0; i < p.maxHp / 2; i++) {
    const x = 6 + i * 9;
    const v = Math.max(0, Math.min(2, p.hp - i * 2));
    const justLost = v < 2 && i === lost && p.inv > 0.9;
    const bounce = v > 0 && p.hp <= 4 && Math.floor(game.time * 4) % 2 === 0 ? -1 : 0;
    drawSprite(ctx, justLost ? heartHalfWhite : v === 2 ? heartFull : v === 1 ? heartHalf : heartEmpty, x, 6 + bounce);
  }

  // Current woven spell in a little frame under the hearts; dots for the other slots.
  const prog = game.progress;
  if (game.hasWand) {
    const cur = prog.current;
    const info = ELEMENTS[cur.el];
    const pop = Math.round(Math.sin(Math.min(1, game.spellBump) * Math.PI) * 2);
    const fx = 6, fy = 17 - pop;
    rect(ctx, fx, fy, 13, 13, P.outline);
    rect(ctx, fx + 1, fy + 1, 11, 11, game.spellBump > 0 ? info.accent : "#5a4378");
    rect(ctx, fx + 1, fy + 1, 11, 1, info.main);
    drawSprite(ctx, iconSprites[cur.el], fx + 2, fy + 2);
    drawFormGlyph(ctx, cur.form, fx + 9, fy + 9, info.accent);
    const blink = Math.floor(game.time * 2) % 2 ? P.cream : P.magicYellow;
    let hx = fx + 17;
    if (prog.filledSlots.length > 1) {
      drawText(ctx, "Q", hx, fy + 1, P.cream);
      prog.loadout.forEach((w, i) => {
        rect(ctx, hx + i * 4, fy + 8, 3, 3, P.outline);
        px(ctx, hx + 1 + i * 4, fy + 9, !w ? "#5a4378" : i === prog.slot ? P.white : ELEMENTS[w.el].main);
      });
      hx += 16;
    }
    if (prog.newRune) drawText(ctx, "R", hx, fy + 4, blink);
    else if (prog.filledSlots.length < 2 && Object.values(game.inventory).some((n) => n > 0)) drawText(ctx, "E", hx, fy + 4, blink);
  }

  // Inventory: right-aligned, only what has been found so far.
  let x = vw - 6;
  for (let i = ITEM_ORDER.length - 1; i >= 0; i--) {
    const t = ITEM_ORDER[i];
    const n = game.inventory[t];
    if (n <= 0) continue;
    const label = String(n);
    const w = textWidth(label);
    const bump = game.hudBump[t];
    const lift = Math.round(Math.sin(Math.min(1, bump) * Math.PI) * 3);
    x -= w;
    drawText(ctx, label, x, 8 - lift, bump > 0 ? P.magicYellow : P.cream);
    const spr = itemSprites[t];
    x -= spr.width + 2;
    drawSprite(ctx, spr, x, 6 + Math.floor((7 - spr.height) / 2) - lift);
    x -= 7;
  }

  // Boss health bar along the bottom.
  const boss = game.boss;
  if (boss && !boss.dead) {
    const w = 150, x0 = Math.round((vw - w) / 2), y0 = 166;
    const k = Math.max(0, boss.hp / boss.maxHp);
    const name = "KING SLIME";
    drawText(ctx, name, (vw - textWidth(name)) / 2, y0 - 8, P.magicYellow);
    rect(ctx, x0 - 1, y0 - 1, w + 2, 7, P.outline);
    rect(ctx, x0, y0, w, 5, P.heartEmpty);
    rect(ctx, x0, y0, Math.round(w * k), 5, boss.flash > 0 ? P.white : k <= 0.5 ? P.heart : P.slime);
    rect(ctx, x0, y0, Math.round(w * k), 1, k <= 0.5 ? P.heartHi : P.slimeHi);
    rect(ctx, x0 + w / 2, y0, 1, 5, P.outline);
  }

  if (!p.alive) {
    const msg = "OOPS!";
    rect(ctx, 0, 80, vw, 20, "rgba(59,42,74,0.5)");
    drawText(ctx, msg, (vw - textWidth(msg, 2)) / 2, 85, P.magicYellow, P.outline, 2);
  }
}

const FORM_GLYPHS: Record<FormId, string[]> = {
  bolt: ["..#..", "...#.", "#####", "...#.", "..#.."],
  ring: [".###.", "#...#", "#.#.#", "#...#", ".###."],
  pillar: [".###.", "..#..", "..#..", "..#..", "#####"],
  lob: [".##..", "#..#.", "....#", "..#.#", "...##"],
};

/** 5x5 mark for a form rune, outlined so it reads over any icon. */
export function drawFormGlyph(ctx: Ctx, form: FormId, x: number, y: number, color: string, outline: string | null = P.outline) {
  const g = FORM_GLYPHS[form];
  if (outline) {
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) if (g[j][i] === "#") rect(ctx, x + i - 1, y + j - 1, 3, 3, outline);
  }
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) if (g[j][i] === "#") px(ctx, x + i, y + j, color);
}
