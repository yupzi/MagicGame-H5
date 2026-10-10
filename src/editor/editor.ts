import { drawText } from "../engine/font";
import { rect, type Ctx } from "../engine/gfx";
import { clamp } from "../engine/math";
import { VH, VW, type Game } from "../game/game";
import { DOOR_TYPES, formatMap, OBJ_INFO, OBJ_ORDER, parseDest, type CurvePt, type MapData, type MapObj, type ObjType, type PropDef } from "../game/mapdata";
import { P } from "../game/palette";
import { encodeRow, makeTile, Mat, MATERIALS, normalizeTile, SHAPES, shapeCovers, TILE, tileMat, tileShape } from "../game/tiles";
import { NO_CEIL, NO_GROUND } from "../game/world";
import { HOME_MAP, MAPS } from "../maps";
import { EDITOR_CSS } from "./style";
import { StoryEditor } from "./story-editor";
import type { PlayRequest } from "./script-doc";
import { SCRIPT_SECTIONS } from "../game/dialogue";
import { STORY } from "../game/story";

type Tool = "tile" | "object" | "select" | "curve";

const ZOOMS = [1, 2, 4];
const MAT_COLOR: Record<number, string> = {
  [Mat.Grass]: P.grass, [Mat.Dirt]: P.dirt, [Mat.Stone]: P.stone, [Mat.Soft]: "#e8a86c", [Mat.Water]: "#6fb8f0", [Mat.Plank]: P.bark, [Mat.Air]: "#1c1432",
};
const MAX_UNDO = 60;

/** Screen-space box of an object, for picking and highlighting. */
function objBox(o: MapObj, worldH: number): [number, number, number, number] {
  const { x, y } = o;
  switch (o.type) {
    case "cloud": { const w = o.w ?? 44; return [x - w / 2, y - 4, x + w / 2, y + 10]; }
    case "door":
      if (o.style === "edge") { const w = o.w ?? 16, h = o.h ?? 40; return [x - w / 2, y - h, x + w / 2, y]; }
      return [x - 12, y - 24, x + 12, y];
    case "pit": { const w = o.w ?? 32, h = o.h ?? 24; return [x - w / 2, y - h, x + w / 2, y]; }
    case "landing": return [x - 6, y - 6, x + 6, y + 6];
    case "trigger": { const w = o.w ?? 24, h = o.h ?? 48; return [x - w / 2, y - h, x + w / 2, y]; }
    case "npc": return [x - 8, y - 34, x + 8, y];
    case "bridge": { const w = o.w ?? 96; return [x - w / 2, y - 14, x + w / 2, y + 16]; }
    case "zone": return [x - 3, 0, x + 3, worldH];
    case "tree": return [x - 12, y - 34, x + 12, y];
    case "cottage": return [x - 30, y - 50, x + 30, y];
    case "gate": return [x - 13, y - 60, x + 13, y];
    case "boss": return [x - 4, y - 60, x + 4, y];
    case "scar": return [x - 64, y - 14, x + 64, y + 14];
    case "pillar": return [x - 8, y - (o.h ?? 36) - 4, x + 8, y];
    case "light": { const w = o.w ?? 24; return [x - w / 2, y - 4, x + w / 2, y + 12]; }
    case "boar": return [x - 12, y - 16, x + 12, y];
    case "lantern": return [x - 7, y - 26, x + 7, y];
    default: return [x - 8, y - 18, x + 8, y];
  }
}

/** Short ASCII tag drawn next to markers (the pixel font has no Chinese). */
function objTag(o: MapObj) {
  switch (o.type) {
    case "door": return `${o.id ?? "?"}>${o.to || "?"}`;
    case "pit": return `PIT ${o.id ?? "?"}>${o.to || "?"}`;
    case "landing": return `IN ${o.id ?? "?"}`;
    case "lantern": return `LAMP ${o.id ?? ""}`;
    case "gate": return `${o.kind ?? ""} ${o.id ?? ""}`;
    case "zone": return "ZONE";
    case "boss": return "BOSS";
    case "tablet": return `RUNE ${o.form || "-"}`;
    case "npc": return `${o.kind ?? ""}:${o.text ?? ""}`;
    case "trigger": return `${o.mode === "bark" ? "SAY" : "TALK"} ${o.text ?? ""}`;
    case "bridge": return `BRIDGE ${o.cond ?? ""}`;
    case "light": return "LIGHT";
    default: return "";
  }
}

/**
 * The map editor (F2). Paint terrain, place things, link doors between maps and
 * save straight back into src/maps while the dev server runs.
 */
export class Editor {
  open = false;
  private camX = 0;
  private camY = 0;
  private zoom = 2;
  private tool: Tool = "tile";
  private mat: Mat = Mat.Grass;
  private shape = 1;
  private brush = 1;
  private grid = true;
  private objType: ObjType = "tree";
  private selected: MapObj | null = null;
  /** Selected / dragged point of the hill line. */
  private curvePt = -1;
  /** Which line the hill-line tool edits: the ground line or the ceiling line. */
  private lineKey: "curve" | "ceil" = "curve";
  private curveDrag = false;
  private curveDirty: [number, number] | null = null;
  /** Objects on the ground when a hill-line drag began. */
  private standing: MapObj[] = [];

  private mx = 0; // mouse in world px
  private my = 0;
  private mouseIn = false;
  private paint: 0 | 1 | 2 = 0; // painting / erasing
  private lastPaint: [number, number] = [0, 0];
  private rectFrom: [number, number] | null = null;
  private rectErase = false;
  private drag: { o: MapObj; dx: number; dy: number; moved: boolean } | null = null;
  private pan: { sx: number; sy: number; cx: number; cy: number } | null = null;
  private keys = new Set<string>();
  private dirty: [number, number, number, number] | null = null;
  private undoStack: { id: string; json: string }[] = [];
  private redoStack: { id: string; json: string }[] = [];
  private unsaved = new Set<string>();

  private panel: HTMLDivElement;
  private storyEditor: StoryEditor;
  private el: Record<string, HTMLElement> = {};
  private msgT = 0;

  constructor(private game: Game, private canvas: HTMLCanvasElement, private onResize: () => void) {
    const style = document.createElement("style");
    style.textContent = EDITOR_CSS;
    document.head.appendChild(style);
    this.panel = document.createElement("div");
    this.panel.id = "editor";
    this.panel.className = "hidden";
    document.body.appendChild(this.panel);
    this.buildPanel();
    this.storyEditor = new StoryEditor(game, () => this.refreshPanel(), (req) => this.playDialogue(req));

    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    canvas.addEventListener("pointerdown", (e) => this.onPointer(e, "down"));
    window.addEventListener("pointermove", (e) => this.onPointer(e, "move"));
    window.addEventListener("pointerup", (e) => this.onPointer(e, "up"));
    canvas.addEventListener("contextmenu", (e) => { if (this.open) e.preventDefault(); });
    canvas.addEventListener("wheel", (e) => {
      if (!this.open) return;
      e.preventDefault();
      this.setZoom(ZOOMS[clamp(ZOOMS.indexOf(this.zoom) + (e.deltaY > 0 ? 1 : -1), 0, ZOOMS.length - 1)], e);
    }, { passive: false });
    window.addEventListener("beforeunload", (e) => {
      if (this.unsaved.size) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  private get level() { return this.game.level; }
  private get world() { return this.game.level.world; }
  private get map(): MapData { return this.game.level.map; }
  private get vw() { return VW * this.zoom; }
  private get vh() { return VH * this.zoom; }

  // ------------------------------------------------------------- open / close

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    const g = this.game;
    this.open = true;
    g.input.muted = true;
    g.input.reset();
    g.player.cancelCharge();
    g.ui.setTip(null);
    // Edit the map as it's written, not as it was left after playing.
    g.rebuildLevel(g.level.id);
    this.camX = g.camX - (this.vw - VW) / 2;
    this.camY = g.camY - (this.vh - VH) / 2;
    this.selected = null;
    document.body.classList.add("editing");
    this.panel.classList.remove("hidden");
    this.applyCanvasSize();
    this.refreshPanel();
  }

  /** Opens the story editor (F3), over the map editor. */
  openStory() {
    if (!this.open) this.show();
    this.storyEditor.show();
  }

  /**
   * The story editor's "play in the game": go to the map where the
   * conversation happens, stand the witch in front of whoever says it and
   * start from the chosen line.
   */
  playDialogue(req: PlayRequest) {
    if (!this.open) this.show();
    const o = req.obj;
    if (req.map && o) {
      if (req.map !== this.map.id) this.switchMap(req.map);
      // Stand on the side the person faces, a step away.
      const x = o.type === "npc" ? o.x + (o.face ?? -1) * 22 : o.x;
      this.camX = x - this.vw / 2;
      this.camY = o.y - 12 - this.vh / 2;
    }
    this.close();
    const npc = o?.type === "npc" ? this.game.npcs.find((n) => Math.abs(n.x - o.x) < 1 && Math.abs(n.y - o.y) < 16) : undefined;
    this.game.talk(req.section, npc, req.at);
  }

  /** Back to the game, starting from the middle of the view ("play test"). */
  close() {
    const g = this.game;
    this.storyEditor.hide();
    this.finishStroke();
    this.open = false;
    document.body.classList.remove("editing");
    this.panel.classList.add("hidden");
    g.input.muted = false;
    g.input.reset();
    g.rebuildLevel(g.level.id);
    const w = this.world;
    const x = clamp(this.camX + this.vw / 2, 12, w.w - 12);
    g.placePlayer(x, clamp(this.camY + this.vh / 2, 0, w.h - 1), g.player.facing);
    this.applyCanvasSize();
  }

  private applyCanvasSize() {
    const z = this.open ? this.zoom : 1;
    this.canvas.width = VW * z;
    this.canvas.height = VH * z;
    this.canvas.getContext("2d")!.imageSmoothingEnabled = false;
    this.onResize();
  }

  private setZoom(z: number, e?: MouseEvent) {
    if (z === this.zoom) return;
    // Keep the point under the mouse (or the middle) in place.
    const [ax, ay] = e ? this.toWorld(e) : [this.camX + this.vw / 2, this.camY + this.vh / 2];
    const fx = (ax - this.camX) / this.vw, fy = (ay - this.camY) / this.vh;
    this.zoom = z;
    this.camX = ax - fx * this.vw;
    this.camY = ay - fy * this.vh;
    this.applyCanvasSize();
    this.refreshPanel();
  }

  // ------------------------------------------------------------- input

  private toWorld(e: MouseEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [this.camX + ((e.clientX - r.left) / r.width) * this.canvas.width, this.camY + ((e.clientY - r.top) / r.height) * this.canvas.height];
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
    if (down && e.code === "F2") {
      e.preventDefault();
      this.toggle();
      return;
    }
    if (!this.open) return;
    if (!down) {
      this.keys.delete(e.code);
      return;
    }
    if (typing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === "KeyS") { e.preventDefault(); void this.save(); return; }
    if (ctrl && e.code === "KeyZ") { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if (ctrl && e.code === "KeyY") { e.preventDefault(); this.redo(); return; }
    if (ctrl) return;
    this.keys.add(e.code);
    switch (e.code) {
      case "KeyB": this.setTool("tile"); break;
      case "KeyO": this.setTool("object"); break;
      case "KeyV": this.setTool("select"); break;
      case "KeyH": this.setTool("curve"); break;
      case "KeyC": if (this.tool === "curve") this.togglePtFlag("c"); break;
      case "KeyF": if (this.tool === "curve") this.togglePtFlag("f"); break;
      case "KeyT": if (this.tool === "curve") this.switchLine(this.lineKey === "curve" ? "ceil" : "curve"); break;
      case "KeyG": this.grid = !this.grid; break;
      case "KeyX": this.brush = this.brush === 1 ? 3 : 1; this.refreshPanel(); break;
      case "KeyQ": this.shape = this.shape <= 1 ? SHAPES.length - 1 : this.shape - 1; this.refreshPanel(); break;
      case "KeyE": this.shape = this.shape >= SHAPES.length - 1 ? 1 : this.shape + 1; this.refreshPanel(); break;
      case "Delete":
      case "Backspace":
        if (this.tool === "curve" && this.curvePt >= 0) this.deletePt(this.curvePt);
        else if (this.selected) this.deleteObj(this.selected);
        break;
      case "Escape": this.selected = null; this.refreshPanel(); break;
      default: {
        const m = MATERIALS.find((m) => `Digit${m.key}` === e.code);
        if (m) { this.mat = m.id; this.setTool("tile"); }
      }
    }
    if (e.code.startsWith("Arrow") || e.code === "Space" || e.code === "Tab") e.preventDefault();
  }

  private onPointer(e: PointerEvent, kind: "down" | "move" | "up") {
    if (!this.open) return;
    const [wx, wy] = this.toWorld(e);
    this.mx = wx;
    this.my = wy;
    const r = this.canvas.getBoundingClientRect();
    this.mouseIn = e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
    if (kind === "down") {
      (document.activeElement as HTMLElement | null)?.blur?.();
      const panBtn = e.button === 1 || (e.button === 0 && this.keys.has("Space")) || (e.button === 2 && this.tool === "select");
      if (panBtn) {
        this.pan = { sx: e.clientX, sy: e.clientY, cx: this.camX, cy: this.camY };
        return;
      }
      if (this.tool === "tile") this.tileDown(e);
      else if (this.tool === "object") this.objectDown(e);
      else if (this.tool === "curve") this.curveDown(e);
      else this.selectDown(e);
      return;
    }
    if (kind === "move") {
      if (this.pan) {
        const k = this.canvas.width / r.width;
        this.camX = this.pan.cx - (e.clientX - this.pan.sx) * k;
        this.camY = this.pan.cy - (e.clientY - this.pan.sy) * k;
        return;
      }
      if (this.paint) {
        // Fill in between mouse events so fast strokes don't leave gaps.
        const [lx, ly] = this.lastPaint;
        const steps = Math.max(1, Math.ceil(Math.hypot(wx - lx, wy - ly) / (TILE / 2)));
        for (let i = 1; i <= steps; i++) this.paintAt(lx + ((wx - lx) * i) / steps, ly + ((wy - ly) * i) / steps, this.paint === 2);
        this.lastPaint = [wx, wy];
      }
      if (this.curveDrag) this.movePt(wx, wy);
      if (this.drag) {
        const d = this.drag;
        d.o.x = Math.round(wx - d.dx);
        d.o.y = Math.round(wy - d.dy);
        d.moved = true;
      }
      return;
    }
    // up
    if (this.pan) { this.pan = null; return; }
    if (this.rectFrom) this.finishRect();
    if (this.paint) this.finishStroke();
    if (this.curveDrag) {
      this.curveDrag = false;
      this.flushCurve();
      this.regroundAll(this.standing);
      this.markUnsaved(this.map.id);
      this.refreshPanel();
    }
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      if (d.moved) {
        if (OBJ_INFO[d.o.type].ground && !e.altKey) d.o.y = this.world.restY(d.o.x, d.o.y - 2);
        this.objectsChanged();
      }
    }
  }

  // ------------------------------------------------------------- tiles

  private tileDown(e: PointerEvent) {
    const tx = Math.floor(this.mx / TILE), ty = Math.floor(this.my / TILE);
    if (e.button === 0 && e.altKey) {
      // Eyedropper.
      const t = this.world.tileAt(tx, ty);
      if (t) { this.mat = tileMat(t); this.shape = tileShape(t); this.refreshPanel(); }
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    this.pushUndo();
    if (e.shiftKey) {
      this.rectFrom = [tx, ty];
      this.rectErase = e.button === 2;
      return;
    }
    this.paint = e.button === 2 ? 2 : 1;
    this.lastPaint = [this.mx, this.my];
    this.paintAt(this.mx, this.my, this.paint === 2);
  }

  private tileValue(erase: boolean) {
    return erase ? 0 : normalizeTile(this.mat, this.shape);
  }

  private paintAt(wx: number, wy: number, erase: boolean) {
    const cx = Math.floor(wx / TILE), cy = Math.floor(wy / TILE);
    const r = this.brush === 3 ? 1 : 0;
    this.setTiles(cx - r, cy - r, cx + r, cy + r, this.tileValue(erase));
  }

  private setTiles(x0: number, y0: number, x1: number, y1: number, v: number) {
    let changed = false;
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.world.setTile(tx, ty, v)) changed = true;
    if (!changed) return;
    const d = this.dirty;
    this.dirty = d ? [Math.min(d[0], x0), Math.min(d[1], y0), Math.max(d[2], x1 + 1), Math.max(d[3], y1 + 1)] : [x0, y0, x1 + 1, y1 + 1];
  }

  private flushTiles() {
    if (!this.dirty) return;
    const [x0, y0, x1, y1] = this.dirty;
    this.dirty = null;
    this.world.refresh(x0, y0, x1, y1);
  }

  private finishRect() {
    const [ax, ay] = this.rectFrom!;
    this.rectFrom = null;
    const bx = Math.floor(this.mx / TILE), by = Math.floor(this.my / TILE);
    this.setTiles(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), this.tileValue(this.rectErase));
    this.finishStroke(true);
  }

  private finishStroke(force = false) {
    if (!this.paint && !force) return;
    this.paint = 0;
    this.flushTiles();
    this.world.storeRows();
    this.markUnsaved(this.map.id);
  }

  // ------------------------------------------------------------- hill line

  private get pts(): CurvePt[] | null {
    return this.map[this.lineKey]?.pts ?? null;
  }

  private get lineName() {
    return this.lineKey === "curve" ? "地面线" : "洞顶线";
  }

  private switchLine(key: "curve" | "ceil") {
    this.lineKey = key;
    this.curvePt = -1;
    this.say(`现在编辑：${this.lineName}`);
    this.refreshPanel();
  }

  /** Index of the hill-line point under the mouse. */
  private ptAt(x: number, y: number) {
    const pts = this.pts;
    if (!pts) return -1;
    const r = 4 * this.zoom;
    let best = -1, bd = r;
    pts.forEach((p, i) => {
      const d = Math.max(Math.abs(p[0] - x), Math.abs(p[1] - y));
      if (d <= bd) { bd = d; best = i; }
    });
    return best;
  }

  private curveDown(e: PointerEvent) {
    const pts = this.pts;
    if (!pts) return this.say(`这张地图还没有${this.lineName}：在左边面板里点「创建${this.lineName}」`);
    const hit = this.ptAt(this.mx, this.my);
    if (e.button === 2) {
      if (hit >= 0) this.deletePt(hit);
      return;
    }
    if (e.button !== 0) return;
    this.pushUndo();
    this.standing = this.grounded();
    if (hit >= 0) this.curvePt = hit;
    else {
      // A new point on the line, between its neighbours.
      const x = clamp(Math.round(this.mx), 0, this.world.w);
      let i = pts.findIndex((p) => p[0] > x);
      if (i < 0) i = pts.length;
      pts.splice(i, 0, [x, clamp(Math.round(this.my), 0, this.world.h)]);
      this.curvePt = i;
      this.touchCurve(i);
    }
    this.curveDrag = true;
    this.refreshPanel();
  }

  private movePt(wx: number, wy: number) {
    const pts = this.pts;
    const i = this.curvePt;
    if (!pts || i < 0) return;
    this.touchCurve(i);
    const lo = i > 0 ? pts[i - 1][0] + 1 : 0;
    const hi = i < pts.length - 1 ? pts[i + 1][0] - 1 : this.world.w;
    const p = pts[i];
    p[0] = clamp(Math.round(wx), lo, hi);
    p[1] = clamp(Math.round(wy), 0, this.world.h);
    this.touchCurve(i);
  }

  private deletePt(i: number) {
    const pts = this.pts;
    if (!pts) return;
    if (pts.length <= 2) return this.say(`${this.lineName}至少要留两个点`);
    this.pushUndo();
    const standing = this.grounded();
    this.touchCurve(i);
    pts.splice(i, 1);
    this.curvePt = -1;
    this.flushCurve();
    this.regroundAll(standing);
    this.markUnsaved(this.map.id);
    this.refreshPanel();
  }

  /** Cliff ("c") or flat ("f") on the selected point. */
  private togglePtFlag(flag: "c" | "f") {
    const pts = this.pts;
    const i = this.curvePt;
    if (!pts || i < 0) return this.say(`先点选${this.lineName}上的一个点`);
    this.pushUndo();
    const standing = this.grounded();
    const p = pts[i];
    let flags = p[2] ?? "";
    flags = flags.includes(flag) ? flags.replace(flag, "") : flags + flag;
    pts[i] = flags ? [p[0], p[1], flags] : [p[0], p[1]];
    this.touchCurve(i);
    this.flushCurve();
    this.regroundAll(standing);
    this.markUnsaved(this.map.id);
    this.refreshPanel();
  }

  /** The ground between point i's neighbours needs redrawing. */
  private touchCurve(i: number) {
    const pts = this.pts!;
    const x0 = pts[Math.max(0, i - 1)][0], x1 = pts[Math.min(pts.length - 1, i + 1)][0];
    const d = this.curveDirty;
    this.curveDirty = d ? [Math.min(d[0], x0), Math.max(d[1], x1)] : [x0, x1];
  }

  private flushCurve() {
    if (!this.curveDirty) return;
    const [x0, x1] = this.curveDirty;
    this.curveDirty = null;
    this.world.refreshCurve(x0, x1);
  }

  /** Things standing on the ground right now (so they can follow the hill line when it moves). */
  private grounded() {
    return this.map.objects.filter((o) => OBJ_INFO[o.type].ground && !(o.type === "door" && o.style === "edge") && Math.abs(this.world.restY(o.x, o.y - 2) - o.y) <= 2);
  }

  /** Puts them back on the (new) ground. */
  private regroundAll(list: MapObj[]) {
    let moved = false;
    for (const o of list) {
      const y = this.world.restY(o.x, o.y);
      if (y !== o.y) { o.y = y; moved = true; }
    }
    for (const o of this.map.objects) {
      // Edge doors span the full height above the ground.
      if (o.type !== "door" || o.style !== "edge") continue;
      const y = this.world.restY(o.x, 0);
      if (y !== o.y) { o.y = y; o.h = y; moved = true; }
    }
    if (moved) {
      this.level.populate(this.game.progress);
      if (this.map.id === HOME_MAP) this.game.makePets();
    }
  }

  private setCurve(on: boolean) {
    this.pushUndo();
    const m = this.map;
    if (on) {
      const y = Math.round(this.world.h * (this.lineKey === "curve" ? 0.7 : 0.3));
      m[this.lineKey] = { noise: true, pts: [[0, y], [this.world.w, y]] };
    } else m[this.lineKey] = undefined;
    this.curvePt = -1;
    this.world.refreshCurve(0, this.world.w);
    this.markUnsaved(m.id);
    this.refreshPanel();
  }

  // ------------------------------------------------------------- objects

  private objectAt(x: number, y: number) {
    let best: MapObj | null = null;
    let area = Infinity;
    for (const o of this.map.objects) {
      const [x0, y0, x1, y1] = objBox(o, this.world.h);
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const a = (x1 - x0) * (y1 - y0);
      if (a < area) { area = a; best = o; }
    }
    return best;
  }

  private objectDown(e: PointerEvent) {
    if (e.button === 2) {
      const o = this.objectAt(this.mx, this.my);
      if (o) this.deleteObj(o);
      return;
    }
    if (e.button !== 0) return;
    const info = OBJ_INFO[this.objType];
    if ((this.objType === "cottage" || this.objType === "boss") && this.map.objects.some((o) => o.type === this.objType)) {
      this.say(`每张地图只能有一个「${info.name}」，先删掉原来的。`);
      return;
    }
    this.pushUndo();
    const x = Math.round(this.mx);
    const y = info.ground && !e.altKey ? this.world.restY(x, this.my) : Math.round(this.my);
    const o: MapObj = { type: this.objType, x, y, ...structuredClone(info.defaults ?? {}) };
    if (o.type === "tree" || o.type === "rock" || o.type === "crystal") o.seed = Math.floor(Math.random() * 1e6);
    if (DOOR_TYPES.includes(o.type)) {
      const prefix = o.type === "pit" ? "pit" : o.type === "landing" ? "in" : "d";
      o.id = this.freshId(prefix, (id) => this.map.objects.some((p) => DOOR_TYPES.includes(p.type) && p.id === id));
    }
    if (o.type === "gate") o.id = this.freshId(`${this.map.id}_g`, (id) => this.allObjects().some((p) => p.type === "gate" && p.id === id));
    if (o.type === "lantern") o.id = this.freshId(`${this.map.id}_l`, (id) => this.allObjects().some((p) => p.type === "lantern" && p.id === id));
    this.map.objects.push(o);
    this.selected = o;
    this.objectsChanged();
  }

  private selectDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const o = this.objectAt(this.mx, this.my);
    this.selected = o;
    if (o) {
      this.pushUndo();
      this.drag = { o, dx: this.mx - o.x, dy: this.my - o.y, moved: false };
    }
    this.refreshPanel();
  }

  private allObjects() {
    return Object.values(MAPS).flatMap((m) => m.objects);
  }

  private freshId(prefix: string, taken: (id: string) => boolean) {
    for (let i = 1; ; i++) if (!taken(`${prefix}${i}`)) return `${prefix}${i}`;
  }

  private deleteObj(o: MapObj) {
    this.pushUndo();
    this.map.objects = this.map.objects.filter((p) => p !== o);
    if (this.selected === o) this.selected = null;
    this.objectsChanged();
  }

  /** Rebuilds the placed things after an object edit. */
  private objectsChanged() {
    this.level.populate(this.game.progress);
    this.world.refreshObjects();
    if (this.map.id === HOME_MAP) this.game.makePets();
    this.markUnsaved(this.map.id);
    this.refreshPanel();
  }

  // ------------------------------------------------------------- undo / save

  private snapshot(id: string) {
    const lv = this.game.level;
    if (lv.id === id) lv.world.storeRows();
    return { id, json: JSON.stringify(MAPS[id]) };
  }

  private pushUndo() {
    this.undoStack.push(this.snapshot(this.map.id));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  private restore(s: { id: string; json: string }) {
    const m = MAPS[s.id];
    const data = JSON.parse(s.json) as MapData;
    for (const k of Object.keys(m) as (keyof MapData)[]) delete m[k];
    Object.assign(m, data);
    this.game.rebuildLevel(s.id);
    this.game.enterLevel(s.id);
    this.selected = null;
    this.curvePt = -1;
    this.markUnsaved(s.id);
    this.refreshPanel();
  }

  private undo() {
    this.finishStroke();
    const s = this.undoStack.pop();
    if (!s) return this.say("没有可以撤销的了");
    this.redoStack.push(this.snapshot(s.id));
    this.restore(s);
  }

  private redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot(s.id));
    this.restore(s);
  }

  private markUnsaved(id: string) {
    this.unsaved.add(id);
    this.updateStatus();
  }

  async save() {
    this.finishStroke();
    if (!this.unsaved.size) return this.say("没有需要保存的改动");
    this.world.storeRows();
    const failed: string[] = [];
    for (const id of [...this.unsaved]) {
      try {
        const res = await fetch("/__maps/save", { method: "POST", body: formatMap(MAPS[id]) });
        if (!res.ok) throw new Error(await res.text());
        this.unsaved.delete(id);
      } catch (err) {
        failed.push(`${id}：${err instanceof Error ? err.message : err}`);
      }
    }
    if (failed.length) this.say(`保存失败（要用 start.bat / npm run dev 启动才能保存）\n${failed.join("\n")}`, 8);
    else this.say("已保存到 src/maps/");
    this.updateStatus();
  }

  // ------------------------------------------------------------- maps

  private switchMap(id: string) {
    this.finishStroke();
    this.game.rebuildLevel(id);
    this.game.enterLevel(id);
    const w = this.world;
    this.camX = w.w <= this.vw ? (w.w - this.vw) / 2 : 0;
    this.camY = w.h <= this.vh ? (w.h - this.vh) / 2 : w.h - this.vh;
    this.selected = null;
    this.curvePt = -1;
    this.refreshPanel();
  }

  private newRoom() {
    const id = prompt("新房间的 id（英文字母、数字、- 或 _，例如 cave1）：")?.trim();
    if (!id) return;
    if (!/^[a-z0-9_-]+$/i.test(id)) return this.say("id 只能用英文字母、数字、- 和 _");
    if (MAPS[id]) return this.say(`已经有叫 ${id} 的地图了`);
    const name = prompt("房间的名字（进门时显示）：", "神秘洞穴")?.trim() || id;
    const W = 40, H = 23;
    const tiles = new Uint8Array(W * H).fill(makeTile(Mat.Dirt, 1));
    for (let y = 2; y <= 19; y++) for (let x = 2; x <= W - 3; x++) tiles[y * W + x] = 0;
    const rows = Array.from({ length: H }, (_, y) => encodeRow(tiles.subarray(y * W, (y + 1) * W)));
    const entry: MapObj = { type: "door", x: 5 * TILE, y: 20 * TILE, id: "entry", style: "burrow", to: "" };
    // Opened while a door is selected: link the two both ways.
    const from = this.selected?.type === "door" ? this.selected : null;
    if (from) {
      this.pushUndo();
      from.to = `${id}/entry`;
      entry.to = `${this.map.id}/${from.id}`;
      this.markUnsaved(this.map.id);
    }
    MAPS[id] = { id, name, kind: "room", bg: "burrow", w: W, h: H, rows, objects: [entry] };
    this.markUnsaved(id);
    this.switchMap(id);
    this.say(from ? `新房间 ${id} 已经和刚才选中的门连起来了` : `新房间 ${id}：记得在别的地图放一个门通到 ${id}/entry`, 5);
  }

  /** Grows or shrinks the map; extra tiles on the left/top shift everything over. */
  private resizeMap(w: number, h: number, addLeft: number, addTop: number) {
    const m = this.map;
    w = clamp(Math.round(w), 10, 2000);
    h = clamp(Math.round(h), 8, 400);
    this.pushUndo();
    this.world.storeRows();
    const old = this.world;
    const tiles = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ox = x - addLeft, oy = y - addTop;
        // New rows below copy the bottom row, so the ground carries on.
        const sy = Math.min(oy, old.th - 1);
        tiles[y * w + x] = ox >= 0 && ox < old.tw && oy >= 0 ? old.tileAt(ox, sy) : 0;
      }
    }
    m.w = w;
    m.h = h;
    m.rows = Array.from({ length: h }, (_, y) => encodeRow(tiles.subarray(y * w, (y + 1) * w)));
    for (const o of m.objects) {
      o.x += addLeft * TILE;
      o.y += addTop * TILE;
    }
    for (const c of [m.curve, m.ceil]) {
      if (!c) continue;
      for (const p of c.pts) {
        p[0] = clamp(p[0] + addLeft * TILE, 0, w * TILE);
        p[1] += addTop * TILE;
      }
    }
    // Rows added on top sit nearer the surface.
    if (m.depth !== undefined) m.depth -= addTop * TILE;
    this.game.rebuildLevel(m.id);
    this.game.enterLevel(m.id);
    this.markUnsaved(m.id);
    this.refreshPanel();
  }

  // ------------------------------------------------------------- per frame

  update(dt: number) {
    const k = this.keys;
    const sp = (k.has("ShiftLeft") || k.has("ShiftRight") ? 900 : 320) * this.zoom * dt;
    if (k.has("KeyA") || k.has("ArrowLeft")) this.camX -= sp;
    if (k.has("KeyD") || k.has("ArrowRight")) this.camX += sp;
    if (k.has("KeyW") || k.has("ArrowUp")) this.camY -= sp;
    if (k.has("KeyS") || k.has("ArrowDown")) this.camY += sp;
    const w = this.world;
    this.camX = clamp(this.camX, -this.vw / 2, Math.max(-this.vw / 2, w.w - this.vw / 2));
    this.camY = clamp(this.camY, -this.vh / 2, Math.max(-this.vh / 2, w.h - this.vh / 2));
    this.flushTiles();
    if (!this.curveDrag || Math.floor(this.game.time * 20) !== Math.floor((this.game.time + dt) * 20)) this.flushCurve();
    this.game.time += dt;
    this.msgT -= dt;
    if (this.msgT <= 0) this.el.msg.textContent = "";
  }

  render(ctx: Ctx) {
    const g = this.game;
    const cx = Math.round(this.camX), cy = Math.round(this.camY);
    g.camX = cx;
    g.camY = cy;
    const vw = this.vw, vh = this.vh;
    ctx.fillStyle = "#1c1432";
    ctx.fillRect(0, 0, vw, vh);
    g.renderWorld(ctx, cx, cy, vw, vh);

    ctx.save();
    ctx.translate(-cx, -cy);
    const w = this.world;
    // Map bounds.
    ctx.globalAlpha = 0.9;
    rect(ctx, -1, -1, w.w + 2, 1, P.magicPink);
    rect(ctx, -1, w.h, w.w + 2, 1, P.magicPink);
    rect(ctx, -1, -1, 1, w.h + 2, P.magicPink);
    rect(ctx, w.w, -1, 1, w.h + 2, P.magicPink);
    ctx.globalAlpha = 1;
    // Tile grid.
    if (this.grid && this.tool === "tile" && this.zoom <= 2) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#ffffff";
      const x0 = Math.max(0, Math.floor(cx / TILE) * TILE), x1 = Math.min(w.w, cx + vw);
      const y0 = Math.max(0, Math.floor(cy / TILE) * TILE), y1 = Math.min(w.h, cy + vh);
      for (let x = x0; x <= x1; x += TILE) ctx.fillRect(x, y0, 1, y1 - y0);
      for (let y = y0; y <= y1; y += TILE) ctx.fillRect(x0, y, x1 - x0, 1);
      ctx.globalAlpha = 1;
    }
    // Markers for every object.
    for (const o of this.map.objects) {
      const [x0, y0, x1, y1] = objBox(o, w.h);
      if (x1 < cx - 20 || x0 > cx + vw + 20) continue;
      const col = OBJ_INFO[o.type].color;
      const sel = o === this.selected;
      if (o.type === "zone") {
        ctx.globalAlpha = 0.6;
        for (let y = Math.max(0, cy); y < Math.min(w.h, cy + vh); y += 6) rect(ctx, o.x, y, 1, 3, col);
        ctx.globalAlpha = 1;
      } else if (sel || DOOR_TYPES.includes(o.type) || o.type === "boss" || o.type === "trigger" || this.tool !== "tile") {
        ctx.globalAlpha = sel ? 1 : 0.55;
        this.outline(ctx, x0, y0, x1, y1, sel ? (Math.floor(g.time * 6) % 2 ? P.white : P.magicYellow) : col);
        ctx.globalAlpha = 1;
      }
      const tag = objTag(o);
      if (tag) drawText(ctx, tag.toUpperCase(), x0, (o.type === "zone" ? Math.max(0, cy) + 4 : y0 - 7), col);
    }
    // The hill line and its points.
    if (this.tool === "curve") {
      const lines: [Int16Array | null, number, boolean][] = [[this.world.curveY, NO_GROUND, this.lineKey === "curve"], [this.world.ceilY, NO_CEIL, this.lineKey === "ceil"]];
      for (const [line, none, active] of lines) {
        if (!line) continue;
        ctx.globalAlpha = active ? 0.8 : 0.35;
        for (let x = Math.max(0, cx); x < Math.min(w.w, cx + vw); x++) if (line[x] !== none) rect(ctx, x, line[x] - 1, 1, this.zoom > 1 ? 2 : 1, active ? P.magicYellow : P.white);
      }
      ctx.globalAlpha = 1;
    }
    if (this.tool === "curve" && this.pts) {
      const s = 2 * this.zoom;
      this.pts.forEach((p, i) => {
        const col = i === this.curvePt ? P.magicYellow : p[2]?.includes("c") ? P.red : P.white;
        rect(ctx, p[0] - s - 1, p[1] - s - 1, s * 2 + 3, s * 2 + 3, P.outline);
        rect(ctx, p[0] - s, p[1] - s, s * 2 + 1, s * 2 + 1, col);
        if (p[2]?.includes("f")) drawText(ctx, "F", p[0] + s + 2, p[1] - 2, P.cream);
      });
    }
    // Cursor preview.
    if (this.mouseIn && !this.pan) {
      if (this.tool === "tile") {
        const tx = Math.floor(this.mx / TILE), ty = Math.floor(this.my / TILE);
        let [ax, ay, bx, by] = [tx, ty, tx, ty];
        if (this.rectFrom) {
          ax = Math.min(this.rectFrom[0], tx); bx = Math.max(this.rectFrom[0], tx);
          ay = Math.min(this.rectFrom[1], ty); by = Math.max(this.rectFrom[1], ty);
        } else if (this.brush === 3) { ax--; ay--; bx++; by++; }
        ctx.globalAlpha = 0.35;
        rect(ctx, ax * TILE, ay * TILE, (bx - ax + 1) * TILE, (by - ay + 1) * TILE, this.rectFrom && this.rectErase ? P.red : MAT_COLOR[this.mat]);
        ctx.globalAlpha = 1;
        this.outline(ctx, ax * TILE, ay * TILE, (bx + 1) * TILE, (by + 1) * TILE, P.white);
      } else if (this.tool === "object") {
        const info = OBJ_INFO[this.objType];
        const y = info.ground ? this.world.restY(this.mx, this.my) : this.my;
        rect(ctx, this.mx - 1, y - 1, 3, 3, info.color);
        rect(ctx, this.mx, y - 12, 1, 12, info.color);
      }
    }
    ctx.restore();

    const label = `${this.map.id.toUpperCase()}  X ${Math.round(this.mx)} Y ${Math.round(this.my)}  TILE ${Math.floor(this.mx / TILE)},${Math.floor(this.my / TILE)}  ${this.zoom === 1 ? "1X" : `1/${this.zoom}`}`;
    drawText(ctx, label, 4, vh - 9, P.cream);
  }

  private outline(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, col: string) {
    rect(ctx, x0, y0, x1 - x0, 1, col);
    rect(ctx, x0, y1 - 1, x1 - x0, 1, col);
    rect(ctx, x0, y0, 1, y1 - y0, col);
    rect(ctx, x1 - 1, y0, 1, y1 - y0, col);
  }

  // ------------------------------------------------------------- panel

  private say(msg: string, t = 3) {
    this.el.msg.textContent = msg;
    this.msgT = t;
  }

  private setTool(t: Tool) {
    this.tool = t;
    this.refreshPanel();
  }

  private buildPanel() {
    this.panel.innerHTML = `
      <div class="ed-title">地图编辑器 <span class="ed-key">F2 试玩</span></div>
      <div class="ed-row"><select data-el="maps"></select></div>
      <div class="ed-row"><button data-act="newroom">＋ 新建房间</button><button data-act="save">保存 <span class="ed-key">Ctrl+S</span></button></div>
      <div class="ed-row"><button data-act="story">对话 · 任务 · 时间编辑器</button></div>
      <div class="ed-status" data-el="status"></div>
      <div class="ed-tools">
        <button data-tool="tile">画地形 <span class="ed-key">B</span></button>
        <button data-tool="object">放物件 <span class="ed-key">O</span></button>
        <button data-tool="select">选择 <span class="ed-key">V</span></button>
        <button data-tool="curve">起伏线 <span class="ed-key">H</span></button>
      </div>
      <div data-el="curvebox">
        <div class="ed-h">起伏线</div>
        <div data-el="curveinfo"></div>
        <div class="ed-help">地面线：线下面全是地面（大地图是草地，房间是泥土）。洞顶线：线上面全是泥土，两条线中间就是洞。<br>瓦片画在线上面，要在线里挖洞用「挖空」材质。<br>T 切换地面线 / 洞顶线<br>左键拖动点 · 点空白处加点 · 右键或 Delete 删点<br>C 断崖（从前一个点直直落到这个点）<br>F 从这个点到下一个点不加小起伏</div>
      </div>
      <div data-el="tilebox">
        <div class="ed-h">材质 <span class="ed-key">1-7</span></div>
        <div class="ed-grid" data-el="mats"></div>
        <div class="ed-h">形状 <span class="ed-key">Q / E</span></div>
        <div class="ed-shapes" data-el="shapes"></div>
        <div class="ed-row"><label><input type="checkbox" data-el="brush3"> 3×3 大笔刷 <span class="ed-key">X</span></label></div>
        <div class="ed-help">左键画 · 右键擦<br>Shift+拖动 画矩形（右键拖 擦矩形）<br>Alt+点击 吸取格子</div>
      </div>
      <div data-el="objbox">
        <div class="ed-h">物件</div>
        <div class="ed-objs" data-el="objs"></div>
        <div class="ed-help">左键放置（自动落到地面，按住 Alt 放在原处）· 右键删除</div>
      </div>
      <div data-el="props"></div>
      <details class="ed-map">
        <summary>地图设置</summary>
        <div data-el="mapform"></div>
      </details>
      <div class="ed-help">
        WASD / 方向键 移动视角（Shift 更快）<br>
        滚轮 缩放 · 中键或空格+拖动 平移<br>
        Ctrl+Z 撤销 · Ctrl+Y 重做 · G 网格<br>
        F2 从视角中间开始试玩，再按 F2 回来
      </div>
      <div class="ed-msg" data-el="msg"></div>`;
    for (const n of this.panel.querySelectorAll<HTMLElement>("[data-el]")) this.el[n.dataset.el!] = n;
    for (const b of this.panel.querySelectorAll<HTMLElement>("[data-tool]")) b.addEventListener("click", () => this.setTool(b.dataset.tool as Tool));
    this.panel.querySelector('[data-act="save"]')!.addEventListener("click", () => void this.save());
    this.panel.querySelector('[data-act="newroom"]')!.addEventListener("click", () => this.newRoom());
    this.panel.querySelector('[data-act="story"]')!.addEventListener("click", () => {
      const obj = this.selected;
      this.storyEditor.show(obj?.text, obj && (obj.type === "npc" || obj.type === "trigger") ? { obj, field: "text" } : undefined);
    });
    this.el.maps.addEventListener("change", () => this.switchMap((this.el.maps as HTMLSelectElement).value));
    (this.el.brush3 as HTMLInputElement).addEventListener("change", (e) => { this.brush = (e.target as HTMLInputElement).checked ? 3 : 1; });

    for (const m of MATERIALS) {
      const b = document.createElement("button");
      b.innerHTML = `<i style="background:${MAT_COLOR[m.id]}"></i>${m.name}`;
      b.dataset.mat = String(m.id);
      b.addEventListener("click", () => { this.mat = m.id; this.setTool("tile"); });
      this.el.mats.appendChild(b);
    }
    SHAPES.forEach((s, i) => {
      if (i === 0) return;
      const b = document.createElement("button");
      b.title = s.name;
      b.dataset.shape = String(i);
      const c = document.createElement("canvas");
      c.width = c.height = 8;
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff6e8";
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (shapeCovers(i, x, y)) g.fillRect(x, y, 1, 1);
      b.appendChild(c);
      b.addEventListener("click", () => { this.shape = i; this.setTool("tile"); });
      this.el.shapes.appendChild(b);
    });
    for (const t of OBJ_ORDER) {
      const b = document.createElement("button");
      b.innerHTML = `<i style="background:${OBJ_INFO[t].color}"></i>${OBJ_INFO[t].name}`;
      b.dataset.obj = t;
      b.addEventListener("click", () => { this.objType = t; this.setTool("object"); });
      this.el.objs.appendChild(b);
    }
  }

  private updateStatus() {
    const n = this.unsaved.size;
    this.el.status.textContent = n ? `● 未保存：${[...this.unsaved].join("、")}` : "✓ 全部已保存";
    this.el.status.classList.toggle("warn", n > 0);
  }

  private refreshPanel() {
    if (!this.open) return;
    const sel = this.el.maps as HTMLSelectElement;
    sel.innerHTML = Object.values(MAPS)
      .sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === "overworld" ? -1 : 1))
      .map((m) => `<option value="${m.id}">${m.name}（${m.id}）</option>`)
      .join("");
    sel.value = this.map.id;
    for (const b of this.panel.querySelectorAll<HTMLElement>("[data-tool]")) b.classList.toggle("on", b.dataset.tool === this.tool);
    for (const b of this.panel.querySelectorAll<HTMLElement>("[data-mat]")) b.classList.toggle("on", Number(b.dataset.mat) === this.mat);
    for (const b of this.panel.querySelectorAll<HTMLElement>("[data-shape]")) b.classList.toggle("on", Number(b.dataset.shape) === this.shape);
    for (const b of this.panel.querySelectorAll<HTMLElement>("[data-obj]")) b.classList.toggle("on", b.dataset.obj === this.objType);
    (this.el.brush3 as HTMLInputElement).checked = this.brush === 3;
    this.el.tilebox.style.display = this.tool === "tile" ? "" : "none";
    this.el.objbox.style.display = this.tool === "object" ? "" : "none";
    this.el.curvebox.style.display = this.tool === "curve" ? "" : "none";
    if (this.tool === "curve") this.buildCurveInfo();
    this.buildProps();
    this.buildMapForm();
    this.updateStatus();
  }

  /** Line settings: which line, on/off, bumps, and the selected point's flags. */
  private buildCurveInfo() {
    const box = this.el.curveinfo;
    const c = this.map[this.lineKey];
    box.innerHTML = "";
    const pick = document.createElement("div");
    pick.className = "ed-row";
    for (const [key, label] of [["curve", "地面线"], ["ceil", "洞顶线"]] as const) {
      const b = document.createElement("button");
      b.textContent = label + (this.map[key] ? "" : "（无）");
      b.classList.toggle("on", this.lineKey === key);
      b.addEventListener("click", () => this.switchLine(key));
      pick.appendChild(b);
    }
    box.appendChild(pick);
    const button = (label: string, fn: () => void, cls = "") => {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener("click", fn);
      box.appendChild(b);
    };
    const check = (label: string, on: boolean, fn: (v: boolean) => void) => {
      const l = document.createElement("label");
      l.className = "ed-field";
      const i = document.createElement("input");
      i.type = "checkbox";
      i.checked = on;
      i.addEventListener("change", () => fn(i.checked));
      l.append(i, " ", label);
      box.appendChild(l);
    };
    if (!c) {
      button(`创建${this.lineName}`, () => this.setCurve(true));
      return;
    }
    check("随机小起伏（手绘感）", c.noise, (v) => {
      this.pushUndo();
      const standing = this.grounded();
      c.noise = v;
      this.world.refreshCurve(0, this.world.w);
      this.regroundAll(standing);
      this.markUnsaved(this.map.id);
    });
    const p = c.pts[this.curvePt];
    if (p) {
      const h = document.createElement("div");
      h.className = "ed-h";
      h.textContent = `选中的点：x ${p[0]}, y ${p[1]}`;
      box.appendChild(h);
      check("断崖（C）", !!p[2]?.includes("c"), () => this.togglePtFlag("c"));
      check("到下一个点保持平整（F）", !!p[2]?.includes("f"), () => this.togglePtFlag("f"));
    }
    button(`删除${this.lineName}`, () => {
      if (confirm(`删除这张地图的${this.lineName}？（只留下画的瓦片）`)) this.setCurve(false);
    }, "ed-del");
  }

  /** Property form for the selected object. */
  private buildProps() {
    const box = this.el.props;
    box.innerHTML = "";
    const o = this.selected;
    if (!o) return;
    const info = OBJ_INFO[o.type];
    const head = document.createElement("div");
    head.className = "ed-h";
    head.textContent = `选中：${info.name}（x ${o.x}, y ${o.y}）`;
    box.appendChild(head);
    for (const p of info.props) box.appendChild(this.propField(o, p));
    if (o.type === "npc" || o.type === "trigger") {
      const edit = document.createElement("button");
      edit.textContent = o.type === "npc" ? "编辑此地图的对话" : "打开关联对话";
      edit.addEventListener("click", () => this.storyEditor.show(o.text, { obj: o, field: "text" }));
      box.appendChild(edit);
    }
    if (o.type === "npc" && o.bark) {
      const edit = document.createElement("button");
      edit.textContent = "打开自言自语";
      edit.addEventListener("click", () => this.storyEditor.show(o.bark, { obj: o, field: "bark" }));
      box.appendChild(edit);
    }
    const del = document.createElement("button");
    del.className = "ed-del";
    del.textContent = "删除（Delete）";
    del.addEventListener("click", () => this.deleteObj(o));
    box.appendChild(del);
  }

  private propField(o: MapObj, p: PropDef) {
    const row = document.createElement("label");
    row.className = "ed-field";
    row.append(p.label);
    const cur = o[p.key];
    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (p.type === "select" || p.type === "door" || p.type === "dialogue") {
      const s = document.createElement("select");
      const opts: [string, string][] = p.type === "door" ? this.doorOptions(o)
        : p.type === "dialogue" ? [["", "（选择台词段落）"], ...SCRIPT_SECTIONS.map((s) => [s.id, s.title ? `${s.chapter ? s.chapter + " · " : ""}${s.title}（${s.id}）` : s.id] as [string, string])]
        : p.key === "period" ? [["", "任何时段"], ...STORY.periods.map((v) => [v.id, v.name] as [string, string])]
        : p.options!;
      if (cur && !opts.some(([v]) => v === String(cur))) opts.push([String(cur), `⚠ 不存在：${cur}`]);
      s.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
      s.value = cur === undefined ? "" : String(cur);
      input = s;
    } else if (p.type === "longtext") {
      input = document.createElement("textarea");
      input.value = String(cur ?? "");
    } else {
      const i = document.createElement("input");
      if (p.type === "bool") {
        i.type = "checkbox";
        i.checked = !!cur;
      } else {
        i.type = p.type === "number" ? "number" : "text";
        i.value = cur === undefined ? "" : String(cur);
      }
      input = i;
    }
    input.addEventListener("change", () => {
      this.pushUndo();
      const rec = o as unknown as Record<string, unknown>;
      let v: unknown;
      if (p.type === "bool") v = (input as HTMLInputElement).checked;
      else if (p.type === "number" || p.key === "decay" || p.key === "face") v = input.value === "" ? undefined : Number(input.value);
      else v = input.value;
      if (v === undefined || (v === false && p.type === "bool")) delete rec[p.key];
      else rec[p.key] = v;
      // A different person must not inherit the previous person's conversation.
      // Its entry is resolved by the dialogue editor when opened.
      if (o.type === "npc" && p.key === "kind" && v !== cur) delete o.text;
      if (p.type === "door") this.linkBack(o);
      this.objectsChanged();
    });
    row.appendChild(input);
    return row;
  }

  /** Every door in every map, as "mapId/doorId". */
  private doorOptions(self: MapObj): [string, string][] {
    const out: [string, string][] = [["", "（还没通到哪里）"]];
    for (const m of Object.values(MAPS)) {
      for (const o of m.objects) {
        if (!DOOR_TYPES.includes(o.type) || !o.id || o === self) continue;
        const kind = o.type === "pit" ? "掉落口" : o.type === "landing" ? "落下点" : "门";
        out.push([`${m.id}/${o.id}`, `${m.name} · ${kind} ${o.id}`]);
      }
    }
    return out;
  }

  /** Pointing door A at door B also points B back at A, if B leads nowhere yet. */
  private linkBack(a: MapObj) {
    // Falling is one way: pits and drop points never lead back.
    if (a.type !== "door") return;
    const dest = parseDest(a.to);
    if (!dest || !a.id) return;
    const b = MAPS[dest[0]]?.objects.find((o) => o.type === "door" && o.id === dest[1]);
    if (!b) return;
    if (!b || b.to) return;
    b.to = `${this.map.id}/${a.id}`;
    if (dest[0] !== this.map.id) {
      this.markUnsaved(dest[0]);
      this.game.rebuildLevel(dest[0]);
    }
    this.say(`已经双向连通：${a.id} ⇄ ${dest.join("/")}`);
  }

  private buildMapForm() {
    const m = this.map;
    const box = this.el.mapform;
    box.innerHTML = `
      <label class="ed-field">名字<input data-k="name" value="${m.name.replace(/"/g, "&quot;")}"></label>
      <label class="ed-field">类型<select data-k="kind"><option value="overworld">大地图（丘陵漫步）</option><option value="room">房间</option></select></label>
      <label class="ed-field">背景<select data-k="bg"><option value="sky">天空</option><option value="burrow">地洞</option></select></label>
      <label class="ed-field">最上面一行在地表下多深（px，留空=自动）<input type="number" data-k="depth" value="${m.depth ?? ""}"></label>
      <div class="ed-h">尺寸（格）现在 ${m.w} × ${m.h}</div>
      <div class="ed-row"><input type="number" data-k="w" value="${m.w}"> × <input type="number" data-k="h" value="${m.h}"></div>
      <label class="ed-field">多出来的加在<select data-k="anchor"><option value="br">右边 / 下边</option><option value="tl">左边 / 上边</option></select></label>
      <button data-k="resize">调整尺寸</button>`;
    const q = <T extends HTMLElement>(k: string) => box.querySelector<T>(`[data-k="${k}"]`)!;
    q<HTMLSelectElement>("kind").value = m.kind;
    q<HTMLSelectElement>("bg").value = m.bg;
    const meta = (k: "name" | "kind" | "bg") => q<HTMLInputElement>(k).addEventListener("change", (e) => {
      this.pushUndo();
      (m as unknown as Record<string, string>)[k] = (e.target as HTMLInputElement).value;
      this.game.rebuildLevel(m.id);
      this.game.enterLevel(m.id);
      this.markUnsaved(m.id);
      this.refreshPanel();
    });
    meta("name");
    meta("kind");
    meta("bg");
    q<HTMLInputElement>("depth").addEventListener("change", (e) => {
      this.pushUndo();
      const v = (e.target as HTMLInputElement).value.trim();
      if (v === "" || !Number.isFinite(Number(v))) delete m.depth;
      else m.depth = Math.round(Number(v));
      this.game.rebuildLevel(m.id);
      this.game.enterLevel(m.id);
      this.markUnsaved(m.id);
      this.refreshPanel();
    });
    q("resize").addEventListener("click", () => {
      const w = Number(q<HTMLInputElement>("w").value), h = Number(q<HTMLInputElement>("h").value);
      const tl = q<HTMLSelectElement>("anchor").value === "tl";
      this.resizeMap(w, h, tl ? w - m.w : 0, tl ? h - m.h : 0);
    });
  }
}
