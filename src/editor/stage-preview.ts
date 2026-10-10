import { sfx } from "../engine/audio";
import { Typer, type Line } from "../game/dialogue";
import { Bubble, drawEmote, headHeight, splitThought } from "../game/bubbles";
import { drawPerson, LOOK_BY_NAME, LOOKS, type Expr, type Look } from "../game/people";
import { fitFrame, fontVersion } from "../game/pixelui";
import { ELEMENTS, FORMS } from "../game/runes";
import type { PlayRequest, ScriptDoc } from "./script-doc";

/**
 * A little stage that acts out one line of the script with the game's own
 * bubbles, faces and people, and can play a conversation on from there
 * (click to turn the page, pick options, answer conditions yourself).
 */

/** One moment of the script: a line in a section. */
export interface View {
  section: string;
  pc: number;
  line: Line | null;
}

const PX = 2;
const STAGE_W = 180, STAGE_H = 104, FEET = 92;
const LEFT_X = 58, RIGHT_X = 122;
const PLAYER = LOOKS.ariri?.name ?? "阿梨梨";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = "") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export interface StageHooks {
  /** The play-through moved to another line (so the editor can follow it). */
  onLine?: (v: View) => void;
  /** ◂ ▸ buttons. */
  step?: (dir: number) => void;
  play: (req: PlayRequest) => void;
}

export class StagePreview {
  readonly el = el("div", "sc-preview");
  private stage = el("div", "sc-stage");
  private canvas = el("canvas");
  private caption = el("div", "sc-caption");
  private note = el("div", "sc-note");
  private buttons = el("div", "sc-stage-buttons");
  private info = el("div", "sc-stage-info");
  private bubble: Bubble;
  private picker: Bubble;

  private view: View | null = null;
  playing = false;
  private ask: "page" | "choice" | "if" | "note" | "end" = "page";
  private hops = 0;
  private typer = new Typer();
  private lineT = 0;
  private raf = 0;
  private lastT = 0;
  private fontSeen = -1;

  constructor(private doc: ScriptDoc, private hooks: StageHooks) {
    this.canvas.width = STAGE_W;
    this.canvas.height = STAGE_H;
    this.stage.style.setProperty("--px", `${PX}px`);
    this.stage.style.setProperty("--fs", "12px");
    this.stage.style.setProperty("--lh", "14px");
    this.stage.append(this.canvas, this.caption, this.note);
    this.stage.onpointerdown = (e) => { if (!(e.target as HTMLElement).closest(".bb-opt, button")) this.click(); };
    this.el.append(el("div", "sc-side-title", "预览 <small>选中哪句，就演哪句</small>"), this.stage, this.info, this.buttons);
    this.bubble = new Bubble(this.stage, "talk");
    this.picker = new Bubble(this.stage, "talk picker");
    this.renderButtons();
  }

  start() {
    cancelAnimationFrame(this.raf);
    this.lastT = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.playing) this.endPlay();
  }

  /** Shows one line, fully typed (unless it's the same one already showing). */
  show(v: View | null) {
    if (this.playing) this.endPlay();
    const same = v && this.view && v.section === this.view.section && v.pc === this.view.pc && v.line === this.view.line;
    this.view = v;
    if (!same) this.present(false);
    this.renderButtons();
  }

  /** The line under a script line number, as a view. */
  viewAt(src: number): View | null {
    const at = this.doc.at.get(src);
    return at ? { section: at.section, pc: at.pc, line: at.line } : null;
  }

  private endPlay() {
    this.playing = false;
    this.renderButtons();
  }

  /** Who stands on the right: whoever this section talks with (not the witch). */
  private partner(section: string, pc: number): Look | null {
    const lines = this.doc.parsed.script[section] ?? [];
    for (let i = pc; i >= 0; i--) { const l = lines[i]; if (l?.t === "say" && l.who && l.who !== PLAYER && LOOK_BY_NAME[l.who]) return LOOK_BY_NAME[l.who]; }
    for (const l of lines) if (l.t === "say" && l.who && l.who !== PLAYER && LOOK_BY_NAME[l.who]) return LOOK_BY_NAME[l.who];
    const use = this.doc.useFor(section);
    if (use?.obj?.type === "npc") return LOOKS[use.obj.kind ?? ""] ?? null;
    return null;
  }

  private present(typing: boolean) {
    const v = this.view;
    this.bubble.hide();
    this.picker.hide();
    this.caption.classList.remove("show");
    this.note.className = "sc-note";
    this.note.innerHTML = "";
    this.lineT = 0;
    const l = v?.line;
    if (!v || !l) {
      this.info.textContent = v ? "这里还是空的" : "选中一句台词或一个节点";
      return;
    }
    const sec = this.doc.parsed.sections.find((s) => s.id === v.section);
    this.info.innerHTML = `<b>${esc(sec?.title || v.section)}</b> · 第 ${l.src} 行`;
    if (l.t === "say") {
      const { thought, text } = splitThought(l.text);
      this.typer.set(text);
      if (!typing) this.typer.finish();
      if (!l.who) {
        this.caption.textContent = text;
        this.caption.classList.add("show");
        fitFrame(this.caption, "caption", PX);
        this.caption.style.left = `${Math.round((STAGE_W * PX - this.caption.offsetWidth) / 2 / PX) * PX}px`;
        return;
      }
      const b = this.bubble;
      b.setName(l.who, LOOK_BY_NAME[l.who] ?? null);
      b.setText(text);
      b.reveal(typing ? 0 : text.length);
      b.setChoices("");
      b.mode({ thought, free: false });
      b.el.classList.toggle("done", !typing);
      b.show(true);
      this.place(b, this.headFor(l.who));
      return;
    }
    if (l.t === "choice") {
      const p = this.picker;
      p.setName("");
      p.setText("");
      p.el.classList.add("choosing");
      p.setChoices(l.options.map((o, i) => `<div class="bb-opt${i === 0 ? " on" : ""}" data-i="${i}">${esc(o.text)}</div>`).join(""));
      p.choicesEl.querySelectorAll<HTMLElement>(".bb-opt").forEach((d) => {
        d.onpointerdown = (e) => { e.stopPropagation(); this.pick(Number(d.dataset.i)); };
        d.onpointerenter = () => p.choicesEl.querySelectorAll(".bb-opt").forEach((o) => o.classList.toggle("on", o === d));
      });
      p.mode({});
      p.show(true);
      this.place(p, this.headFor(PLAYER));
      this.ask = "choice";
      return;
    }
    this.note.classList.add("show");
    if (l.t === "if") {
      this.note.innerHTML = `<span>❓ 如果 <b>${esc(l.cond)}</b> → ${esc(l.to)}</span>` + (this.playing ? `<span class="sc-yn"><button data-yes>成立</button><button data-no>不成立</button></span>` : "");
      this.note.querySelector<HTMLButtonElement>("[data-yes]")?.addEventListener("click", () => this.jumpTo(l.to));
      this.note.querySelector<HTMLButtonElement>("[data-no]")?.addEventListener("click", () => this.advance());
      this.ask = "if";
    } else if (l.t === "goto") {
      this.note.innerHTML = `<span>↪ 跳到 <b>${esc(l.to)}</b></span>`;
      this.ask = "note";
    } else if (l.t === "cmd") {
      this.note.innerHTML = `<span>${describeCommand(l.name, l.args)}</span>`;
      this.ask = l.name === "end" || l.name === "ending" ? "end" : "note";
      if (this.playing && l.name === "sfx") sfx.init();
    }
  }

  private headFor(who: string) {
    const look = LOOK_BY_NAME[who];
    if (who === PLAYER) return { x: LEFT_X, y: FEET - 31 };
    if (look) return { x: RIGHT_X, y: FEET - headHeight(look) };
    return null;
  }

  /** Puts a bubble over a head on the stage, like layoutBubbles does in the game. */
  private place(b: Bubble, head: { x: number; y: number } | null) {
    const W = STAGE_W * PX, H = STAGE_H * PX;
    b.mode({ thought: b.el.classList.contains("thought"), free: !head });
    b.size(PX, W - PX * 8);
    const g = (v: number) => Math.round(v / PX) * PX;
    if (!head) {
      b.el.style.transform = `translate(${g((W - b.w) / 2)}px, ${g(H - b.h - PX * 3)}px)`;
      return;
    }
    const sx = head.x * PX, sy = head.y * PX;
    const x = g(Math.min(Math.max(PX * 2, sx - b.w / 2), W - b.w - PX * 2));
    const y = g(Math.max(PX * 2, sy - b.h - (b.el.classList.contains("thought") ? 9 : 3) * PX));
    const tx = g(Math.min(Math.max(PX * 6, sx - x), b.w - PX * 6));
    b.el.style.setProperty("--tx", `${tx}px`);
    b.el.classList.toggle("flip", tx > b.w / 2);
    b.el.style.transform = `translate(${x}px, ${y}px)`;
  }

  private renderButtons() {
    const v = this.view;
    const use = v && this.doc.useFor(v.section);
    this.buttons.innerHTML = this.playing
      ? `<button data-a="next">下一步 ▸</button><button data-a="stop">■ 停止</button>`
      : `<button data-a="prev" title="上一句">◂</button><button data-a="nextline" title="下一句">▸</button>
         <button data-a="play" class="sc-primary" title="从这句开始一句句演下去（点舞台翻页）">▶ 从这里演</button>
         <button data-a="game" title="${use ? `去「${esc(use.label)}」，从这句开始` : "在当前位置从这句开始"}">🎮 进游戏试玩</button>`;
    for (const b of this.buttons.querySelectorAll<HTMLButtonElement>("button")) b.onclick = () => this.action(b.dataset.a!);
  }

  private action(a: string) {
    const v = this.view;
    if (a === "stop") { this.endPlay(); return; }
    if (a === "next") { this.click(); return; }
    if (a === "prev" || a === "nextline") { this.hooks.step?.(a === "prev" ? -1 : 1); return; }
    if (!v) return;
    if (a === "play") {
      sfx.init();
      this.playing = true;
      this.hops = 0;
      this.present(true);
      this.renderButtons();
      this.moved();
      return;
    }
    if (a === "game") {
      const use = this.doc.useFor(v.section);
      this.hooks.play({ section: v.section, at: v.pc, map: use?.map, obj: use?.obj });
    }
  }

  private moved() {
    if (!this.view?.line) { this.finish(); return; }
    if (this.view.line.t === "say") this.ask = "page";
    this.hooks.onLine?.(this.view);
  }

  private click() {
    if (!this.playing) return;
    if (this.ask === "page" && this.typer.typing) { this.typer.finish(); return; }
    if (this.ask === "choice" || this.ask === "if") return;
    if (this.ask === "end") { this.finish(); return; }
    const l = this.view?.line;
    if (l?.t === "goto") { this.jumpTo(l.to); return; }
    this.advance();
  }

  private pick(i: number) {
    const l = this.view?.line;
    if (l?.t !== "choice" || !this.playing) return;
    sfx.menuMove();
    const to = l.options[i].to;
    if (to) this.jumpTo(to);
    else this.advance();
  }

  private jumpTo(section: string) {
    const lines = this.doc.parsed.script[section];
    if (!lines || ++this.hops > 200) { this.finish(); return; }
    this.view = { section, pc: 0, line: lines[0] ?? null };
    this.present(true);
    this.moved();
  }

  private advance() {
    const v = this.view;
    if (!v || ++this.hops > 400) { this.finish(); return; }
    const lines = this.doc.parsed.script[v.section] ?? [];
    this.view = { section: v.section, pc: v.pc + 1, line: lines[v.pc + 1] ?? null };
    if (!this.view.line) { this.finish(); return; }
    this.present(true);
    this.moved();
  }

  private finish() {
    this.bubble.hide();
    this.picker.hide();
    this.caption.classList.remove("show");
    this.note.className = "sc-note show";
    this.note.innerHTML = `<span>— 对话结束 —</span>`;
    this.ask = "end";
    this.endPlay();
  }

  private frame(t: number) {
    this.raf = requestAnimationFrame((n) => this.frame(n));
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    this.lineT += dt;
    const l = this.view?.line;
    if (l?.t === "say" && this.typer.typing) {
      this.typer.step(dt, this.playing ? (l.who && LOOK_BY_NAME[l.who]?.voice) || 520 : 0);
      if (l.who) {
        this.bubble.reveal(this.typer.shown);
        if (!this.typer.typing) this.bubble.el.classList.add("done");
      } else this.caption.textContent = this.typer.visible;
    }
    this.draw(t / 1000);
  }

  private draw(time: number) {
    const ctx = this.canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const sky = ctx.createLinearGradient(0, 0, 0, STAGE_H);
    sky.addColorStop(0, "#9fd8ff");
    sky.addColorStop(1, "#e8f6ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    ctx.fillStyle = "#c9ecc1";
    for (let x = 0; x < STAGE_W; x++) ctx.fillRect(x, 70 + Math.round(Math.sin(x / 19) * 4 + Math.sin(x / 7) * 1.5), 1, STAGE_H);
    ctx.fillStyle = "#7fd06b";
    ctx.fillRect(0, FEET, STAGE_W, STAGE_H - FEET);
    ctx.fillStyle = "#5fb55a";
    ctx.fillRect(0, FEET, STAGE_W, 2);
    ctx.fillStyle = "#b7875a";
    ctx.fillRect(0, FEET + 5, STAGE_W, STAGE_H);
    for (let x = 3; x < STAGE_W; x += 11) { ctx.fillStyle = "#a57750"; ctx.fillRect(x, FEET + 8 + (x % 3), 2, 1); }

    const v = this.view;
    const l = v?.line ?? null;
    const say = l?.t === "say" ? l : null;
    const other = v ? this.partner(v.section, v.pc) : null;
    const talking = !!say && this.typer.typing;
    const me = LOOKS.ariri;
    const exprOf = (name: string): Expr => (say && say.who === name ? say.expr : "normal");
    if (me) drawPerson(ctx, LEFT_X, FEET, me, 1, time, { expr: exprOf(PLAYER), talking: talking && say?.who === PLAYER, blink: Math.sin(time * 1.3) > 0.97 });
    if (other) drawPerson(ctx, RIGHT_X, FEET, other, -1, time, { expr: exprOf(other.name), talking: talking && say?.who === other.name, blink: Math.sin(time * 1.1 + 1) > 0.97 });
    if (say?.who && say.expr !== "normal") {
      const head = this.headFor(say.who);
      if (head) drawEmote(ctx, head.x, head.y + 12, say.who === PLAYER ? 1 : -1, say.expr, this.lineT);
    }
    if (this.fontSeen !== fontVersion) {
      this.fontSeen = fontVersion;
      if (this.bubble.visible && say?.who) this.place(this.bubble, this.headFor(say.who));
      if (this.picker.visible) this.place(this.picker, this.headFor(PLAYER));
    }
  }
}

/** A command in words, for the stage and the node cards. */
export function describeCommand(name: string, args: string[]) {
  const a = args.map(esc);
  switch (name) {
    case "learn": return `✨ 学会符文：<b>${esc(ELEMENTS[args[0] as keyof typeof ELEMENTS]?.name ?? args[0] ?? "")}</b>`;
    case "form": return `✨ 学会形态：<b>${esc(FORMS[args[0] as keyof typeof FORMS]?.name ?? args[0] ?? "")}</b>`;
    case "wand": return `🪄 拿出法杖`;
    case "item": return `🎁 得到 <b>${a[0] ?? ""} ×${a[1] ?? 1}</b>`;
    case "take": return `📤 交出 <b>${a[0] ?? ""} ×${a[1] ?? 1}</b>`;
    case "flag": return `🚩 记住 <b>${a.join(" ")}</b>`;
    case "unflag": return `🚩 忘掉 <b>${a.join(" ")}</b>`;
    case "wait": return `⏸ 等玩家：<b>${a[0] ?? ""}</b>　${a.slice(1).join(" ")}`;
    case "quest": return `📜 接任务：<b>${a.slice(1).join(" ") || a[0] || ""}</b>`;
    case "stage": return `📜 任务 ${a[0] ?? ""} 进入 <b>${a[1] ?? ""}</b>`;
    case "done": return `✔ 完成任务 <b>${a.join(" ")}</b>`;
    case "banner": return `🏷 大字：<b>${a.join(" ")}</b>`;
    case "heal": return `💗 回满血`;
    case "ending": return `🎬 结束画面`;
    case "period": return `🕒 时段变成 <b>${a[0] ?? ""}</b>`;
    case "nextperiod": return `🕒 进入下一个时段`;
    case "end": return `■ 对话结束`;
    case "pause": return `… 停顿 <b>${a[0] ?? 1}</b> 秒`;
    case "act": return `🏃 <b>${a[0] ?? ""}</b> ${a[1] ?? ""}${args[1] === "走" ? ` ${a[2] ?? ""}` : ""}`;
    case "camera": return args[0] && args[0] !== PLAYER ? `🎥 镜头看向 <b>${a[0]}</b>` : `🎥 镜头回到阿梨梨`;
    case "shake": return `📳 震屏 <b>${"▮".repeat(Math.max(1, Math.min(3, Number(args[0]) || 1)))}</b>`;
    case "sfx": return `♪ 音效：<b>${a[0] ?? ""}</b>`;
    default: return `⚙ !${esc(name)} ${a.join(" ")}`;
  }
}

