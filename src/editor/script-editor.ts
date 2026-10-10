import { type Line, type SectionInfo, type ScriptIssue } from "../game/dialogue";
import { LOOKS } from "../game/people";
import { ELEMENTS, ELEMENT_ORDER, FORMS, FORM_ORDER } from "../game/runes";
import { STORY } from "../game/story";
import type { PlayRequest, ScriptDoc } from "./script-doc";
import { BUILTIN_FLAGS, COMMAND_INFO, complete, highlightLine, jumpTarget, lineKind, NARRATOR, speakerOf, type Suggestion } from "./script-lang";
import { StagePreview, type View } from "./stage-preview";

/**
 * The story editor's text mode: the script as text you type like a play
 * (with colours, suggestions and problems underlined), an outline of
 * chapters and sections, the stage acting out the line under the cursor,
 * and the flow of the conversation drawn by itself.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = "") {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export class ScriptEditor {
  readonly el = el("div", "sc-shell");
  private input = el("textarea", "sc-input");
  private hl = el("div", "sc-hl");
  private scroll = el("div", "sc-scroll");
  private stack = el("div", "sc-stack");
  private popup = el("div", "sc-popup");
  private status = el("div", "sc-statusline");
  private outline = el("div", "sc-outline-list");
  private search = el("input", "sc-search");
  private flow = el("div", "sc-flow");
  private preview: StagePreview;

  private lines: string[] = [];
  private colors: Record<string, string> = {};
  private caretLine = 1;
  private lastFlowKey = "";

  private suggest: { line: number; from: number; to: number; items: Suggestion[]; index: number; fresh: boolean } | null = null;
  private composing = false;
  open = false;

  constructor(private doc: ScriptDoc, hooks: { play: (req: PlayRequest) => void }) {
    for (const look of Object.values(LOOKS)) this.colors[look.name] = look.dress;
    this.preview = new StagePreview(doc, {
      play: hooks.play,
      step: (d) => this.stepLine(d),
      onLine: (v) => this.followPlay(v),
    });
    this.build();
    this.load();
    doc.onChange((source) => {
      if (source === this) return;
      this.load();
      if (this.open) this.refresh();
    });
  }

  private get parsed() { return this.doc.parsed; }

  // ------------------------------------------------------------------ layout

  private build() {
    const side = el("aside", "sc-outline");
    const head = el("div", "sc-outline-head");
    this.search.placeholder = "搜索台词、段落…";
    this.search.oninput = () => this.renderOutline();
    this.search.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.outline.querySelector<HTMLButtonElement>("button")?.click(); }
      if (e.key === "Escape") { this.search.value = ""; this.renderOutline(); this.input.focus(); }
    };
    const add = el("button", "sc-add", "＋ 新段落");
    add.title = "在当前段落后面加一个新段落";
    add.onclick = () => this.newSection();
    head.append(this.search, add);
    side.append(head, this.outline);

    const main = el("section", "sc-main");
    const bar = el("div", "sc-toolbar");
    main.append(bar, this.doc.banner);
    this.fillToolbar(bar);
    this.input.spellcheck = false;
    this.input.setAttribute("autocomplete", "off");
    this.input.setAttribute("aria-label", "台词脚本");
    this.stack.append(this.hl, this.input);
    this.scroll.append(this.stack, this.popup);
    main.append(this.scroll, this.status);

    const right = el("aside", "sc-side");
    right.append(this.preview.el, el("div", "sc-side-title", "对话流程 <small>自动生成 · 点方块跳过去</small>"), this.flow);
    this.el.append(side, main, right);

    const inp = this.input;
    inp.addEventListener("input", (e) => this.onInput(e as InputEvent));
    inp.addEventListener("keydown", (e) => this.onKey(e));
    inp.addEventListener("compositionstart", () => { this.composing = true; });
    inp.addEventListener("compositionend", () => { this.composing = false; this.updateSuggest(false); });
    inp.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey) this.followJump();
      this.caretMoved();
    });
    inp.addEventListener("keyup", (e) => { if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) this.caretMoved(); });
    inp.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== inp) this.closeSuggest(); }, 150));
    this.popup.addEventListener("pointerdown", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (!item || !this.suggest) return;
      e.preventDefault();
      this.suggest.index = Number(item.dataset.i);
      this.accept();
    });
  }

  private fillToolbar(bar: HTMLElement) {
    const tip = el("span", "sc-tip", "直接打字就行：<b>名字(表情): 台词</b> · 回车后按 <kbd>Tab</kbd> 换下一个说话人 · <kbd>Ctrl</kbd>+点击 跳到段落 · <kbd>Ctrl</kbd>+<kbd>/</kbd> 注释");
    const help = el("details", "sc-help");
    help.innerHTML = `<summary>写法速查</summary><div class="sc-help-body">
      <p><b>【第一站】</b> 章节，左边目录按它分组</p>
      <p><b>== granny == 苹果婆婆·初见</b> 段落。地图上的人物/触发区用段落名找台词；后面的中文是标题，可不写</p>
      <p><b>苹果婆婆(开心): 台词</b> 说话。表情：普通 开心 惊讶 汗 困 生气 得意</p>
      <p><b>阿梨梨: （心里话）</b> 用（）括起来 = 心里想的</p>
      <p><b>旁白: 文字</b> 屏幕上方的叙述</p>
      <p><b>不写名字的一行</b> 上一个人接着说</p>
      <p><b>* 选项 -> 段落</b> 连着几行就是几个选项</p>
      <p><b>?fire -> 段落</b> 条件成立就跳。<b>!fire</b> 没有标记，<b>木头>=3</b> 数量，空格隔开 = 都要成立</p>
      <p><b>-> 段落</b> 跳过去 · <b>!命令</b> 给东西、学符文… 打 ! 会列出来</p>
      <p>同一个人不同时候说不同的话：段落开头写几行 <b>?条件 -> 段落</b>，都不成立就往下说默认的。</p></div>`;
    bar.append(tip, help);
  }

  mount(host: HTMLElement) {
    host.append(this.el);
    this.open = true;
    this.preview.start();
    if (this.doc.focusLine) this.gotoLine(this.doc.focusLine, true);
    else this.refresh();
  }

  unmount() {
    if (!this.open) return;
    this.open = false;
    this.doc.focusLine = this.caretLine;
    this.preview.stop();
    this.closeSuggest();
    this.el.remove();
  }

  focusSection(id?: string) {
    const sec = id && this.parsed.sections.find((s) => s.id === id);
    if (sec) this.gotoLine(sec.line, true);
  }

  escape() {
    if (this.suggest) { this.closeSuggest(); return true; }
    if (this.preview.playing) { this.preview.show(this.viewAtCaret()); return true; }
    return false;
  }

  // ------------------------------------------------------------------ text

  /** Takes the text from the document (someone else changed it), keeping the cursor where it was. */
  private load() {
    const pos = this.input.selectionStart;
    this.input.value = this.doc.text;
    this.lines = this.doc.text.split("\n");
    this.input.setSelectionRange(Math.min(pos, this.doc.text.length), Math.min(pos, this.doc.text.length));
    this.renderHighlight();
  }

  private onInput(e: InputEvent) {
    this.doc.set(this.input.value, this);
    this.lines = this.input.value.split("\n");
    this.renderHighlight();
    this.caretLine = this.lineAt(this.input.selectionStart);
    this.refresh();
    if (this.composing) return;
    const fresh = e.inputType === "insertLineBreak" || (e.inputType === "insertText" && e.data === null);
    this.updateSuggest(fresh);
  }

  /** Line number (1-based) at a character offset. */
  private lineAt(pos: number) {
    let n = 1;
    const v = this.input.value;
    for (let i = 0; i < pos; i++) if (v.charCodeAt(i) === 10) n++;
    return n;
  }

  /** Character offset where a line (1-based) starts. */
  private offsetOf(line: number) {
    let off = 0;
    for (let i = 0; i < line - 1 && i < this.lines.length; i++) off += this.lines[i].length + 1;
    return off;
  }

  private renderHighlight() {
    const issues = new Map<number, ScriptIssue>();
    for (const i of this.parsed.issues) if (!issues.has(i.line) || !i.warn) issues.set(i.line, i);
    const sec = this.sectionAt(this.caretLine);
    this.hl.innerHTML = this.lines.map((raw, i) => {
      const n = i + 1;
      const issue = issues.get(n);
      const cls = [`ln k-${lineKind(raw)}`, issue ? (issue.warn ? "warn" : "err") : "", sec && n >= sec.line && n <= sec.end ? "in-sec" : "", n === this.caretLine ? "cur" : ""].join(" ");
      return `<div class="${cls}" data-n="${n}">${highlightLine(raw, this.colors)}</div>`;
    }).join("");
  }

  /** Moves the "current line" and "current section" marks without rebuilding the text. */
  private markCaret() {
    const sec = this.sectionAt(this.caretLine);
    const rows = this.hl.children;
    for (let i = 0; i < rows.length; i++) {
      const n = i + 1;
      rows[i].classList.toggle("cur", n === this.caretLine);
      rows[i].classList.toggle("in-sec", !!sec && n >= sec.line && n <= sec.end);
    }
  }

  private caretMoved() {
    const line = this.lineAt(this.input.selectionStart);
    if (line !== this.caretLine || this.preview.playing) {
      this.caretLine = line;
      // Moving the cursor yourself stops a play-through and shows that line instead.
      if (this.preview.playing) this.preview.show(this.viewAtCaret());
      this.markCaret();
      this.refresh();
    }
    if (this.suggest && this.suggest.line !== line) this.closeSuggest();
  }

  private gotoLine(line: number, top = false) {
    const off = this.offsetOf(line);
    const end = off + (this.lines[line - 1]?.length ?? 0);
    this.input.focus({ preventScroll: true });
    this.input.setSelectionRange(end, end);
    this.caretLine = line;
    this.markCaret();
    this.scrollToLine(line, top);
    this.refresh();
  }

  private scrollToLine(line: number, top: boolean) {
    const row = this.hl.children[line - 1] as HTMLElement | undefined;
    if (!row) return;
    const y = row.offsetTop, h = this.scroll.clientHeight;
    if (top) this.scroll.scrollTop = Math.max(0, y - 40);
    else if (y < this.scroll.scrollTop + 30 || y > this.scroll.scrollTop + h - 60) this.scroll.scrollTop = Math.max(0, y - h / 3);
  }

  /** Replaces [from, to) with text, keeping the browser's own undo (Ctrl+Z) working. */
  private replace(from: number, to: number, text: string) {
    this.input.focus({ preventScroll: true });
    this.input.setSelectionRange(from, to);
    if (!document.execCommand("insertText", false, text)) {
      this.input.setRangeText(text, from, to, "end");
      this.input.dispatchEvent(new InputEvent("input", { inputType: "insertReplacementText" }));
    }
  }

  private sectionAt(line: number): SectionInfo | undefined {
    return this.parsed.sections.find((s) => line >= s.line && line <= s.end);
  }

  // ------------------------------------------------------------------ keys

  private onKey(e: KeyboardEvent) {
    if (e.isComposing || this.composing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const s = this.suggest;
    if (s) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        s.index = (s.index + (e.key === "ArrowDown" ? 1 : s.items.length - 1)) % s.items.length;
        this.renderSuggest();
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !s.fresh)) { e.preventDefault(); this.accept(); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.closeSuggest(); return; }
    }
    if (e.key === "Tab" && !ctrl) {
      e.preventDefault();
      this.updateSuggest(false, true);
      return;
    }
    if (ctrl && (e.key === "/" || e.code === "Slash")) { e.preventDefault(); this.toggleComment(); return; }
    if (e.key === "Enter" && !ctrl && !e.shiftKey) {
      // Choices keep coming until an empty one ends the list.
      const pos = this.input.selectionStart;
      if (pos !== this.input.selectionEnd) return;
      const line = this.lineAt(pos), raw = this.lines[line - 1] ?? "";
      if (lineKind(raw) !== "choice" || pos !== this.offsetOf(line) + raw.length) return;
      e.preventDefault();
      if (/^\s*\*\s*$/.test(raw)) this.replace(this.offsetOf(line), pos, "");
      else this.replace(pos, pos, "\n* ");
    }
  }

  private toggleComment() {
    const a = this.lineAt(this.input.selectionStart), b = this.lineAt(this.input.selectionEnd);
    const rows = this.lines.slice(a - 1, b);
    const all = rows.every((r) => !r.trim() || r.trim().startsWith("#"));
    const out = rows.map((r) => !r.trim() ? r : all ? r.replace(/^(\s*)#\s?/, "$1") : `# ${r}`);
    const from = this.offsetOf(a), to = this.offsetOf(b) + (this.lines[b - 1]?.length ?? 0);
    this.replace(from, to, out.join("\n"));
    this.input.setSelectionRange(from, from + out.join("\n").length);
  }

  /** Ctrl+click on a jump: go to that section. */
  private followJump() {
    const line = this.lineAt(this.input.selectionStart);
    const raw = this.lines[line - 1] ?? "";
    const t = jumpTarget(raw);
    const h = raw.match(/^\s*==\s*(\S+?)\s*==/);
    if (t) this.focusSection(t.id);
    else if (h) {
      // On a header: jump to the first place that leads here.
      const from = [...(this.doc.incoming.get(h[1]) ?? [])][0];
      if (from) this.focusSection(from);
    }
  }

  // ------------------------------------------------------------------ suggestions

  private speakersFor(line: number) {
    const sec = this.sectionAt(line);
    const recent: string[] = [];
    if (sec) {
      for (let n = line - 1; n > sec.line; n--) {
        const who = speakerOf(this.lines[n - 1] ?? "");
        if (who && who !== NARRATOR && !recent.includes(who)) recent.push(who);
        if (recent.length >= 3) break;
      }
    }
    // The one who spoke before last usually answers next.
    const order = recent.length >= 2 ? [recent[1], recent[0], ...recent.slice(2)] : recent;
    const all = Object.values(LOOKS).map((l) => l.name);
    return [...order, ...all.filter((n) => !order.includes(n))];
  }

  private flags() {
    const set = new Set(Object.keys(BUILTIN_FLAGS));
    for (const lines of Object.values(this.parsed.script)) for (const l of lines) if (l.t === "cmd" && (l.name === "flag" || l.name === "unflag")) l.args.forEach((a) => set.add(a));
    return [...set];
  }

  private updateSuggest(fresh: boolean, forced = false) {
    const pos = this.input.selectionStart;
    if (pos !== this.input.selectionEnd) return this.closeSuggest();
    const line = this.lineAt(pos);
    const raw = this.lines[line - 1] ?? "";
    const col = pos - this.offsetOf(line);
    // Only pop up by itself on a fresh line or while typing a word; Tab asks for it anywhere.
    const typedChar = /[^\s:：]$/.test(raw.slice(0, col)) || /[(（!！?？>]\s*$/.test(raw.slice(0, col)) || /->\s*$/.test(raw.slice(0, col));
    if (!forced && !fresh && !typedChar) return this.closeSuggest();
    if (!forced && !fresh && !raw.slice(0, col).trim()) return this.closeSuggest();
    const r = complete(raw, col, {
      speakers: this.speakersFor(line),
      colors: this.colors,
      sections: this.parsed.sections.map((s) => ({ id: s.id, title: s.title })),
      flags: this.flags(),
      quests: STORY.quests.map((q) => ({ id: q.id, title: q.title })),
      periods: STORY.periods,
      elements: ELEMENT_ORDER.filter((e) => e !== "star").map((e) => ({ id: e, name: ELEMENTS[e].name })),
      forms: FORM_ORDER.filter((f) => f !== "bolt").map((f) => ({ id: f, name: FORMS[f].name })),
    });
    if (!r || !r.items.length) return this.closeSuggest();
    // Don't offer exactly what's already there.
    const typed = raw.slice(r.from, col);
    if (!forced && r.items.length === 1 && r.items[0].insert.trim() === typed.trim()) return this.closeSuggest();
    const base = this.offsetOf(line);
    this.suggest = { line, from: base + r.from, to: pos, items: r.items.slice(0, 40), index: 0, fresh: fresh && !raw.trim() };
    this.renderSuggest();
  }

  private renderSuggest() {
    const s = this.suggest;
    if (!s) return;
    this.popup.innerHTML = s.items.map((it, i) =>
      `<div class="sc-sg${i === s.index ? " on" : ""}" data-i="${i}">${it.color ? `<i style="background:${it.color}"></i>` : ""}<b>${esc(it.label)}</b>${it.detail ? `<small>${esc(it.detail)}</small>` : ""}</div>`).join("")
      + `<div class="sc-sg-hint">${s.fresh ? "Tab 选用 · 回车照常换行" : "Tab / 回车 选用"} · Esc 关闭</div>`;
    this.popup.classList.add("show");
    const at = this.caretXY(s.line, s.from - this.offsetOf(s.line));
    this.popup.style.left = `${Math.max(0, Math.min(at.x, this.stack.clientWidth - 260))}px`;
    this.popup.style.top = `${at.y + 26}px`;
    this.popup.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }

  private closeSuggest() {
    this.suggest = null;
    this.popup.classList.remove("show");
  }

  private accept() {
    const s = this.suggest;
    if (!s) return;
    const it = s.items[s.index];
    this.closeSuggest();
    this.replace(s.from, s.to, it.insert);
    // Chain on: after a command or an expression there's usually more to pick.
    if (/[(（!！]$|^[a-z]+ $/.test(it.insert) || it.insert === "-> " || it.insert === "? ") this.updateSuggest(false, true);
  }

  /** Where column `col` of `line` is, relative to the text stack. */
  private caretXY(line: number, col: number) {
    const row = this.hl.children[line - 1] as HTMLElement | undefined;
    if (!row) return { x: 0, y: 0 };
    const base = this.stack.getBoundingClientRect();
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let left = col;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const len = node.textContent!.length;
      if (left <= len) {
        const range = document.createRange();
        range.setStart(node, left);
        range.setEnd(node, left);
        const r = range.getClientRects()[0] ?? (node.parentElement!.getBoundingClientRect());
        return { x: r.left - base.left, y: r.top - base.top };
      }
      left -= len;
    }
    const r = row.getBoundingClientRect();
    return { x: 56, y: r.top - base.top };
  }

  // ------------------------------------------------------------------ outline

  private renderOutline() {
    const q = this.search.value.trim().toLowerCase();
    const cur = this.sectionAt(this.caretLine)?.id;
    const issuesIn = (s: SectionInfo) => this.parsed.issues.filter((i) => !i.warn && i.line >= s.line && i.line <= s.end).length;
    let html = "";
    let chapter: string | null = null;
    for (const s of this.parsed.sections) {
      const body = this.lines.slice(s.line - 1, s.end);
      const hits = q ? body.map((t, i) => [t, s.line + i] as const).filter(([t]) => t.toLowerCase().includes(q) && !t.trim().startsWith("==")) : [];
      const match = !q || s.id.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || hits.length;
      if (!match) continue;
      if (s.chapter !== chapter) {
        chapter = s.chapter;
        const line = this.lines.findIndex((t) => t.trim() === `【${chapter}】`) + 1;
        html += `<button class="sc-chapter" data-line="${line || s.line}">${esc(chapter || "（未分章）")}</button>`;
      }
      const uses = this.doc.uses.get(s.id) ?? [];
      const refs = this.doc.incoming.get(s.id)?.size ?? 0;
      const errs = issuesIn(s);
      const badges = uses.map((u) => `<span class="b-${u.kind}" title="${esc(u.label)}">${{ npc: "📍", trigger: "▦", bark: "💭", time: "⏰" }[u.kind]} ${esc(u.label.split(" · ").pop()!)}</span>`).join("")
        + (!uses.length && !refs ? `<span class="b-unused" title="地图、时间事件和其他段落都没有用到它">未使用</span>` : "")
        + (errs ? `<span class="b-err">${errs} 个问题</span>` : "");
      const says = this.parsed.script[s.id]?.filter((l) => l.t === "say").length ?? 0;
      html += `<button class="sc-sec${s.id === cur ? " on" : ""}" data-line="${s.line}">
        <span class="sc-sec-top"><b>${esc(s.title || s.id)}</b><small>${says} 句</small></span>
        ${s.title ? `<code>${esc(s.id)}</code>` : ""}${badges ? `<span class="sc-badges">${badges}</span>` : ""}</button>`;
      for (const [t, n] of hits.slice(0, 6)) html += `<button class="sc-hit" data-line="${n}">${esc(t.trim())}</button>`;
    }
    if (!html) html = `<p class="sc-empty">没有找到「${esc(q)}」</p>`;
    this.outline.innerHTML = html;
    for (const b of this.outline.querySelectorAll<HTMLButtonElement>("[data-line]")) b.onclick = () => this.gotoLine(Number(b.dataset.line), !b.classList.contains("sc-hit"));
    this.outline.querySelector(".sc-sec.on")?.scrollIntoView({ block: "nearest" });
  }

  private newSection() {
    const sec = this.sectionAt(this.caretLine) ?? this.parsed.sections.at(-1);
    let end = sec ? sec.end : this.lines.length;
    while (end > (sec?.line ?? 0) && !(this.lines[end - 1] ?? "").trim()) end--;
    let n = 1;
    while (this.parsed.script[`new_${n}`]) n++;
    const id = `new_${n}`;
    const at = this.offsetOf(end) + (this.lines[end - 1]?.length ?? 0);
    const text = `\n\n== ${id} == 新段落\n旁白: `;
    this.replace(at, at, text);
    const start = at + 5;
    this.input.setSelectionRange(start, start + id.length);
    this.caretMoved();
    this.scrollToLine(this.lineAt(start), false);
    this.say("先给段落起个英文名（地图和跳转用它找台词），== 后面的中文是标题");
  }

  // ------------------------------------------------------------------ status

  private say(text: string) {
    this.status.innerHTML = `<span class="sc-say">${esc(text)}</span>`;
  }

  private renderStatus() {
    const issue = this.parsed.issues.find((i) => i.line === this.caretLine);
    const raw = this.lines[this.caretLine - 1] ?? "";
    const total = this.parsed.issues.filter((i) => !i.warn).length;
    let hint = "";
    if (issue) hint = `<span class="${issue.warn ? "sc-warn" : "sc-err"}">第 ${issue.line} 行：${esc(issue.msg)}</span>`;
    else {
      const kind = lineKind(raw);
      const t = jumpTarget(raw);
      const cmd = raw.trim().match(/^[!！](\S+)/);
      hint = t ? `跳到 <b>${esc(t.id)}</b> · Ctrl+点击过去`
        : kind === "section" ? `段落 · ${(this.doc.uses.get(raw.trim().match(/^==\s*(\S+?)\s*==/)?.[1] ?? "") ?? []).map((u) => esc(u.label)).join("、") || "地图上还没有人用它"}`
        : cmd ? `命令：${esc(COMMAND_INFO[cmd[1]]?.[1] ?? cmd[1])}`
        : kind === "say" || kind === "more" ? "台词 · 右边看效果" : "";
    }
    const count = total ? `<button class="sc-issues">⚠ ${total} 个问题</button>` : `<span class="sc-ok">✓ 没有问题</span>`;
    this.status.innerHTML = `<span class="sc-pos">第 ${this.caretLine} 行</span><span class="sc-hint">${hint}</span>${count}`;
    const btn = this.status.querySelector<HTMLButtonElement>(".sc-issues");
    if (btn) btn.onclick = () => {
      const next = this.parsed.issues.find((i) => !i.warn && i.line > this.caretLine) ?? this.parsed.issues.find((i) => !i.warn);
      if (next) this.gotoLine(next.line);
    };
  }

  // ------------------------------------------------------------------ refresh

  private refresh() {
    if (!this.open) return;
    this.renderOutline();
    this.renderStatus();
    if (!this.preview.playing) this.preview.show(this.viewAtCaret());
    this.renderFlow();
  }

  /** The script line under the cursor, as a moment the stage can show. */
  private viewAtCaret(): View | null {
    const sec = this.sectionAt(this.caretLine);
    if (!sec) return null;
    const lines = this.parsed.script[sec.id] ?? [];
    let pc = 0;
    for (let i = 0; i < lines.length; i++) if (lines[i].src <= this.caretLine) pc = i;
    return { section: sec.id, pc, line: lines[pc] ?? null };
  }

  /** Moves the cursor to the previous or next spoken line. */
  private stepLine(dir: number) {
    for (let n = this.caretLine + dir; n >= 1 && n <= this.lines.length; n += dir) {
      const k = lineKind(this.lines[n - 1]);
      if (k === "say" || k === "more" || k === "choice") { this.gotoLine(n); return; }
    }
  }

  /** A play-through moved on: the cursor follows it. */
  private followPlay(v: View) {
    if (!v.line) return;
    this.caretLine = v.line.src;
    this.markCaret();
    this.scrollToLine(v.line.src, false);
  }

  // ------------------------------------------------------------------ flow

  /**
   * The conversation around the current section, drawn as boxes top to
   * bottom: where it starts (the section a map or event plays) and every
   * section it can reach, with the choice or condition on each arrow.
   */
  private renderFlow() {
    const cur = this.sectionAt(this.caretLine)?.id ?? "";
    const root = this.rootOf(cur);
    const key = `${root}|${cur}|${this.input.value.length}|${this.parsed.sections.length}`;
    if (key === this.lastFlowKey) return;
    this.lastFlowKey = key;
    if (!root) { this.flow.innerHTML = `<p class="sc-empty">把光标放到某个段落里</p>`; return; }
    type Edge = { from: string; to: string; label: string; kind: string };
    const depth = new Map<string, number>([[root, 0]]);
    const order = [root];
    const edges: Edge[] = [];
    for (let i = 0; i < order.length && order.length < 30; i++) {
      const id = order[i];
      for (const l of this.parsed.script[id] ?? []) {
        const out: Edge[] = l.t === "goto" ? [{ from: id, to: l.to, label: "", kind: "goto" }]
          : l.t === "if" ? [{ from: id, to: l.to, label: l.cond, kind: "if" }]
          : l.t === "choice" ? l.options.filter((o) => o.to).map((o) => ({ from: id, to: o.to!, label: o.text, kind: "choice" })) : [];
        for (const e of out) {
          if (!this.parsed.script[e.to]) continue;
          edges.push(e);
          if (!depth.has(e.to)) { depth.set(e.to, depth.get(id)! + 1); order.push(e.to); }
        }
      }
    }
    const rows: string[][] = [];
    for (const id of order) (rows[depth.get(id)!] ??= []).push(id);
    const W = 340, BOX_H = 44, GAP_Y = 34;
    const pos = new Map<string, { x: number; y: number; w: number }>();
    let y = 4;
    for (const row of rows) {
      for (let i = 0; i < row.length; i += 3) {
        const chunk = row.slice(i, i + 3);
        const w = Math.min(150, (W - 8 - (chunk.length - 1) * 8) / chunk.length);
        const total = chunk.length * w + (chunk.length - 1) * 8;
        chunk.forEach((id, j) => pos.set(id, { x: (W - total) / 2 + j * (w + 8), y, w }));
        y += BOX_H + GAP_Y;
      }
    }
    const H = y - GAP_Y + 8;
    let svg = "";
    for (const e of edges) {
      const a = pos.get(e.from)!, b = pos.get(e.to)!;
      const ax = a.x + a.w / 2, ay = a.y + BOX_H, bx = b.x + b.w / 2, by = b.y;
      const back = b.y <= a.y;
      const d = back
        ? `M${a.x + a.w} ${a.y + BOX_H / 2} C${W - 2} ${a.y + BOX_H / 2} ${W - 2} ${b.y + BOX_H / 2} ${b.x + b.w} ${b.y + BOX_H / 2}`
        : `M${ax} ${ay} C${ax} ${ay + 20} ${bx} ${by - 20} ${bx} ${by - 4}`;
      svg += `<path class="f-${e.kind}${back ? " f-back" : ""}" d="${d}" marker-end="url(#sc-arrow)"/>`;
      if (e.label) {
        const lx = back ? W - 40 : (ax + bx) / 2, ly = back ? (a.y + b.y) / 2 + BOX_H / 2 : (ay + by) / 2;
        const text = e.label.length > 9 ? e.label.slice(0, 8) + "…" : e.label;
        svg += `<text class="t-${e.kind}" x="${lx}" y="${ly + 4}" text-anchor="middle">${esc(e.kind === "if" ? "?" + text : text)}</text>`;
      }
    }
    let boxes = "";
    for (const [id, p] of pos) {
      const s = this.parsed.sections.find((x) => x.id === id);
      const first = this.parsed.script[id]?.find((l) => l.t === "say") as Extract<Line, { t: "say" }> | undefined;
      const n = this.parsed.script[id]?.filter((l) => l.t === "say").length ?? 0;
      boxes += `<button class="sc-node${id === cur ? " on" : ""}${id === root ? " root" : ""}" data-id="${esc(id)}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${BOX_H}px"
        title="${esc(first ? `${first.who ?? NARRATOR}: ${first.text}` : id)}"><b>${esc(s?.title || id)}</b><small>${n ? `${n} 句` : "只有跳转"}</small></button>`;
    }
    const use = this.doc.useFor(root);
    this.flow.innerHTML = `<div class="sc-flow-from">${use ? `从 <b>${esc(use.label)}</b> 开始` : this.doc.uses.get(root)?.[0] ? esc(this.doc.uses.get(root)![0].label) : "还没有地方用到它"}</div>
      <div class="sc-flow-canvas" style="height:${H}px"><svg width="${W}" height="${H}"><defs><marker id="sc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z"/></marker></defs>${svg}</svg>${boxes}</div>`;
    for (const b of this.flow.querySelectorAll<HTMLButtonElement>(".sc-node")) b.onclick = () => this.focusSection(b.dataset.id!);
  }

  /** The section a conversation starts from: walk back along jumps to one used by a map or event. */
  private rootOf(id: string) {
    if (!id) return "";
    const seen = new Set<string>();
    let cur = id;
    for (let i = 0; i < 20; i++) {
      seen.add(cur);
      if (this.doc.uses.has(cur)) return cur;
      const from = [...(this.doc.incoming.get(cur) ?? [])].find((x) => !seen.has(x));
      if (!from) return cur;
      cur = from;
    }
    return cur;
  }
}
