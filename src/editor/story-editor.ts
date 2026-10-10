import type { Game } from "../game/game";
import type { MapObj } from "../game/mapdata";
import { COMMANDS, SCRIPT_DATA, SCRIPT_SECTIONS } from "../game/dialogue";
import { STORY, storyErrors, type QuestDef, type QuestStage, type StoryContent } from "../game/story";
import { NodeEditor } from "./node-editor";
import { NODE_CSS } from "./node-editor-style";
import { ScriptDoc, type PlayRequest } from "./script-doc";
import { ScriptEditor } from "./script-editor";
import { SCRIPT_CSS } from "./script-editor-style";
import { renderConditions } from "./story-conditions";

type Tab = "dialogue" | "quest" | "time";
/** The dialogue tab edits the script as nodes or as text. */
type Mode = "node" | "text";
const MODE_KEY = "magic-hills.dialogue-mode";
const $ = <T extends HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

/** Dev-only visual authoring for conversations, quests and day/period events. */
export class StoryEditor {
  private root = document.createElement("div");
  private tab: Tab = "dialogue";
  private quest = "";
  private event = "";
  private dirty = false;
  private previewDay = 1;
  private previewPeriod = "morning";
  private message = "";
  private doc: ScriptDoc;
  private script: ScriptEditor;
  private nodes: NodeEditor;
  private mode: Mode = "node";
  private scriptStatus = "";
  private past: StoryContent[] = [];
  private future: StoryContent[] = [];
  private base = JSON.stringify(STORY);
  private draftStored = false;
  private saving = false;
  private pendingDraft: StoryContent | null = null;
  private draftConflict = false;
  private readonly draftKey = "magic-hills.story-editor.draft.v3";
  open = false;

  constructor(private game: Game, private onClose: () => void, play: (req: PlayRequest) => void) {
    this.doc = new ScriptDoc();
    const hooks = { play: (req: PlayRequest) => { this.hide(); play(req); } };
    this.script = new ScriptEditor(this.doc, hooks);
    this.nodes = new NodeEditor(this.doc, hooks);
    try { if (localStorage.getItem(MODE_KEY) === "text") this.mode = "text"; } catch { /* the default is fine */ }
    this.doc.onStatus((text) => {
      this.scriptStatus = text;
      const status = this.root.querySelector<HTMLElement>(".se-status");
      if (status && this.tab === "dialogue") status.textContent = text;
    });
    try {
      const draft = JSON.parse(localStorage.getItem(this.draftKey) || "null");
      if (Array.isArray(draft?.data?.quests) && draft?.data?.version === STORY.version && JSON.stringify(draft.data) !== this.base) {
        this.pendingDraft = draft.data; this.draftConflict = draft.base !== this.base;
      }
    } catch { /* A missing or corrupt draft never replaces project content. */ }
    this.root.id = "story-editor";
    this.root.className = "hidden";
    document.body.appendChild(this.root);
    const style = document.createElement("style");
    style.textContent = STORY_CSS + SCRIPT_CSS + NODE_CSS;
    document.head.appendChild(style);
    window.addEventListener("keydown", (e) => {
      if (!this.open) return;
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
        e.preventDefault(); e.stopImmediatePropagation(); void (this.tab === "dialogue" ? this.doc.saveNow() : this.save()); return;
      }
      // The script is a text box with its own undo; the forms use the editor's.
      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyZ" || e.code === "KeyY") && this.tab !== "dialogue") {
        e.preventDefault(); e.stopImmediatePropagation(); this.travel(e.code === "KeyY" || e.shiftKey); return;
      }
      if (e.code === "Escape" && this.tab === "dialogue" && this.editor().escape()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.code === "Escape" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) this.hide();
    }, true);
    window.addEventListener("beforeunload", (e) => { if (this.dirty && !this.draftStored) { e.preventDefault(); e.returnValue = ""; } });
  }

  show(section?: string, binding?: { obj: MapObj; field: "text" | "bark" }) {
    if (section || binding) this.tab = "dialogue";
    // Resolve the NPC entry even when the user's preferred mode is text.
    if (binding?.obj.type === "npc" && binding.field === "text") this.nodes.prepareMapCanvases();
    this.previewDay = this.game.progress.day;
    this.previewPeriod = this.game.progress.period;
    this.open = true;
    this.root.classList.remove("hidden");
    this.render();
    if (this.tab === "dialogue") this.editor().focusSection(binding ? binding.obj[binding.field] : section);
  }

  private editor() {
    return this.mode === "node" ? this.nodes : this.script;
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.script.unmount();
    this.nodes.unmount();
    this.root.classList.add("hidden");
    this.onClose();
  }

  private checkpoint() {
    this.past.push(structuredClone(STORY)); if (this.past.length > 100) this.past.shift();
    this.future = [];
  }
  private travel(redo: boolean) {
    const from = redo ? this.future : this.past, to = redo ? this.past : this.future;
    const snapshot = from.pop(); if (!snapshot) return;
    to.push(structuredClone(STORY)); Object.assign(STORY, snapshot);
    this.touch(); this.render();
  }
  private storeDraft() {
    if (this.pendingDraft) return;
    try { localStorage.setItem(this.draftKey, JSON.stringify({ base: this.base, data: STORY })); this.draftStored = true; }
    catch { this.draftStored = false; }
  }
  private change(fn: () => void) {
    this.checkpoint(); fn();
    this.touch();
    this.render();
  }

  private touch() {
    this.dirty = true;
    this.storeDraft();
    const status = this.root.querySelector<HTMLElement>(".se-status");
    if (status) status.textContent = this.draftStored ? "草稿已自动保存 · 待保存到项目" : "尚未保存 · 请保存到项目";
    const undo = this.root.querySelector<HTMLButtonElement>("[data-undo]"); if (undo) undo.disabled = !this.past.length;
    const redo = this.root.querySelector<HTMLButtonElement>("[data-redo]"); if (redo) redo.disabled = !this.future.length;
  }


  private render() {
    if (!this.open) return;
    if (this.tab !== "dialogue" || this.mode !== "text") this.script.unmount();
    if (this.tab !== "dialogue" || this.mode !== "node") this.nodes.unmount();
    const scrolls = [".se-side", ".se-form"].map((selector) => {
      const el = this.root.querySelector<HTMLElement>(selector);
      return [selector, el?.scrollLeft ?? 0, el?.scrollTop ?? 0] as const;
    });
    this.root.innerHTML = `<header class="se-header"><strong>剧情编辑器</strong><nav></nav><button data-undo title="撤销 Ctrl+Z">撤销</button><button data-redo title="重做 Ctrl+Y">重做</button><span class="se-status"></span><button data-save>保存到项目</button><button data-close>返回地图</button></header><main class="se-main"></main>`;
    for (const [id, label] of [["dialogue", "对话"], ["quest", "任务"], ["time", "时间"]] as [Tab, string][]) {
      const b = document.createElement("button"); b.textContent = label; b.className = this.tab === id ? "active" : "";
      b.onclick = () => { this.tab = id; this.render(); };
      $(this.root, "nav").appendChild(b);
    }
    if (this.tab === "dialogue") {
      const modes = document.createElement("span"); modes.className = "se-modes";
      for (const [id, label, tip] of [["node", "节点", "节点连线编辑"], ["text", "文本", "像写剧本一样直接打字"]] as [Mode, string, string][]) {
        const b = document.createElement("button"); b.textContent = label; b.title = tip; b.className = this.mode === id ? "active" : "";
        b.onclick = () => {
          if (this.mode === id) return;
          this.editor().unmount();
          this.mode = id;
          try { localStorage.setItem(MODE_KEY, id); } catch { /* not remembered, that's all */ }
          this.render();
        };
        modes.appendChild(b);
      }
      $(this.root, "nav").appendChild(modes);
    }
    $(this.root, ".se-status").textContent = this.tab === "dialogue" ? this.scriptStatus : this.dirty ? this.draftStored ? "草稿已自动保存" : "尚未保存" : "✓ 已保存到项目";
    const undo = $<HTMLButtonElement>(this.root, "[data-undo]"); undo.disabled = !this.past.length; undo.onclick = () => this.travel(false);
    const redo = $<HTMLButtonElement>(this.root, "[data-redo]"); redo.disabled = !this.future.length; redo.onclick = () => this.travel(true);
    undo.hidden = redo.hidden = this.tab === "dialogue";
    $<HTMLButtonElement>(this.root, "[data-save]").disabled = this.saving;
    $<HTMLButtonElement>(this.root, "[data-save]").onclick = () => void (this.tab === "dialogue" ? this.doc.saveNow() : this.save());
    $<HTMLButtonElement>(this.root, "[data-close]").onclick = () => this.hide();
    if (this.tab === "dialogue") this.renderDialogues();
    else if (this.tab === "quest") this.renderQuests();
    else this.renderTime();
    for (const [selector, left, top] of scrolls) {
      const el = this.root.querySelector<HTMLElement>(selector);
      if (el) { el.scrollLeft = left; el.scrollTop = top; }
    }
    if (this.pendingDraft) {
      const overlay = document.createElement("div"); overlay.className = "se-draft-overlay";
      const box = document.createElement("section"); overlay.append(box);
      const title = document.createElement("h2"); title.textContent = "发现上次的编辑草稿"; box.append(title);
      const text = document.createElement("p"); text.textContent = this.draftConflict ? "项目内容也有变化。可以先下载草稿备份，再选择要继续编辑的版本。" : "上次的编辑已保存在这台浏览器里，是否继续？"; box.append(text);
      this.button(box, "继续编辑草稿", () => {
        const draft = this.pendingDraft!; this.pendingDraft = null;
        this.change(() => Object.assign(STORY, draft));
      });
      this.button(box, "下载草稿备份", () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(this.pendingDraft, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "对话草稿备份.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      this.button(box, "使用项目版本", () => { this.pendingDraft = null; localStorage.removeItem(this.draftKey); this.render(); });
      this.root.append(overlay);
    }
    if (this.message) {
      const banner = document.createElement("div"); banner.className = "se-message"; banner.textContent = this.message;
      this.root.appendChild(banner);
      this.message = "";
    }
  }

  private sidebar(title: string, add: () => void) {
    const side = document.createElement("aside"); side.className = "se-side";
    const h = document.createElement("div"); h.className = "se-side-title"; h.textContent = title;
    const b = document.createElement("button"); b.textContent = "＋"; b.title = `新建${title}`; b.onclick = add;
    h.appendChild(b); side.appendChild(h);
    $(this.root, ".se-main").appendChild(side);
    return side;
  }

  private renderDialogues() {
    this.editor().mount($(this.root, ".se-main"));
  }

  private target(parent: HTMLElement, value: string, onChange: (v: string) => void, blankLabel = "请选择对话") {
    this.select(parent, [["", blankLabel], ...SCRIPT_SECTIONS.map((s) => [s.id, s.title ? `${s.title}（${s.id}）` : s.id] as [string, string])], value, onChange, "播放的对话段落");
  }

  private previewCond(cond: string) {
    return cond.split(/[\s,&]+/).filter(Boolean).every((part) => {
      const day = part.match(/^day(>=|<=|>|<|=)(\d+)$/);
      if (day) { const n = Number(day[2]); return day[1] === ">=" ? this.previewDay >= n : day[1] === "<=" ? this.previewDay <= n : day[1] === ">" ? this.previewDay > n : day[1] === "<" ? this.previewDay < n : this.previewDay === n; }
      const period = part.match(/^period=(\w+)$/);
      if (period) return this.previewPeriod === period[1];
      return this.game.scriptCond(part);
    });
  }
  private renderQuests() {
    const side = this.sidebar("任务", () => {
      const id = prompt("新任务 ID")?.trim(); if (!id) return;
      if (!/^[a-z][\w-]*$/i.test(id) || STORY.quests.some((q) => q.id === id)) return alert("ID 格式不正确或已经存在");
      this.change(() => { STORY.quests.push({ id, title: id, stages: [{ id: "start", title: "开始", hint: "完成目标", condition: "", autoAdvance: false }] }); this.quest = id; });
    });
    for (const q of STORY.quests) this.button(side, `${q.title} (${q.id})`, () => { this.quest = q.id; this.render(); }, q.id === this.quest ? "active" : "");
    const main = document.createElement("div"); main.className = "se-form"; $(this.root, ".se-main").appendChild(main);
    const q = STORY.quests.find((x) => x.id === this.quest) ?? STORY.quests[0];
    if (!q) { main.textContent = "任务由对话中的 quest 动作或时间事件接取，再由条件或 done 动作完成。"; return; }
    this.quest = q.id;
    const h = document.createElement("h2"); h.textContent = `任务 ${q.id}`; main.appendChild(h);
    this.input(main, "任务名称", q.title, (v) => this.change(() => q.title = v));
    q.stages.forEach((stage, i) => this.renderQuestStage(main, q, stage, i));
    this.button(main, "＋ 新阶段", () => this.change(() => q.stages.push({ id: `stage${q.stages.length + 1}`, title: "新阶段", hint: "", condition: "", autoAdvance: false })));
    this.button(main, "删除任务", () => { if (confirm(`删除任务 ${q.id}？`)) this.change(() => { STORY.quests.splice(STORY.quests.indexOf(q), 1); this.quest = ""; }); });
    const help = document.createElement("p"); help.className = "se-help"; help.textContent = "条件例子：木头>=3、bridge、!boss、day>=2、period=evening。勾选自动推进后，满足条件会进入下一阶段；最后阶段则完成任务。也可以在对话里使用 stage / done 动作。"; main.appendChild(help);
  }

  private renderQuestStage(parent: HTMLElement, q: QuestDef, stage: QuestStage, i: number) {
    const card = document.createElement("section"); card.className = "se-card"; parent.appendChild(card);
    const h = document.createElement("h3"); h.textContent = `阶段 ${i + 1}`; card.appendChild(h);
    this.input(card, "阶段 ID", stage.id, (v) => this.change(() => stage.id = v));
    this.input(card, "阶段名称", stage.title, (v) => this.change(() => stage.title = v));
    this.input(card, "右上角提示", stage.hint, (v) => this.change(() => stage.hint = v));
    renderConditions(card, stage.condition, v => this.change(() => stage.condition = v), false);
    const label = document.createElement("label"); label.className = "se-check"; label.textContent = "条件达成时自动推进";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = stage.autoAdvance;
    check.onchange = () => this.change(() => stage.autoAdvance = check.checked); label.prepend(check); card.appendChild(label);
    this.button(card, "删除阶段", () => { if (q.stages.length > 1) this.change(() => q.stages.splice(i, 1)); });
  }

  private renderTime() {
    const side = this.sidebar("时间事件", () => {
      const id = prompt("新时间事件 ID")?.trim(); if (!id) return;
      if (!/^[a-z][\w-]*$/i.test(id) || STORY.timeline.some((e) => e.id === id)) return alert("ID 格式不正确或已经存在");
      this.change(() => { STORY.timeline.push({ id, day: 0, period: STORY.periods[0]?.id ?? "morning", condition: "", dialogue: "", actions: [] }); this.event = id; });
    });
    for (const e of STORY.timeline) this.button(side, `${e.day || "每天"} · ${STORY.periods.find((p) => p.id === e.period)?.name ?? e.period} · ${e.id}`, () => { this.event = e.id; this.render(); }, e.id === this.event ? "active" : "");
    const main = document.createElement("div"); main.className = "se-form"; $(this.root, ".se-main").appendChild(main);
    const title = document.createElement("h2"); title.textContent = "天数 + 时段"; main.appendChild(title);
    const help = document.createElement("p"); help.className = "se-help"; help.textContent = "时间不会自动流逝。睡觉进入下一天早晨；对话中的 period 或 nextperiod 动作可以推进时段。事件在指定时间、条件满足时触发，每天最多一次。"; main.appendChild(help);
    const periods = document.createElement("div"); periods.className = "se-periods"; main.appendChild(periods);
    for (const p of STORY.periods) this.input(periods, p.id, p.name, (v) => this.change(() => p.name = v));
    const preview = document.createElement("div"); preview.className = "se-preview"; main.appendChild(preview);
    preview.append("预览：");
    const day = document.createElement("input"); day.type = "number"; day.min = "1"; day.value = String(this.previewDay); day.onchange = () => { this.previewDay = Math.max(1, Number(day.value) || 1); this.render(); }; preview.append(day);
    this.select(preview, STORY.periods.map((p) => [p.id, p.name]), this.previewPeriod, (v) => { this.previewPeriod = v; this.render(); });
    const active = STORY.timeline.filter((e) => (!e.day || e.day === this.previewDay) && e.period === this.previewPeriod && this.previewCond(e.condition));
    const result = document.createElement("p"); result.textContent = active.length ? `符合的事件：${active.map((e) => e.id).join("、")}` : "没有符合的事件"; preview.appendChild(result);
    const event = STORY.timeline.find((x) => x.id === this.event) ?? STORY.timeline[0];
    if (!event) return;
    this.event = event.id;
    const h = document.createElement("h3"); h.textContent = `事件 ${event.id}`; main.appendChild(h);
    this.number(main, "第几天（0 = 每天）", event.day, (v) => this.change(() => event.day = Math.max(0, v)));
    this.select(main, STORY.periods.map((p) => [p.id, p.name]), event.period, (v) => this.change(() => event.period = v), "时段");
    renderConditions(main, event.condition, v => this.change(() => event.condition = v), false);
    this.target(main, event.dialogue, (v) => this.change(() => event.dialogue = v), "不播放对话");
    const ah = document.createElement("h3"); ah.textContent = "进入时执行"; main.appendChild(ah);
    event.actions.forEach((a, i) => {
      const row = document.createElement("div"); row.className = "se-row"; main.appendChild(row);
      this.select(row, COMMANDS.filter((c) => !["wait", "end", "ending", "nextperiod", "period"].includes(c)).map((c) => [c, c]), a.name, (v) => this.change(() => a.name = v));
      this.input(row, "参数", a.args.join(" "), (v) => this.change(() => a.args = v.trim() ? v.trim().split(/\s+/) : []));
      this.button(row, "×", () => this.change(() => event.actions.splice(i, 1)));
    });
    this.button(main, "＋ 动作", () => this.change(() => event.actions.push({ name: "flag", args: [""] })));
    this.button(main, "删除事件", () => { if (confirm(`删除事件 ${event.id}？`)) this.change(() => { STORY.timeline.splice(STORY.timeline.indexOf(event), 1); this.event = ""; }); });
  }

  private button(parent: HTMLElement, label: string, fn: () => void, cls = "") {
    const b = document.createElement("button"); b.textContent = label; b.className = cls; b.onclick = fn; parent.appendChild(b); return b;
  }

  private input(parent: HTMLElement, label: string, value: string, fn: (v: string) => void, live = false) {
    const wrap = document.createElement("label"); wrap.className = "se-field"; wrap.append(label);
    const input = document.createElement("input"); input.type = "text"; input.value = value;
    if (live) input.oninput = () => fn(input.value); else input.onchange = () => fn(input.value);
    wrap.appendChild(input); parent.appendChild(wrap); return input;
  }

  private number(parent: HTMLElement, label: string, value: number, fn: (v: number) => void) {
    const wrap = document.createElement("label"); wrap.className = "se-field"; wrap.append(label);
    const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.value = String(value); input.onchange = () => fn(Number(input.value) || 0);
    wrap.appendChild(input); parent.appendChild(wrap);
  }

  private select(parent: HTMLElement, options: [string, string][], value: string, fn: (v: string) => void, label = "") {
    const wrap = document.createElement("label"); wrap.className = "se-field"; if (label) wrap.append(label);
    const select = document.createElement("select");
    for (const [v, name] of options) { const opt = document.createElement("option"); opt.value = v; opt.textContent = name; select.appendChild(opt); }
    select.value = value; select.onchange = () => fn(select.value);
    wrap.appendChild(select); parent.appendChild(wrap); return select;
  }

  private async save() {
    if (this.saving || this.pendingDraft) return;
    this.storeDraft();
    const errors = storyErrors(STORY, new Set(Object.keys(SCRIPT_DATA)));
    if (errors.length) { this.message = `草稿已保留，保存到项目之前请完成：${errors.slice(0, 3).join("；")}`; this.render(); return; }
    const body = JSON.stringify(STORY);
    this.saving = true;
    try {
      const response = await fetch("/__story/save", { method: "POST", body });
      if (!response.ok) throw new Error(await response.text());
      this.base = body;
      this.dirty = JSON.stringify(STORY) !== body;
      if (!this.dirty) localStorage.removeItem(this.draftKey); else this.storeDraft();
    } catch (e) { this.message = `项目保存失败，${this.draftStored ? "草稿已保留在浏览器" : "请重试"}：${e instanceof Error ? e.message : e}`; }
    finally { this.saving = false; this.render(); }
  }
}

const STORY_CSS = `
#story-editor { position: fixed; inset: 0; z-index: 30; background: #181126; color: #fff6e8; font: 13px/1.5 "Microsoft YaHei", sans-serif; }
.se-draft-overlay { position:absolute; inset:0; z-index:20; background:#26364188; display:grid; place-items:center; } .se-draft-overlay section { width:min(560px,85vw); background:#fff; padding:28px; border-radius:12px; box-shadow:0 20px 80px #0005; } .se-draft-overlay button { margin:5px; }
#story-editor.hidden { display: none; }
#story-editor button, #story-editor input, #story-editor select, #story-editor textarea { font: inherit; color: inherit; background: #34285a; border: 1px solid #64538d; padding: 5px 7px; box-sizing: border-box; }
#story-editor button { cursor: pointer; } #story-editor button:hover { border-color: #ffe478; }
#story-editor button.active { background: #6a4fb0; color: #ffe478; border-color: #ffe478; }
.se-header { height: 48px; padding: 6px 12px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; border-bottom: 2px solid #6a4fb0; }
.se-header strong { color: #ffe478; font-size: 17px; margin-right: 18px; } .se-header nav { display: flex; gap: 4px; align-items: center; }
.se-modes { display: flex; margin-left: 14px; border: 1px solid #64538d; border-radius: 6px; overflow: hidden; }
#story-editor .se-modes button { border: 0; border-radius: 0; padding: 4px 12px; } .se-header .se-status { margin-left: auto; color: #b8f5a0; }
.se-main { display: flex; height: calc(100vh - 48px); min-width: 0; }
.se-side { flex: 0 0 205px; border-right: 1px solid #544176; padding: 10px; overflow: auto; box-sizing: border-box; display: flex; flex-direction: column; gap: 5px; }
.se-side-title { display: flex; justify-content: space-between; align-items: center; color: #c9a0ff; font-size: 16px; }
.se-side .se-list { display: flex; flex-direction: column; gap: 3px; overflow: auto; } .se-side button { text-align: left; }
.se-graph-scroll { flex: 1; min-width: 0; overflow: auto; background-color: #211936; background-image: radial-gradient(#45365e 1px, transparent 1px); background-size: 20px 20px; }
.se-board { position: relative; } .se-lines { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.se-link { fill: none; stroke: #b797ef; stroke-width: 2; opacity: .7; }
.se-node { position: absolute; width: 180px; min-height: 90px; border: 2px solid #755da4; background: #34285a; box-shadow: 4px 5px 0 #120c22; cursor: pointer; }
.se-node.selected { border-color: #ffe478; } .se-node-head { padding: 5px 7px; background: #5b458c; color: #fff2a0; cursor: grab; font-weight: bold; }
.se-node-body { padding: 7px; color: #d7c8eb; overflow: hidden; }
.se-detail { flex: 0 0 345px; padding: 12px; overflow: auto; border-left: 1px solid #544176; box-sizing: border-box; }
.se-form { flex: 1; overflow: auto; padding: 14px 24px; max-width: 850px; } .se-form h2, .se-detail h2 { color: #ffe478; margin: 0 0 10px; }
.se-form h3, .se-detail h3 { color: #c9a0ff; margin: 14px 0 6px; }
.se-field { display: flex; flex-direction: column; gap: 2px; margin: 7px 0; color: #d0bce9; min-width: 0; flex: 1; }
.se-field input, .se-field select, .se-field textarea { width: 100%; } .se-field textarea { min-height: 75px; resize: vertical; }
.se-row { display: flex; gap: 4px; align-items: end; } .se-row .se-field { margin: 2px 0; }
.se-card { border: 1px solid #554478; background: #261c3d; padding: 8px; margin: 8px 0; }
.se-option { border-left: 2px solid #a98bd7; padding-left: 7px; margin: 7px 0; }
.se-preview { border: 1px solid #8c70bd; background: #2d224a; padding: 10px; margin: 10px 0; min-height: 45px; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; }
.se-preview-body { flex: 1; min-width: 0; } .se-face { width: 52px; height: 48px; image-rendering: pixelated; flex: none; }
.se-preview p { margin: 5px 0; } .se-preview button { margin: 2px; }
.se-preview input[type=number] { width: 70px; margin: 0 6px; } .se-preview .se-field { display: inline-flex; width: 110px; margin: 0 6px; }
.se-periods { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; } .se-check { display: flex; gap: 5px; align-items: center; margin: 8px 0; }
.se-help { color: #b7a4d3; max-width: 650px; }
.se-workspace { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.se-workbar { min-height: 48px; display: flex; align-items: center; gap: 6px; padding: 6px 20px; box-sizing: border-box; border-bottom: 1px solid #544176; background: #20172f; }
.se-workbar span { color: #c9a0ff; font-weight: bold; margin-right: auto; }
.se-workbar button { border-radius: 5px; padding: 5px 12px !important; }
.se-write { flex: 1; overflow: auto; background: linear-gradient(150deg, #251b37 0%, #171222 75%); }
.se-page { width: min(100%, 830px); margin: 0 auto; padding: 28px 34px 90px; box-sizing: border-box; }
.se-page-head { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.se-page-head h2 { margin: 2px 0 4px; font-size: 25px; color: #ffe79e; overflow-wrap: anywhere; }
.se-page-title { flex: 1; min-width: 0; }
.se-page-title .se-field { max-width: 560px; margin: 2px 0; font-size: 11px; }
.se-page-title input { font-size: 21px !important; font-weight: bold !important; color: #ffe79e !important; background: transparent !important; border: 0 !important; border-bottom: 1px solid #59486f !important; padding: 2px 0 !important; }
.se-page-title input:focus { outline: none; border-color: #ffe79e !important; }
.se-page-title small { font-size: 11px; }
.se-eyebrow { font-size: 11px; color: #bea3df; letter-spacing: .1em; }
.se-primary { background: #8160b5 !important; border-color: #b794ea !important; font-weight: bold !important; }
.se-create { display: flex; gap: 5px; }
.se-create input { width: 100%; min-width: 0; }
.se-create button { flex: none; }
.se-search { width: 100%; }
.se-side .se-list { flex: 1; min-height: 0; }
.se-section { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 8px !important; border-radius: 5px; }
.se-section strong { font-size: 12px; overflow-wrap: anywhere; }
.se-section small { color: #bdafd1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
.se-section.active small { color: #e3d1fe; }
.se-step { border-radius: 8px; padding: 0 18px 16px; margin: 10px 0 0; box-shadow: 0 5px 18px #100b1c55; }
.se-step-say { border-left: 3px solid #e6c66c; }
.se-step-choice { border-left: 3px solid #8de2d8; }
.se-step-goto, .se-step-if { border-left: 3px solid #ba9cec; }
.se-step-cmd { border-left: 3px solid #ef9aa9; }
.se-step-head { display: flex; align-items: center; gap: 10px; min-height: 48px; border-bottom: 1px solid #4a3a66; margin-bottom: 10px; }
.se-step-head strong { color: #fff1bd; font-size: 14px; }
.se-step-index { color: #a68cbb; font: bold 11px Consolas, monospace; }
.se-step-controls { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.se-step-controls .se-field { display: flex; flex-direction: row; align-items: center; gap: 5px; flex: none; margin: 0; font-size: 11px; }
.se-step-controls select { width: auto; padding: 3px 5px !important; }
.se-icon { min-width: 27px; }
.se-link-button { background: transparent !important; border-color: transparent !important; color: #c6b6df !important; }
.se-link-button:hover { color: #ffe79e !important; }
.se-danger { border-color: #d78491 !important; background: #653342 !important; }
.se-step .se-row { gap: 12px; align-items: flex-end; }
.se-step .se-field { margin: 8px 0; }
.se-step textarea { min-height: 98px; font-size: 15px !important; line-height: 1.7 !important; padding: 10px 12px !important; background: #1d172b !important; }
.se-step .se-option { border: 1px solid #5d687d; border-left: 3px solid #8de2d8; border-radius: 4px; padding: 8px 12px; margin: 9px 0; background: #22293a; }
.se-add { margin: 4px 0 12px 30px; color: #bba4d8; }
.se-add summary { display: inline-block; cursor: pointer; list-style: none; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
.se-add summary:hover { background: #392b55; color: #ffe79e; }
.se-add summary::-webkit-details-marker { display: none; }
.se-add-options { display: flex; flex-wrap: wrap; gap: 5px; padding: 7px 0; }
.se-add-options button { text-align: left; border-radius: 4px; }
.se-preview-large { align-items: center; margin: 17px 0; border-radius: 8px; }
.se-page-footer { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; padding: 20px 0; color: #e6a5b0; }
.se-empty { max-width: 500px; margin: 17vh auto; text-align: center; color: #d1c2e4; padding: 20px; }
.se-message { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); max-width: 80vw; background: #66384c; color: #fff; border: 1px solid #d989a1; border-radius: 6px; padding: 9px 14px; box-shadow: 0 8px 24px #0008; }
@media (max-width: 800px) {
  .se-header { height: auto; min-height: 48px; flex-wrap: wrap; }
  .se-header strong { margin-right: 0; }
  .se-header .se-status { margin-left: 0; }
  .se-main { display: block; height: calc(100vh - 85px); overflow: auto; }
  .se-side { width: 100%; height: 145px; border-right: 0; border-bottom: 1px solid #544176; }
  .se-side .se-list { display: flex; flex-direction: row; flex-wrap: wrap; overflow: auto; }
  .se-graph-scroll { width: 100%; height: 270px; }
  .se-detail { width: 100%; height: auto; overflow: visible; border-left: 0; border-top: 1px solid #544176; }
  .se-form { max-width: none; padding: 12px; }
  .se-periods { grid-template-columns: repeat(2, 1fr); }
  .se-workspace { min-height: 0; }
  .se-write { min-height: 58vh; overflow: visible; }
  .se-page { padding: 18px 14px 55px; }
  .se-step .se-row { flex-wrap: wrap; gap: 3px; }
  .se-step-head { flex-wrap: wrap; padding: 6px 0; }
  .se-step-controls { width: 100%; justify-content: flex-end; }
  .se-page-head h2 { font-size: 21px; }
}
`;

