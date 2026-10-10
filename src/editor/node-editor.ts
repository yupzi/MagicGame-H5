import { sfx } from "../engine/audio";
import { ITEM_NAMES, WAIT_ACTIONS } from "../game/dialogue";
import { formatMap } from "../game/mapdata";
import { drawPerson, EXPR_NAMES, LOOK_BY_NAME, LOOKS, type Expr } from "../game/people";
import { ELEMENTS, FORMS } from "../game/runes";
import { ACTS, SOUNDS } from "../game/stagecraft";
import { STORY } from "../game/story";
import { MAPS } from "../maps";
import type { PlayRequest, ScriptDoc } from "./script-doc";
import { dialogueEntryBindings, syncMapCanvases, type MapBinding } from "./map-canvases";
import { BUILTIN_FLAGS } from "./script-lang";
import { describeCommand, StagePreview, type View } from "./stage-preview";
import { describeCondition, renderConditions } from "./story-conditions";
import {
  arrange, edgesOf, EVENT_PREFIX, layoutFor, mergeSays, newId, NODE_W, parseGraph, serializeGraph,
  type Canvas, type GNode, type Graph, type NodeType,
} from "./story-graph";

/**
 * The story editor's node mode: one canvas per person (or story event),
 * nodes of different kinds wired left to right, the stage and the selected
 * node's properties on the right. Every change is written straight back to
 * script.txt (see story-graph.ts), so text mode and the game see it at once.
 */

const PLAYER = LOOKS.ariri?.name ?? "阿梨梨";
const NARRATOR = "旁白";

/** Name, icon and colour of each kind of node. */
export const NODE_TYPES: Record<NodeType, { name: string; icon: string; color: string; hint: string }> = {
  start: { name: "开始", icon: "▶", color: "#4fae6e", hint: "对话从这里开始。地图上的人物、触发区用它的编号找台词" },
  say: { name: "对话", icon: "话", color: "#6a74e8", hint: "一句句台词，从上往下播放" },
  choice: { name: "选项", icon: "选", color: "#2f9e96", hint: "让玩家选择，每个选项连到不同的地方" },
  judge: { name: "判断", icon: "?", color: "#d9862f", hint: "条件成立走「是」，否则走「否」" },
  flag: { name: "标记", icon: "旗", color: "#8a6fc6", hint: "记住或忘掉一件事（会存档），判断里可以用" },
  item: { name: "物品", icon: "物", color: "#c29a2e", hint: "得到或交出东西" },
  rune: { name: "学会", icon: "✦", color: "#cf5b94", hint: "学会符文，或者拿出法杖" },
  quest: { name: "任务", icon: "务", color: "#4f8fd0", hint: "接任务、推进阶段、完成任务" },
  wait: { name: "等玩家", icon: "等", color: "#6f839b", hint: "收起气泡，等玩家做一个动作再继续" },
  show: { name: "演出", icon: "演", color: "#b0588a", hint: "屏幕大字、回满血、结束画面、换时段" },
  pause: { name: "停顿", icon: "…", color: "#6b6590", hint: "安静几秒，适合制造笑点的节奏" },
  act: { name: "人物动作", icon: "动", color: "#3f9c63", hint: "转身、跳一下、走几步、退场、出场" },
  camera: { name: "镜头", icon: "镜", color: "#3f83a3", hint: "镜头看向某人，或者震屏" },
  sfx: { name: "音效", icon: "♪", color: "#a0713f", hint: "播放一个音效" },
  jump: { name: "跳转", icon: "↪", color: "#707086", hint: "跳到别的人物或事件的对话" },
  end: { name: "结束", icon: "■", color: "#a8465a", hint: "对话在这里结束（出口不连线也会结束）" },
  cmd: { name: "命令", icon: "!", color: "#707086", hint: "其他命令" },
};

const MENU: { group: string; types: NodeType[] }[] = [
  { group: "对话流程", types: ["say", "choice", "judge", "jump", "end", "start"] },
  { group: "剧情变化", types: ["flag", "item", "rune", "quest", "show"] },
  { group: "演出", types: ["pause", "act", "camera", "sfx", "wait"] },
];

const EXPR_WORD: Record<string, string> = Object.fromEntries(Object.entries(EXPR_NAMES).map(([k, v]) => [v, k]));
const ITEMS = Object.keys(ITEM_NAMES).filter((k) => /[^a-z]/i.test(k));
const ITEM_WORD: Record<string, string> = Object.fromEntries(ITEMS.map((k) => [ITEM_NAMES[k], k]));
const WAITS = Object.keys(WAIT_ACTIONS).filter((k) => /[^a-z]/i.test(k));

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = "") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const avatars = new Map<string, string>();
/** A little picture of someone, for the canvas list. */
function avatar(name: string) {
  const look = LOOK_BY_NAME[name];
  if (!look) return "";
  let url = avatars.get(name);
  if (!url) {
    const c = document.createElement("canvas");
    c.width = 22;
    c.height = 30;
    const ctx = c.getContext("2d")!;
    drawPerson(ctx, 11, 29, look, 1, 0);
    url = c.toDataURL();
    avatars.set(name, url);
  }
  return `<img class="nd-avatar" src="${url}" alt="">`;
}

type Snapshot = { text: string; layout: string; bindings: MapBinding[] };

export class NodeEditor {
  readonly el = el("div", "nd-shell");
  private list = el("div", "nd-list");
  private search = el("input", "sc-search");
  private viewport = el("div", "nd-viewport");
  private world = el("div", "nd-world");
  private svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private layer = el("div", "nd-layer");
  private zoomLabel = el("span", "nd-zoom");
  private hint = el("span", "nd-hint");
  private canvasTitle = el("span", "nd-canvas-title");
  private expandedPeople = new Set<string>();
  private inspector = el("div", "nd-inspector");
  private menu = el("div", "nd-menu");
  private preview: StagePreview;

  private graph: Graph = { preamble: "", canvases: [] };
  private canvasName = "";
  private selKey: string | null = null;
  private selLine = 0;
  private playingKey: string | null = null;
  private views = new Map<string, { zoom: number; x: number; y: number }>();
  private zoom = 1;
  private panX = 40;
  private panY = 40;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private mergeKey = "";
  private mergeT = 0;
  private pending: { id: string; port: string } | null = null;
  private typing = 0;
  private typingFlush: (() => void) | null = null;
  open = false;

  constructor(private doc: ScriptDoc, hooks: { play: (req: PlayRequest) => void }) {
    this.preview = new StagePreview(doc, { play: hooks.play, step: (d) => this.step(d), onLine: (v) => this.followPlay(v) });
    this.build();
    this.rebuild();
    doc.onChange((source) => {
      if (source === this) return;
      this.rebuild();
      if (this.open) this.render();
    });
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  // ------------------------------------------------------------------ layout

  private build() {
    const side = el("aside", "nd-side");
    this.search.placeholder = "搜索人物、台词…";
    this.search.oninput = () => this.renderList();
    // Flush-on-blur can rebuild the list before a navigation button receives click.
    this.list.addEventListener("pointerdown", (e) => {
      if (e.button === 0 && (e.target as Element).closest("button")) e.preventDefault();
    });
    side.append(el("div", "nd-side-head"), this.list);
    side.firstElementChild!.append(this.search);

    const main = el("section", "nd-main");
    const bar = el("div", "nd-toolbar");
    bar.innerHTML = `<button data-z="-" title="缩小">−</button>`;
    bar.append(this.zoomLabel);
    bar.insertAdjacentHTML("beforeend", `<button data-z="+" title="放大">＋</button><button data-a="fit" title="让所有节点都在视野里（F）">适合内容</button>
      <button data-a="arrange" title="自动排列，并把连着的对话节点合成一个">一键整理</button>
      <button data-a="undo" title="撤销 Ctrl+Z">↶</button><button data-a="redo" title="重做 Ctrl+Y">↷</button>`);
    bar.prepend(this.canvasTitle);
    bar.append(this.hint);
    bar.onclick = (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b) return;
      if (b.dataset.z) this.setZoom(this.zoom * (b.dataset.z === "+" ? 1.2 : 1 / 1.2));
      if (b.dataset.a === "fit") this.fit();
      if (b.dataset.a === "arrange") this.arrangeNow(true);
      if (b.dataset.a === "undo") this.travel(false);
      if (b.dataset.a === "redo") this.travel(true);
    };
    this.svg.classList.add("nd-edges");
    this.world.append(this.svg, this.layer);
    this.viewport.append(this.world, this.menu);
    main.append(bar, this.doc.banner, this.viewport);

    const right = el("aside", "nd-right");
    right.append(this.preview.el, this.inspector);
    this.el.append(side, main, right);
    this.bindCanvas();
  }

  mount(host: HTMLElement) {
    host.append(this.el);
    this.open = true;
    this.preview.start();
    this.doc.indexUses();
    this.rebuild();
    this.prepareMapCanvases();
    if (this.doc.focusLine) this.selectLine(this.doc.focusLine);
    const scope = this.canvas()?.scope;
    if (scope) this.expandedPeople.add(scope.person);
    this.render();
    this.arrangeIfNew();
    if (!this.views.has(this.canvasName)) requestAnimationFrame(() => this.fit());
  }

  unmount() {
    if (!this.open) return;
    this.flushTyping();
    this.open = false;
    const n = this.selected();
    if (n?.src.length) this.doc.focusLine = n.src[Math.min(this.selLine, n.src.length - 1)];
    this.preview.stop();
    this.hideMenu();
    this.el.remove();
  }

  /** Opens the canvas with this section and selects it (from the map editor's "打开关联对话"). */
  focusSection(id?: string) {
    if (!id) return;
    for (const c of this.graph.canvases) {
      const n = c.nodes.find((x) => x.sec === id);
      if (n) {
        this.switchCanvas(c.name);
        this.select(n);
        requestAnimationFrame(() => this.center(n));
        return;
      }
    }
  }

  escape() {
    if (!this.menu.hidden && this.menu.classList.contains("show")) { this.hideMenu(); return true; }
    if (this.pending) { this.pending = null; this.renderCanvas(); return true; }
    if (this.preview.playing) { this.showPreview(); return true; }
    return false;
  }

  // ------------------------------------------------------------------ model

  private rebuild() {
    this.graph = parseGraph(this.doc.text, this.doc.layout, this.doc.entries());
    if (!this.graph.canvases.some((c) => c.name === this.canvasName)) this.canvasName = this.graph.canvases[0]?.name ?? "";
  }

  prepareMapCanvases() {
    this.flushTyping();
    this.doc.indexUses();
    this.rebuild();
    const before = this.snapshot();
    const result = syncMapCanvases(this.graph, Object.values(MAPS), Object.fromEntries(Object.entries(LOOKS).map(([id, look]) => [id, look.name])));
    if (!result.changed) return;
    this.past.push(before);
    this.future = [];
    this.doc.setMapBindings(result.bindings);
    if (!this.canvas()) this.canvasName = this.graph.canvases.find((c) => c.scope?.person === this.canvasName)?.name ?? this.graph.canvases[0]?.name ?? "";
    const scope = this.canvas()?.scope;
    if (scope) this.expandedPeople.add(scope.person);
    this.selKey = null;
    this.commit();
  }

  private canvasLabel(c: Canvas) {
    return c.scope ? `${c.scope.person} / ${MAPS[c.scope.map]?.name ?? c.scope.map}` : c.name;
  }

  private canvas(): Canvas | undefined {
    return this.graph.canvases.find((c) => c.name === this.canvasName);
  }

  private selected(): GNode | undefined {
    return this.selKey ? this.canvas()?.nodes.find((n) => n.key === this.selKey) : undefined;
  }

  private byId(id: string | null | undefined) {
    return id ? this.canvas()?.nodes.find((n) => n.id === id) : undefined;
  }

  /** Writes the graph back to the script, then reads it back (so what you see is what the text says). */
  private commit(opts: { inspector?: boolean } = {}) {
    const sel = this.selected();
    const { text, keys, starts } = serializeGraph(this.graph);
    const layout = layoutFor(this.graph, keys, text, starts, this.doc.entries());
    if (sel) this.selKey = keys.get(sel.id) ?? this.selKey;
    this.doc.setLayout(layout);
    this.doc.set(text, this);
    this.graph = parseGraph(text, layout, this.doc.entries());
    this.renderCanvas();
    this.renderList();
    if (opts.inspector !== false) this.renderInspector();
    this.showPreview();
  }

  private snapshot(): Snapshot {
    return { text: this.doc.text, layout: JSON.stringify(this.doc.layout), bindings: this.doc.mapBindings() };
  }

  /** A change to the graph: remembered for undo, then committed. `merge` joins quick edits of one field into one undo step. */
  private mutate(fn: () => void, opts: { inspector?: boolean; merge?: string } = {}) {
    const now = performance.now();
    if (!opts.merge || opts.merge !== this.mergeKey || now - this.mergeT > 1500) {
      this.past.push(this.snapshot());
      if (this.past.length > 100) this.past.shift();
      this.future = [];
    }
    this.mergeKey = opts.merge ?? "";
    this.mergeT = now;
    fn();
    this.commit(opts);
  }

  private travel(redo: boolean) {
    this.flushTyping();
    const from = redo ? this.future : this.past, to = redo ? this.past : this.future;
    const s = from.pop();
    if (!s) return;
    to.push(this.snapshot());
    this.doc.setMapBindings(s.bindings);
    this.doc.setLayout(JSON.parse(s.layout));
    this.doc.set(s.text, this);
    this.rebuild();
    this.mergeKey = "";
    this.render();
  }

  /** An edit to the selected node. */
  private edit(fn: (n: GNode) => void, opts: { inspector?: boolean; merge?: string } = {}) {
    const n = this.selected();
    if (!n) return;
    this.mutate(() => fn(n), opts);
  }

  /** Typing in a field: applied a moment after the last key (and when leaving the field). */
  private typed(field: string, fn: (n: GNode) => void) {
    clearTimeout(this.typing);
    const run = () => { this.typingFlush = null; this.edit(fn, { inspector: false, merge: `${this.selKey}:${field}` }); };
    this.typingFlush = run;
    this.typing = window.setTimeout(run, 260);
  }

  private flushTyping() {
    clearTimeout(this.typing);
    const f = this.typingFlush;
    this.typingFlush = null;
    f?.();
  }

  // ------------------------------------------------------------------ rendering

  private render() {
    if (!this.open) return;
    this.renderList();
    this.renderCanvas();
    this.renderInspector();
    this.showPreview();
  }

  private renderList() {
    const q = this.search.value.trim().toLowerCase();
    const hits = (c: Canvas) => !q ? 0 : c.nodes.reduce((k, n) => k + (n.lines ?? []).filter((l) => l.text.toLowerCase().includes(q)).length + (n.options ?? []).filter((o) => o.text.toLowerCase().includes(q)).length, 0);
    const item = (c: Canvas, label?: string, child = false) => {
      const h = hits(c);
      if (q && !`${c.name} ${this.canvasLabel(c)}`.toLowerCase().includes(q) && !h) return "";
      const starts = c.nodes.filter((n) => n.type === "start");
      const onMap = starts.some((s) => this.doc.uses.has(s.sec!));
      const shown = label ?? (c.kind === "event" ? c.name.replace(new RegExp(`^${EVENT_PREFIX}\\s*[·:：]?\\s*`), "") : c.name);
      return `<button class="nd-canvas${child ? " nd-map-child" : ""}${c.name === this.canvasName ? " on" : ""}" data-canvas="${esc(c.name)}" title="${c.scope ? esc(this.canvasLabel(c)) : "双击改名 · 右键更多"}">
        ${child ? `<span class="nd-map-icon">↳</span>` : c.kind === "person" ? avatar(c.scope?.person ?? c.name) || `<span class="nd-avatar nd-noface">?</span>` : `<span class="nd-avatar nd-event">🎬</span>`}
        <span class="nd-canvas-name"><b>${esc(shown)}</b><small>${c.nodes.length} 个节点${h ? ` · 找到 ${h} 处` : ""}</small></span>
        ${onMap ? `<i title="已经放进地图">📍</i>` : `<i class="nd-off" title="还没有放进地图">○</i>`}</button>`;
    };
    const people = this.graph.canvases.filter((c) => c.kind === "person");
    const events = this.graph.canvases.filter((c) => c.kind === "event");
    const groups = new Map<string, Canvas[]>();
    for (const c of people) {
      const name = c.scope?.person ?? c.name;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(c);
    }
    const personRows = [...groups].map(([person, canvases]) => {
      if (canvases.length === 1) return item(canvases[0], person);
      const children = canvases.map((c) => item(c, c.scope ? MAPS[c.scope.map]?.name ?? c.scope.map : "未分配对话", true)).join("");
      if (!children) return "";
      const expanded = !!q || this.expandedPeople.has(person);
      return `<button class="nd-canvas nd-person" data-person="${esc(person)}" aria-expanded="${expanded}">
        ${avatar(person)}<span class="nd-canvas-name"><b>${esc(person)}</b><small>${canvases.filter((c) => c.scope).length} 张地图</small></span><span>${expanded ? "▾" : "▸"}</span></button>
        ${expanded ? `<div class="nd-map-children">${children}</div>` : ""}`;
    }).join("");
    this.list.innerHTML = `<div class="nd-group">人物</div>${personRows}<button class="nd-new" data-new="person">＋ 新人物</button>
      <div class="nd-group">剧情事件</div>${events.map((c) => item(c)).join("")}<button class="nd-new" data-new="event">＋ 新事件</button>`;
    for (const b of this.list.querySelectorAll<HTMLButtonElement>("[data-person]")) b.onclick = () => {
      const person = b.dataset.person!;
      if (this.expandedPeople.has(person)) this.expandedPeople.delete(person);
      else {
        this.expandedPeople.add(person);
        const canvases = groups.get(person)!;
        if (!canvases.some((c) => c.name === this.canvasName)) this.switchCanvas(canvases.find((c) => c.scope)?.name ?? canvases[0].name);
      }
      this.renderList();
    };
    for (const b of this.list.querySelectorAll<HTMLButtonElement>("[data-canvas]")) {
      b.onclick = () => this.switchCanvas(b.dataset.canvas!);
      if (!this.graph.canvases.find((c) => c.name === b.dataset.canvas)?.scope) {
        b.ondblclick = () => this.renameCanvas(b.dataset.canvas!);
        b.oncontextmenu = (e) => { e.preventDefault(); this.canvasMenu(b.dataset.canvas!, e); };
      }
    }
    for (const b of this.list.querySelectorAll<HTMLButtonElement>("[data-new]")) b.onclick = (e) => this.newCanvas(b.dataset.new as "person" | "event", e);
  }

  private switchCanvas(name: string) {
    if (name === this.canvasName) {
      const scope = this.canvas()?.scope;
      if (scope) { this.expandedPeople.add(scope.person); this.renderList(); }
      return;
    }
    this.flushTyping();
    this.views.set(this.canvasName, { zoom: this.zoom, x: this.panX, y: this.panY });
    this.canvasName = name;
    const scope = this.canvas()?.scope;
    if (scope) this.expandedPeople.add(scope.person);
    this.selKey = null;
    this.pending = null;
    const v = this.views.get(name);
    this.render();
    this.arrangeIfNew();
    if (v) { this.zoom = v.zoom; this.panX = v.x; this.panY = v.y; this.applyView(); }
    else requestAnimationFrame(() => this.fit());
  }

  private nodeBody(n: GNode) {
    switch (n.type) {
      case "start": {
        const uses = this.doc.uses.get(n.sec!) ?? [];
        const lines = uses.map((u) => `<p class="nd-use">${{ npc: "📍", trigger: "▦", bark: "💭", time: "⏰" }[u.kind]} ${esc(u.label)}</p>`).join("");
        return lines || `<p class="nd-muted">还没有放进地图 · 编号 <code>${esc(n.sec!)}</code></p>`;
      }
      case "say": {
        const shown = n.lines!.slice(0, 4).map((l) => {
          const look = l.who ? LOOK_BY_NAME[l.who] : null;
          const who = l.who ?? NARRATOR;
          return `<p><span class="nd-who" style="--c:${look?.dress ?? (l.who ? "#8f86a8" : "#4e6d8c")}">${esc(who)}</span>${l.expr !== "normal" ? `<small>${esc(EXPR_WORD[l.expr] ?? "")}</small>` : ""} ${esc(l.text) || "<em>（空）</em>"}</p>`;
        }).join("");
        return shown + (n.lines!.length > 4 ? `<p class="nd-muted">……还有 ${n.lines!.length - 4} 句</p>` : "");
      }
      case "choice":
        return n.options!.map((o, i) => `<div class="nd-opt"><span>${esc(o.text) || "<em>（空）</em>"}</span><i class="nd-dot${o.to ? " on" : ""}" data-port="o${i}"></i></div>`).join("");
      case "judge":
        return `<p>${esc(describeCondition(n.cond ?? ""))}</p><code class="nd-cond">?${esc(n.cond ?? "")}</code>`;
      case "jump": {
        const t = this.findSection(n.target ?? "");
        return `<p>→ ${t ? `<b>${esc(this.canvasLabel(t.canvas))}</b> · ${esc(t.node.title || t.node.sec!)}` : `<span class="nd-bad">找不到 ${esc(n.target ?? "")}</span>`}</p>`;
      }
      case "end":
        return `<p class="nd-muted">对话在这里结束</p>`;
      default:
        return `<p>${n.cmd ? describeCommand(n.cmd.name, n.cmd.args) : ""}</p>`;
    }
  }

  private renderCanvas() {
    const c = this.canvas();
    this.canvasTitle.textContent = c ? this.canvasLabel(c) : "";
    this.canvasTitle.title = this.canvasTitle.textContent;
    this.layer.innerHTML = "";
    if (!c) { this.svg.innerHTML = ""; return; }
    const issues = this.nodeIssues(c);
    this.layer.innerHTML = c.nodes.map((n) => {
      const t = NODE_TYPES[n.type];
      const outs = n.type === "judge"
        ? `<div class="nd-out yes"><span>是</span><i class="nd-dot${n.yes ? " on" : ""}" data-port="yes"></i></div><div class="nd-out no"><span>否</span><i class="nd-dot${n.next ? " on" : ""}" data-port="next"></i></div>`
        : n.type === "choice" || n.type === "jump" || n.type === "end" ? ""
        : `<div class="nd-out"><span>${n.type === "start" ? "开始" : "下一步"}</span><i class="nd-dot${n.next ? " on" : ""}" data-port="next"></i></div>`;
      const cls = ["nd-node", `nd-t-${n.type}`, n.key === this.selKey ? "sel" : "", n.key === this.playingKey ? "playing" : "", issues.has(n.id) ? "bad" : "",
        this.pending?.id === n.id ? "pending" : ""].join(" ");
      return `<article class="${cls}" data-id="${n.id}" style="left:${n.x}px;top:${n.y}px;width:${NODE_W}px;--c:${t.color}" ${issues.has(n.id) ? `title="${esc(issues.get(n.id)!)}"` : ""}>
        ${n.type !== "start" ? `<i class="nd-in" title="连到这里"></i>` : ""}
        <header><span class="nd-ico">${t.icon}</span><b>${esc(n.type === "start" ? n.title || "开始" : n.title || t.name)}</b>${n.type === "start" ? `<code>${esc(n.sec!)}</code>` : n.title ? `<small>${t.name}</small>` : ""}</header>
        <div class="nd-body">${this.nodeBody(n)}</div>${outs}</article>`;
    }).join("");
    this.hint.textContent = this.pending ? "点一个节点连过去 · Esc 取消" : "拖圆点连线 · 双击连线断开 · 右键空白处加节点";
    this.applyView();
    this.renderEdges();
  }

  /** Problems worth a red outline: a jump to nowhere, an empty line. */
  private nodeIssues(c: Canvas) {
    const out = new Map<string, string>();
    for (const n of c.nodes) {
      if (n.type === "jump" && !this.findSection(n.target ?? "")) out.set(n.id, `找不到跳转目标 ${n.target}`);
      if (n.type === "say" && n.lines!.some((l) => !l.text.trim())) out.set(n.id, "有一句台词是空的");
      if (n.type === "judge" && !n.cond?.trim()) out.set(n.id, "判断还没有写条件");
      const bad = n.src.map((s) => this.doc.parsed.issues.find((i) => i.line === s && !i.warn)).find(Boolean);
      if (bad) out.set(n.id, bad.msg);
    }
    return out;
  }

  private portPoint(node: HTMLElement, sel: string) {
    const p = node.querySelector<HTMLElement>(sel);
    if (!p) return null;
    const w = this.world.getBoundingClientRect(), r = p.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - w.left) / this.zoom, y: (r.top + r.height / 2 - w.top) / this.zoom };
  }

  private renderEdges() {
    const c = this.canvas();
    if (!c) return;
    let html = "";
    for (const n of c.nodes) {
      const card = this.layer.querySelector<HTMLElement>(`[data-id="${n.id}"]`);
      if (!card) continue;
      for (const e of edgesOf(n)) {
        if (!e.to) continue;
        const target = this.layer.querySelector<HTMLElement>(`[data-id="${e.to}"]`);
        const port = e.kind === "option" ? `[data-port="o${e.index}"]` : e.kind === "yes" ? `[data-port="yes"]` : `[data-port="next"]`;
        const a = this.portPoint(card, port), b = target && this.portPoint(target, ".nd-in");
        if (!a || !b) continue;
        const d = Math.max(50, Math.abs(b.x - a.x) * 0.45);
        const path = `M${a.x} ${a.y} C${a.x + d} ${a.y} ${b.x - d} ${b.y} ${b.x} ${b.y}`;
        const kind = n.type === "judge" ? (e.kind === "yes" ? "yes" : "no") : e.kind;
        html += `<path class="nd-edge e-${kind}" d="${path}"/><path class="nd-hit" d="${path}" data-from="${n.id}" data-port="${e.kind === "option" ? `o${e.index}` : e.kind}"><title>双击断开</title></path>`;
      }
    }
    this.svg.innerHTML = html + `<path class="nd-edge nd-temp" d=""/>`;
  }

  /** Real card heights, for laying cards out without overlaps. */
  private measured = (n: GNode) => this.layer.querySelector<HTMLElement>(`[data-id="${n.id}"]`)?.offsetHeight ?? 80;

  /** 一键整理 (and the first look at a canvas nobody has arranged yet). */
  private arrangeNow(merge: boolean) {
    const c = this.canvas();
    if (!c) return;
    if (merge) this.mutate(() => { mergeSays(c); }, { inspector: false });
    const again = this.canvas();
    if (!again) return;
    this.past.push(this.snapshot());
    arrange(again, this.measured);
    const pos = { ...this.doc.layout.pos };
    for (const n of again.nodes) pos[n.key] = [n.x, n.y];
    this.doc.setLayout({ ...this.doc.layout, pos });
    this.renderCanvas();
    requestAnimationFrame(() => this.fit());
  }

  /** A canvas shown for the first time (nothing saved for it yet) gets arranged with its real card sizes. */
  private arrangeIfNew() {
    const c = this.canvas();
    if (!c || c.nodes.some((n) => n.key in this.doc.layout.pos)) return false;
    arrange(c, this.measured);
    const pos = { ...this.doc.layout.pos };
    for (const n of c.nodes) pos[n.key] = [n.x, n.y];
    this.doc.setLayout({ ...this.doc.layout, pos });
    this.renderCanvas();
    return true;
  }

  private applyView() {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  private setZoom(z: number, cx?: number, cy?: number) {
    const r = this.viewport.getBoundingClientRect();
    const x = cx ?? r.width / 2, y = cy ?? r.height / 2;
    const nz = Math.min(2, Math.max(0.3, z));
    this.panX = x - ((x - this.panX) * nz) / this.zoom;
    this.panY = y - ((y - this.panY) * nz) / this.zoom;
    this.zoom = nz;
    this.applyView();
  }

  private fit() {
    const c = this.canvas();
    if (!c?.nodes.length) return;
    const cards = [...this.layer.querySelectorAll<HTMLElement>(".nd-node")];
    const x0 = Math.min(...c.nodes.map((n) => n.x)), y0 = Math.min(...c.nodes.map((n) => n.y));
    const x1 = Math.max(...c.nodes.map((n) => n.x + NODE_W));
    const y1 = Math.max(...cards.map((e) => e.offsetTop + e.offsetHeight), y0 + 100);
    const r = this.viewport.getBoundingClientRect();
    // Not smaller than readable: a long conversation starts at the left and scrolls on.
    this.zoom = Math.min(1.1, Math.max(0.65, Math.min((r.width - 60) / (x1 - x0), (r.height - 60) / (y1 - y0))));
    this.panX = Math.max(30, (r.width - (x1 - x0) * this.zoom) / 2) - x0 * this.zoom;
    this.panY = Math.max(20, (r.height - (y1 - y0) * this.zoom) / 2) - y0 * this.zoom;
    this.applyView();
  }

  /** Scrolls a node into the middle of the view if it's out of sight. */
  private center(n: GNode, always = true) {
    const r = this.viewport.getBoundingClientRect();
    const sx = n.x * this.zoom + this.panX, sy = n.y * this.zoom + this.panY;
    if (!always && sx > 20 && sy > 20 && sx + NODE_W * this.zoom < r.width - 20 && sy + 80 < r.height) return;
    this.panX = r.width / 2 - (n.x + NODE_W / 2) * this.zoom;
    this.panY = r.height / 3 - n.y * this.zoom;
    this.applyView();
  }

  // ------------------------------------------------------------------ canvas input

  private toWorld(e: { clientX: number; clientY: number }) {
    const r = this.viewport.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.panX) / this.zoom, y: (e.clientY - r.top - this.panY) / this.zoom };
  }

  private bindCanvas() {
    const vp = this.viewport;
    const editable = (target: EventTarget | null) => target instanceof Element &&
      !!target.closest('input, textarea, select, [contenteditable="true"]');
    vp.addEventListener("dragstart", (e) => {
      if (!editable(e.target)) e.preventDefault();
    });
    vp.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      this.setZoom(this.zoom * (e.deltaY > 0 ? 0.9 : 1.1), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    vp.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const card = (e.target as HTMLElement).closest<HTMLElement>(".nd-node");
      if (card) { this.nodeMenu(card.dataset.id!, e); return; }
      this.addMenu(e);
    });
    vp.addEventListener("dblclick", (e) => {
      const hit = (e.target as Element).closest?.(".nd-hit") as SVGElement | null;
      if (hit) { this.disconnect(hit.dataset.from!, hit.dataset.port!); return; }
      const card = (e.target as HTMLElement).closest<HTMLElement>(".nd-node");
      const n = card && this.byId(card.dataset.id);
      if (n?.type === "jump" && n.target) this.focusSection(n.target);
    });
    vp.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest(".nd-menu") || editable(t)) return;
      // Canvas gestures must not also start browser text selection or native dragging.
      e.preventDefault();
      this.hideMenu();
      const dot = t.closest<HTMLElement>(".nd-dot");
      const card = t.closest<HTMLElement>(".nd-node");
      if (dot && card) { e.preventDefault(); this.dragWire(e, card.dataset.id!, dot.dataset.port!); return; }
      if (card) {
        if (this.pending) { this.connect(this.pending.id, this.pending.port, card.dataset.id!); this.pending = null; return; }
        this.dragNode(e, card);
        return;
      }
      if (this.pending) { this.pending = null; this.renderCanvas(); }
      this.pan(e);
    });
  }

  private pan(e: PointerEvent) {
    const sx = e.clientX, sy = e.clientY, ox = this.panX, oy = this.panY;
    let moved = false;
    this.viewport.classList.add("panning");
    const move = (m: PointerEvent) => {
      moved = moved || Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) > 3;
      this.panX = ox + m.clientX - sx;
      this.panY = oy + m.clientY - sy;
      this.applyView();
    };
    const up = () => {
      this.viewport.classList.remove("panning");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved && this.selKey) { this.flushTyping(); this.selKey = null; this.renderCanvas(); this.renderInspector(); this.showPreview(); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  private dragNode(e: PointerEvent, card: HTMLElement) {
    const n = this.byId(card.dataset.id);
    if (!n) return;
    if (n.key !== this.selKey) this.select(n);
    const again = this.layer.querySelector<HTMLElement>(`[data-id="${n.id}"]`) ?? card;
    const sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y;
    let moved = false;
    const before = this.snapshot();
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - sx) / this.zoom, dy = (m.clientY - sy) / this.zoom;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      n.x = Math.round(ox + dx);
      n.y = Math.round(oy + dy);
      again.style.left = `${n.x}px`;
      again.style.top = `${n.y}px`;
      this.renderEdges();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return;
      this.past.push(before);
      this.future = [];
      this.doc.setLayout({ ...this.doc.layout, pos: { ...this.doc.layout.pos, [n.key]: [n.x, n.y] } });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Dragging from an exit: drop on a node to connect, on empty space to add a node there; a click waits for the next click. */
  private dragWire(e: PointerEvent, from: string, port: string) {
    const card = this.layer.querySelector<HTMLElement>(`[data-id="${from}"]`)!;
    const a = this.portPoint(card, `[data-port="${port}"]`)!;
    const temp = this.svg.querySelector<SVGPathElement>(".nd-temp")!;
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const move = (m: PointerEvent) => {
      moved = moved || Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) > 4;
      const b = this.toWorld(m);
      const d = Math.max(40, Math.abs(b.x - a.x) * 0.45);
      temp.setAttribute("d", `M${a.x} ${a.y} C${a.x + d} ${a.y} ${b.x - d} ${b.y} ${b.x} ${b.y}`);
    };
    const up = (m: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      temp.setAttribute("d", "");
      if (!moved) {
        this.pending = { id: from, port };
        this.renderCanvas();
        return;
      }
      const over = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>(".nd-node");
      if (over) this.connect(from, port, over.dataset.id!);
      else this.addMenu(m, { id: from, port });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  private setPort(n: GNode, port: string, to: string | null) {
    if (port === "next") n.next = to;
    else if (port === "yes") n.yes = to;
    else if (port.startsWith("o")) n.options![Number(port.slice(1))].to = to;
  }

  private connect(from: string, port: string, to: string) {
    const t = this.byId(to);
    if (!t) return;
    if (t.type === "start") { this.flash("「开始」节点前面不能再接东西；要跳回这里，连到它后面的第一个节点"); this.renderCanvas(); return; }
    this.mutate(() => { const n = this.byId(from); if (n) this.setPort(n, port, to); }, { inspector: true });
  }

  private disconnect(from: string, port: string) {
    this.mutate(() => { const n = this.byId(from); if (n) this.setPort(n, port, null); }, { inspector: true });
  }

  private flash(text: string) {
    this.hint.textContent = text;
    this.hint.classList.add("warn");
    setTimeout(() => this.hint.classList.remove("warn"), 2500);
  }

  // ------------------------------------------------------------------ menus

  private showMenuAt(e: { clientX: number; clientY: number }, html: string) {
    const r = this.viewport.getBoundingClientRect();
    this.menu.innerHTML = html;
    this.menu.classList.add("show");
    const w = this.menu.offsetWidth, h = this.menu.offsetHeight;
    this.menu.style.left = `${Math.min(e.clientX - r.left, r.width - w - 8)}px`;
    this.menu.style.top = `${Math.min(e.clientY - r.top, r.height - h - 8)}px`;
  }

  private hideMenu() {
    this.menu.classList.remove("show");
    this.renderEdges();
  }

  /** Right-click on empty canvas (or a wire dropped there): add a node, connected if it came from a wire. */
  private addMenu(e: { clientX: number; clientY: number }, from?: { id: string; port: string }) {
    const at = this.toWorld(e);
    this.showMenuAt(e, `<div class="nd-menu-title">加入节点</div>` + MENU.map((g) => `<div class="nd-menu-group">${g.group}</div><div class="nd-menu-grid">${
      g.types.filter((t) => !(from && t === "start")).map((t) => `<button data-add="${t}" title="${esc(NODE_TYPES[t].hint)}" style="--c:${NODE_TYPES[t].color}"><span>${NODE_TYPES[t].icon}</span>${NODE_TYPES[t].name}</button>`).join("")}</div>`).join(""));
    for (const b of this.menu.querySelectorAll<HTMLButtonElement>("[data-add]")) b.onclick = () => {
      this.hideMenu();
      this.addNode(b.dataset.add as NodeType, at.x, at.y, from);
    };
  }

  private nodeMenu(id: string, e: MouseEvent) {
    const n = this.byId(id);
    if (!n) return;
    this.select(n);
    this.showMenuAt(e, `<button data-m="copy">复制一个</button>${n.type === "jump" ? `<button data-m="open">打开目标</button>` : ""}<button data-m="del" class="danger">删除</button>`);
    for (const b of this.menu.querySelectorAll<HTMLButtonElement>("[data-m]")) b.onclick = () => {
      this.hideMenu();
      if (b.dataset.m === "del") this.deleteNode(n);
      if (b.dataset.m === "copy") this.duplicate(n);
      if (b.dataset.m === "open" && n.target) this.focusSection(n.target);
    };
  }

  private canvasMenu(name: string, e: MouseEvent) {
    const r = this.el.getBoundingClientRect();
    this.showMenuAt({ clientX: Math.max(e.clientX, r.left + 240), clientY: e.clientY }, `<button data-m="rename">改名</button><button data-m="del" class="danger">删除这张画布</button>`);
    for (const b of this.menu.querySelectorAll<HTMLButtonElement>("[data-m]")) b.onclick = () => {
      this.hideMenu();
      if (b.dataset.m === "rename") this.renameCanvas(name);
      if (b.dataset.m === "del") this.deleteCanvas(name);
    };
  }

  // ------------------------------------------------------------------ node operations

  /** Someone this canvas is about (its person), for new lines and actions. */
  private person() {
    const c = this.canvas();
    const name = c?.scope?.person ?? c?.name;
    return c?.kind === "person" && name && LOOK_BY_NAME[name] ? name : null;
  }

  private freshNode(type: NodeType): GNode {
    const who = this.person() ?? PLAYER;
    const n: GNode = { id: newId(), type, x: 0, y: 0, placed: true, key: "", src: [] };
    const cmd = (name: string, ...args: string[]) => { n.cmd = { name, args }; };
    switch (type) {
      case "say": n.lines = [{ who, expr: "normal", text: "" }]; break;
      case "choice": n.options = [{ text: "好呀", to: null }, { text: "不要", to: null }]; break;
      case "judge": n.cond = "wand"; break;
      case "flag": cmd("flag", "新标记"); break;
      case "item": cmd("item", "木头", "1"); break;
      case "rune": cmd("learn", "fire"); break;
      case "quest": cmd("quest", STORY.quests[0]?.id ?? "task", "新任务"); break;
      case "wait": cmd("wait", "魔法", "按 J 用魔法"); break;
      case "show": cmd("banner", "大标题"); break;
      case "pause": cmd("pause", "1"); break;
      case "act": cmd("act", who, "跳"); break;
      case "camera": cmd("camera", who); break;
      case "sfx": cmd("sfx", "叮"); break;
      case "jump": n.target = this.graph.canvases.find((c) => c.name !== this.canvasName)?.nodes.find((x) => x.type === "start")?.sec ?? ""; break;
      case "start": {
        let k = 1;
        const base = Object.entries(LOOKS).find(([, l]) => l.name === this.person())?.[0] ?? "talk";
        while (this.doc.parsed.script[`${base}_${k}`]) k++;
        n.sec = `${base}_${k}`;
        n.title = "新的开始";
        break;
      }
    }
    return n;
  }

  private addNode(type: NodeType, x: number, y: number, from?: { id: string; port: string }) {
    const n = this.freshNode(type);
    n.x = Math.round(x);
    n.y = Math.round(y - 20);
    const keyed = n;
    this.mutate(() => {
      this.canvas()?.nodes.push(n);
      const src = from && this.byId(from.id);
      if (src) this.setPort(src, from!.port, n.id);
      this.selKey = null;
    }, { inspector: false });
    // After the round trip the node has its key; select it by position.
    const again = this.canvas()?.nodes.find((o) => o.type === keyed.type && o.x === keyed.x && o.y === keyed.y);
    if (again) this.select(again);
    if (type === "say") requestAnimationFrame(() => this.inspector.querySelector<HTMLTextAreaElement>("textarea")?.focus());
  }

  private deleteNode(n: GNode) {
    if (n.type === "start" && this.doc.uses.has(n.sec!) && !confirm(`「${n.title || n.sec}」已经在地图上用了（${this.doc.uses.get(n.sec!)!.map((u) => u.label).join("、")}），删除后那里就没有对话了。确定删除吗？`)) return;
    this.mutate(() => {
      const c = this.canvas()!;
      c.nodes.splice(c.nodes.findIndex((x) => x.id === n.id), 1);
      for (const o of c.nodes) {
        if (o.next === n.id) o.next = null;
        if (o.yes === n.id) o.yes = null;
        for (const opt of o.options ?? []) if (opt.to === n.id) opt.to = null;
      }
      this.selKey = null;
    }, { inspector: true });
  }

  private duplicate(n: GNode) {
    const copy: GNode = { ...structuredClone(n), id: newId(), x: n.x + 30, y: n.y + 30, sec: undefined, key: "" };
    if (copy.type === "start") return this.flash("「开始」节点不能复制；右键空白处可以加一个新的开始");
    this.mutate(() => { this.canvas()?.nodes.push(copy); }, { inspector: false });
    const again = this.canvas()?.nodes.find((o) => o.x === copy.x && o.y === copy.y);
    if (again) this.select(again);
  }

  private select(n: GNode, line = 0) {
    this.flushTyping();
    this.selKey = n.key;
    this.selLine = line;
    this.playingKey = null;
    this.renderCanvas();
    this.renderInspector();
    // Picking a node yourself stops a play-through and shows that node.
    this.preview.show(this.viewOf(n, line));
  }

  /** Selects whatever node a script line belongs to (switching canvas if needed). */
  private selectLine(src: number) {
    for (const c of this.graph.canvases) {
      for (const n of c.nodes) {
        const i = n.src.indexOf(src);
        if (i >= 0 || (n.type === "start" && n.src[0] === src)) {
          this.canvasName = c.name;
          if (c.scope) this.expandedPeople.add(c.scope.person);
          this.selKey = n.key;
          this.selLine = Math.max(0, i);
          return;
        }
      }
    }
  }

  private findSection(id: string) {
    for (const c of this.graph.canvases) {
      const node = c.nodes.find((n) => n.sec === id);
      if (node) return { canvas: c, node };
    }
    return null;
  }

  // ------------------------------------------------------------------ canvases

  private newCanvas(kind: "person" | "event", e: MouseEvent) {
    if (kind === "event") {
      const name = prompt("新事件叫什么？（比如：遇到史莱姆、下雨了）")?.trim();
      if (!name) return;
      this.createCanvas(`${EVENT_PREFIX} · ${name}`, "event", null);
      return;
    }
    const taken = new Set(this.graph.canvases.map((c) => c.scope?.person ?? c.name));
    const free = Object.entries(LOOKS).filter(([, l]) => !taken.has(l.name) && l.name !== PLAYER);
    this.showMenuAt({ clientX: e.clientX + 20, clientY: e.clientY - 40 }, `<div class="nd-menu-title">给谁建一张画布？</div>` +
      free.map(([id, l]) => `<button data-look="${id}">${avatar(l.name)} ${esc(l.name)}</button>`).join("") +
      `<button data-look="">其他名字…</button><div class="nd-menu-tip">人物外观在 src/story/people.json 里加</div>`);
    for (const b of this.menu.querySelectorAll<HTMLButtonElement>("[data-look]")) b.onclick = () => {
      this.hideMenu();
      const id = b.dataset.look!;
      const name = id ? LOOKS[id].name : prompt("人物名字（和台词里写的一样）")?.trim();
      if (!name) return;
      if (taken.has(name)) return this.switchCanvas(this.graph.canvases.find((c) => (c.scope?.person ?? c.name) === name)!.name);
      this.createCanvas(name, "person", id || null);
    };
  }

  private createCanvas(name: string, kind: "person" | "event", lookId: string | null) {
    let base = lookId ?? (kind === "event" ? "event" : "person");
    if (this.doc.parsed.script[base] || !lookId) {
      let k = 1;
      while (this.doc.parsed.script[`${base}_${k}`]) k++;
      base = `${base}_${k}`;
    }
    const start: GNode = { id: newId(), type: "start", x: 40, y: 60, placed: true, key: "", sec: base, title: kind === "event" ? name.replace(/^事件\s*·\s*/, "") : "初次见面", src: [] };
    const say: GNode = { id: newId(), type: "say", x: 40 + NODE_W + 70, y: 60, placed: true, key: "", src: [],
      lines: kind === "person" ? [{ who: name, expr: "normal", text: "你好！" }, { who: PLAYER, expr: "sweat", text: "你、你好……" }] : [{ who: null, expr: "normal", text: "……" }] };
    start.next = say.id;
    this.mutate(() => {
      this.graph.canvases.push({ name, kind, nodes: [start, say] });
      this.canvasName = name;
      this.selKey = null;
    }, { inspector: true });
    this.flash(kind === "person" ? "在地图里放置这个人物，再点「编辑此地图的对话」即可自动关联" : `在地图编辑器里放一个触发区，对话选「${base}」就能在游戏里触发`);
    requestAnimationFrame(() => this.fit());
  }

  private renameCanvas(name: string) {
    const c = this.graph.canvases.find((x) => x.name === name);
    if (!c) return;
    const shown = c.kind === "event" ? name.replace(/^事件\s*·\s*/, "") : name;
    const next = prompt(c.kind === "person" ? "人物名字（和台词里写的一样，才会有名牌和声音）" : "事件名字", shown)?.trim();
    if (!next || next === shown) return;
    const full = c.kind === "event" ? `${EVENT_PREFIX} · ${next}` : next;
    if (this.graph.canvases.some((x) => x.name === full)) return alert("已经有这个名字了");
    this.mutate(() => {
      c.name = full;
      if (this.canvasName === name) this.canvasName = full;
    }, { inspector: false });
  }

  private deleteCanvas(name: string) {
    const c = this.graph.canvases.find((x) => x.name === name);
    if (!c) return;
    const used = c.nodes.filter((n) => n.type === "start" && this.doc.uses.has(n.sec!));
    if (!confirm(`删除「${name}」的全部 ${c.nodes.length} 个节点？${used.length ? `\n其中 ${used.map((n) => n.sec).join("、")} 已经在地图上用了。` : ""}\n（可以用 ↶ 撤销）`)) return;
    this.mutate(() => {
      this.graph.canvases.splice(this.graph.canvases.indexOf(c), 1);
      if (this.canvasName === name) this.canvasName = this.graph.canvases[0]?.name ?? "";
      this.selKey = null;
    }, { inspector: true });
  }

  // ------------------------------------------------------------------ preview

  private viewOf(n: GNode, line = 0): View | null {
    if (n.type === "start") {
      const lines = this.doc.parsed.script[n.sec!] ?? [];
      return { section: n.sec!, pc: 0, line: lines[0] ?? null };
    }
    const src = n.src[Math.min(line, n.src.length - 1)];
    return src ? this.preview.viewAt(src) : null;
  }

  private showPreview() {
    if (this.preview.playing) return;
    const n = this.selected();
    this.preview.show(n ? this.viewOf(n, this.selLine) : null);
  }

  /** ◂ ▸ on the stage: the previous or next line of a 对话 node, then along the wires. */
  private step(dir: number) {
    const n = this.selected();
    if (!n) return;
    if (n.type === "say" && this.selLine + dir >= 0 && this.selLine + dir < n.lines!.length) {
      this.selLine += dir;
      this.renderInspector();
      this.showPreview();
      return;
    }
    const c = this.canvas()!;
    const to = dir > 0 ? this.byId(n.next ?? n.options?.[0]?.to ?? n.yes) : c.nodes.find((o) => edgesOf(o).some((e) => e.to === n.id));
    if (to) this.select(to, dir < 0 && to.type === "say" ? to.lines!.length - 1 : 0);
  }

  /** The stage is playing on: light up the node it's on, following it to other canvases. */
  private followPlay(v: View) {
    if (!v.line) return;
    for (const c of this.graph.canvases) {
      const n = c.nodes.find((x) => x.src.includes(v.line!.src));
      if (!n) continue;
      if (c.name !== this.canvasName) {
        this.views.set(this.canvasName, { zoom: this.zoom, x: this.panX, y: this.panY });
        this.canvasName = c.name;
        this.renderList();
      }
      this.playingKey = n.key;
      this.renderCanvas();
      this.center(n, false);
      return;
    }
  }

  // ------------------------------------------------------------------ keys

  private onKey(e: KeyboardEvent) {
    if (!this.open) return;
    const t = e.target as HTMLElement;
    const inField = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && !inField && (e.code === "KeyZ" || e.code === "KeyY")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.travel(e.code === "KeyY" || e.shiftKey);
      return;
    }
    if (inField) return;
    const n = this.selected();
    if ((e.key === "Delete" || e.key === "Backspace") && n) { e.preventDefault(); this.deleteNode(n); }
    else if (ctrl && e.code === "KeyD" && n) { e.preventDefault(); this.duplicate(n); }
    else if (e.code === "KeyF" && !ctrl) this.fit();
  }

  // ------------------------------------------------------------------ inspector

  private renderInspector() {
    const box = this.inspector;
    const n = this.selected();
    box.innerHTML = "";
    if (!n) {
      box.innerHTML = `<div class="nd-empty"><b>${esc(this.canvas() ? this.canvasLabel(this.canvas()!) : "还没有画布")}</b><p>点一个节点编辑它。</p>
        <p>右键空白处加节点；从节点右边的圆点拖出连线，拖到空白处可以直接接一个新节点。</p><p>Delete 删除 · Ctrl+D 复制 · Ctrl+Z 撤销 · F 适合内容</p></div>`;
      return;
    }
    const t = NODE_TYPES[n.type];
    const head = el("div", "nd-ins-head", `<span class="nd-ico" style="--c:${t.color}">${t.icon}</span><b>${t.name}</b><small>${esc(t.hint)}</small>`);
    const del = el("button", "nd-del", "删除");
    del.onclick = () => this.deleteNode(n);
    head.append(del);
    box.append(head);
    const body = el("div", "nd-ins-body");
    box.append(body);
    const inspectors: Partial<Record<NodeType, (b: HTMLElement, n: GNode) => void>> = {
      start: (b, n) => this.insStart(b, n), say: (b, n) => this.insSay(b, n), choice: (b, n) => this.insChoice(b, n), judge: (b, n) => this.insJudge(b, n),
      flag: (b, n) => this.insFlag(b, n), item: (b, n) => this.insItem(b, n), rune: (b, n) => this.insRune(b, n), quest: (b, n) => this.insQuest(b, n),
      wait: (b, n) => this.insWait(b, n), show: (b, n) => this.insShow(b, n), pause: (b, n) => this.insPause(b, n), act: (b, n) => this.insAct(b, n),
      camera: (b, n) => this.insCamera(b, n), sfx: (b, n) => this.insSfx(b, n), jump: (b, n) => this.insJump(b, n), cmd: (b, n) => this.insCmd(b, n),
    };
    inspectors[n.type]?.(body, n);
    if (n.type === "end") body.append(el("p", "nd-muted", "对话走到这里就结束。出口没有连线的地方也会结束，所以这个节点只是让流程更清楚。"));
    if (n.type !== "start") {
      const more = el("details", "nd-more");
      more.open = !!(n.title || n.note?.length);
      more.innerHTML = `<summary>标题和备注</summary>`;
      this.text(more, "标题（显示在节点上，可不写）", n.title ?? "", "title", (x, v) => { x.title = v.trim() || undefined; });
      this.area(more, "备注（只给自己看）", (n.note ?? []).join("\n"), "note", (x, v) => { x.note = v.trim() ? v.split("\n") : undefined; });
      body.append(more);
    }
  }

  private field(parent: HTMLElement, label: string, input: HTMLElement) {
    const f = el("label", "nd-field");
    f.append(el("span", "", esc(label)), input);
    parent.append(f);
    return input;
  }

  private text(parent: HTMLElement, label: string, value: string, key: string, apply: (n: GNode, v: string) => void, placeholder = "") {
    const i = el("input");
    i.value = value;
    i.placeholder = placeholder;
    i.oninput = () => this.typed(key, (n) => apply(n, i.value));
    i.onblur = () => this.flushTyping();
    return this.field(parent, label, i) as HTMLInputElement;
  }

  private area(parent: HTMLElement, label: string, value: string, key: string, apply: (n: GNode, v: string) => void) {
    const a = el("textarea");
    a.value = value;
    a.rows = 2;
    a.oninput = () => this.typed(key, (n) => apply(n, a.value));
    a.onblur = () => this.flushTyping();
    return this.field(parent, label, a) as HTMLTextAreaElement;
  }

  private choose(parent: HTMLElement, label: string, options: [string, string][], value: string, apply: (n: GNode, v: string) => void) {
    const s = el("select");
    if (!options.some(([v]) => v === value)) options = [[value, value || "（请选择）"], ...options];
    for (const [v, l] of options) s.add(new Option(l, v));
    s.value = value;
    s.onchange = () => this.edit((n) => apply(n, s.value), { inspector: true });
    return this.field(parent, label, s) as HTMLSelectElement;
  }

  private number(parent: HTMLElement, label: string, value: number, step: number, apply: (n: GNode, v: number) => void) {
    const i = el("input");
    i.type = "number";
    i.step = String(step);
    i.value = String(value);
    i.oninput = () => this.typed(label, (n) => apply(n, Number(i.value) || 0));
    i.onblur = () => this.flushTyping();
    return this.field(parent, label, i);
  }

  private people(extra: string[] = []) {
    const names = [PLAYER, ...Object.values(LOOKS).map((l) => l.name).filter((n) => n !== PLAYER)];
    for (const x of extra) if (x && !names.includes(x)) names.push(x);
    return names;
  }

  private flags() {
    const set = new Set(Object.keys(BUILTIN_FLAGS));
    for (const lines of Object.values(this.doc.parsed.script)) for (const l of lines) if (l.t === "cmd" && (l.name === "flag" || l.name === "unflag")) l.args.forEach((a) => set.add(a));
    return [...set];
  }

  private insStart(b: HTMLElement, n: GNode) {
    const id = el("input");
    id.value = n.sec!;
    const rename = el("button", "", "改编号");
    rename.onclick = () => this.renameStart(n, id.value.trim());
    const row = el("div", "nd-row");
    row.append(id, rename);
    this.field(b, "编号（地图上的人物、触发区用它找这段对话）", row);
    this.text(b, "标题", n.title ?? "", "title", (x, v) => { x.title = v.trim() || undefined; }, "比如：初次见面、学会火以后");
    const uses = this.doc.uses.get(n.sec!) ?? [];
    const canvas = this.canvas()!;
    const bindings = dialogueEntryBindings(canvas, n.sec!, Object.values(MAPS), Object.fromEntries(Object.entries(LOOKS).map(([id, look]) => [id, look.name])));
    if (bindings.length) {
      const current = bindings.every(({ obj }) => obj.text === n.sec);
      const entry = el("button", "", current ? "✓ 当前地图的对话入口" : "设为此地图的对话入口");
      entry.disabled = current;
      entry.onclick = () => this.mutate(() => this.doc.setMapBindings(bindings), { inspector: true });
      b.append(entry, el("p", "nd-muted", `与「${esc(canvas.scope!.person)}」交谈时${current ? "会" : "可设为"}从这里开始，仅用于「${esc(MAPS[canvas.scope!.map]?.name ?? canvas.scope!.map)}」${bindings.length > 1 ? `中的 ${bindings.length} 个同名人物` : ""}。`));
    }
    b.append(el("div", "nd-uses", uses.length
      ? `<b>在这些地方开始：</b>${uses.map((u) => `<p>${{ npc: "📍", trigger: "▦", bark: "💭", time: "⏰" }[u.kind]} ${esc(u.label)}</p>`).join("")}`
      : `<b>还没有作为入口使用。</b><p>${bindings.length ? "点击上方按钮可将这里设为当前地图的人物对话入口。" : "人物放进地图后会自动关联；剧情触发区可在地图编辑器里选择此段落。"}</p>`));
    b.append(el("p", "nd-muted", "同一个人不同时候说不同的话：开始后面接「判断」节点来分流。"));
  }

  private renameStart(n: GNode, next: string) {
    const old = n.sec!;
    if (!next || next === old) return;
    if (!/^\S+$/.test(next) || next === "结束") return alert("编号不能有空格");
    if (this.doc.parsed.script[next]) return alert(`已经有叫 ${next} 的段落了`);
    // Maps and timeline events that used the old number follow it.
    for (const m of Object.values(MAPS)) {
      let changed = false;
      for (const o of m.objects) {
        if ((o.type === "npc" || o.type === "trigger") && o.text === old) { o.text = next; changed = true; }
        if (o.bark === old) { o.bark = next; changed = true; }
      }
      if (changed) void fetch("/__maps/save", { method: "POST", body: formatMap(m) });
    }
    if (STORY.timeline.some((ev) => ev.dialogue === old)) {
      for (const ev of STORY.timeline) if (ev.dialogue === old) ev.dialogue = next;
      void fetch("/__story/save", { method: "POST", body: JSON.stringify(STORY) });
    }
    this.mutate(() => {
      n.sec = next;
      for (const c of this.graph.canvases) for (const x of c.nodes) if (x.type === "jump" && x.target === old) x.target = next;
    }, { inspector: true });
    this.doc.indexUses();
    this.renderInspector();
  }

  private insSay(b: HTMLElement, n: GNode) {
    const list = el("div", "nd-lines");
    b.append(list);
    const names = this.people(n.lines!.map((l) => l.who ?? ""));
    n.lines!.forEach((l, i) => {
      const row = el("div", `nd-line${i === this.selLine ? " on" : ""}`);
      const top = el("div", "nd-line-top");
      const who = el("select");
      for (const name of names) who.add(new Option(name, name));
      who.add(new Option("旁白（屏幕上方）", NARRATOR));
      who.add(new Option("其他人…", "\u0000"));
      who.value = l.who ?? NARRATOR;
      const look = l.who ? LOOK_BY_NAME[l.who] : null;
      who.style.setProperty("--c", look?.dress ?? "#4e6d8c");
      who.onchange = () => {
        let v: string | null = who.value;
        if (v === "\u0000") v = prompt("名字（要在人物表里才有名牌和声音）")?.trim() || null;
        if (!v) { who.value = l.who ?? NARRATOR; return; }
        this.edit((x) => { x.lines![i].who = v === NARRATOR ? null : v; }, { inspector: true });
      };
      const expr = el("select");
      for (const [word, e] of Object.entries(EXPR_NAMES)) expr.add(new Option(word, e));
      expr.value = l.expr;
      expr.disabled = !l.who;
      expr.onchange = () => this.edit((x) => { x.lines![i].expr = expr.value as Expr; }, { inspector: true });
      const thought = /^\s*[（(][\s\S]*[）)]\s*$/.test(l.text);
      const think = el("button", `nd-think${thought ? " on" : ""}`, "💭");
      think.title = "心里话（虚线气泡）";
      think.onclick = () => this.edit((x) => {
        const t = x.lines![i].text;
        x.lines![i].text = thought ? t.replace(/^\s*[（(]([\s\S]*)[）)]\s*$/, "$1") : `（${t}）`;
      }, { inspector: true });
      const up = el("button", "", "↑"), down = el("button", "", "↓"), rm = el("button", "", "×");
      up.disabled = i === 0;
      down.disabled = i === n.lines!.length - 1;
      up.onclick = () => this.edit((x) => { const a = x.lines!; [a[i - 1], a[i]] = [a[i], a[i - 1]]; this.selLine = i - 1; }, { inspector: true });
      down.onclick = () => this.edit((x) => { const a = x.lines!; [a[i + 1], a[i]] = [a[i], a[i + 1]]; this.selLine = i + 1; }, { inspector: true });
      rm.onclick = () => { if (n.lines!.length > 1) this.edit((x) => { x.lines!.splice(i, 1); this.selLine = Math.max(0, i - 1); }, { inspector: true }); };
      top.append(el("span", "nd-line-no", String(i + 1)), who, expr, think, el("span", "nd-grow"), up, down, rm);
      const text = el("textarea");
      text.value = l.text;
      text.rows = 2;
      text.placeholder = l.who ? "说什么？（回车：下一句）" : "旁白（回车：下一句）";
      text.onfocus = () => {
        if (this.selLine === i) return;
        this.selLine = i;
        list.querySelectorAll(".nd-line").forEach((r, k) => r.classList.toggle("on", k === i));
        this.showPreview();
      };
      text.oninput = () => this.typed(`line${i}`, (x) => { if (x.lines![i]) x.lines![i].text = text.value.replace(/\n/g, " "); });
      text.onblur = () => this.flushTyping();
      text.onkeydown = (e) => {
        if (e.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.flushTyping();
          this.edit((x) => {
            x.lines!.splice(i + 1, 0, { who: this.answerer(x, i), expr: "normal", text: "" });
            this.selLine = i + 1;
          }, { inspector: true });
          requestAnimationFrame(() => this.inspector.querySelectorAll<HTMLTextAreaElement>(".nd-line textarea")[i + 1]?.focus());
        } else if (e.key === "Backspace" && !text.value && n.lines!.length > 1) {
          e.preventDefault();
          this.edit((x) => { x.lines!.splice(i, 1); this.selLine = Math.max(0, i - 1); }, { inspector: true });
          requestAnimationFrame(() => {
            const prev = this.inspector.querySelectorAll<HTMLTextAreaElement>(".nd-line textarea")[Math.max(0, i - 1)];
            prev?.focus();
            prev?.setSelectionRange(prev.value.length, prev.value.length);
          });
        }
      };
      row.append(top, text);
      list.append(row);
    });
    const add = el("button", "nd-add", "＋ 再加一句");
    add.onclick = () => {
      const i = n.lines!.length - 1;
      this.edit((x) => { x.lines!.push({ who: this.answerer(x, i), expr: "normal", text: "" }); this.selLine = i + 1; }, { inspector: true });
      requestAnimationFrame(() => [...this.inspector.querySelectorAll<HTMLTextAreaElement>(".nd-line textarea")].pop()?.focus());
    };
    b.append(add, el("p", "nd-muted", "回车加下一句（说话人自动换成对方）· Shift+回车不换 · 空行按退格删除"));
  }

  /** Who probably speaks after line i: the other person in the conversation. */
  private answerer(n: GNode, i: number) {
    const cur = n.lines![i]?.who ?? null;
    for (let k = i - 1; k >= 0; k--) { const w = n.lines![k].who; if (w !== cur) return w; }
    if (cur === PLAYER) return this.person() ?? PLAYER;
    return PLAYER;
  }

  private insChoice(b: HTMLElement, n: GNode) {
    n.options!.forEach((o, i) => {
      const row = el("div", "nd-choice-row");
      const input = el("input");
      input.value = o.text;
      input.placeholder = "选项文字";
      input.oninput = () => this.typed(`opt${i}`, (x) => { if (x.options![i]) x.options![i].text = input.value; });
      input.onblur = () => this.flushTyping();
      const target = this.byId(o.to);
      const where = el("small", "", target ? `→ ${esc(target.title || NODE_TYPES[target.type].name)}` : "未连接：选了就结束");
      const up = el("button", "", "↑"), rm = el("button", "", "×");
      up.disabled = i === 0;
      up.onclick = () => this.edit((x) => { const a = x.options!; [a[i - 1], a[i]] = [a[i], a[i - 1]]; }, { inspector: true });
      rm.onclick = () => { if (n.options!.length > 1) this.edit((x) => { x.options!.splice(i, 1); }, { inspector: true }); };
      row.append(el("span", "nd-line-no", String(i + 1)), input, up, rm, where);
      b.append(row);
    });
    const add = el("button", "nd-add", "＋ 加一个选项");
    add.onclick = () => this.edit((x) => { x.options!.push({ text: "", to: null }); }, { inspector: true });
    b.append(add, el("p", "nd-muted", "每个选项在节点右边有自己的圆点，拖出去连到想去的地方。"));
  }

  private insJudge(b: HTMLElement, n: GNode) {
    renderConditions(b, n.cond ?? "", (v) => {
      if (!v.trim()) { this.flash("判断至少要有一个条件"); this.renderInspector(); return; }
      this.edit((x) => { x.cond = v; }, { inspector: true });
    }, false);
    b.append(el("p", "nd-muted", "条件都成立走「是」，否则走「否」。常用：拿到法杖 wand、学会火 fire、木头>=3、!boss（还没打败首领）"));
  }

  private insFlag(b: HTMLElement, n: GNode) {
    const c = n.cmd!;
    this.choose(b, "做什么", [["flag", "记住"], ["unflag", "忘掉"]], c.name, (x, v) => { x.cmd!.name = v; });
    const i = this.text(b, "标记名（判断里用它）", c.args.join(" "), "flag", (x, v) => { x.cmd!.args = v.trim().split(/\s+/).filter(Boolean); });
    const list = el("datalist");
    list.id = "nd-flags";
    for (const f of this.flags()) list.append(new Option(BUILTIN_FLAGS[f] ?? "", f));
    i.setAttribute("list", "nd-flags");
    b.append(list);
  }

  private insItem(b: HTMLElement, n: GNode) {
    const c = n.cmd!;
    this.choose(b, "做什么", [["item", "得到"], ["take", "交出"]], c.name, (x, v) => { x.cmd!.name = v; });
    this.choose(b, "东西", ITEMS.map((k) => [k, k]), ITEM_WORD[ITEM_NAMES[c.args[0]] ?? ""] ?? c.args[0] ?? "", (x, v) => { x.cmd!.args[0] = v; });
    this.number(b, "数量", Number(c.args[1]) || 1, 1, (x, v) => { x.cmd!.args[1] = String(Math.max(1, Math.round(v))); });
  }

  private insRune(b: HTMLElement, n: GNode) {
    const c = n.cmd!;
    const opts: [string, string][] = [
      ...(["fire", "ice", "thunder", "flower"] as const).map((e) => [`learn ${e}`, `元素符文 · ${ELEMENTS[e].name}`] as [string, string]),
      ...(["ring", "pillar", "lob"] as const).map((f) => [`form ${f}`, `形态符文 · ${FORMS[f].name}`] as [string, string]),
      ["wand", "从帽子里拿出法杖（之后才能用魔法）"],
    ];
    this.choose(b, "学会什么", opts, [c.name, ...c.args].join(" "), (x, v) => { const [name, ...args] = v.split(" "); x.cmd = { name, args }; });
  }

  private insQuest(b: HTMLElement, n: GNode) {
    const c = n.cmd!;
    this.choose(b, "做什么", [["quest", "接任务"], ["stage", "推进到某个阶段"], ["done", "完成任务"]], c.name, (x, v) => { x.cmd = { name: v, args: [x.cmd!.args[0] ?? ""] }; });
    this.choose(b, "哪个任务（在「任务」页里建）", STORY.quests.map((q) => [q.id, `${q.title}（${q.id}）`]), c.args[0] ?? "", (x, v) => { x.cmd!.args[0] = v; });
    const q = STORY.quests.find((x) => x.id === c.args[0]);
    if (c.name === "quest") this.text(b, "右上角显示的文字（{木头} 显示数量）", c.args.slice(1).join(" "), "qtext", (x, v) => { x.cmd!.args = [x.cmd!.args[0], ...v.trim().split(/\s+/).filter(Boolean)]; });
    if (c.name === "stage") this.choose(b, "阶段", (q?.stages ?? []).map((s) => [s.id, s.title]), c.args[1] ?? "", (x, v) => { x.cmd!.args[1] = v; });
  }

  private insWait(b: HTMLElement, n: GNode) {
    const c = n.cmd!;
    this.choose(b, "等玩家做什么", WAITS.map((k) => [k, k]), c.args[0] ?? "魔法", (x, v) => { x.cmd!.args[0] = v; });
    this.text(b, "提示文字", c.args.slice(1).join(" "), "tip", (x, v) => { x.cmd!.args = [x.cmd!.args[0], ...v.trim().split(/\s+/).filter(Boolean)]; }, "比如：按 J 挥动法杖");
  }

  private insShow(b: HTMLElement, n: GNode) {
    const c = n.cmd!;
    this.choose(b, "演出", [["banner", "屏幕中间的大字"], ["heal", "回满血"], ["ending", "结束画面"], ["period", "切换时段"], ["nextperiod", "进入下一个时段"]], c.name,
      (x, v) => { x.cmd = { name: v, args: v === "banner" ? ["大标题"] : v === "period" ? [STORY.periods[0]?.id ?? "morning"] : [] }; });
    if (c.name === "banner") this.text(b, "文字", c.args.join(" "), "banner", (x, v) => { x.cmd!.args = v.trim().split(/\s+/).filter(Boolean); });
    if (c.name === "period") this.choose(b, "时段", STORY.periods.map((p) => [p.id, p.name]), c.args[0] ?? "", (x, v) => { x.cmd!.args = [v]; });
  }

  private insPause(b: HTMLElement, n: GNode) {
    this.number(b, "停几秒", Number(n.cmd!.args[0]) || 1, 0.1, (x, v) => { x.cmd!.args = [String(Math.max(0.1, Math.round(v * 10) / 10))]; });
    b.append(el("p", "nd-muted", "气泡先收起来，安静一会儿再继续。放在吐槽前面，笑点会更响。"));
  }

  private insAct(b: HTMLElement, n: GNode) {
    const c = n.cmd!;
    this.choose(b, "谁", this.people([c.args[0] ?? ""]).map((p) => [p, p]), c.args[0] ?? PLAYER, (x, v) => { x.cmd!.args[0] = v; });
    this.choose(b, "动作", Object.keys(ACTS).map((k) => [k, k]), c.args[1] ?? "跳", (x, v) => { x.cmd!.args = [x.cmd!.args[0], v, ...(v === "走" ? [x.cmd!.args[2] || "30"] : [])]; });
    if (c.args[1] === "走") this.number(b, "走多远（像素，负数往左）", Number(c.args[2]) || 30, 5, (x, v) => { x.cmd!.args[2] = String(Math.round(v) || 30); });
    b.append(el("p", "nd-muted", "退场：慢慢消失（重新进地图会回来，想永久离开请配合「标记」和人物的出现条件）。阿梨梨只能转身和跳。"));
  }

  private insCamera(b: HTMLElement, n: GNode) {
    const c = n.cmd!;
    const mode = c.name === "shake" ? "shake" : c.args[0] && c.args[0] !== PLAYER ? "look" : "back";
    this.choose(b, "做什么", [["look", "镜头看向某人"], ["back", "镜头回到阿梨梨"], ["shake", "震屏"]], mode,
      (x, v) => { x.cmd = v === "shake" ? { name: "shake", args: ["2"] } : { name: "camera", args: [v === "back" ? PLAYER : this.person() ?? PLAYER] }; });
    if (mode === "look") this.choose(b, "看谁", this.people([c.args[0] ?? ""]).filter((p) => p !== PLAYER).map((p) => [p, p]), c.args[0] ?? "", (x, v) => { x.cmd!.args = [v]; });
    if (mode === "shake") this.choose(b, "强度", [["1", "轻轻"], ["2", "中等"], ["3", "很猛"]], c.args[0] ?? "2", (x, v) => { x.cmd!.args = [v]; });
    if (mode !== "shake") b.append(el("p", "nd-muted", "对话结束时镜头会自己回来。"));
  }

  private insSfx(b: HTMLElement, n: GNode) {
    const row = el("div", "nd-row");
    const s = el("select");
    for (const k of Object.keys(SOUNDS)) s.add(new Option(k, k));
    s.value = n.cmd!.args[0] ?? "叮";
    s.onchange = () => { this.edit((x) => { x.cmd!.args = [s.value]; }, { inspector: true }); };
    const hear = el("button", "", "▶ 试听");
    hear.onclick = () => { sfx.init(); SOUNDS[s.value]?.(sfx); };
    row.append(s, hear);
    this.field(b, "音效", row);
  }

  private insJump(b: HTMLElement, n: GNode) {
    const s = el("select");
    for (const c of this.graph.canvases) {
      const g = document.createElement("optgroup");
      g.label = this.canvasLabel(c);
      for (const x of c.nodes) if (x.sec) g.append(new Option(`${x.type === "start" ? "▶ " : ""}${x.title || x.sec}（${x.sec}）`, x.sec));
      if (g.children.length) s.append(g);
    }
    s.value = n.target ?? "";
    s.onchange = () => this.edit((x) => { x.target = s.value; }, { inspector: true });
    this.field(b, "跳到", s);
    const go = el("button", "", "打开看看");
    go.onclick = () => n.target && this.focusSection(n.target);
    b.append(go, el("p", "nd-muted", "同一张画布里直接连线就行；跳转用来去别的人物或事件。"));
  }

  private insCmd(b: HTMLElement, n: GNode) {
    this.text(b, "命令", [n.cmd!.name, ...n.cmd!.args].join(" "), "cmd", (x, v) => { const [name, ...args] = v.trim().split(/\s+/); x.cmd = { name: name || "end", args }; });
  }
}
