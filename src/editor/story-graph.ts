import { END_TARGET, parseScript, SAY_RE } from "../game/dialogue";
import { EXPR_NAMES, type Expr } from "../game/people";

/**
 * The dialogue script seen as a node graph, one canvas per person or story
 * event (the script's 【chapters】). script.txt stays the source of truth:
 * `parseGraph` reads nodes out of the text, `serializeGraph` writes a graph
 * back as text. Node positions (and the few facts the text can't say) live
 * in layout.json.
 *
 * How the text maps onto nodes:
 *   == id ==              a start node when a map, event or layout marks it as a way in;
 *                         otherwise just where the next node's text begins
 *   name: line …          consecutive lines form one 对话 node
 *   * option -> id        consecutive options form one 选项 node, one exit per option
 *   ?cond -> id           a 判断 node: 是 goes to id, 否 carries on below
 *   !command              one node per command (its kind decides the node type)
 *   -> id                 a link; into another canvas it shows as a 跳转 node
 *   -> 结束 / !end        the end
 */

export type NodeType =
  | "start" | "say" | "choice" | "judge" | "flag" | "item" | "rune" | "quest" | "wait"
  | "show" | "pause" | "act" | "camera" | "sfx" | "jump" | "end" | "cmd";

/** Which node a `!command` becomes. */
export const CMD_TYPE: Record<string, NodeType> = {
  flag: "flag", unflag: "flag", item: "item", take: "item", learn: "rune", form: "rune", wand: "rune",
  quest: "quest", stage: "quest", done: "quest", wait: "wait", banner: "show", heal: "show", ending: "show",
  period: "show", nextperiod: "show", pause: "pause", act: "act", camera: "camera", shake: "camera", sfx: "sfx",
};

export interface SayLine { who: string | null; expr: Expr; text: string }

export interface GNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  /** Has a saved position (unplaced nodes get one from the auto layout). */
  placed: boolean;
  /** Key for layout.json, stable across saves. */
  key: string;
  /** Section id this node starts (start nodes: the id maps and events use). */
  sec?: string;
  title?: string;
  /** Comment lines written above it. */
  note?: string[];
  lines?: SayLine[];
  options?: { text: string; to: string | null }[];
  cond?: string;
  /** 判断: where 是 goes (否 is `next`). */
  yes?: string | null;
  next?: string | null;
  cmd?: { name: string; args: string[] };
  /** 跳转: the section it goes to. */
  target?: string;
  /** Script lines this node came from (for the preview and "play from here"). */
  src: number[];
}

export interface CanvasScope { person: string; map: string }
export interface Canvas { name: string; kind: "person" | "event"; nodes: GNode[]; scope?: CanvasScope }
export interface Graph { preamble: string; canvases: Canvas[] }

export interface Layout {
  /** Chapter names are stable; map display names may change independently. */
  canvases?: Record<string, CanvasScope>;
  pos: Record<string, [number, number]>;
  /** Sections that are ways in even if nothing on a map uses them yet. */
  starts: string[];
  /** Sections nothing leads to that are NOT ways in (loose nodes waiting to be connected). */
  loose: string[];
}

export const EMPTY_LAYOUT: Layout = { pos: {}, starts: [], loose: [] };
export const UNGROUPED = "未分组";
export const EVENT_PREFIX = "事件";

export const canvasKind = (name: string): Canvas["kind"] => (name.startsWith(EVENT_PREFIX) ? "event" : "person");

let uid = 0;
export const newId = () => `n${++uid}`;

/** Every edge out of a node: [target, kind, label]. */
export function edgesOf(n: GNode): { to: string | null; kind: "next" | "yes" | "option"; index: number }[] {
  const out: { to: string | null; kind: "next" | "yes" | "option"; index: number }[] = [];
  if (n.type === "choice") n.options!.forEach((o, i) => out.push({ to: o.to, kind: "option", index: i }));
  else if (n.type === "judge") { out.push({ to: n.yes ?? null, kind: "yes", index: 0 }); out.push({ to: n.next ?? null, kind: "next", index: 0 }); }
  else if (n.type !== "jump" && n.type !== "end") out.push({ to: n.next ?? null, kind: "next", index: 0 });
  return out;
}

// ------------------------------------------------------------------ text → graph

export function parseGraph(text: string, layout: Layout, entries: Set<string>): Graph {
  const rows = text.split(/\r?\n/);
  const { script, sections } = parseScript(text);
  const first = rows.findIndex((r) => /^\s*(【.*】|==)/.test(r));
  const preamble = (first < 0 ? rows : rows.slice(0, first)).join("\n").replace(/\s+$/, "");

  // Comments belong to the next line with something on it.
  const notes = new Map<number, string[]>();
  let pending: string[] = [];
  const canvases = new Map<string, Canvas>();
  const canvasOf = (name: string) => {
    if (!canvases.has(name)) canvases.set(name, { name, kind: canvasKind(name), nodes: [], scope: layout.canvases?.[name] });
    return canvases.get(name)!;
  };
  rows.forEach((raw, i) => {
    if (first < 0 || i < first) return;
    const s = raw.trim();
    if (!s) return;
    if (s.startsWith("#")) { pending.push(s.replace(/^#\s?/, "")); return; }
    const chap = s.match(/^【\s*(.+?)\s*】$/);
    if (chap) canvasOf(chap[1]);
    if (pending.length && !chap) notes.set(i + 1, pending);
    if (!chap) pending = [];
  });

  const incoming = new Map<string, number>();
  for (const lines of Object.values(script)) for (const l of lines) {
    const to = l.t === "goto" || l.t === "if" ? [l.to] : l.t === "choice" ? l.options.flatMap((o) => (o.to ? [o.to] : [])) : [];
    for (const t of to) incoming.set(t, (incoming.get(t) ?? 0) + 1);
  }
  const isStart = (id: string) => entries.has(id) || layout.starts.includes(id) || (!incoming.get(id) && !layout.loose.includes(id));

  const firstOf = new Map<string, string | null>();
  const canvasOfSec = new Map<string, Canvas>();
  const fixups: { sec: string; canvas: Canvas; set: (id: string | null) => void }[] = [];
  const shared = new Map<string, GNode>();
  const sharedNode = (canvas: Canvas, kind: "jump" | "end", target = "") => {
    const key = kind === "end" ? `>${canvas.name}>end` : `>${canvas.name}>${target}`;
    let n = shared.get(key);
    if (!n) {
      n = { id: newId(), type: kind, x: 0, y: 0, placed: false, key, src: [], ...(kind === "jump" ? { target } : {}) };
      shared.set(key, n);
      canvas.nodes.push(n);
    }
    return n;
  };

  for (const s of sections) {
    const canvas = canvasOf(s.chapter || UNGROUPED);
    canvasOfSec.set(s.id, canvas);
    const headNote = notes.get(s.line);
    let start: GNode | null = null;
    let link: ((id: string) => void) | null = null;
    let firstId: string | null | undefined;
    if (isStart(s.id)) {
      start = { id: newId(), type: "start", x: 0, y: 0, placed: false, key: `@${s.id}`, sec: s.id, title: s.title || undefined, note: headNote, src: [s.line] };
      canvas.nodes.push(start);
      const st = start;
      link = (id) => { st.next = id; };
    }
    let idx = 0;
    let open: GNode | null = null;
    const linkTo = (id: string) => {
      if (firstId === undefined) firstId = id;
      link?.(id);
    };
    const add = (n: GNode, note?: string[]) => {
      n.key = `${s.id}#${idx++}`;
      if (!start && firstId === undefined) {
        n.sec = s.id;
        n.title = s.title || undefined;
        n.note = [...(headNote ?? []), ...(note ?? [])];
      } else if (note) n.note = note;
      if (!n.note?.length) delete n.note;
      canvas.nodes.push(n);
      linkTo(n.id);
      return n;
    };
    const base = () => ({ id: newId(), x: 0, y: 0, placed: false, key: "", src: [] as number[] });
    for (const l of script[s.id] ?? []) {
      const note = notes.get(l.src);
      if (l.t === "say") {
        if (open && link && !note) {
          open.lines!.push({ who: l.who, expr: l.expr, text: l.text });
          open.src.push(l.src);
          continue;
        }
        const n = add({ ...base(), type: "say", lines: [{ who: l.who, expr: l.expr, text: l.text }], src: [l.src] }, note);
        open = n;
        link = (id) => { n.next = id; };
        continue;
      }
      open = null;
      if (l.t === "choice") {
        const n = add({ ...base(), type: "choice", options: l.options.map((o) => ({ text: o.text, to: null })), src: l.options.map((_, i) => l.src + i) }, note);
        const fall: number[] = [];
        l.options.forEach((o, i) => {
          if (o.to === null) fall.push(i);
          else if (o.to === END_TARGET) n.options![i].to = sharedNode(canvas, "end").id;
          else fixups.push({ sec: o.to, canvas, set: (id) => { n.options![i].to = id; } });
        });
        link = fall.length ? (id) => { for (const i of fall) n.options![i].to = id; } : null;
      } else if (l.t === "if") {
        const n = add({ ...base(), type: "judge", cond: l.cond, src: [l.src] }, note);
        if (l.to !== END_TARGET) fixups.push({ sec: l.to, canvas, set: (id) => { n.yes = id; } });
        link = (id) => { n.next = id; };
      } else if (l.t === "goto") {
        if (link) {
          const set = link;
          if (firstId === undefined) firstId = null;
          if (l.to === END_TARGET) set(sharedNode(canvas, "end").id);
          else fixups.push({ sec: l.to, canvas, set: (id) => { if (id) set(id); } });
        } else add({ ...base(), type: "jump", target: l.to, src: [l.src] }, note);
        link = null;
      } else if (l.name === "end") {
        if (link) {
          const e = sharedNode(canvas, "end");
          e.src.push(l.src);
          linkTo(e.id);
        } else add({ ...base(), type: "end", src: [l.src] }, note);
        link = null;
      } else {
        const n = add({ ...base(), type: CMD_TYPE[l.name] ?? "cmd", cmd: { name: l.name, args: [...l.args] }, src: [l.src] }, note);
        link = (id) => { n.next = id; };
      }
    }
    firstOf.set(s.id, firstId ?? null);
  }
  // Jumps are resolved once every section has its nodes: same canvas → an edge, another canvas → a 跳转 node.
  for (const f of fixups) {
    const home = canvasOfSec.get(f.sec);
    if (home === f.canvas) f.set(firstOf.get(f.sec) ?? null);
    else f.set(sharedNode(f.canvas, "jump", f.sec).id);
  }
  for (const c of canvases.values()) for (const n of c.nodes) {
    const p = layout.pos[n.key];
    if (p) { n.x = p[0]; n.y = p[1]; n.placed = true; }
  }
  const graph = { preamble, canvases: [...canvases.values()] };
  for (const c of graph.canvases) placeNew(c);
  return graph;
}

// ------------------------------------------------------------------ graph → text

const EXPR_WORD: Record<string, string> = Object.fromEntries(Object.entries(EXPR_NAMES).filter(([, v]) => v !== "normal").map(([k, v]) => [v, k]));
const special = (t: string) => !t.trim() || /^\s*([*?？!！#]|->|==|【)/.test(t) || SAY_RE.test(t.trim());

function sayLines(n: GNode) {
  return n.lines!.map((l, i) => {
    const prev = n.lines![i - 1];
    const text = l.text.replace(/\r?\n/g, " ");
    if (prev && prev.who === l.who && prev.expr === l.expr && !special(text)) return text;
    const expr = l.expr !== "normal" && EXPR_WORD[l.expr] ? `(${EXPR_WORD[l.expr]})` : "";
    return `${l.who ?? "旁白"}${expr}: ${text}`;
  });
}

function cmdLine(n: GNode) {
  const c = n.cmd!;
  return `!${c.name}${c.args.filter((a) => a !== "").length ? " " + c.args.filter((a) => a !== "").join(" ") : ""}`;
}

/**
 * Writes the graph as script text. Returns the text and each node's layout
 * key, so positions can be saved under the keys the text will parse back to.
 */
export function serializeGraph(g: Graph): { text: string; keys: Map<string, string>; starts: string[] } {
  const keys = new Map<string, string>();
  const starts: string[] = [];
  const out: string[] = [];
  if (g.preamble) out.push(g.preamble, "", "");
  const used = new Set<string>();
  for (const c of g.canvases) for (const n of c.nodes) if (n.sec) used.add(n.sec);
  for (const c of g.canvases) {
    const byId = new Map(c.nodes.map((n) => [n.id, n]));
    const nextIn = new Map<string, number>(), branchIn = new Set<string>(), anyIn = new Set<string>();
    for (const n of c.nodes) for (const e of edgesOf(n)) {
      if (!e.to || !byId.has(e.to)) continue;
      anyIn.add(e.to);
      if (e.kind === "next") nextIn.set(e.to, (nextIn.get(e.to) ?? 0) + 1);
      else branchIn.add(e.to);
    }
    const inline = (n: GNode) => (n.type === "jump" || n.type === "end") && anyIn.has(n.id);
    const isHead = (n: GNode) => !inline(n) && (n.type === "start" || !!n.sec || !!n.title || branchIn.has(n.id) || (nextIn.get(n.id) ?? 0) !== 1);
    // Heads in the order a reader meets them: from each way in, along the edges.
    const heads: GNode[] = [];
    const seen = new Set<string>();
    const visit = (root: GNode) => {
      const queue = [root];
      while (queue.length) {
        const n = queue.shift()!;
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        if (isHead(n)) heads.push(n);
        for (const e of edgesOf(n)) { const t = e.to && byId.get(e.to); if (t) queue.push(t); }
      }
    };
    for (const n of c.nodes) if (n.type === "start") visit(n);
    for (const n of c.nodes) visit(n);
    const base = (c.nodes.find((n) => n.type === "start")?.sec ?? "part").replace(/_\d+$/, "");
    for (const h of heads) {
      if (h.sec) continue;
      let k = 2;
      while (used.has(`${base}_${k}`)) k++;
      h.sec = `${base}_${k}`;
      used.add(h.sec);
    }
    const ref = (id: string | null | undefined) => {
      const t = id ? byId.get(id) : null;
      if (!t) return END_TARGET;
      if (t.type === "jump") return t.target || END_TARGET;
      if (t.type === "end") return END_TARGET;
      return t.sec!;
    };
    out.push(`【${c.name}】`);
    const emitted = new Set<string>();
    const emitSection = (h: GNode) => {
      out.push("");
      for (const line of h.note ?? []) out.push(`# ${line}`);
      out.push(`== ${h.sec} ==${h.title ? " " + h.title : ""}`);
      let idx = 0;
      let node: GNode | undefined;
      const follow = (from: GNode): GNode | undefined => {
        const t = from.next ? byId.get(from.next) : undefined;
        if (!t) return undefined;
        if (t.type === "end") { out.push("!end"); keys.set(t.id, `>${c.name}>end`); return undefined; }
        if (t.type === "jump") { out.push(`-> ${t.target}`); keys.set(t.id, `>${c.name}>${t.target}`); return undefined; }
        if (isHead(t) || emitted.has(t.id)) { out.push(`-> ${t.sec}`); return undefined; }
        return t;
      };
      if (h.type === "start") {
        keys.set(h.id, `@${h.sec}`);
        starts.push(h.sec!);
        emitted.add(h.id);
        node = follow(h);
      } else node = h;
      while (node) {
        const n = node;
        emitted.add(n.id);
        keys.set(n.id, `${h.sec}#${idx++}`);
        if (n !== h) for (const line of n.note ?? []) out.push(`# ${line}`);
        node = undefined;
        switch (n.type) {
          case "say":
            out.push(...sayLines(n));
            node = follow(n);
            break;
          case "choice":
            // An option with nowhere to go has no arrow: nothing follows a choice here, so it ends the conversation.
            for (const o of n.options!) out.push(`* ${o.text.replace(/->/g, "→") || "……"}${o.to && byId.has(o.to) ? ` -> ${ref(o.to)}` : ""}`);
            break;
          case "judge":
            out.push(`?${n.cond || "wand"} -> ${ref(n.yes)}`);
            node = follow(n);
            break;
          case "jump":
            out.push(`-> ${n.target || END_TARGET}`);
            break;
          case "end":
            out.push("!end");
            break;
          case "start":
            break;
          default:
            out.push(cmdLine(n));
            node = follow(n);
        }
      }
    };
    for (const h of heads) emitSection(h);
    // Anything left (a loop with no way in) still gets written.
    for (const n of c.nodes) {
      if (emitted.has(n.id) || inline(n)) continue;
      if (!n.sec) { let k = 2; while (used.has(`${base}_${k}`)) k++; n.sec = `${base}_${k}`; used.add(n.sec); }
      emitSection(n);
    }
    for (const n of c.nodes) if (inline(n) && !keys.has(n.id)) keys.set(n.id, n.type === "end" ? `>${c.name}>end` : `>${c.name}>${n.target}`);
    out.push("", "");
  }
  return { text: out.join("\n").replace(/\n{3,}$/, "\n"), keys, starts };
}

/** Layout for the text a graph was just written as: positions under their new keys, plus the start/loose facts. */
export function layoutFor(g: Graph, keys: Map<string, string>, text: string, starts: string[], entries: Set<string>): Layout {
  const pos: Layout["pos"] = {};
  for (const c of g.canvases) for (const n of c.nodes) {
    const k = keys.get(n.id);
    if (k) pos[k] = [Math.round(n.x), Math.round(n.y)];
  }
  const { script, sections } = parseScript(text);
  const incoming = new Set<string>();
  for (const lines of Object.values(script)) for (const l of lines) {
    if (l.t === "goto" || l.t === "if") incoming.add(l.to);
    if (l.t === "choice") for (const o of l.options) if (o.to) incoming.add(o.to);
  }
  const startSet = new Set(starts);
  const loose = sections.map((s) => s.id).filter((id) => !startSet.has(id) && !incoming.has(id) && !entries.has(id));
  // A start something jumps to (or that no map uses yet) must be remembered as one.
  const keep = starts.filter((id) => incoming.has(id) || !entries.has(id));
  const canvases = Object.fromEntries(g.canvases.filter((c) => c.scope).map((c) => [c.name, c.scope!]));
  return { pos, starts: keep, loose, canvases };
}

// ------------------------------------------------------------------ layout

export const NODE_W = 230;
const GAP_X = 70, GAP_Y = 28;

/** Rough card height, for laying cards out before they're drawn. */
export function nodeHeight(n: GNode) {
  switch (n.type) {
    case "say": return 60 + n.lines!.slice(0, 4).reduce((h, l) => h + 19 * Math.ceil(((l.who ?? "旁白").length + l.text.length + 2) / 15), 0) + (n.lines!.length > 4 ? 19 : 0);
    case "choice": return 50 + n.options!.length * 26;
    case "judge": return 104;
    case "start": return 78;
    default: return 74;
  }
}

/** Places cards that have no saved position: after whatever leads to them, or below everything else. */
export function placeNew(c: Canvas) {
  if (c.nodes.every((n) => n.placed)) return;
  if (!c.nodes.some((n) => n.placed)) { arrange(c); return; }
  const pred = new Map<string, GNode>();
  for (const n of c.nodes) for (const e of edgesOf(n)) if (e.to && !pred.has(e.to)) pred.set(e.to, n);
  let bottom = Math.max(...c.nodes.filter((n) => n.placed).map((n) => n.y + nodeHeight(n)));
  for (let pass = 0; pass < c.nodes.length; pass++) {
    let moved = false;
    for (const n of c.nodes) {
      if (n.placed) continue;
      const p = pred.get(n.id);
      if (p?.placed) {
        n.x = p.x + NODE_W + GAP_X;
        n.y = p.y;
        while (c.nodes.some((o) => o !== n && o.placed && Math.abs(o.x - n.x) < NODE_W && Math.abs(o.y - n.y) < nodeHeight(o))) n.y += 40;
        n.placed = moved = true;
      }
    }
    if (!moved) break;
  }
  for (const n of c.nodes) {
    if (n.placed) continue;
    n.x = 40;
    n.y = bottom + GAP_Y;
    bottom = n.y + nodeHeight(n);
    n.placed = true;
  }
}

/** Lays a whole canvas out left to right in columns by distance from its ways in (`height` measures real cards when they exist). */
export function arrange(c: Canvas, height: (n: GNode) => number = nodeHeight) {
  const byId = new Map(c.nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const roots = c.nodes.filter((n) => n.type === "start");
  const hasIn = new Set(c.nodes.flatMap((n) => edgesOf(n).map((e) => e.to).filter(Boolean) as string[]));
  for (const n of c.nodes) if (n.type !== "start" && !hasIn.has(n.id)) roots.push(n);
  const queue = roots.map((r) => ({ n: r, d: 0 }));
  while (queue.length) {
    const { n, d } = queue.shift()!;
    if (depth.has(n.id)) continue;
    depth.set(n.id, d);
    for (const e of edgesOf(n)) { const t = e.to && byId.get(e.to); if (t && !depth.has(t.id)) queue.push({ n: t, d: d + 1 }); }
  }
  for (const n of c.nodes) if (!depth.has(n.id)) depth.set(n.id, 0);
  const cols = new Map<number, GNode[]>();
  for (const n of c.nodes) { const d = depth.get(n.id)!; if (!cols.has(d)) cols.set(d, []); cols.get(d)!.push(n); }
  for (const [d, list] of cols) {
    let y = 40;
    for (const n of list) {
      n.x = 40 + d * (NODE_W + GAP_X);
      n.y = y;
      n.placed = true;
      y += height(n) + GAP_Y;
    }
  }
}

/** Joins 对话 nodes that simply follow one another into one (part of 一键整理). */
export function mergeSays(c: Canvas) {
  const byId = new Map(c.nodes.map((n) => [n.id, n]));
  const inCount = new Map<string, number>();
  for (const n of c.nodes) for (const e of edgesOf(n)) if (e.to) inCount.set(e.to, (inCount.get(e.to) ?? 0) + 1);
  let merged = 0;
  for (const a of c.nodes) {
    while (a.type === "say" && a.next) {
      const b = byId.get(a.next);
      if (!b || b === a || b.type !== "say" || inCount.get(b.id) !== 1 || b.sec || b.title || b.note?.length) break;
      a.lines!.push(...b.lines!);
      a.next = b.next ?? null;
      c.nodes.splice(c.nodes.indexOf(b), 1);
      byId.delete(b.id);
      merged++;
    }
  }
  return merged;
}
