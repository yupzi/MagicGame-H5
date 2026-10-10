import { sfx } from "../engine/audio";
import type { Input } from "../engine/input";
import SCRIPT from "../story/script.txt?raw";
import type { Game } from "./game";
import { EXPR_NAMES, LOOK_BY_NAME, type Expr, type Npc } from "./people";
import { fitFrame, fontVersion } from "./pixelui";
import { ACTS, SOUNDS } from "./stagecraft";
import { Bubble, findAnchor, headOf, onScreen, splitThought, type Anchor, type Speech } from "./bubbles";

/**
 * The dialogue script (src/story/script.txt) and the speech bubbles that play it.
 * See the top of script.txt for the format.
 */
export type Line =
  | { t: "say"; who: string | null; expr: Expr; text: string; src: number }
  | { t: "choice"; options: { text: string; to: string | null }[]; src: number }
  | { t: "goto"; to: string; src: number }
  | { t: "if"; cond: string; to: string; src: number }
  | { t: "cmd"; name: string; args: string[]; src: number };

export type Script = Record<string, Line[]>;

/** Speaker name that means "no one": narration. */
const NARRATOR = "旁白";

export const COMMANDS = ["learn", "form", "flag", "unflag", "item", "take", "wand", "quest", "stage", "done", "period", "nextperiod", "wait", "heal", "banner", "ending", "end", "pause", "act", "camera", "shake", "sfx"];
/** Staging commands (stagecraft.ts): a conversation waits for them to finish. */
export const STAGING = ["pause", "act", "camera", "shake", "sfx"];
/** A jump target that ends the conversation: `* 算了 -> 结束`. */
export const END_TARGET = "结束";

/** Item names the script may use, in Chinese or English. */
export const ITEM_NAMES: Record<string, string> = {
  木头: "wood", 石头: "stone", 水晶: "crystal", 凝胶: "gel", 毛皮: "fur", 苹果: "apple", 肉: "meat",
  wood: "wood", stone: "stone", crystal: "crystal", gel: "gel", fur: "fur", apple: "apple", meat: "meat",
};

/** What `!wait` can wait for: the player doing one of these. */
export const WAIT_ACTIONS: Record<string, string[]> = {
  魔法: ["bolt"], bolt: ["bolt"], 蓄力: ["charge"], charge: ["charge"], 跳: ["jump"], jump: ["jump"],
  切换: ["swap"], swap: ["swap"], 上: ["up"], up: ["up"], 下: ["down"], down: ["down"],
  左: ["left"], left: ["left"], 右: ["right"], right: ["right"], 走: ["left", "right"], move: ["left", "right"],
};

/** A problem in the script, pinned to its line so the editor can underline it. */
export interface ScriptIssue { line: number; msg: string; warn?: boolean }
/** A `== id ==` section as written: where it starts, its optional title and the 【chapter】 it sits in. */
export interface SectionInfo { id: string; title: string; chapter: string; line: number; end: number }

/** Parses the script. Problems are collected rather than thrown, so a typo never stops the game. */
export function parseScript(src: string) {
  const script: Script = {};
  const issues: ScriptIssue[] = [];
  const sections: SectionInfo[] = [];
  const err = (line: number, msg: string) => issues.push({ line, msg });
  let cur: Line[] | null = null;
  let chapter = "";
  let lastWho: string | null = null;
  let lastExpr: Expr = "normal";
  const rows = src.split(/\r?\n/);
  rows.forEach((raw, i) => {
    const n = i + 1;
    const s = raw.trim();
    if (!s || s.startsWith("#")) return;
    const chap = s.match(/^【\s*(.+?)\s*】$/);
    if (chap) {
      chapter = chap[1];
      return;
    }
    const sec = s.match(/^==\s*(\S+?)\s*==\s*(.*)$/);
    if (sec) {
      if (script[sec[1]]) err(n, `段落 ${sec[1]} 重复了`);
      const last = sections.at(-1);
      if (last) last.end = n - 1;
      sections.push({ id: sec[1], title: sec[2].trim(), chapter, line: n, end: rows.length });
      cur = script[sec[1]] = [];
      lastWho = null;
      lastExpr = "normal";
      return;
    }
    if (!cur) {
      err(n, "写在第一个 == 段落 == 之前，会被忽略");
      return;
    }
    const list: Line[] = cur;
    if (s.startsWith("*")) {
      const m = s.slice(1).match(/^\s*(.+?)\s*(?:->\s*(\S+))?$/);
      if (!m) return err(n, "选项的写法是 * 选项文字 -> 段落");
      const prev = list[list.length - 1];
      const opt = { text: m[1], to: m[2] ?? null };
      if (prev?.t === "choice") prev.options.push(opt);
      else list.push({ t: "choice", options: [opt], src: n });
      return;
    }
    if (s.startsWith("->")) {
      const to = s.slice(2).trim();
      if (!to) return err(n, "-> 后面要写跳到哪个段落");
      list.push({ t: "goto", to, src: n });
      return;
    }
    if (s.startsWith("?") || s.startsWith("？")) {
      const m = s.slice(1).match(/^\s*(.+?)\s*->\s*(\S+)$/);
      if (m) list.push({ t: "if", cond: m[1], to: m[2], src: n });
      else err(n, "条件的写法是 ?条件 -> 段落");
      return;
    }
    if (s.startsWith("!") || s.startsWith("！")) {
      const [name, ...args] = s.slice(1).trim().split(/\s+/);
      if (!COMMANDS.includes(name)) err(n, `不认识的命令 !${name}`);
      if ((name === "item" || name === "take") && !ITEM_NAMES[args[0]]) err(n, `不认识的东西「${args[0] ?? ""}」（可以用：${Object.keys(ITEM_NAMES).slice(0, 7).join(" ")}）`);
      if (name === "wait" && !WAIT_ACTIONS[args[0]]) err(n, `!wait 后面要写等什么（${Object.keys(WAIT_ACTIONS).filter((k) => /[^a-z]/.test(k)).join(" ")}）`);
      if (name === "pause" && !(Number(args[0]) > 0)) err(n, "!pause 后面写停几秒，比如 !pause 1.5");
      if (name === "act" && !ACTS[args[1]]) err(n, `!act 的写法：!act 名字 动作（${Object.keys(ACTS).join(" ")}），走要写距离：!act 名字 走 -30`);
      if (name === "act" && args[1] === "走" && !Number(args[2])) err(n, "走多远？比如 !act 苹果婆婆 走 30（负数往左）");
      if (name === "shake" && args[0] && !(Number(args[0]) >= 1 && Number(args[0]) <= 3)) err(n, "!shake 的强度写 1、2 或 3");
      if (name === "sfx" && !SOUNDS[args[0]]) err(n, `不认识的音效「${args[0] ?? ""}」（可以用：${Object.keys(SOUNDS).join(" ")}）`);
      list.push({ t: "cmd", name, args, src: n });
      return;
    }
    const say = s.match(SAY_RE);
    if (say) {
      const who = say[1] === NARRATOR ? null : say[1];
      let expr: Expr = "normal";
      if (say[2]) {
        const e = EXPR_NAMES[say[2]];
        if (e) expr = e;
        else err(n, `不认识的表情「${say[2]}」（可以用：${Object.keys(EXPR_NAMES).join(" ")}）`);
      }
      if (who && !LOOK_BY_NAME[who]) issues.push({ line: n, msg: `「${who}」不在人物表里（src/story/people.json），不会有名牌和声音`, warn: true });
      lastWho = who;
      lastExpr = expr;
      list.push({ t: "say", who, expr, text: say[3], src: n });
      return;
    }
    // No speaker: another page from whoever spoke last.
    list.push({ t: "say", who: lastWho, expr: lastExpr, text: s, src: n });
  });
  for (const lines of Object.values(script)) {
    for (const l of lines) {
      const targets = l.t === "goto" || l.t === "if" ? [l.to] : l.t === "choice" ? l.options.flatMap((o) => (o.to ? [o.to] : [])) : [];
      for (const to of targets) if (!script[to] && to !== END_TARGET) err(l.src, `找不到段落 ${to}`);
    }
  }
  issues.sort((a, b) => a.line - b.line);
  const errors = issues.filter((e) => !e.warn).map((e) => `第 ${e.line} 行：${e.msg}`);
  return { script, errors, issues, sections };
}

/** `名字(表情): 台词` — the speaker is up to ten characters with no spaces, colons or brackets. */
export const SAY_RE = /^([^:：\s()（）]{1,10})\s*(?:[(（]\s*([^)）]*?)\s*[)）])?\s*[:：]\s*(.*)$/;

/** The script the game plays, parsed from src/story/script.txt (or the story editor's unsaved text). */
export const SCRIPT_DATA: Script = {};
/** Its sections in script order, with titles and chapters (for pickers in the editors). */
export const SCRIPT_SECTIONS: SectionInfo[] = [];
/** The text SCRIPT_DATA came from. */
export let scriptText = "";
/** The text as last read from the file (the story editor compares against it). */
export let scriptFile = SCRIPT;
const fileListeners = new Set<(text: string) => void>();

/** Swaps in a new script without reloading anything; returns its problems. */
export function setScript(src: string) {
  const parsed = parseScript(src);
  for (const k of Object.keys(SCRIPT_DATA)) delete SCRIPT_DATA[k];
  Object.assign(SCRIPT_DATA, parsed.script);
  SCRIPT_SECTIONS.splice(0, SCRIPT_SECTIONS.length, ...parsed.sections);
  scriptText = src;
  return parsed;
}

/** Calls back when script.txt changes on disk (saved from the editor or another program). */
export function onScriptFile(fn: (text: string) => void) {
  fileListeners.add(fn);
  return () => fileListeners.delete(fn);
}

for (const e of setScript(SCRIPT).errors) console.warn(`[script.txt] ${e}`);

// Editing script.txt swaps the new lines in without reloading the page (you stay where you are).
if (import.meta.hot) {
  import.meta.hot.accept("../story/script.txt?raw", (mod) => {
    if (!mod) return;
    const text = mod.default as string;
    scriptFile = text;
    if (fileListeners.size) {
      for (const fn of fileListeners) fn(text);
      return;
    }
    const { errors } = setScript(text);
    for (const e of errors) console.warn(`[script.txt] ${e}`);
    console.info(`[script.txt] 台词已更新${errors.length ? `（${errors.length} 个问题，见上面）` : ""}`);
  });
}

const TYPE_SPEED = 38; // characters per second
const PAUSES: Record<string, number> = { "，": 0.08, "、": 0.08, "。": 0.18, "！": 0.18, "？": 0.18, "…": 0.1, "—": 0.05 };

/** Types a page out character by character with a little voice. Shared by conversations and mutterings. */
export class Typer {
  text = "";
  shown = 0;
  private wait = 0;

  set(text: string) {
    this.text = text;
    this.shown = 0;
    this.wait = 0;
  }

  get typing() {
    return this.shown < this.text.length;
  }

  get visible() {
    return this.text.slice(0, this.shown);
  }

  finish() {
    this.shown = this.text.length;
  }

  /** `voice` is the blip pitch (0 for silence). */
  step(dt: number, voice: number, volume?: number) {
    this.wait -= dt;
    while (this.wait <= 0 && this.typing) {
      const ch = this.text[this.shown++];
      this.wait += 1 / TYPE_SPEED + (PAUSES[ch] ?? 0);
      if (voice && this.shown % 2 === 1 && !PAUSES[ch] && ch !== " ") sfx.blip(voice, volume);
    }
  }
}

/**
 * Plays script sections as speech bubbles over the speakers' heads. The
 * player stands still until it's over. Narration shows as a caption at the
 * top, choices float over the witch, and anyone who isn't on screen talks
 * from a plain box at the bottom.
 */
export class Dialogue {
  /** The line being said, over whoever says it. */
  private bubble: Bubble;
  /** Choices, over the witch. */
  private picker: Bubble;
  private caption: HTMLDivElement;
  private capSaid: HTMLSpanElement;
  private capUnsaid: HTMLSpanElement;
  private lines: Line[] = [];
  private pc = 0;
  private hops = 0;
  open = false;
  /** Current page. */
  private say: Extract<Line, { t: "say" }> | null = null;
  private anchor: Anchor = null;
  private thought = false;
  /** The person the player walked up to: lines with their name float over them. */
  private talkTo: Npc | null = null;
  private typer = new Typer();
  private lineT = 0;
  private choice: Extract<Line, { t: "choice" }> | null = null;
  private pick = 0;
  private clicked = false;
  /** Section being played, for tests and debugging. */
  section = "";
  /** Runs once the conversation is over. */
  private onDone: (() => void) | null = null;
  /** `!wait`: the bubbles are hidden until the player does one of these. */
  waitFor: { actions: string[]; tip: string } | null = null;
  private resumeT = 0;
  /** Seconds left of a staging command the conversation is waiting for. */
  private hold = 0;

  constructor(private game: Game, host: HTMLElement) {
    this.bubble = new Bubble(host, "talk");
    this.picker = new Bubble(host, "talk picker");
    this.caption = document.createElement("div");
    this.caption.id = "caption";
    this.caption.innerHTML = `<span></span><span class="bb-unsaid"></span><i class="bb-next"></i>`;
    [this.capSaid, this.capUnsaid] = [...this.caption.querySelectorAll("span")];
    host.appendChild(this.caption);
    // Clicking anywhere turns the page.
    host.addEventListener("pointerdown", () => {
      if (this.open && !this.choice) this.clicked = true;
    });
  }

  has(section: string) {
    return !!SCRIPT_DATA[section];
  }

  /** Starts a section; returns false if the script has no such section. */
  /** `at` starts partway into the section (the story editor's "play from here"). */
  start(section: string, onDone?: () => void, talkTo?: Npc, at = 0) {
    const lines = SCRIPT_DATA[section];
    if (!lines) {
      console.warn(`[script.txt] 找不到段落 ${section}`);
      return false;
    }
    this.lines = lines;
    this.pc = at;
    this.hops = 0;
    this.section = section;
    this.talkTo = talkTo ?? null;
    this.onDone = onDone ?? null;
    this.open = true;
    this.clicked = false;
    this.advance();
    return true;
  }

  private jump(to: string) {
    this.lines = SCRIPT_DATA[to] ?? [];
    this.pc = 0;
    this.section = to;
  }

  /** Runs lines until one needs the player: a page of text or a choice. */
  private advance() {
    this.say = null;
    this.choice = null;
    while (this.open) {
      if (++this.hops > 500) return this.close(); // a goto loop in the script
      const l = this.lines[this.pc++];
      if (!l) return this.close();
      switch (l.t) {
        case "say":
          return this.showPage(l);
        case "choice":
          return this.showChoice(l);
        case "goto":
          this.jump(l.to);
          break;
        case "if":
          if (this.game.scriptCond(l.cond)) this.jump(l.to);
          break;
        case "cmd":
          if (l.name === "end") return this.close();
          if (l.name === "wait") return this.startWait(l.args);
          if (STAGING.includes(l.name)) {
            // Staging holds the conversation until it's done; the bubbles step aside for pauses and moves.
            const t = this.game.stagecraft.run(l.name, l.args);
            if (t > 0) {
              this.hold = t;
              if (l.name !== "shake" && l.name !== "sfx") this.hideAll();
              return;
            }
            break;
          }
          this.game.scriptCommand(l.name, l.args);
          break;
      }
    }
  }

  private hideAll() {
    this.bubble.hide();
    this.picker.hide();
    this.caption.classList.remove("show", "done");
  }

  /** Hides the bubbles and lets the player play until they do what the script asked. */
  private startWait(args: string[]) {
    const actions = WAIT_ACTIONS[args[0]] ?? ["bolt"];
    this.waitFor = { actions, tip: args.slice(1).join(" ") };
    this.resumeT = 0;
    this.open = false;
    this.say = null;
    this.hideAll();
  }

  get waiting() {
    return !!this.waitFor;
  }

  /** Called every game tick while waiting; picks the conversation back up a moment after the action. */
  updateWait(dt: number, input: Input) {
    const w = this.waitFor;
    if (!w) return;
    if (this.resumeT > 0) {
      this.resumeT -= dt;
      if (this.resumeT <= 0) {
        this.waitFor = null;
        this.open = true;
        this.advance();
      }
      return;
    }
    if (w.actions.some((a) => input.pressed(a as Parameters<Input["pressed"]>[0]))) this.resumeT = 0.7;
  }

  private showPage(l: Extract<Line, { t: "say" }>) {
    const { thought, text } = splitThought(l.text);
    this.say = l;
    this.lineT = 0;
    this.typer.set(text);
    this.picker.hide();
    if (!l.who) {
      // Narration: a caption across the top, nobody's bubble.
      this.anchor = null;
      this.bubble.hide();
      this.capSaid.textContent = "";
      this.capUnsaid.textContent = text;
      this.caption.classList.remove("done");
      this.caption.classList.add("show");
      return;
    }
    this.caption.classList.remove("show", "done");
    this.anchor = findAnchor(this.game, l.who, this.talkTo);
    this.thought = thought;
    const b = this.bubble;
    b.setName(l.who, LOOK_BY_NAME[l.who] ?? null);
    b.setText(text);
    b.setChoices("");
    b.el.classList.remove("done", "choosing");
    b.show(true);
  }

  private showChoice(l: Extract<Line, { t: "choice" }>) {
    this.choice = l;
    this.pick = 0;
    // The question stays up over whoever asked it; the answers float over the witch.
    this.bubble.el.classList.remove("done");
    this.caption.classList.remove("done");
    const b = this.picker;
    b.setName("");
    b.setText("");
    b.el.classList.add("choosing");
    b.setChoices(l.options.map((o, i) => `<div class="bb-opt" data-i="${i}">${escapeHtml(o.text)}</div>`).join(""));
    b.choicesEl.querySelectorAll<HTMLDivElement>(".bb-opt").forEach((d) => {
      d.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        this.pick = Number(d.dataset.i);
        this.choose();
      });
    });
    b.show(true);
    this.markPick();
  }

  private markPick() {
    this.picker.choicesEl.querySelectorAll(".bb-opt").forEach((d, i) => d.classList.toggle("on", i === this.pick));
  }

  private choose() {
    const opt = this.choice!.options[this.pick];
    sfx.menuMove();
    this.picker.hide();
    if (opt.to) this.jump(opt.to);
    this.advance();
  }

  close() {
    this.hold = 0;
    this.game.stagecraft.endScene();
    this.open = false;
    this.waitFor = null;
    this.say = null;
    this.choice = null;
    this.talkTo = null;
    this.hideAll();
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  update(dt: number, input: Input) {
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.hold = 0;
        this.advance();
      }
      return;
    }
    this.lineT += dt;
    const next = input.pressed("bolt") || input.pressed("confirm") || (input.pressed("jump") && !input.pressed("up")) || this.clicked;
    this.clicked = false;
    if (this.choice) {
      const n = this.choice.options.length;
      if (input.pressed("up") || input.pressed("left")) { this.pick = (this.pick + n - 1) % n; this.markPick(); sfx.menuMove(); }
      else if (input.pressed("down") || input.pressed("right")) { this.pick = (this.pick + 1) % n; this.markPick(); sfx.menuMove(); }
      else if (next) this.choose();
      return;
    }
    if (!this.say) return;
    const t = this.typer;
    if (t.typing) {
      if (next) t.finish();
      else t.step(dt, (this.say.who && LOOK_BY_NAME[this.say.who]?.voice) || 520, this.thought ? 0.012 : undefined);
      if (this.say.who) this.bubble.reveal(t.shown);
      else [this.capSaid.textContent, this.capUnsaid.textContent] = [t.text.slice(0, t.shown), t.text.slice(t.shown)];
      if (!t.typing) (this.say.who ? this.bubble.el : this.caption).classList.add("done");
    } else if (next) {
      this.advance();
    }
  }

  private captionFor = "";
  /** Rounds the narration band to whole game pixels, gives it its frame and centres it. */
  fitCaption(px: number, screenW: number) {
    if (!this.caption.classList.contains("show")) return;
    const key = `${px}|${fontVersion}|${this.typer.text}`;
    if (key === this.captionFor) return;
    this.captionFor = key;
    const { w } = fitFrame(this.caption, "caption", px);
    this.caption.style.left = `${Math.round((screenW - w) / 2 / px) * px}px`;
  }

  /** Who is talking right now, for mouths, faces and emote icons. */
  speeches(): Speech[] {
    if (!this.open || !this.say?.who) return [];
    return [{ anchor: this.anchor, expr: this.say.expr, typing: this.typer.typing, t: this.lineT }];
  }

  /**
   * Points the bubbles at the speakers for this frame. `inWorld` is false
   * inside the cottage, where everyone talks from the box at the bottom.
   */
  place(camX: number, camY: number, vw: number, vh: number, inWorld: boolean): Bubble[] {
    const head = inWorld ? headOf(this.game, this.anchor) : null;
    const seen = !!head && onScreen(head, camX, camY, vw, vh);
    this.bubble.head = seen ? head : null;
    this.bubble.mode({ thought: this.thought, free: !seen });
    const me = inWorld ? headOf(this.game, "player") : null;
    this.picker.head = me;
    this.picker.mode({ free: !me });
    return [this.bubble, this.picker];
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
