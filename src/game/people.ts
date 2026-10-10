import { blob, ellipse, px, rect, type Ctx } from "../engine/gfx";
import { lerp } from "../engine/math";
import { outlined, spans } from "./draw";
import PEOPLE from "../story/people.json";
import { P } from "./palette";

/**
 * People met on the road: a look (colours, hair, hat) drawn in the same
 * chibi style as the witch, plus the faces they pull while talking.
 */
export type Expr = "normal" | "happy" | "surprised" | "sweat" | "sleepy" | "angry" | "smug";

/** Expression names as written in the dialogue script. */
export const EXPR_NAMES: Record<string, Expr> = {
  普通: "normal", 开心: "happy", 惊讶: "surprised", 汗: "sweat", 困: "sleepy", 生气: "angry", 得意: "smug",
};

export interface Look {
  /** Shown on the name tag and used as the speaker name in the script. */
  name: string;
  /** Pitch of the little typing voice. */
  voice: number;
  skin: string;
  hair: string;
  hairShade: string;
  hairStyle: "long" | "bun" | "short";
  dress: string;
  dressShade: string;
  hem: string;
  apron?: string;
  /** Stocking stripes (the same colour twice for plain legs). */
  legs: string[];
  boot: string;
  hat: "witch" | "tall" | "scarf" | "straw" | "helmet" | "none";
  /** Hat main, dark and highlight. */
  hatColor: string[];
  /** Grown-ups stand a few pixels taller. */
  tall: number;
  glasses?: boolean;
}

/** Everyone's look lives in src/story/people.json, so new people can be added without touching code. */
export const LOOKS: Record<string, Look> = PEOPLE as Record<string, Look>;

export function isLook(id: string | undefined): id is string {
  return !!id && id in LOOKS;
}

/** Speaker name in the script → look. */
export const LOOK_BY_NAME: Record<string, Look> = Object.fromEntries(Object.values(LOOKS).map((l) => [l.name, l]));

export interface PoseOpts {
  expr?: Expr;
  /** Mouth flaps while the text types out. */
  talking?: boolean;
  blink?: boolean;
}

/**
 * Draws a person standing with their feet at (x, y), facing f (±1). `time`
 * drives the idle breathing and the talking mouth.
 */
export function drawPerson(ctx: Ctx, x0: number, y: number, look: Look, f: number, time: number, o: PoseOpts = {}) {
  const x = Math.round(x0);
  const bob = Math.sin(time * 3 + x0 * 0.7) * 0.4;
  const hy = Math.round(y - 14 - look.tall + bob); // head centre
  const dTop = hy + 5;
  const dBot = Math.round(y - 3 + bob);

  // Hair behind the head.
  if (look.hairStyle === "long") {
    const shift = () => -f * 1.5;
    outlined((dx, dy, c) => spans(ctx, x, hy - 2, Math.round(y - 5 + bob), (t) => lerp(5.5, 5, t), shift, dx, dy, c), look.hair);
    spans(ctx, x - f, hy + 2, Math.round(y - 5 + bob), (t) => lerp(2, 3, t), shift, 0, 0, look.hairShade);
  } else if (look.hairStyle === "short") {
    outlined((dx, dy, c) => spans(ctx, x, hy - 2, hy + 4, (t) => lerp(6, 6.5, t), () => -f, dx, dy, c), look.hair);
  }

  // Legs and boots.
  for (const lx of [x - 2, x + 2]) {
    for (let yy = dBot; yy < y - 2; yy++) px(ctx, lx, yy, yy % 2 ? look.legs[1] : look.legs[0]);
    blob(ctx, lx, y - 1.3, 1.8, 1.2, look.boot, P.outline);
  }

  // Dress: a bell skirt, longer on grown-ups since their heads sit higher.
  const half = (t: number) => lerp(3.5, 6 + look.tall * 0.3, Math.pow(t, 1.2));
  const none = () => 0;
  outlined((dx, dy, c) => spans(ctx, x, dTop, dBot, half, none, dx, dy, c), look.dress);
  spans(ctx, x - f, dTop + 2, dBot, (t) => half(t) * 0.45, none, 0, 0, look.dressShade);
  for (let i = -11; i <= 11; i++) if (Math.abs(i) < half(1)) px(ctx, x + i, dBot, i % 2 ? look.hem : look.dress);
  if (look.apron) {
    spans(ctx, x + f, dTop + 2, dBot - 1, (t) => lerp(2, 3.5, t), none, 0, 0, look.apron);
    rect(ctx, x + f - 3, dTop + 2, 6, 1, look.apron);
  }
  // A hand resting in front.
  blob(ctx, x + f * 4, dTop + 3, 1.3, 1.3, look.skin, P.outline);

  // Head, with the hair framing a 3/4 face.
  blob(ctx, x, hy, 6.5, 6, look.skin, P.outline);
  ellipse(ctx, x, hy, 6.5, 6, look.hair, hy - 1);
  ellipse(ctx, x - f * 3.5, hy + 0.5, 3.2, look.hairStyle === "short" ? 4 : 5.5, look.hair);
  for (let i = -5; i <= 6; i++) {
    if ((i * f + 6) % 3 !== 0) px(ctx, x + i, hy - 1, look.hair);
    else if (i * f > -1) px(ctx, x + i, hy - 1, look.hairShade);
  }
  for (let yy = hy; yy <= hy + (look.hairStyle === "short" ? 2 : 4); yy++) px(ctx, x - f, yy, look.hairShade);
  if (look.hairStyle !== "short") {
    const lockX = x + f * 6 - (f > 0 ? 1 : 0);
    rect(ctx, lockX, hy - 1, 1, 5, look.hair);
    px(ctx, lockX, hy + 3, look.hairShade);
  }
  if (look.hairStyle === "bun" && look.hat !== "scarf") {
    blob(ctx, x - f * 2, hy - 6, 3, 2.6, look.hair, P.outline);
    px(ctx, x - f * 3, hy - 7, look.hairShade);
  }

  drawFace(ctx, x, hy, f, look, time, o);

  drawHat(ctx, x, hy, f, look);
}

function drawFace(ctx: Ctx, x: number, hy: number, f: number, look: Look, time: number, o: PoseOpts) {
  const expr = o.expr ?? "normal";
  const eyes = [x + f, x + f * 4];
  const mx = x + f * 3;
  const E = P.eye;
  const left = f < 0 ? 1 : 0; // two-wide marks start one pixel further left when facing left
  if (o.blink && expr !== "happy" && expr !== "sleepy") {
    for (const ex of eyes) px(ctx, ex, hy + 2, E);
  } else {
    switch (expr) {
      case "happy":
        for (const ex of eyes) { px(ctx, ex, hy + 1, E); px(ctx, ex - 1, hy + 2, E); px(ctx, ex + 1, hy + 2, E); }
        break;
      case "surprised":
        for (const ex of eyes) rect(ctx, ex, hy, 1, 3, E);
        break;
      case "sleepy":
        for (const ex of eyes) rect(ctx, ex - left, hy + 2, 2, 1, E);
        break;
      case "smug":
        for (const ex of eyes) { rect(ctx, ex - left, hy + 1, 2, 1, E); px(ctx, ex, hy + 2, E); }
        break;
      case "angry":
        for (const ex of eyes) rect(ctx, ex, hy + 1, 1, 2, E);
        // Brows slanting down towards the nose.
        px(ctx, x, hy - 1, E); px(ctx, x + f * 2, hy, E);
        px(ctx, x + f * 5, hy - 1, E); px(ctx, x + f * 3, hy, E);
        break;
      default:
        for (const ex of eyes) rect(ctx, ex, hy + 1, 1, 2, E);
    }
  }
  if (look.glasses) {
    // Little round rims: a glint on top, the frame underneath.
    for (const ex of eyes) { px(ctx, ex - 1, hy + 3, P.stoneDark); px(ctx, ex, hy + 3, P.stoneDark); px(ctx, ex + 1, hy + 3, P.stoneDark); px(ctx, ex + f, hy, P.white); }
  }
  px(ctx, x, hy + 3, P.cheek);
  px(ctx, x + f * 5, hy + 3, P.cheek);

  // Mouth.
  const open = o.talking && Math.sin(time * 20) > -0.2;
  if (expr === "surprised") rect(ctx, mx - left, hy + 4, 2, 2, P.mouth);
  else if (expr === "sweat" && !open) { px(ctx, mx - 1, hy + 5, P.mouth); px(ctx, mx, hy + 4, P.mouth); px(ctx, mx + 1, hy + 5, P.mouth); }
  else if (open) rect(ctx, mx, hy + 4, 1, 2, P.mouth);
  else if (expr === "happy" || expr === "smug") rect(ctx, mx - left, hy + 4, 2, 1, P.mouth);
  else px(ctx, mx, hy + 4, P.mouth);

  // Little extras floating by the head.
  if (expr === "sweat") {
    const sx = x + f * 8;
    px(ctx, sx, hy - 2, P.iceHi);
    rect(ctx, sx - (f < 0 ? 0 : 0), hy - 1, 1, 2, P.ice);
    px(ctx, sx + f, hy, P.iceDark);
  } else if (expr === "angry") {
    const ax = x - f * 6, ay = hy - 8;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) px(ctx, ax + dx * 2, ay + dy * 2, P.red);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) px(ctx, ax + dx, ay + dy, P.red);
  } else if (expr === "sleepy") {
    const zx = x + f * 8, zy = hy - 7 + Math.round(Math.sin(time * 2));
    rect(ctx, zx - 1, zy, 3, 1, P.white); px(ctx, zx, zy + 1, P.white); rect(ctx, zx - 1, zy + 2, 3, 1, P.white);
  }
}

function drawHat(ctx: Ctx, x: number, hy: number, f: number, look: Look) {
  const [main, dark, hi] = look.hatColor;
  const hbY = hy - 5.5;
  if (look.hat === "witch" || look.hat === "tall") {
    const tall = look.hat === "tall";
    const coneH = tall ? 15 : 11;
    const baseX = x - f * 0.5;
    const tipX = tall ? x - f * 1.5 : x - f * 3;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= coneH; i++) {
        const t = i / coneH;
        const cx = lerp(baseX, tipX, tall ? t : t * t);
        const half = 5 * (1 - t) + 0.6;
        const yy = hbY - i;
        if (pass === 0) rect(ctx, cx - half - 1, yy - 1, half * 2 + 2, 3, P.outline);
        else {
          rect(ctx, cx - half, yy, half * 2, 1, i <= 2 ? dark : main);
          if (i > 2) px(ctx, cx - half * 0.5 * f, yy, hi);
        }
      }
    }
    const sx = Math.round(baseX + f);
    const star = tall ? P.magicPurple : P.magicYellow;
    px(ctx, sx, hbY - 2, star);
    px(ctx, sx - 1, hbY - 1, star); px(ctx, sx + 1, hbY - 1, star); px(ctx, sx, hbY - 1, P.white);
    blob(ctx, baseX, hbY + 0.5, tall ? 10 : 9, 1.5, main, P.outline);
    px(ctx, tipX, hbY - coneH - 1, star);
  } else if (look.hat === "scarf") {
    // A polka-dot headscarf tied at the back, a bun peeking out beneath.
    blob(ctx, x, hy - 1, 7, 5.5, main, P.outline, hy - 1);
    rect(ctx, x - 7, hy - 1, 15, 1, dark);
    for (const [dx, dy] of [[-3, -4], [2, -5], [4, -2], [-5, -2], [0, -2]]) px(ctx, x + dx, hy + dy, hi);
    blob(ctx, x - f * 7, hy, 2, 1.5, main, P.outline);
    px(ctx, x - f * 8, hy + 2, dark);
    px(ctx, x - f * 7, hy + 2, dark);
  } else if (look.hat === "helmet") {
    // A round hard hat with a ridge down the middle and a peak at the front.
    blob(ctx, x, hy - 1, 7, 6, main, P.outline, hy - 1);
    rect(ctx, x - 7, hy - 1, 14, 1, dark);
    rect(ctx, x + (f > 0 ? 6 : -9), hy - 1, 3, 1, dark);
    px(ctx, x + (f > 0 ? 9 : -10), hy - 1, P.outline);
    for (let yy = hy - 6; yy <= hy - 2; yy++) px(ctx, x, yy, hi);
    px(ctx, x - f * 3, hy - 4, hi);
  } else if (look.hat === "straw") {
    blob(ctx, x - f * 0.5, hbY - 2, 4.5, 3, main, P.outline, hbY);
    rect(ctx, x - f * 0.5 - 4, hbY - 1, 9, 1, P.red);
    blob(ctx, x - f * 0.5, hbY + 0.5, 10, 1.6, main, P.outline);
    rect(ctx, x - f * 0.5 - 8, hbY, 16, 1, hi);
    px(ctx, x - f * 0.5 + 9, hbY + 1, dark);
  }
}

// ------------------------------------------------------------------ in the world

/** Whether a map object's condition holds: space-separated flags, "!flag" for "not set". Empty = always. */
export function condMet(cond: string | undefined, has: (flag: string) => boolean) {
  if (!cond) return true;
  return cond.split(/[\s,&]+/).filter(Boolean).every((c) => (c.startsWith("!") ? !has(c.slice(1)) : has(c)));
}

/** Someone standing by the road who talks when you press up beside them. */
export class Npc {
  facing: number;
  private blinkT = 2 + Math.random() * 2;
  /** A bubble of theirs is up: their face shows the line's feeling. */
  speaking = false;
  /** The words are still typing out: the mouth moves. */
  talking = false;
  expr: Expr = "normal";
  /** Script staging (stagecraft.ts): how high a hop has lifted them, how visible they are, and whether they keep the way the script turned them. */
  hop = 0;
  alpha = 1;
  gone = false;
  scripted = false;

  constructor(
    public x: number,
    readonly y: number,
    readonly look: Look,
    /** Script section to run. */
    readonly talk: string,
    readonly cond: string,
    facing = -1,
    readonly period = "",
    /** Script section they mutter when the witch comes near (no need to stop and listen). */
    readonly bark = "",
    /** How close (px, left or right) the witch has to be for them to mutter. */
    readonly barkR = 64,
    /** Seconds of quiet after muttering before they'll say it again. */
    readonly barkCd = 12,
  ) {
    this.facing = facing;
  }

  near(px: number, py: number) {
    return !this.gone && Math.abs(px - this.x) < 20 && Math.abs(py - this.y) < 24;
  }

  update(dt: number, px: number, py: number) {
    if (!this.scripted && Math.abs(px - this.x) < 70 && Math.abs(py - this.y) < 50 && Math.abs(px - this.x) > 2) this.facing = Math.sign(px - this.x);
    this.blinkT -= dt;
    if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 2.5;
  }

  draw(ctx: Ctx, time: number, near: boolean) {
    if (this.gone && this.alpha <= 0) return;
    ctx.globalAlpha = this.alpha;
    drawPerson(ctx, this.x, this.y - Math.round(this.hop), this.look, this.facing, time, {
      expr: this.speaking ? this.expr : "normal", talking: this.talking, blink: this.blinkT < 0,
    });
    ctx.globalAlpha = 1;
    if (this.gone) return;
    if (near && !this.speaking) {
      // A speech bubble with three dots bobbing over their head.
      const bx = this.x, by = Math.round(this.y - 40 - this.look.tall + Math.sin(time * 5));
      rect(ctx, bx - 6, by - 4, 12, 7, P.outline);
      rect(ctx, bx - 5, by - 3, 10, 5, P.white);
      px(ctx, bx - 1, by + 3, P.outline); px(ctx, bx, by + 3, P.outline); px(ctx, bx - 1, by + 2, P.white);
      const n = Math.floor(time * 3) % 4;
      for (let i = 0; i < 3; i++) if (i < n) px(ctx, bx - 3 + i * 3, by - 1, P.outline);
    }
  }
}

/**
 * An invisible box that starts a conversation once, the first time you walk
 * into it — or, as a muttering, a few bubbles that don't stop the player.
 */
export class Trigger {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly w: number,
    readonly h: number,
    readonly talk: string,
    readonly cond: string,
    /** Remembered in the save as seen:<key> once it has fired. */
    readonly key: string,
    readonly period = "",
    /** "bark": said in bubbles while you keep walking; "" : a conversation you stop for. */
    readonly mode = "",
    /** A muttering that can play again after you walk out and back in. */
    readonly repeat = false,
  ) {}

  contains(px: number, py: number) {
    return Math.abs(px - this.x) <= this.w / 2 && py <= this.y + 2 && py >= this.y - this.h;
  }
}
