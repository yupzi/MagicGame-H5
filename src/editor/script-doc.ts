import { onScriptFile, scriptFile, setScript, type Line } from "../game/dialogue";
import { formatMap, type MapObj } from "../game/mapdata";
import { LOOKS } from "../game/people";
import { STORY } from "../game/story";
import { MAPS } from "../maps";
import LAYOUT from "../story/layout.json";
import { EMPTY_LAYOUT, type Layout } from "./story-graph";
import type { MapBinding } from "./map-canvases";

/**
 * The dialogue script shared by the story editor's two ways of editing it
 * (nodes and text): the text, what it parses to, where each section is used
 * from, the node layout, and saving both back to the project.
 */

/** Where a section is used from outside the script. */
export interface SectionUse {
  kind: "npc" | "trigger" | "bark" | "time";
  label: string;
  map?: string;
  obj?: MapObj;
}

/** "Play from here in the game": the section, how far in, and where to stand. */
export interface PlayRequest {
  section: string;
  at: number;
  map?: string;
  obj?: MapObj;
}

export type SaveState = "saved" | "pending" | "saving" | "error" | "conflict";

const el = (cls: string) => { const e = document.createElement("div"); e.className = cls; return e; };

export class ScriptDoc {
  text = "";
  parsed = setScript("");
  layout: Layout = { ...EMPTY_LAYOUT, ...(LAYOUT as unknown as Partial<Layout>) };
  uses = new Map<string, SectionUse[]>();
  incoming = new Map<string, Set<string>>();
  /** Script line number → where it is played from. */
  at = new Map<number, { section: string; pc: number; line: Line }>();
  state: SaveState = "saved";
  /** Shown over the editor when script.txt changed elsewhere while there were unsaved edits here. */
  readonly banner = el("sc-banner");
  /** The line both editors should show when switching between them. */
  focusLine = 0;

  private saved = scriptFile;
  private layoutSaved = JSON.stringify(this.layout);
  private saveTimer = 0;
  private externalText = "";
  private dirtyMaps = new Map<string, string>();
  private saveTask: Promise<void> | null = null;
  private listeners = new Set<(source: unknown) => void>();
  private statusListeners = new Set<(text: string, state: SaveState) => void>();

  constructor() {
    this.apply(scriptFile);
    onScriptFile((text) => this.fileChanged(text));
    window.addEventListener("beforeunload", () => {
      if (this.state === "pending" || this.state === "saving") navigator.sendBeacon?.("/__story/script", new Blob([this.text], { type: "text/plain" }));
      if (JSON.stringify(this.layout) !== this.layoutSaved) navigator.sendBeacon?.("/__story/layout", new Blob([JSON.stringify(this.layout, null, 1)], { type: "text/plain" }));
      for (const body of this.dirtyMaps.values()) navigator.sendBeacon?.("/__maps/save", new Blob([body], { type: "text/plain" }));
    });
  }

  /** New text from one of the editors (`source`, which isn't told about its own change). */
  set(text: string, source: unknown) {
    if (text === this.text) return;
    this.apply(text);
    this.notify(source);
    this.scheduleSave();
  }

  setLayout(layout: Layout) {
    this.layout = layout;
    this.scheduleSave();
  }

  /** Track map links in the same save cycle as the dialogue they refer to. */
  setMapBindings(bindings: MapBinding[]) {
    for (const { map, obj, field, value } of bindings) {
      if (obj[field] === value || !MAPS[map]?.objects.includes(obj)) continue;
      obj[field] = value;
      this.dirtyMaps.set(map, formatMap(MAPS[map]));
    }
    this.indexUses();
    if (this.dirtyMaps.size) this.scheduleSave();
  }

  mapBindings(): MapBinding[] {
    return Object.values(MAPS).flatMap((m) => m.objects.filter((o) => o.type === "npc").flatMap((obj) =>
      (["text", "bark"] as const).map((field) => ({ map: m.id, obj, field, value: obj[field] ?? "" }))));
  }

  onChange(fn: (source: unknown) => void) { this.listeners.add(fn); }
  onStatus(fn: (text: string, state: SaveState) => void) { this.statusListeners.add(fn); fn(this.statusText(), this.state); }

  private notify(source: unknown) { for (const fn of this.listeners) fn(source); }

  private apply(text: string) {
    this.text = text;
    this.parsed = setScript(text);
    this.at.clear();
    for (const [section, lines] of Object.entries(this.parsed.script)) {
      lines.forEach((line, pc) => {
        this.at.set(line.src, { section, pc, line });
        // Every option of a choice is its own line in the text.
        if (line.t === "choice") line.options.forEach((_, i) => this.at.set(line.src + i, { section, pc, line }));
      });
    }
    this.indexUses();
  }

  indexUses() {
    this.uses.clear();
    this.incoming.clear();
    const add = (id: string, u: SectionUse) => { if (!this.uses.has(id)) this.uses.set(id, []); this.uses.get(id)!.push(u); };
    for (const m of Object.values(MAPS)) {
      for (const o of m.objects) {
        if (o.type === "npc") {
          const who = LOOKS[o.kind ?? ""]?.name ?? "人物";
          if (o.text) add(o.text, { kind: "npc", label: `${m.name} · ${who}`, map: m.id, obj: o });
          if (o.bark) add(o.bark, { kind: "bark", label: `${m.name} · ${who}自言自语`, map: m.id, obj: o });
        } else if (o.type === "trigger" && o.text) {
          add(o.text, { kind: o.mode === "bark" ? "bark" : "trigger", label: `${m.name} · 触发区`, map: m.id, obj: o });
        }
      }
    }
    for (const ev of STORY.timeline) if (ev.dialogue) add(ev.dialogue, { kind: "time", label: `时间事件 ${ev.id}` });
    for (const [id, lines] of Object.entries(this.parsed.script)) {
      for (const l of lines) {
        const to = l.t === "goto" || l.t === "if" ? [l.to] : l.t === "choice" ? l.options.flatMap((o) => (o.to ? [o.to] : [])) : [];
        for (const t of to) {
          if (!this.incoming.has(t)) this.incoming.set(t, new Set());
          this.incoming.get(t)!.add(id);
        }
      }
    }
  }

  /** Sections something outside the script plays: maps and timeline events. */
  entries() {
    return new Set(this.uses.keys());
  }

  /** Where a section is played from in the world: its own use, or the use of whatever leads to it. */
  useFor(section: string): SectionUse | undefined {
    const seen = new Set<string>();
    const queue = [section];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const u = this.uses.get(id)?.find((x) => x.map);
      if (u) return u;
      queue.push(...(this.incoming.get(id) ?? []));
    }
    return undefined;
  }

  // ------------------------------------------------------------------ saving

  private scheduleSave() {
    if (this.state !== "conflict") this.state = "pending";
    this.pushStatus();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveNow(), 700);
  }

  async saveNow(): Promise<void> {
    if (this.saveTask) {
      await this.saveTask;
      if (this.state === "pending") return this.saveNow();
      return;
    }
    this.saveTask = this.savePending();
    try { await this.saveTask; } finally { this.saveTask = null; }
  }

  private async savePending() {
    clearTimeout(this.saveTimer);
    if (this.state === "conflict") return;
    const text = this.text, layout = JSON.stringify(this.layout, null, 1);
    const textDirty = text !== this.saved, layoutDirty = layout !== this.layoutSaved;
    if (!textDirty && !layoutDirty && !this.dirtyMaps.size) { this.state = "saved"; this.pushStatus(); return; }
    this.state = "saving";
    this.pushStatus();
    try {
      if (textDirty) {
        const res = await fetch("/__story/script", { method: "POST", body: text });
        if (!res.ok) throw new Error(await res.text());
        this.saved = text;
      }
      if (layoutDirty) {
        const res = await fetch("/__story/layout", { method: "POST", body: layout });
        if (!res.ok) throw new Error(await res.text());
        this.layoutSaved = layout;
      }
      // Do not publish newer map links before their script has been written.
      if (this.text === text && JSON.stringify(this.layout, null, 1) === layout) {
        for (const [id, body] of [...this.dirtyMaps]) {
          const res = await fetch("/__maps/save", { method: "POST", body });
          if (!res.ok) throw new Error(await res.text());
          if (this.dirtyMaps.get(id) === body) this.dirtyMaps.delete(id);
        }
      }
      this.state = this.text === this.saved && JSON.stringify(this.layout, null, 1) === this.layoutSaved && !this.dirtyMaps.size ? "saved" : "pending";
      if (this.state === "pending") this.scheduleSave();
    } catch {
      this.state = "error";
    }
    this.pushStatus();
  }

  private statusText() {
    return {
      saved: "✓ 已自动保存到 script.txt",
      pending: "正在编辑…",
      saving: "保存中…",
      error: "⚠ 保存失败（要用 npm run dev 启动）",
      conflict: "⚠ 文件在别处被改了",
    }[this.state];
  }

  private pushStatus() {
    for (const fn of this.statusListeners) fn(this.statusText(), this.state);
  }

  /** script.txt changed on disk: our own save coming back, or someone editing it elsewhere. */
  private fileChanged(text: string) {
    if (text === this.saved || text === this.text) { this.saved = text; return; }
    if (this.text === this.saved && this.state !== "pending" && this.state !== "saving") {
      this.saved = text;
      this.apply(text);
      this.notify(null);
      return;
    }
    this.externalText = text;
    this.state = "conflict";
    this.pushStatus();
    this.banner.innerHTML = `script.txt 在别的地方被修改了，而这里也有没保存的修改。
      <button data-a="theirs">用文件里的版本</button><button data-a="mine">保留这里的（覆盖文件）</button>`;
    this.banner.classList.add("show");
    this.banner.querySelector<HTMLButtonElement>('[data-a="theirs"]')!.onclick = () => {
      this.banner.classList.remove("show");
      this.state = "saved";
      this.saved = this.externalText;
      this.apply(this.externalText);
      this.notify(null);
      this.pushStatus();
    };
    this.banner.querySelector<HTMLButtonElement>('[data-a="mine"]')!.onclick = () => {
      this.banner.classList.remove("show");
      this.saved = this.externalText;
      this.state = "pending";
      void this.saveNow();
    };
  }
}
