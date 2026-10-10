import { sfx } from "../engine/audio";
import { drawSprite, ellipse, px, rect, ring, setOverride, type Ctx } from "../engine/gfx";
import { drawText, textWidth } from "../engine/font";
import type { Input } from "../engine/input";
import { clamp, damp, lerp, makeRng, rand } from "../engine/math";
import { drawMagicCircle } from "./effects";
import type { Game } from "./game";
import { P } from "./palette";
import { Particles } from "./particles";
import { BRANCH_COLOR, maxLevel, SKILL, skillPos, SKILLS, type Skill, type SkillId } from "./skills";
import { iconSprites, iconSpritesDim, iconSpritesWhite, ITEM_ORDER, itemSprites, type ItemType } from "./sprites";

const ITEM_NAMES: Record<ItemType, string> = {
  wood: "木头", stone: "石头", crystal: "水晶", gel: "凝胶", fur: "毛皮", apple: "苹果", meat: "肉",
};

const R = 9; // node radius in chart pixels
const GOLD = "#ffd24a";
const BG = "#1c1432";
const FLY_TIME = 0.42;

interface NodeAnim {
  appear: number; // <0 waiting, 0..1 popping in, >=1 shown
  sx: number; sy: number; vx: number; vy: number;
  shake: number;
  flash: number;
  stamp: number; // MAX stamp animation 0..1
}

interface Flyer {
  type: ItemType;
  amount: number;
  node: SkillId;
  batch: Batch;
  delay: number;
  t: number;
  sx: number; sy: number; // start (screen)
  bend: number;
  departed: boolean;
}

interface Batch {
  skill: Skill;
  left: number;
  landed: number;
}

interface Ring {
  x: number; y: number; r0: number; r1: number; t: number; life: number; color: string;
}

/**
 * The Magic Star Chart: a skill tree drawn on the game canvas at chunky pixel
 * zoom. Buying a node sends the materials flying into it one by one; when the
 * last one lands the node bursts, links grow out and new stars pop in.
 * Text lives in a DOM card beside the selected node so Chinese stays crisp.
 */
export class SkillTree {
  open = false;
  private t = 0;
  private closing = 0;
  private sel: Skill = SKILL.grimoire;
  private zoom = 2;
  private zoomTarget = 2;
  private camX = 0;
  private camY = 0;
  private follow = true;
  private shakeT = 0;
  private anims = new Map<SkillId, NodeAnim>();
  private links = new Map<SkillId, number>(); // grow 0..1 for the link into this node
  private inFlight = new Map<SkillId, number>(); // upgrades bought but not landed yet
  private flyers: Flyer[] = [];
  private rings: Ring[] = [];
  private owed = Object.fromEntries(ITEM_ORDER.map((t) => [t, 0])) as Record<ItemType, number>;
  private bump = Object.fromEntries(ITEM_ORDER.map((t) => [t, 0])) as Record<ItemType, number>;
  private barX = {} as Record<ItemType, number>;
  private fx: Particles;
  private stars: [number, number, number][] = [];
  private pointer: { x: number; y: number; down: boolean; moved: number } | null = null;

  private root: HTMLDivElement;
  private card: HTMLDivElement;
  private cardKey = "";
  private canvas: HTMLCanvasElement | null;

  constructor(private game: Game, host: HTMLElement) {
    this.fx = new Particles(game.world);
    const rng = makeRng(99);
    for (let i = 0; i < 70; i++) this.stars.push([rng() * 480 - 80, rng() * 300 - 60, rng()]);

    this.root = document.createElement("div");
    this.root.id = "tree";
    this.root.className = "hidden";
    this.root.innerHTML = `
      <div class="tree-card"></div>
      <div class="tree-foot">
        <span class="tree-title">✦ 魔法星盘 ✦</span>
        <span class="tree-keys">方向键 / WASD 选择 · J / 空格 升级 · Q 缩放 · R 符文编织 · E / Esc 返回</span>
        <button class="tree-reset">重置存档</button>
      </div>`;
    host.appendChild(this.root);
    this.card = this.root.querySelector(".tree-card")!;
    this.root.querySelector(".tree-reset")!.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("确定要清空所有材料、魔法和进度吗？")) game.resetSave();
    });
    this.canvas = host.querySelector("canvas");
    this.bindPointer();
  }

  // ------------------------------------------------------------------ state helpers

  /** Level as shown: upgrades whose materials are still flying don't count yet. */
  private lv(s: Skill) {
    return this.game.progress.level(s.id) - (this.inFlight.get(s.id) ?? 0);
  }

  private isAvailable(s: Skill) {
    return !s.parent || this.lv(SKILL[s.parent]) > 0;
  }

  private isHinted(s: Skill) {
    return !!s.parent && !this.isAvailable(s) && this.isAvailable(SKILL[s.parent]);
  }

  private shown(s: Skill) {
    return this.isAvailable(s) || this.isHinted(s);
  }

  private anim(id: SkillId): NodeAnim {
    let a = this.anims.get(id);
    if (!a) {
      a = { appear: 1, sx: 1, sy: 1, vx: 0, vy: 0, shake: 0, flash: 0, stamp: 1 };
      this.anims.set(id, a);
    }
    return a;
  }

  private toScreen(x: number, y: number): [number, number] {
    const vw = this.game.viewW, vh = this.game.viewH;
    return [vw / 2 + (x - this.camX) * this.zoom, vh / 2 + 8 + (y - this.camY) * this.zoom];
  }

  private toChart(sx: number, sy: number): [number, number] {
    const vw = this.game.viewW, vh = this.game.viewH;
    return [(sx - vw / 2) / this.zoom + this.camX, (sy - vh / 2 - 8) / this.zoom + this.camY];
  }

  // ------------------------------------------------------------------ open / close

  show() {
    this.open = true;
    this.closing = 0;
    this.t = 0;
    const prog = this.game.progress;
    if (!this.shown(this.sel)) this.sel = SKILL.grimoire;
    // Start on something buyable if the current pick isn't.
    if (!prog.canUpgrade(this.sel)) {
      const ready = SKILLS.find((s) => prog.canUpgrade(s));
      if (ready) this.sel = ready;
    }
    const [x, y] = skillPos(this.sel);
    this.camX = x;
    this.camY = y;
    this.follow = true;
    // Stars pop in rippling outward from the centre.
    for (const s of SKILLS) {
      const a = this.anim(s.id);
      a.appear = -s.r / 260 - 0.05;
      a.sx = a.sy = 1;
      a.stamp = 1;
    }
    this.cardKey = "";
    this.root.classList.remove("hidden");
    this.root.classList.add("in");
    sfx.bookOpen();
  }

  hide() {
    if (this.closing > 0) return;
    this.closing = 0.18;
    this.root.classList.add("hidden");
    this.root.classList.remove("in");
    this.landAll();
    sfx.bookClose();
  }

  /** Skip the flight when leaving so no upgrade is ever left half-applied. */
  private landAll() {
    for (const f of this.flyers) {
      if (!f.departed) this.owed[f.type] -= f.amount;
    }
    const batches = new Set(this.flyers.map((f) => f.batch));
    this.flyers = [];
    for (const b of batches) this.levelUp(b.skill, true);
  }

  // ------------------------------------------------------------------ input

  private bindPointer() {
    const c = this.canvas;
    if (!c) return;
    const local = (e: PointerEvent | WheelEvent): [number, number] => {
      const r = c.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * this.game.viewW, ((e.clientY - r.top) / r.height) * this.game.viewH];
    };
    c.addEventListener("pointermove", (e) => {
      if (!this.open) return;
      const [x, y] = local(e);
      if (this.pointer?.down) {
        const dx = x - this.pointer.x, dy = y - this.pointer.y;
        this.pointer.moved += Math.abs(dx) + Math.abs(dy);
        if (this.pointer.moved > 3) {
          this.camX -= dx / this.zoom;
          this.camY -= dy / this.zoom;
          this.follow = false;
        }
      } else {
        const hit = this.nodeAt(x, y);
        if (hit && hit !== this.sel) this.select(hit, false);
      }
      this.pointer = { x, y, down: this.pointer?.down ?? false, moved: this.pointer?.moved ?? 0 };
    });
    c.addEventListener("pointerdown", (e) => {
      if (!this.open) return;
      const [x, y] = local(e);
      this.pointer = { x, y, down: true, moved: 0 };
    });
    c.addEventListener("pointerup", (e) => {
      if (!this.open || !this.pointer) return;
      const [x, y] = local(e);
      if (this.pointer.moved <= 3) {
        const hit = this.nodeAt(x, y);
        if (hit) {
          this.select(hit, false);
          this.tryUpgrade(hit);
        }
      }
      this.pointer.down = false;
    });
    c.addEventListener("wheel", (e) => {
      if (!this.open) return;
      e.preventDefault();
      this.setZoom(e.deltaY < 0 ? 2 : 1);
    }, { passive: false });
  }

  private nodeAt(sx: number, sy: number): Skill | null {
    const [cx, cy] = this.toChart(sx, sy);
    for (const s of SKILLS) {
      if (!this.shown(s)) continue;
      const [x, y] = skillPos(s);
      if (Math.hypot(x - cx, y - cy) <= R + 2) return s;
    }
    return null;
  }

  private setZoom(z: number) {
    if (z === this.zoomTarget) return;
    this.zoomTarget = z;
    sfx.menuMove();
  }

  private select(s: Skill, follow: boolean) {
    if (s === this.sel) return;
    this.sel = s;
    this.follow = follow || this.follow;
    if (follow) this.follow = true;
    const a = this.anim(s.id);
    a.sx = 1.25; a.sy = 1.25; a.vx = a.vy = 0;
    sfx.menuMove();
  }

  /** Pick the nearest visible node roughly in direction (dx, dy). */
  private navigate(dx: number, dy: number) {
    const [x0, y0] = skillPos(this.sel);
    let best: Skill | null = null;
    let bestScore = Infinity;
    for (const s of SKILLS) {
      if (s === this.sel || !this.shown(s)) continue;
      const [x, y] = skillPos(s);
      const vx = x - x0, vy = y - y0;
      const d = Math.hypot(vx, vy);
      const cos = (vx * dx + vy * dy) / d;
      if (cos < 0.3) continue;
      const score = d * (1 + 2.5 * (1 - cos));
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (best) this.select(best, true);
  }

  private handle(input: Input) {
    if (input.pressed("menu")) return this.hide();
    if (input.pressed("weave")) {
      // R hops over to the weaving table.
      this.hide();
      this.game.weave.show();
      return;
    }
    if (input.pressed("left")) this.navigate(-1, 0);
    if (input.pressed("right")) this.navigate(1, 0);
    if (input.pressed("up")) this.navigate(0, -1);
    if (input.pressed("down")) this.navigate(0, 1);
    if (input.pressed("swap")) this.setZoom(this.zoomTarget === 2 ? 1 : 2);
    const confirm = input.pressed("bolt") || input.pressed("confirm") || (input.pressed("jump") && !input.pressed("up"));
    if (confirm) this.tryUpgrade(this.sel);
  }

  // ------------------------------------------------------------------ upgrading

  private deny(s: Skill, why: string) {
    const a = this.anim(s.id);
    a.shake = 0.3;
    sfx.denied();
    this.card.dataset.deny = why;
    this.card.classList.remove("deny");
    void this.card.offsetWidth;
    this.card.classList.add("deny");
  }

  private tryUpgrade(s: Skill) {
    const prog = this.game.progress;
    if (!this.isAvailable(s) || !prog.available(s)) return this.deny(s, "locked");
    if (prog.maxed(s)) return this.deny(s, "max");
    if (!prog.affordable(s)) return this.deny(s, "cost");
    const cost = prog.nextCost(s)!;
    prog.upgrade(s);
    this.inFlight.set(s.id, (this.inFlight.get(s.id) ?? 0) + 1);
    const batch: Batch = { skill: s, left: 0, landed: 0 };
    let i = 0;
    for (const [type, n] of Object.entries(cost) as [ItemType, number][]) {
      const count = Math.min(n, 6);
      for (let k = 0; k < count; k++) {
        this.flyers.push({
          type, amount: n / count, node: s.id, batch, delay: i * 0.055, t: 0,
          sx: this.barX[type] ?? this.game.viewW / 2, sy: 7, bend: rand(-40, 40), departed: false,
        });
        this.owed[type] += n / count;
        batch.left++;
        i++;
      }
    }
    // Materials have left the purse but still show until each one takes off.
    if (batch.left === 0) this.levelUp(s, false);
    sfx.treeCharge();
    this.cardKey = "";
  }

  private levelUp(s: Skill, quiet: boolean) {
    const left = (this.inFlight.get(s.id) ?? 1) - 1;
    if (left > 0) this.inFlight.set(s.id, left);
    else this.inFlight.delete(s.id);
    const lvl = this.lv(s);
    const first = lvl === 1;
    const maxed = lvl >= maxLevel(s);
    this.game.onUpgraded(s);
    this.cardKey = "";
    if (quiet) return;

    const [x, y] = skillPos(s);
    const col = BRANCH_COLOR[s.branch];
    const a = this.anim(s.id);
    a.sx = 1.7; a.sy = 0.55; a.vx = a.vy = 0;
    a.flash = 0.14;
    this.shakeT = maxed || s.spell ? 0.35 : 0.2;
    this.rings.push({ x, y, r0: R, r1: R + 22, t: 0, life: 0.45, color: col.main });
    this.rings.push({ x, y, r0: R - 2, r1: R + 12, t: 0, life: 0.3, color: P.white });
    this.fx.burst(x, y, {
      count: 22, colors: [col.main, col.accent, P.white], speed: [40, 140], life: [0.3, 0.7], shape: "spark", additive: true, drag: 4,
    });
    this.fx.burst(x, y, {
      count: 5, colors: [P.white], speed: [30, 80], life: [0.5, 0.9], shape: "starSmall", drag: 2, gravity: 60,
    });
    sfx.levelUp(lvl);
    if (maxed && maxLevel(s) > 1) {
      a.stamp = 0;
      sfx.maxStamp();
    }
    if (first) {
      // Grow links to the children, then pop them (and their hinted children) in.
      let k = 0;
      for (const c of SKILLS) {
        if (c.parent !== s.id) continue;
        this.links.set(c.id, 0);
        const ca = this.anim(c.id);
        ca.appear = -0.2 - k * 0.1;
        k++;
        for (const g of SKILLS) {
          if (g.parent !== c.id) continue;
          this.links.set(g.id, 0);
          this.anim(g.id).appear = -0.45 - k * 0.1;
        }
      }
      if (s.spell) {
        sfx.unlock();
        this.rings.push({ x, y, r0: R, r1: R + 60, t: 0, life: 0.8, color: col.accent });
        this.fx.burst(x, y, {
          count: 40, colors: [P.heart, P.fire, P.volt, P.leaf, P.ice, P.magicPurple], speed: [60, 200], life: [0.5, 1.0],
          shape: "spark", additive: true, drag: 3,
        });
      }
    }
  }

  // ------------------------------------------------------------------ update

  update(dt: number, input: Input) {
    if (this.closing > 0) {
      this.closing -= dt;
      if (this.closing <= 0) this.open = false;
      return;
    }
    this.t += dt;
    this.handle(input);

    // Camera and zoom.
    this.zoom = lerp(this.zoom, this.zoomTarget, damp(14, dt));
    if (Math.abs(this.zoom - this.zoomTarget) < 0.01) this.zoom = this.zoomTarget;
    if (this.follow) {
      const [x, y] = skillPos(this.sel);
      const tx = this.zoomTarget === 1 ? x * 0.35 : x;
      const ty = this.zoomTarget === 1 ? y * 0.35 : y;
      this.camX = lerp(this.camX, tx, damp(9, dt));
      this.camY = lerp(this.camY, ty, damp(9, dt));
    }
    this.camX = clamp(this.camX, -110, 110);
    this.camY = clamp(this.camY, -100, 100);
    this.shakeT = Math.max(0, this.shakeT - dt);

    for (const s of SKILLS) {
      const a = this.anim(s.id);
      if (a.appear < 1) {
        const before = a.appear;
        a.appear = Math.min(1, a.appear + dt * 4);
        if (before <= 0 && a.appear > 0 && this.t > 0.3 && this.shown(s)) sfx.pop();
      }
      a.vx += ((1 - a.sx) * 600 - a.vx * 14) * dt;
      a.vy += ((1 - a.sy) * 600 - a.vy * 14) * dt;
      a.sx += a.vx * dt;
      a.sy += a.vy * dt;
      a.shake = Math.max(0, a.shake - dt);
      a.flash = Math.max(0, a.flash - dt);
      if (a.stamp < 1) a.stamp = Math.min(1, a.stamp + dt * 3.5);
      const g = this.links.get(s.id);
      if (g !== undefined && g < 1) this.links.set(s.id, Math.min(1, g + dt * 3.2));
    }

    // Flying materials.
    for (const f of this.flyers) {
      f.delay -= dt;
      if (f.delay > 0) continue;
      if (!f.departed) {
        f.departed = true;
        this.owed[f.type] -= f.amount;
        this.bump[f.type] = 1;
      }
      f.t += dt / FLY_TIME;
      if (f.t >= 1) {
        const b = f.batch;
        b.landed++;
        const [x, y] = skillPos(SKILL[f.node]);
        const a = this.anim(f.node);
        a.sx = 1.18; a.sy = 0.86;
        this.fx.burst(x, y, {
          count: 4, colors: [P.white, BRANCH_COLOR[b.skill.branch].accent], speed: [20, 60], life: [0.15, 0.3], shape: "px", additive: true, drag: 5,
        });
        sfx.treeTick(b.landed);
        if (b.landed >= b.left) this.levelUp(b.skill, false);
      }
    }
    this.flyers = this.flyers.filter((f) => f.t < 1);
    for (const t of ITEM_ORDER) this.bump[t] = Math.max(0, this.bump[t] - dt * 5);

    this.rings = this.rings.filter((r) => (r.t += dt) < r.life);
    this.fx.update(dt);
    // Ambient sparkles drifting off affordable nodes.
    for (const s of SKILLS) {
      if (!this.isAvailable(s) || !this.game.progress.canUpgrade(s) || Math.random() > dt * 3) continue;
      const [x, y] = skillPos(s);
      this.fx.burst(x + rand(-R, R), y + rand(-R, R), {
        count: 1, colors: [BRANCH_COLOR[s.branch].main, P.white], speed: [4, 14], angle: [-Math.PI * 0.7, -Math.PI * 0.3],
        life: [0.5, 0.9], shape: "px", additive: true,
      });
    }
    this.updateCard();
  }

  // ------------------------------------------------------------------ drawing

  draw(ctx: Ctx) {
    const vw = this.game.viewW, vh = this.game.viewH;
    const fadeIn = Math.min(1, this.t / 0.18);
    const fade = this.closing > 0 ? this.closing / 0.18 : fadeIn;
    ctx.fillStyle = `rgba(28,20,50,${0.93 * fade})`;
    ctx.fillRect(0, 0, vw, vh);
    if (fade < 0.3) return;

    // Twinkling star field with a little parallax.
    for (const [sx, sy, k] of this.stars) {
      const x = Math.round(((sx - this.camX * 0.25) % 480 + 480) % 480 - 80);
      const y = Math.round(((sy - this.camY * 0.25) % 300 + 300) % 300 - 60);
      const tw = Math.sin(this.t * (1 + k * 3) + k * 20);
      if (tw < -0.6) continue;
      px(ctx, x, y, tw > 0.7 ? P.white : k > 0.5 ? "#6a5a90" : "#4a3a78");
    }

    const shake = this.shakeT > 0 ? Math.round(Math.sin(this.t * 90) * this.shakeT * 8) : 0;
    ctx.save();
    ctx.translate(vw / 2 + shake, vh / 2 + 8);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camX, -this.camY);

    // The great circle behind everything.
    const draw = Math.min(1, this.t * 1.4);
    drawMagicCircle(ctx, 0, 0, 104, this.t * 0.08, { ax: 1, ay: 1, progress: draw, main: "#3e3070", accent: "#342a5e", alpha: 1 });
    drawMagicCircle(ctx, 0, 0, 46, -this.t * 0.15, { ax: 1, ay: 1, progress: draw, main: "#3a2d66", accent: "#30265a", alpha: 1 });

    for (const s of SKILLS) if (s.parent && this.shown(s)) this.drawLink(ctx, s);
    for (const r of this.rings) {
      const k = r.t / r.life;
      const rr = lerp(r.r0, r.r1, 1 - (1 - k) * (1 - k));
      ring(ctx, r.x, r.y, rr, rr, r.color);
      if (k < 0.5) ring(ctx, r.x, r.y, rr - 1, rr - 1, r.color);
    }
    for (const s of SKILLS) if (this.shown(s)) this.drawNode(ctx, s);
    this.fx.draw(ctx, false);
    this.fx.draw(ctx, true);
    ctx.restore();

    this.drawBar(ctx);
    this.drawFlyers(ctx);
  }

  private drawLink(ctx: Ctx, s: Skill) {
    const p = SKILL[s.parent!];
    const [x0, y0] = skillPos(p);
    const [x1, y1] = skillPos(s);
    const grow = this.links.get(s.id) ?? 1;
    const appear = Math.min(this.anim(s.id).appear, this.anim(p.id).appear);
    if (appear <= 0 && grow >= 1) return;
    const d = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / d, uy = (y1 - y0) / d;
    const a0 = R + 2, a1 = d - R - 2;
    const len = (a1 - a0) * Math.min(grow, appear > 0 ? 1 : 0);
    const owned = this.lv(s) > 0;
    const avail = this.isAvailable(s);
    const col = BRANCH_COLOR[s.branch];
    for (let i = 0; i <= len; i++) {
      const x = x0 + ux * (a0 + i), y = y0 + uy * (a0 + i);
      if (owned) {
        px(ctx, x, y, col.main);
      } else if (avail) {
        if (i % 3 !== 2) px(ctx, x, y, "#7a6aa8");
      } else if (i % 4 === 0) px(ctx, x, y, "#4a3a78");
    }
    if (owned && grow >= 1) {
      // Motes of light flowing outward along the link.
      const span = a1 - a0;
      for (let k = 0; k < 2; k++) {
        const u = ((this.t * 26 + k * span * 0.5) % span);
        const x = x0 + ux * (a0 + u), y = y0 + uy * (a0 + u);
        px(ctx, x, y, P.white);
        px(ctx, x - ux, y - uy, col.accent);
      }
    }
    if (grow < 1 && len > 0) {
      const x = x0 + ux * (a0 + len), y = y0 + uy * (a0 + len);
      ellipse(ctx, x, y, 1.5, 1.5, P.white);
    }
  }

  private drawNode(ctx: Ctx, s: Skill) {
    const a = this.anim(s.id);
    if (a.appear <= 0) return;
    // Pop-in with a little overshoot.
    const e = a.appear;
    const pop = e < 1 ? 1 + Math.sin(e * Math.PI) * 0.35 - (1 - e) * 1 : 1;
    const k = Math.max(0.05, pop);
    let [x, y] = skillPos(s);
    if (a.shake > 0) x += Math.round(Math.sin(a.shake * 80) * a.shake * 10);
    const lvl = this.lv(s);
    const max = maxLevel(s);
    const col = BRANCH_COLOR[s.branch];
    const hinted = this.isHinted(s);
    const avail = this.isAvailable(s);
    const owned = lvl > 0;
    const maxed = lvl >= max;
    const canBuy = avail && !maxed && this.game.progress.canUpgrade(s) && !this.inFlight.get(s.id);
    const selected = s === this.sel;
    const rx = R * k * a.sx, ry = R * k * a.sy;

    if (canBuy) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.18 + 0.12 * Math.sin(this.t * 5 + s.r);
      ellipse(ctx, x, y, rx + 4, ry + 4, col.main);
      ctx.restore();
    }
    if (a.flash > 0) setOverride(P.white);
    ellipse(ctx, x, y, rx + 2, ry + 2, P.outline);
    const rim = hinted ? "#3e3268" : maxed ? GOLD : owned ? col.main : avail ? "#6a5a98" : "#3e3268";
    ellipse(ctx, x, y, rx + 1, ry + 1, rim);
    ellipse(ctx, x, y, rx - 0.5, ry - 0.5, hinted ? "#221a3c" : owned ? "#4a3a7a" : "#30264e");
    if (owned) ellipse(ctx, x - rx * 0.3, y - ry * 0.35, rx * 0.35, ry * 0.2, "#5e4c94");

    if (hinted) {
      drawText(ctx, "?", x - 1, y - 2, "#6a5a98", "");
    } else {
      const spr = a.flash > 0 ? iconSpritesWhite[s.icon] : owned || canBuy ? iconSprites[s.icon] : iconSpritesDim[s.icon];
      const w = Math.round(spr.width * k), h = Math.round(spr.height * k);
      ctx.drawImage(spr, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
    }
    setOverride(null);
    if (maxed && max > 1) {
      // Orbiting sparkle on maxed nodes.
      const ang = this.t * 2 + s.r;
      px(ctx, x + Math.cos(ang) * (R + 3), y + Math.sin(ang) * (R + 3), GOLD);
    }

    // Level pips.
    if (!hinted && max > 1 && e >= 1) {
      const w = max * 3 - 1;
      for (let i = 0; i < max; i++) {
        const pxX = Math.round(x - w / 2 + i * 3);
        rect(ctx, pxX - 1, y + R + 2, 4, 4, P.outline);
        rect(ctx, pxX, y + R + 3, 2, 2, i < lvl ? (maxed ? GOLD : col.main) : "#3e3268");
      }
    }

    // MAX stamp slams in.
    if (maxed && max > 1 && e >= 1) {
      const st = a.stamp;
      if (st > 0.05) {
        // Drops from above and bounces once.
        const bounce = st < 1 ? Math.round(-(1 - st) * 12 + Math.sin(st * Math.PI) * 3) : 0;
        drawText(ctx, "MAX", x - textWidth("MAX") / 2, y - R - 9 + bounce, GOLD);
      }
    }

    if (selected) {
      // Bouncing cursor brackets.
      const o = R + 4 + Math.round(Math.abs(Math.sin(this.t * 6)) * 1.5);
      const c = Math.floor(this.t * 4) % 2 ? P.white : P.magicYellow;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const cx = Math.round(x + sx * o), cy = Math.round(y + sy * o);
        rect(ctx, cx - (sx > 0 ? 3 : 0) - 1, cy - 1, 5, 3, P.outline);
        rect(ctx, cx - 1, cy - (sy > 0 ? 3 : 0) - 1, 3, 5, P.outline);
        rect(ctx, cx - (sx > 0 ? 3 : 0), cy, 4, 1, c);
        rect(ctx, cx, cy - (sy > 0 ? 3 : 0), 1, 4, c);
      }
    }
  }

  private drawBar(ctx: Ctx) {
    const vw = this.game.viewW;
    rect(ctx, 0, 0, vw, 15, BG);
    rect(ctx, 0, 15, vw, 1, "#4a3a78");
    const inv = this.game.progress.inventory;
    const slot = Math.floor(vw / ITEM_ORDER.length);
    ITEM_ORDER.forEach((t, i) => {
      const x = i * slot + 6;
      const spr = itemSprites[t];
      const lift = Math.round(Math.sin(this.bump[t] * Math.PI) * 2);
      drawSprite(ctx, spr, x, 4 + Math.floor((7 - spr.height) / 2) - lift);
      this.barX[t] = x + spr.width / 2;
      const n = Math.round(inv[t] + this.owed[t]);
      const need = this.needOf(t);
      const color = this.bump[t] > 0 ? P.white : need > 0 ? (inv[t] + this.owed[t] >= need ? "#b8f5a0" : "#ff9eb8") : n > 0 ? P.cream : "#6a5a90";
      drawText(ctx, String(n), x + spr.width + 3, 5 - lift, color);
    });
  }

  /** How many of this item the selected node needs next (0 if none). */
  private needOf(t: ItemType) {
    const prog = this.game.progress;
    if (!this.isAvailable(this.sel)) return 0;
    return prog.nextCost(this.sel)?.[t] ?? 0;
  }

  private drawFlyers(ctx: Ctx) {
    for (const f of this.flyers) {
      if (!f.departed) continue;
      const [tx, ty] = this.toScreen(...skillPos(SKILL[f.node]));
      const e = f.t * f.t; // accelerate into the node
      const mx = (f.sx + tx) / 2 + f.bend, my = Math.min(f.sy, ty) - 30;
      const u = 1 - e;
      const x = u * u * f.sx + 2 * u * e * mx + e * e * tx;
      const y = u * u * f.sy + 2 * u * e * my + e * e * ty;
      const spr = itemSprites[f.type];
      px(ctx, x - (tx - x) * 0.05, y - (ty - y) * 0.05, P.white);
      drawSprite(ctx, spr, x - spr.width / 2, y - spr.height / 2);
    }
  }

  // ------------------------------------------------------------------ DOM card

  private updateCard() {
    const s = this.sel;
    const prog = this.game.progress;
    const lvl = this.lv(s);
    const key = `${s.id}|${lvl}|${this.isAvailable(s)}|${ITEM_ORDER.map((t) => prog.inventory[t]).join(",")}|${this.inFlight.get(s.id) ?? 0}`;
    if (key !== this.cardKey) {
      const changedNode = this.cardKey.split("|")[0] !== s.id;
      this.cardKey = key;
      this.card.innerHTML = this.cardHtml(s, lvl);
      this.card.style.setProperty("--branch", BRANCH_COLOR[s.branch].main);
      if (changedNode) {
        this.card.classList.remove("pop", "deny");
        void this.card.offsetWidth;
        this.card.classList.add("pop");
      }
    }
    // Keep the card beside the node, flipping sides near the edge.
    if (!this.canvas) return;
    const [sx, sy] = this.toScreen(...skillPos(s));
    const scale = this.canvas.clientWidth / this.game.viewW;
    const right = sx < this.game.viewW * 0.55;
    const gap = (R + 8) * this.zoom;
    const left = right ? (sx + gap) * scale : (sx - gap) * scale;
    this.card.style.left = `${Math.round(left)}px`;
    this.card.style.top = `${Math.round(clamp(sy * scale, 30 * scale, this.canvas.clientHeight - 30 * scale))}px`;
    this.card.classList.toggle("flip", !right);
  }

  private cardHtml(s: Skill, lvl: number) {
    const prog = this.game.progress;
    if (this.isHinted(s)) {
      return `<div class="tc-name">？？？</div><div class="tc-desc">点亮相邻的星星后揭晓。</div>`;
    }
    const max = maxLevel(s);
    const maxed = lvl >= max;
    const shownV = s.value ? s.value(Math.max(1, maxed ? lvl : lvl + 1)) : "";
    const desc = markup(s.desc.replace("{v}", `[green]${shownV}[]`));
    const name = s.spell ? rainbow(s.name) : escapeHtml(s.name);
    let stat = "";
    if (s.value && lvl > 0 && !maxed) {
      stat = `<div class="tc-stat">当前 <b>${s.value(lvl)}</b> <i>▶</i> <b class="up">${s.value(lvl + 1)}</b></div>`;
    }
    let cost = "";
    const c = prog.nextCost(s);
    if (c && !maxed && !this.inFlight.get(s.id)) {
      cost = `<div class="tc-cost">${(Object.entries(c) as [ItemType, number][]).map(([t, n]) => {
        const ok = prog.inventory[t] >= n;
        return `<span class="c${ok ? " ok" : ""}"><img src="${spriteUrl(itemSprites[t])}" alt="">${ITEM_NAMES[t]} ${prog.inventory[t]}/${n}</span>`;
      }).join("")}</div>`;
    }
    const foot = maxed ? `<div class="tc-foot max">已到最高等级！</div>`
      : !this.isAvailable(s) ? `<div class="tc-foot">先点亮上一颗星</div>`
      : this.inFlight.get(s.id) ? `<div class="tc-foot go">✦ 注入魔力中…</div>`
      : prog.affordable(s) ? `<div class="tc-foot go">J / 空格 / 点击 升级</div>`
      : `<div class="tc-foot no">材料不足</div>`;
    return `
      <div class="tc-head"><span class="tc-name">${name}</span><span class="tc-lv">等级 ${lvl}/${max}</span></div>
      <div class="tc-desc">${desc}</div>${stat}${cost}${foot}`;
  }
}

// ------------------------------------------------------------------ helpers

const urlCache = new Map<HTMLCanvasElement, string>();
function spriteUrl(spr: HTMLCanvasElement) {
  let u = urlCache.get(spr);
  if (!u) {
    u = spr.toDataURL();
    urlCache.set(spr, u);
  }
  return u;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Letters that each bob and cycle colour on their own offset. */
function rainbow(text: string) {
  return `<span class="rainbow">${[...text].map((ch, i) => `<span style="--i:${i}">${escapeHtml(ch)}</span>`).join("")}</span>`;
}

/** "[fire]火焰[]" → coloured keyword spans; "[rainbow]..[]" → rainbow; newlines → <br>. */
export function markup(src: string) {
  return src.split("\n").map((line) =>
    line.replace(/\[(\w+)\](.*?)\[\]/g, (_m, k: string, t: string) => (k === "rainbow" ? rainbow(t) : `<span class="kw-${k}">${escapeHtml(t)}</span>`)),
  ).join("<br>");
}
