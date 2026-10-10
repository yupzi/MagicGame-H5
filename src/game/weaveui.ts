import { sfx } from "../engine/audio";
import { drawSprite, ellipse, px, rect, ring, type Ctx } from "../engine/gfx";
import { drawText, textWidth } from "../engine/font";
import type { Input } from "../engine/input";
import { makeRng } from "../engine/math";
import { drawMagicCircle } from "./effects";
import type { Game } from "./game";
import { drawFormGlyph } from "./hud";
import { P } from "./palette";
import { Particles } from "./particles";
import { ELEMENT_ORDER, ELEMENTS, FORM_ORDER, FORMS, sameWeave, weaveInfo, type ElementId, type FormId, type Weave } from "./runes";
import { markup } from "./skilltree";
import { LOADOUT_SIZE } from "./spells";
import { iconSprites } from "./sprites";

type Zone = "slot" | "el" | "form";

const NUMERALS = ["I", "II", "III"];
const BG = "#1c1432";
const TILE = 18;

// Layout in canvas pixels (320x180).
const SLOT_X = 10, SLOT_Y = 24, SLOT_W = 52, SLOT_H = 34, SLOT_GAP = 40;
const CIRCLE_X = 138, CIRCLE_Y = 88, CIRCLE_R = 42;
const PAL_X = 214, EL_Y = 30, FORM_Y = 64, TILE_GAP = 20;

interface Flyer {
  x0: number; y0: number;
  t: number;
  el?: ElementId;
  form?: FormId;
}

/**
 * The weaving table: three spell slots on the left, the rune palette on the
 * right and the slot's magic circle in the middle, which redraws itself
 * stroke by stroke every time a rune is placed. Canvas-drawn like the star
 * chart, with a DOM card for the Chinese text.
 */
export class WeaveTable {
  open = false;
  private t = 0;
  private closing = 0;
  private zone: Zone = "slot";
  private cur = 0; // index within the zone
  private editing = 0; // which loadout slot is being woven
  private drawIn = 1; // big circle draw-in progress
  private rot = 0;
  private slotPop = [0, 0, 0];
  private tileShake = new Map<string, number>();
  private flyers: Flyer[] = [];
  private fx: Particles;
  private stars: [number, number, number][] = [];

  private root: HTMLDivElement;
  private card: HTMLDivElement;
  private cardKey = "";
  private canvas: HTMLCanvasElement | null;

  constructor(private game: Game, host: HTMLElement) {
    this.fx = new Particles(game.world);
    const rng = makeRng(7);
    for (let i = 0; i < 60; i++) this.stars.push([rng() * 320, rng() * 180, rng()]);
    this.root = document.createElement("div");
    this.root.id = "weave";
    this.root.className = "hidden";
    this.root.innerHTML = `
      <div class="weave-card"></div>
      <div class="tree-foot">
        <span class="tree-title">✦ 符文编织 ✦</span>
        <span class="tree-keys">方向键 选择 · J / 空格 放入符文 · K 清空咒式栏 · R / Esc 返回</span>
      </div>`;
    host.appendChild(this.root);
    this.card = this.root.querySelector(".weave-card")!;
    this.canvas = host.querySelector("canvas");
    this.bindPointer();
  }

  private get prog() {
    return this.game.progress;
  }

  // ------------------------------------------------------------------ open / close

  show() {
    this.open = true;
    this.closing = 0;
    this.t = 0;
    this.editing = this.prog.slot;
    this.zone = "slot";
    this.cur = this.editing;
    this.drawIn = 0;
    this.cardKey = "";
    this.prog.newRune = false;
    this.root.classList.remove("hidden");
    sfx.bookOpen();
  }

  /** `instant` skips the fade, for hopping straight over to the star chart. */
  hide(instant = false) {
    if (this.closing > 0) return;
    this.closing = 0.18;
    if (instant) {
      this.closing = 0;
      this.open = false;
    }
    this.root.classList.add("hidden");
    // Hold whatever was just woven.
    if (this.prog.loadout[this.editing]) this.prog.slot = this.editing;
    this.game.spellBump = 1;
    this.game.save();
    sfx.bookClose();
  }

  // ------------------------------------------------------------------ geometry

  private slotRect(i: number) {
    return { x: SLOT_X, y: SLOT_Y + i * SLOT_GAP, w: SLOT_W, h: SLOT_H };
  }

  private tileRect(zone: "el" | "form", i: number) {
    return { x: PAL_X + i * TILE_GAP, y: zone === "el" ? EL_Y : FORM_Y, w: TILE, h: TILE };
  }

  private hit(x: number, y: number): { zone: Zone; i: number } | null {
    const inside = (r: { x: number; y: number; w: number; h: number }) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    for (let i = 0; i < LOADOUT_SIZE; i++) if (inside(this.slotRect(i))) return { zone: "slot", i };
    for (let i = 0; i < ELEMENT_ORDER.length; i++) if (inside(this.tileRect("el", i))) return { zone: "el", i };
    for (let i = 0; i < FORM_ORDER.length; i++) if (inside(this.tileRect("form", i))) return { zone: "form", i };
    return null;
  }

  // ------------------------------------------------------------------ input

  private bindPointer() {
    const c = this.canvas;
    if (!c) return;
    const local = (e: PointerEvent): [number, number] => {
      const r = c.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * this.game.viewW, ((e.clientY - r.top) / r.height) * this.game.viewH];
    };
    c.addEventListener("pointermove", (e) => {
      if (!this.open || this.closing > 0) return;
      const [x, y] = local(e);
      const h = this.hit(x, y);
      if (h && (h.zone !== this.zone || h.i !== this.cur)) this.moveTo(h.zone, h.i);
    });
    c.addEventListener("pointerup", (e) => {
      if (!this.open || this.closing > 0) return;
      const [x, y] = local(e);
      const h = this.hit(x, y);
      if (!h) return;
      this.moveTo(h.zone, h.i, true);
      this.confirm();
    });
  }

  private moveTo(zone: Zone, i: number, quiet = false) {
    if (zone === this.zone && i === this.cur) return;
    this.zone = zone;
    this.cur = i;
    if (zone === "slot" && this.editing !== i) {
      this.editing = i;
      this.drawIn = 0;
      this.slotPop[i] = 1;
    }
    if (!quiet) sfx.menuMove();
  }

  private handle(input: Input) {
    if (input.pressed("menu")) {
      // E jumps straight over to the star chart.
      this.hide(true);
      this.game.tree.show();
      return;
    }
    if (input.pressed("weave")) return this.hide();
    const z = this.zone;
    if (input.pressed("up")) {
      if (z === "slot") this.moveTo("slot", (this.cur + LOADOUT_SIZE - 1) % LOADOUT_SIZE);
      else if (z === "form") this.moveTo("el", Math.min(this.cur, ELEMENT_ORDER.length - 1));
    }
    if (input.pressed("down")) {
      if (z === "slot") this.moveTo("slot", (this.cur + 1) % LOADOUT_SIZE);
      else if (z === "el") this.moveTo("form", Math.min(this.cur, FORM_ORDER.length - 1));
    }
    if (input.pressed("right")) {
      if (z === "slot") {
        const w = this.prog.loadout[this.editing];
        this.moveTo("el", w ? ELEMENT_ORDER.indexOf(w.el) : 0);
      } else {
        const n = z === "el" ? ELEMENT_ORDER.length : FORM_ORDER.length;
        if (this.cur < n - 1) this.moveTo(z, this.cur + 1);
      }
    }
    if (input.pressed("left")) {
      if (z !== "slot") {
        if (this.cur > 0) this.moveTo(z, this.cur - 1);
        else this.moveTo("slot", this.editing);
      }
    }
    if (input.pressed("swap")) this.moveTo("slot", (this.editing + 1) % LOADOUT_SIZE);
    if (input.pressed("charge")) this.clearSlot();
    const confirm = input.pressed("bolt") || input.pressed("confirm") || (input.pressed("jump") && !input.pressed("up"));
    if (confirm) this.confirm();
  }

  private deny(key: string, why: string) {
    this.tileShake.set(key, 0.3);
    sfx.denied();
    this.card.dataset.deny = why;
    this.card.classList.remove("deny");
    void this.card.offsetWidth;
    this.card.classList.add("deny");
  }

  private confirm() {
    const prog = this.prog;
    const slot = prog.loadout[this.editing];
    if (this.zone === "slot") {
      this.moveTo("el", slot ? ELEMENT_ORDER.indexOf(slot.el) : 0);
      return;
    }
    let next: Weave;
    if (this.zone === "el") {
      const el = ELEMENT_ORDER[this.cur];
      if (!prog.elements.has(el)) return this.deny(`el${this.cur}`, "locked");
      next = { el, form: slot?.form ?? "bolt" };
      this.flyers.push({ ...this.tileCenter("el", this.cur), t: 0, el });
    } else {
      const form = FORM_ORDER[this.cur];
      if (!prog.forms.has(form)) return this.deny(`form${this.cur}`, "locked");
      if (!slot) return this.deny(`form${this.cur}`, "empty");
      next = { el: slot.el, form };
      this.flyers.push({ ...this.tileCenter("form", this.cur), t: 0, form });
    }
    if (sameWeave(slot, next)) {
      this.slotPop[this.editing] = 0.5;
      sfx.menuMove();
      return;
    }
    prog.loadout[this.editing] = next;
    this.cardKey = "";
  }

  private tileCenter(zone: "el" | "form", i: number) {
    const r = this.tileRect(zone, i);
    return { x0: r.x + r.w / 2, y0: r.y + r.h / 2 };
  }

  /** Called when a flying rune lands in the big circle. */
  private landed(f: Flyer) {
    const w = this.prog.loadout[this.editing];
    if (!w) return;
    const col = ELEMENTS[w.el];
    this.drawIn = 0;
    this.slotPop[this.editing] = 1;
    sfx.weave();
    this.fx.burst(CIRCLE_X, CIRCLE_Y, {
      count: 26, colors: [col.main, col.accent, P.white], speed: [40, 150], life: [0.3, 0.7], shape: "spark", additive: true, drag: 4,
    });
    if (f.form) {
      this.fx.burst(CIRCLE_X, CIRCLE_Y, {
        count: 6, colors: [P.white], speed: [30, 80], life: [0.5, 0.9], shape: "starSmall", drag: 2, gravity: 60,
      });
    }
  }

  private clearSlot() {
    const prog = this.prog;
    const i = this.editing;
    if (!prog.loadout[i]) return;
    if (prog.filledSlots.length <= 1) return this.deny(`slot${i}`, "last");
    prog.loadout[i] = null;
    if (prog.slot === i) prog.slot = prog.filledSlots[0];
    // Keep slot I filled so there's always something in hand.
    if (!prog.loadout[0]) {
      const j = prog.filledSlots[0];
      prog.loadout[0] = prog.loadout[j];
      prog.loadout[j] = null;
      if (prog.slot === j) prog.slot = 0;
    }
    sfx.poof();
    this.drawIn = 0;
    this.cardKey = "";
    const r = this.slotRect(i);
    this.fx.burst(r.x + r.w / 2, r.y + r.h / 2, {
      count: 10, colors: ["#8f7fb0", P.white], speed: [20, 70], life: [0.2, 0.5], shape: "px", drag: 4,
    });
  }

  // ------------------------------------------------------------------ update

  update(dt: number, input: Input) {
    if (this.closing > 0) {
      this.closing -= dt;
      if (this.closing <= 0) this.open = false;
      return;
    }
    this.t += dt;
    this.rot += dt * 0.6;
    this.handle(input);
    if (!this.open) return;
    this.drawIn = Math.min(1, this.drawIn + dt * 1.8);
    for (let i = 0; i < this.slotPop.length; i++) this.slotPop[i] = Math.max(0, this.slotPop[i] - dt * 4);
    for (const [k, v] of this.tileShake) this.tileShake.set(k, Math.max(0, v - dt));
    for (const f of this.flyers) {
      f.t += dt / 0.22;
      if (f.t >= 1) this.landed(f);
    }
    this.flyers = this.flyers.filter((f) => f.t < 1);
    this.fx.update(dt);
    // Motes drifting up off the circle in the woven element's colours.
    const w = this.shownWeave();
    if (w && Math.random() < dt * 14) {
      const a = Math.random() * Math.PI * 2;
      const col = ELEMENTS[w.el];
      this.fx.burst(CIRCLE_X + Math.cos(a) * CIRCLE_R, CIRCLE_Y + Math.sin(a) * CIRCLE_R, {
        count: 1, colors: [col.main, col.accent], speed: [5, 18], angle: [-Math.PI * 0.7, -Math.PI * 0.3], life: [0.5, 1], shape: "px", additive: true,
      });
    }
    this.updateCard();
  }

  /** The hovered rune combined with the slot being edited, if that's a legal weave. */
  private preview(): Weave | null {
    const slot = this.prog.loadout[this.editing];
    if (this.zone === "el") {
      const el = ELEMENT_ORDER[this.cur];
      if (!this.prog.elements.has(el)) return null;
      return { el, form: slot?.form ?? "bolt" };
    }
    if (this.zone === "form" && slot) {
      const form = FORM_ORDER[this.cur];
      if (!this.prog.forms.has(form)) return null;
      return { el: slot.el, form };
    }
    return null;
  }

  private shownWeave() {
    return this.prog.loadout[this.editing];
  }

  // ------------------------------------------------------------------ drawing

  draw(ctx: Ctx) {
    const vw = this.game.viewW, vh = this.game.viewH;
    const fade = this.closing > 0 ? this.closing / 0.18 : Math.min(1, this.t / 0.18);
    ctx.fillStyle = `rgba(28,20,50,${0.94 * fade})`;
    ctx.fillRect(0, 0, vw, vh);
    if (fade < 0.3) return;
    for (const [x, y, k] of this.stars) {
      const tw = Math.sin(this.t * (1 + k * 3) + k * 20);
      if (tw < -0.5) continue;
      px(ctx, x, y, tw > 0.8 ? P.white : k > 0.5 ? "#5a4a80" : "#40326a");
    }
    const title = "RUNE WEAVING";
    drawText(ctx, title, (vw - textWidth(title)) / 2, 6, "#8f7fb0");

    this.drawBigCircle(ctx);
    for (let i = 0; i < LOADOUT_SIZE; i++) this.drawSlot(ctx, i);
    drawText(ctx, "ELEMENT", PAL_X, EL_Y - 8, "#8f7fb0");
    ELEMENT_ORDER.forEach((el, i) => this.drawTile(ctx, "el", i, this.prog.elements.has(el), this.tileSelected("el", i)));
    drawText(ctx, "FORM", PAL_X, FORM_Y - 8, "#8f7fb0");
    FORM_ORDER.forEach((f, i) => this.drawTile(ctx, "form", i, this.prog.forms.has(f), this.tileSelected("form", i)));
    this.drawFlyers(ctx);
    this.fx.draw(ctx, false);
    this.fx.draw(ctx, true);
  }

  private tileSelected(zone: "el" | "form", i: number) {
    const w = this.prog.loadout[this.editing];
    if (!w) return false;
    return zone === "el" ? ELEMENT_ORDER[i] === w.el : FORM_ORDER[i] === w.form;
  }

  private drawBigCircle(ctx: Ctx) {
    const w = this.shownWeave();
    const pv = this.preview();
    const cx = CIRCLE_X, cy = CIRCLE_Y;
    // Faint guide rings so an empty slot still reads as a place to weave.
    ring(ctx, cx, cy, CIRCLE_R + 3, CIRCLE_R + 3, "#3a2d66");
    ring(ctx, cx, cy, CIRCLE_R - 12, CIRCLE_R - 12, "#30265a");
    if (w) {
      const col = ELEMENTS[w.el];
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.12 + 0.05 * Math.sin(this.t * 3);
      ellipse(ctx, cx, cy, CIRCLE_R + 6, CIRCLE_R + 6, col.main);
      ctx.restore();
      drawMagicCircle(ctx, cx, cy, CIRCLE_R, this.rot, {
        ax: 1, ay: 1, progress: this.drawIn, main: col.main, accent: col.accent, form: w.form, glyphs: col.glyphs,
        pulse: this.drawIn < 1 && this.drawIn > 0.85 ? 1 : 0,
      });
      drawSprite(ctx, iconSprites[w.el], cx - 4, cy - 4);
    } else {
      const plus = "+";
      drawText(ctx, plus, cx - textWidth(plus, 2) / 2, cy - 5, "#5a4a80", "", 2);
    }
    // Ghost of the hovered combination.
    if (pv && !sameWeave(pv, w) && this.drawIn >= 1) {
      const col = ELEMENTS[pv.el];
      drawMagicCircle(ctx, cx, cy, CIRCLE_R - 16, -this.rot * 1.5, {
        ax: 1, ay: 1, progress: 1, main: col.main, accent: col.accent, form: pv.form, glyphs: col.glyphs,
        alpha: 0.35 + 0.15 * Math.sin(this.t * 8),
      });
    }
    const shown = pv ?? w;
    if (shown) {
      const tag = weaveInfo(shown).tag;
      drawText(ctx, tag, cx - textWidth(tag) / 2, cy + CIRCLE_R + 9, pv && !sameWeave(pv, w) ? "#8f7fb0" : ELEMENTS[shown.el].accent);
    }
  }

  private drawSlot(ctx: Ctx, i: number) {
    const r = this.slotRect(i);
    const w = this.prog.loadout[i];
    const editing = i === this.editing;
    const pop = Math.sin(this.slotPop[i] * Math.PI) * 2;
    const shake = (this.tileShake.get(`slot${i}`) ?? 0) > 0 ? Math.round(Math.sin(this.t * 80) * 2) : 0;
    const x = r.x + shake, y = Math.round(r.y - pop);
    rect(ctx, x - 1, y - 1, r.w + 2, r.h + 2, P.outline);
    rect(ctx, x, y, r.w, r.h, editing ? "#3a2c62" : BG);
    const rim = w ? ELEMENTS[w.el].main : "#4a3a78";
    if (editing || w) {
      rect(ctx, x, y, r.w, 1, rim);
      rect(ctx, x, y + r.h - 1, r.w, 1, editing ? rim : "#2e2450");
    } else {
      for (let k = 0; k < r.w; k += 3) {
        px(ctx, x + k, y, "#4a3a78");
        px(ctx, x + k, y + r.h - 1, "#4a3a78");
      }
    }
    if (w) {
      const col = ELEMENTS[w.el];
      drawMagicCircle(ctx, x + 17, y + 17, 12, this.rot * (editing ? 2 : 0.7), {
        ax: 1, ay: 1, progress: 1, main: col.main, accent: col.accent, form: w.form, glyphs: col.glyphs, alpha: editing ? 1 : 0.75,
      });
      drawSprite(ctx, iconSprites[w.el], x + 34, y + 13);
      drawFormGlyph(ctx, w.form, x + 44, y + 22, col.accent);
    } else {
      drawText(ctx, "+", x + 16, y + 15, "#4a3a78");
    }
    drawText(ctx, NUMERALS[i], x + r.w - 3 - textWidth(NUMERALS[i]), y + 3, i === this.prog.slot ? P.magicYellow : "#8f7fb0");
    if (this.zone === "slot" && this.cur === i) this.drawCursor(ctx, x, y, r.w, r.h);
    else if (editing && this.zone !== "slot") {
      // Little arrow showing which slot the palette writes into.
      const ax = x + r.w + 3, ay = y + r.h / 2;
      rect(ctx, ax, ay - 1, 1, 3, P.magicYellow);
      px(ctx, ax + 1, ay, P.magicYellow);
    }
  }

  private drawTile(ctx: Ctx, zone: "el" | "form", i: number, known: boolean, selected: boolean) {
    const r = this.tileRect(zone, i);
    const shake = (this.tileShake.get(`${zone}${i}`) ?? 0) > 0 ? Math.round(Math.sin(this.t * 80) * 2) : 0;
    const x = r.x + shake, y = r.y;
    const el = zone === "el" ? ELEMENT_ORDER[i] : null;
    const col = el ? ELEMENTS[el] : { main: P.magicPurple, accent: P.white };
    rect(ctx, x - 1, y - 1, r.w + 2, r.h + 2, P.outline);
    rect(ctx, x, y, r.w, r.h, known ? "#30264e" : "#221a3c");
    if (selected) {
      rect(ctx, x, y, r.w, r.h, "#4a3a7a");
      rect(ctx, x, y + r.h - 2, r.w, 2, col.main);
    }
    if (!known) {
      drawText(ctx, "?", x + r.w / 2 - 1, y + r.h / 2 - 2, "#5a4a88", "");
    } else if (el) {
      drawSprite(ctx, iconSprites[el], x + 5, y + 5);
    } else {
      drawFormGlyph(ctx, FORM_ORDER[i], x + 7, y + 7, selected ? P.white : P.magicPurple, null);
    }
    if (this.zone === zone && this.cur === i) this.drawCursor(ctx, x, y, r.w, r.h);
  }

  private drawCursor(ctx: Ctx, x: number, y: number, w: number, h: number) {
    const o = 2 + Math.round(Math.abs(Math.sin(this.t * 6)) * 1.5);
    const c = Math.floor(this.t * 4) % 2 ? P.white : P.magicYellow;
    const corners: [number, number, number, number][] = [
      [x - o, y - o, 1, 1], [x + w - 1 + o, y - o, -1, 1], [x - o, y + h - 1 + o, 1, -1], [x + w - 1 + o, y + h - 1 + o, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      rect(ctx, Math.min(cx, cx + sx * 3) - 1, cy - 1, 6, 3, P.outline);
      rect(ctx, cx - 1, Math.min(cy, cy + sy * 3) - 1, 3, 6, P.outline);
      rect(ctx, Math.min(cx, cx + sx * 3), cy, 4, 1, c);
      rect(ctx, cx, Math.min(cy, cy + sy * 3), 1, 4, c);
    }
  }

  private drawFlyers(ctx: Ctx) {
    for (const f of this.flyers) {
      const e = f.t * f.t;
      const mx = (f.x0 + CIRCLE_X) / 2, my = Math.min(f.y0, CIRCLE_Y) - 24;
      const u = 1 - e;
      const x = u * u * f.x0 + 2 * u * e * mx + e * e * CIRCLE_X;
      const y = u * u * f.y0 + 2 * u * e * my + e * e * CIRCLE_Y;
      if (f.el) drawSprite(ctx, iconSprites[f.el], x - 4, y - 4);
      else if (f.form) drawFormGlyph(ctx, f.form, x - 2, y - 2, P.white);
      this.fx.burst(x, y, { count: 1, colors: [P.white, P.magicYellow], speed: [0, 10], life: [0.15, 0.3], shape: "px", additive: true });
    }
  }

  // ------------------------------------------------------------------ DOM card

  private updateCard() {
    const prog = this.prog;
    const key = `${this.zone}|${this.cur}|${this.editing}|${JSON.stringify(prog.loadout)}`;
    if (key !== this.cardKey) {
      this.cardKey = key;
      this.card.innerHTML = this.cardHtml();
      const w = this.preview() ?? prog.loadout[this.editing];
      this.card.style.setProperty("--branch", w ? ELEMENTS[w.el].main : "#7a5cb0");
    }
    if (!this.canvas) return;
    const scale = this.canvas.clientWidth / this.game.viewW;
    this.card.style.left = `${Math.round((PAL_X - 6) * scale)}px`;
    this.card.style.top = `${Math.round((FORM_Y + TILE + 8) * scale)}px`;
    this.card.style.width = `${Math.round((this.game.viewW - PAL_X) * scale)}px`;
  }

  private cardHtml() {
    const prog = this.prog;
    const slot = prog.loadout[this.editing];
    const slotName = `第 ${NUMERALS[this.editing]} 栏`;
    if (this.zone === "el" && !prog.elements.has(ELEMENT_ORDER[this.cur])) {
      return `<div class="tc-name">？？？</div><div class="tc-desc">一枚还没点亮的元素符文。<br>在<span class="kw-star">魔法星盘</span>（E）里用材料点亮它。</div>`;
    }
    if (this.zone === "form" && !prog.forms.has(FORM_ORDER[this.cur])) {
      return `<div class="tc-name">？？？</div><div class="tc-desc">一枚失落的形态符文。<br>也许山丘深处的古老石碑上还刻着它。</div>`;
    }
    const pv = this.preview();
    const w = pv ?? slot;
    if (!w) {
      const hint = this.zone === "form" ? "先放一枚元素符文进来吧。" : "选一枚元素符文放进来吧。";
      return `<div class="tc-name">空的咒式栏</div><div class="tc-desc">${hint}</div>`;
    }
    const info = weaveInfo(w);
    const el = ELEMENTS[w.el];
    const changing = pv && !sameWeave(pv, slot);
    const runes = `<span class="kw-${el.kw}">${el.name}</span> ✦ <span class="wc-form">${FORMS[w.form].name}</span>`;
    const use = info.use ? `<div class="wc-use">✧ ${markup(info.use)}</div>` : "";
    const foot = changing
      ? `<div class="tc-foot go">J / 点击：织入${slotName}</div>`
      : this.zone === "slot" ? `<div class="tc-foot">→ 选择符文 · K 清空</div>` : `<div class="tc-foot">已织入${slotName}</div>`;
    return `
      <div class="tc-head"><span class="tc-name" style="color:${el.accent}">${info.name}</span><span class="tc-lv">${runes}</span></div>
      <div class="tc-desc">${markup(info.desc)}</div>${use}${foot}`;
  }
}

