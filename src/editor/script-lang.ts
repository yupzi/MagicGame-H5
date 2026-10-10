import { COMMANDS, ITEM_NAMES, SAY_RE, WAIT_ACTIONS } from "../game/dialogue";
import { EXPR_NAMES } from "../game/people";
import { ACTS, SOUNDS } from "../game/stagecraft";

/**
 * The dialogue script as the story editor sees it: one line at a time,
 * coloured by what it does, plus what to suggest while typing.
 */

export const NARRATOR = "旁白";

export type LineKind = "blank" | "comment" | "chapter" | "section" | "choice" | "goto" | "if" | "cmd" | "say" | "more";

export function lineKind(raw: string): LineKind {
  const s = raw.trim();
  if (!s) return "blank";
  if (s.startsWith("#")) return "comment";
  if (/^【.*】$/.test(s)) return "chapter";
  if (/^==\s*\S+?\s*==/.test(s)) return "section";
  if (s.startsWith("*")) return "choice";
  if (s.startsWith("->")) return "goto";
  if (s.startsWith("?") || s.startsWith("？")) return "if";
  if (s.startsWith("!") || s.startsWith("！")) return "cmd";
  return SAY_RE.test(s) ? "say" : "more";
}

/** The section a jump-like line points at, with where it sits in the line. */
export function jumpTarget(raw: string): { id: string; from: number } | null {
  const kind = lineKind(raw);
  if (kind !== "choice" && kind !== "goto" && kind !== "if") return null;
  const m = raw.match(/->\s*(\S+)\s*$/);
  return m ? { id: m[1], from: raw.length - m[0].length + m[0].indexOf(m[1]) } : null;
}

/** The speaker of a say line (旁白 included), or null. */
export function speakerOf(raw: string) {
  const m = lineKind(raw) === "say" ? raw.trim().match(SAY_RE) : null;
  return m ? m[1] : null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const span = (cls: string, s: string) => (s ? `<span class="${cls}">${esc(s)}</span>` : "");

/** Dark or light text, whichever reads better on this colour. */
function inkOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 140 ? "#1d1430" : "#fff6e8";
}

/** Text of a line, with thoughts （like this） shown dimmer. */
function words(s: string) {
  const t = s.match(/^(\s*)([（(][\s\S]*[）)])(\s*)$/);
  return t ? esc(t[1]) + span("t-thought", t[2]) + esc(t[3]) : span("t-text", s);
}

/**
 * One line as HTML with exactly the same characters as the source (the
 * textarea sits on top of it, so nothing may change width). `colors` gives
 * each speaker's name-tag colour.
 */
export function highlightLine(raw: string, colors: Record<string, string>): string {
  const kind = lineKind(raw);
  const lead = raw.match(/^\s*/)![0];
  const s = raw.slice(lead.length);
  const out = (html: string) => esc(lead) + html;
  switch (kind) {
    case "blank": return esc(raw);
    case "comment": return out(span("t-comment", s));
    case "chapter": return out(span("t-chapter", s));
    case "section": {
      const m = s.match(/^(==\s*)(\S+?)(\s*==)(.*)$/)!;
      return out(span("t-punct", m[1]) + span("t-id", m[2]) + span("t-punct", m[3]) + span("t-title", m[4]));
    }
    case "choice": {
      const m = s.match(/^(\*\s*)(.*?)(\s*->\s*)(\S+)(\s*)$/);
      if (!m) return out(span("t-mark", s[0]) + span("t-choice", s.slice(1)));
      return out(span("t-mark", m[1]) + span("t-choice", m[2]) + span("t-arrow", m[3]) + span("t-target", m[4]) + esc(m[5]));
    }
    case "goto": {
      const m = s.match(/^(->\s*)(.*)$/)!;
      return out(span("t-arrow", m[1]) + span("t-target", m[2]));
    }
    case "if": {
      const m = s.match(/^([?？]\s*)(.*?)(\s*->\s*)(\S+)(\s*)$/);
      if (!m) return out(span("t-mark", s[0]) + span("t-cond", s.slice(1)));
      return out(span("t-mark", m[1]) + span("t-cond", m[2]) + span("t-arrow", m[3]) + span("t-target", m[4]) + esc(m[5]));
    }
    case "cmd": {
      const m = s.match(/^([!！]\s*\S*)(.*)$/)!;
      return out(span("t-cmd", m[1]) + span("t-args", m[2]));
    }
    case "say": {
      const m = s.match(/^([^:：\s()（）]{1,10})(\s*)((?:[(（][^)）]*[)）])?)(\s*[:：]\s*)(.*)$/)!;
      const name = m[1] === NARRATOR ? span("t-narrator", m[1])
        : `<span class="t-name" style="--c:${colors[m[1]] ?? "#8f86a8"};--f:${inkOn(colors[m[1]] ?? "#8f86a8")}">${esc(m[1])}</span>`;
      return out(name + esc(m[2]) + span("t-expr", m[3]) + span("t-punct", m[4]) + (m[1] === NARRATOR ? span("t-narration", m[5]) : words(m[5])));
    }
    default: return out(words(s));
  }
}

// ------------------------------------------------------------------ suggestions

export interface Suggestion {
  label: string;
  /** Replaces the typed word. */
  insert: string;
  detail?: string;
  /** Shown in the speaker's colour. */
  color?: string;
}

export interface CompleteContext {
  /** Speaker names, most likely first. */
  speakers: string[];
  colors: Record<string, string>;
  sections: { id: string; title: string }[];
  flags: string[];
  quests: { id: string; title: string }[];
  periods: { id: string; name: string }[];
  elements: { id: string; name: string }[];
  forms: { id: string; name: string }[];
}

export const COMMAND_INFO: Record<string, [string, string]> = {
  flag: ["flag 标记", "记住一件事（会存档）"],
  unflag: ["unflag 标记", "忘掉一件事"],
  item: ["item 东西 数量", "得到东西"],
  take: ["take 东西 数量", "交出东西"],
  wand: ["wand", "从帽子里拿出法杖（之后才能用魔法）"],
  learn: ["learn 元素", "学会元素符文"],
  form: ["form 形态", "学会形态符文"],
  quest: ["quest 任务 文字", "右上角出现任务，{木头} 显示数量"],
  stage: ["stage 任务 阶段", "任务进入某个阶段"],
  done: ["done 任务", "完成任务"],
  wait: ["wait 动作 提示", "收起气泡，等玩家做这个动作"],
  heal: ["heal", "回满血"],
  banner: ["banner 文字", "屏幕中间出现大字"],
  period: ["period 时段", "切换到某个时段"],
  nextperiod: ["nextperiod", "进入下一个时段"],
  ending: ["ending", "显示结束画面"],
  end: ["end", "对话到此结束"],
  pause: ["pause 秒", "停顿一会儿（气泡收起）"],
  act: ["act 名字 动作", "人物动作：转身 跳 走 退场 出场"],
  camera: ["camera 名字", "镜头看向某人；写阿梨梨就回来"],
  shake: ["shake 强度", "震屏 1~3"],
  sfx: ["sfx 音效", "播放一个音效"],
};

const COMMAND_ARGS_NONE = new Set(["wand", "heal", "nextperiod", "ending", "end"]);

function filter(items: Suggestion[], typed: string) {
  if (!typed) return items;
  const t = typed.toLowerCase();
  const starts = items.filter((i) => i.label.toLowerCase().startsWith(t) || i.insert.toLowerCase().startsWith(t));
  const has = items.filter((i) => !starts.includes(i) && (i.label.toLowerCase().includes(t) || (i.detail ?? "").toLowerCase().includes(t)));
  return [...starts, ...has];
}

/**
 * What to offer at column `col` of `line`: the start of the word being typed
 * and the choices, best first. `fresh` is a brand-new empty line, where the
 * list only shows as a hint (Tab takes it, Enter just types a new line).
 */
export function complete(line: string, col: number, c: CompleteContext): { from: number; items: Suggestion[] } | null {
  const before = line.slice(0, col);
  const after = line.slice(col);
  const lead = before.match(/^\s*/)![0].length;
  const s = before.slice(lead);
  if (after.trim() && !/^\s*(->|[)）:：])/.test(after)) return null;

  // A jump target: after -> on a choice, goto or condition.
  const arrow = s.match(/->\s*(\S*)$/);
  if (arrow && /^([*?？]|->)/.test(s)) {
    return { from: col - arrow[1].length, items: filter(c.sections.map((x) => ({ label: x.id, insert: x.id, detail: x.title })), arrow[1]) };
  }
  // A condition: the word after ? (or after a space inside it).
  const cond = s.match(/^[?？]\s*(?:\S+\s+)*?(!?)(\S*)$/);
  if (cond && !s.includes("->")) {
    const typed = cond[2];
    const items: Suggestion[] = [
      ...c.flags.map((f) => ({ label: cond[1] + f, insert: f, detail: cond[1] ? "没有这个标记" : "有这个标记" })),
      ...Object.keys(ITEM_NAMES).filter((k) => /[^a-z]/.test(k)).map((k) => ({ label: `${k}>=1`, insert: `${k}>=`, detail: "背包里至少有几个" })),
      ...c.quests.flatMap((q) => [
        { label: `quest:${q.id}=active`, insert: `quest:${q.id}=active`, detail: `${q.title} 进行中` },
        { label: `quest:${q.id}=done`, insert: `quest:${q.id}=done`, detail: `${q.title} 已完成` },
      ]),
      { label: "day>=2", insert: "day>=", detail: "第几天以后" },
      ...c.periods.map((p) => ({ label: `period=${p.id}`, insert: `period=${p.id}`, detail: `时段是${p.name}` })),
    ];
    return { from: col - typed.length, items: filter(items, typed) };
  }
  // A command, then its arguments.
  const cmd = s.match(/^[!！](\S*)$/);
  if (cmd) {
    const items = COMMANDS.map((n) => ({ label: COMMAND_INFO[n]?.[0] ?? n, insert: COMMAND_ARGS_NONE.has(n) ? n : `${n} `, detail: COMMAND_INFO[n]?.[1] }));
    return { from: col - cmd[1].length, items: filter(items, cmd[1]) };
  }
  const arg = s.match(/^[!！](\S+)\s+((?:\S+\s+)*)(\S*)$/);
  if (arg) {
    const [, name, done, typed] = arg;
    const first = !done.trim();
    let items: Suggestion[] = [];
    if (first) {
      if (name === "learn") items = c.elements.map((e) => ({ label: e.id, insert: e.id, detail: e.name }));
      else if (name === "form") items = c.forms.map((e) => ({ label: e.id, insert: e.id, detail: e.name }));
      else if (name === "flag" || name === "unflag") items = c.flags.map((f) => ({ label: f, insert: f }));
      else if (name === "item" || name === "take") items = Object.keys(ITEM_NAMES).filter((k) => /[^a-z]/.test(k)).map((k) => ({ label: k, insert: `${k} 1` }));
      else if (name === "wait") items = Object.keys(WAIT_ACTIONS).filter((k) => /[^a-z]/.test(k)).map((k) => ({ label: k, insert: `${k} `, detail: "后面写提示文字" }));
      else if (name === "quest" || name === "done" || name === "stage") items = c.quests.map((q) => ({ label: q.id, insert: name === "done" ? q.id : `${q.id} `, detail: q.title }));
      else if (name === "period") items = c.periods.map((p) => ({ label: p.id, insert: p.id, detail: p.name }));
      else if (name === "act" || name === "camera") items = [...c.speakers].map((n) => ({ label: n, insert: name === "act" ? `${n} ` : n, color: c.colors[n] }));
      else if (name === "sfx") items = Object.keys(SOUNDS).map((k) => ({ label: k, insert: k }));
      else if (name === "shake") items = ["1", "2", "3"].map((k) => ({ label: k, insert: k, detail: ["轻轻", "中等", "很猛"][Number(k) - 1] }));
      else if (name === "pause") items = ["0.5", "1", "2"].map((k) => ({ label: k, insert: k, detail: "秒" }));
    } else if (name === "act" && done.trim().split(/\s+/).length === 1) {
      items = Object.keys(ACTS).map((k) => ({ label: k, insert: k === "走" ? "走 " : k, detail: k === "走" ? "后面写距离，负数往左" : undefined }));
    }
    return items.length ? { from: col - typed.length, items: filter(items, typed) } : null;
  }
  // An expression: 名字( …
  const expr = s.match(/^([^:：\s()（）]{1,10})\s*[(（]([^)）:：]*)$/);
  if (expr) {
    const close = /^\s*[)）]/.test(after) ? "" : ")";
    const colon = /^\s*[)）]?\s*[:：]/.test(after) ? "" : ": ";
    const items = Object.keys(EXPR_NAMES).map((e) => ({ label: e, insert: e + close + colon }));
    return { from: col - expr[2].length, items: filter(items, expr[2]) };
  }
  // A speaker at the start of a line (and on an empty line, the other kinds of line too).
  const who = s.match(/^[^:：\s()（）!！*?？#=【\-]{0,10}$/);
  if (who && !after.trim()) {
    const typed = s;
    const people = [...c.speakers, NARRATOR].map((n) => ({ label: n, insert: `${n}: `, color: c.colors[n], detail: n === NARRATOR ? "屏幕上方的叙述" : undefined }));
    const extras: Suggestion[] = typed ? [] : [
      { label: "* 选项", insert: "* ", detail: "给玩家选择" },
      { label: "-> 跳转", insert: "-> ", detail: "跳到别的段落" },
      { label: "? 条件", insert: "? ", detail: "条件成立就跳" },
      { label: "! 命令", insert: "!", detail: "给东西、学符文……" },
    ];
    const items = [...filter(people, typed), ...extras];
    return items.length ? { from: col - typed.length, items } : null;
  }
  return null;
}

/** Flags the game sets by itself, with what they mean. */
export const BUILTIN_FLAGS: Record<string, string> = {
  wand: "拿到法杖", intro: "看完开场", bridge: "桥修好了", boss: "打败了史莱姆大王", school: "入学了",
  fire: "学会火", ice: "学会冰", thunder: "学会雷", flower: "学会花",
};
