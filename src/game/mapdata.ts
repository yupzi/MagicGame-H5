import { LOOKS } from "./people";

/**
 * Maps are plain JSON files in src/maps/, painted with the in-game editor (F2).
 * A map is a tile grid plus a list of placed objects. "overworld" maps are the
 * wide rolling hills; "room" maps are the places you enter through doors
 * (burrows, caves, ruins).
 */
export type ObjType =
  | "cottage" | "tree" | "rock" | "crystal"
  | "slime" | "rabbit" | "boar"
  | "cloud" | "sign" | "lantern" | "gate" | "tablet"
  | "door" | "pit" | "landing" | "zone" | "boss" | "scar" | "pillar"
  | "npc" | "trigger" | "bridge" | "light";

/** Objects that act as doors: other doors can lead to them by id. */
export const DOOR_TYPES: ObjType[] = ["door", "pit", "landing"];

export interface MapObj {
  type: ObjType;
  x: number;
  /** Feet position: most objects stand on the ground at y. */
  y: number;
  seed?: number;
  /** Cloud width, edge-door width, light-shaft width at the top. */
  w?: number;
  /** Edge-door height, pillar height, light-shaft length. */
  h?: number;
  text?: string;
  /** Lantern / door / gate id, unique within the map (lanterns: unique across maps). */
  id?: string;
  /** Gate kind. */
  kind?: string;
  /** Tablet form rune ("" for a stone past reading). */
  form?: string;
  decay?: number;
  /** Door destination as "mapId/doorId". */
  to?: string;
  /** Door look: hole, burrow, cave or edge (invisible, walk-through). */
  style?: string;
  name?: string;
  broken?: boolean;
  big?: boolean;
  /** NPC / trigger: only there while these story flags hold ("fire", "!boss", "intro !fire"). */
  cond?: string;
  /** Optional narrative period when an NPC or trigger is available. */
  period?: string;
  /** NPC facing (−1 left, 1 right). */
  face?: number;
  /** NPC: dialogue they mutter when the witch comes near, the range (px) and the rest (s) between times. */
  bark?: string;
  barkR?: number;
  barkCd?: number;
  /** Trigger: "bark" plays as bubbles while you keep walking; "" (default) stops you for a conversation. */
  mode?: string;
  /** Trigger in bark mode: plays again after you walk out and back in. */
  repeat?: boolean;
}

export type MapKind = "overworld" | "room";
export type Backdrop = "sky" | "burrow";

/**
 * A point on a map's rolling hill line: [x, y] or [x, y, flags].
 * flags: "c" – a cliff: the ground holds the previous height and steps straight to y here;
 *        "f" – flat: no little bumps from here to the next point.
 */
export type CurvePt = [number, number] | [number, number, string];

/**
 * A rolling line of ground. The hill line (`curve`): everything below it is ground,
 * grassy on overworld maps and earth in rooms. The ceiling line (`ceil`): everything
 * above it is earth. Tiles are painted on top of both.
 */
export interface Curve {
  /** Little hand-drawn bumps along the line. */
  noise: boolean;
  pts: CurvePt[];
}

export interface MapData {
  id: string;
  name: string;
  kind: MapKind;
  bg: Backdrop;
  /** Size in tiles. */
  w: number;
  h: number;
  curve?: Curve;
  ceil?: Curve;
  /**
   * How far below the surface row 0 lies (px). Earth is banded by depth below the
   * surface, so a cave under the hills picks up the colours of the ground above it.
   * Unset: overworld earth bands from the hill line, rooms from row 0.
   */
  depth?: number;
  /** One run-length encoded string per tile row (see tiles.ts). */
  rows: string[];
  objects: MapObj[];
}

export type PropType = "text" | "longtext" | "number" | "select" | "bool" | "door" | "dialogue";

export interface PropDef {
  key: keyof MapObj;
  label: string;
  type: PropType;
  options?: [string, string][];
}

export interface ObjInfo {
  name: string;
  /** Snaps onto the ground below the cursor when placed. */
  ground: boolean;
  color: string;
  props: PropDef[];
  defaults?: Partial<MapObj>;
}

const LOOK_OPTIONS: [string, string][] = Object.entries(LOOKS).map(([id, l]) => [id, l.name]);
const COND_HINT = "出现条件（标记、物品数量、day>=2、period=evening；空=一直在）";
const PERIOD_OPTIONS: [string, string][] = [["", "任何时段"], ["morning", "早晨"], ["afternoon", "午后"], ["evening", "傍晚"], ["night", "夜晚"]];

const GATE_KINDS: [string, string][] = [["crack", "裂开的岩墙（蓄力星光柱）"], ["bramble", "荆棘墙（火）"], ["sealed", "远古魔法门（雷）"], ["seal", "Boss 封印"]];
const FORMS: [string, string][] = [["ring", "环"], ["lob", "抛"], ["pillar", "柱"], ["", "（残破，读不出）"]];
const DOOR_STYLES: [string, string][] = [["hole", "兔子洞口"], ["burrow", "隧道口（房间内）"], ["cave", "山洞口"], ["edge", "隐形通道（走进就切换）"]];

export const OBJ_INFO: Record<ObjType, ObjInfo> = {
  cottage: { name: "小屋", ground: true, color: "#6a74e8", props: [] },
  tree: { name: "树", ground: true, color: "#6fd06a", props: [{ key: "seed", label: "随机种子", type: "number" }] },
  rock: { name: "石头", ground: true, color: "#bcbcd6", props: [{ key: "seed", label: "随机种子", type: "number" }] },
  crystal: { name: "水晶", ground: true, color: "#ff8fd8", props: [{ key: "seed", label: "随机种子", type: "number" }] },
  slime: { name: "史莱姆", ground: true, color: "#7fe0c0", props: [{ key: "big", label: "大史莱姆", type: "bool" }] },
  rabbit: { name: "兔子", ground: true, color: "#fffaf2", props: [] },
  boar: { name: "野猪", ground: true, color: "#a3714f", props: [] },
  cloud: { name: "云朵平台", ground: false, color: "#ffffff", props: [{ key: "w", label: "宽度", type: "number" }], defaults: { w: 44 } },
  sign: { name: "路牌", ground: true, color: "#c98f63", props: [{ key: "text", label: "提示文字", type: "longtext" }], defaults: { text: "写点提示吧" } },
  lantern: { name: "存档灯笼", ground: true, color: "#fff2a0", props: [{ key: "id", label: "灯笼 id（全局唯一）", type: "text" }] },
  gate: { name: "元素门", ground: true, color: "#8a86b8", props: [{ key: "id", label: "门 id（存档用）", type: "text" }, { key: "kind", label: "种类", type: "select", options: GATE_KINDS }], defaults: { kind: "crack" } },
  tablet: {
    name: "符文石碑", ground: true, color: "#c9a0ff",
    props: [{ key: "form", label: "形态符文", type: "select", options: FORMS }, { key: "decay", label: "残破程度", type: "select", options: [["0", "完好"], ["1", "裂开"], ["2", "破碎"]] }],
    defaults: { form: "ring", decay: 0 },
  },
  door: {
    name: "门 / 通道", ground: true, color: "#ffb8d9",
    props: [
      { key: "id", label: "门 id（本地图内唯一）", type: "text" },
      { key: "style", label: "样子", type: "select", options: DOOR_STYLES },
      { key: "to", label: "通往", type: "door" },
      { key: "w", label: "宽（隐形通道）", type: "number" },
      { key: "h", label: "高（隐形通道）", type: "number" },
    ],
    defaults: { style: "hole", to: "", w: 16, h: 40 },
  },
  pit: {
    name: "掉落口", ground: false, color: "#ff9a4a",
    props: [
      { key: "id", label: "id（本地图内唯一）", type: "text" },
      { key: "to", label: "掉到哪里", type: "door" },
      { key: "w", label: "宽", type: "number" },
      { key: "h", label: "高", type: "number" },
    ],
    defaults: { to: "", w: 32, h: 24 },
  },
  landing: { name: "落下点", ground: false, color: "#9fe6ff", props: [{ key: "id", label: "id（本地图内唯一）", type: "text" }] },
  zone: { name: "区域名", ground: false, color: "#ffe478", props: [{ key: "name", label: "名字（从这里往右生效）", type: "text" }], defaults: { name: "新区域" } },
  boss: { name: "Boss 擂台", ground: true, color: "#ff4d6a", props: [] },
  scar: { name: "画错的魔法阵", ground: true, color: "#ff9de6", props: [] },
  npc: {
    name: "人物", ground: true, color: "#ffd0a8",
    props: [
      { key: "kind", label: "是谁", type: "select", options: LOOK_OPTIONS },
      { key: "face", label: "朝向", type: "select", options: [["-1", "朝左"], ["1", "朝右"]] },
      { key: "bark", label: "自言自语（玩家走近时冒出来，不打断操作）", type: "dialogue" },
      { key: "barkR", label: "自言自语范围（左右各多少像素，默认 64）", type: "number" },
      { key: "barkCd", label: "说完后隔几秒才会再说（默认 12）", type: "number" },
      { key: "cond", label: COND_HINT, type: "text" },
      { key: "period", label: "出现时段", type: "select", options: PERIOD_OPTIONS },
    ],
    defaults: { kind: "granny", face: -1 },
  },
  trigger: {
    name: "剧情触发区", ground: false, color: "#ff8ad8",
    props: [
      { key: "text", label: "对话（走进去时开始）", type: "dialogue" },
      { key: "mode", label: "方式", type: "select", options: [["", "剧情：停下来听，只触发一次"], ["bark", "自言自语：边走边冒气泡，不打断"]] },
      { key: "repeat", label: "自言自语可以反复触发（走开再回来）", type: "bool" },
      { key: "w", label: "宽", type: "number" },
      { key: "h", label: "高", type: "number" },
      { key: "cond", label: COND_HINT, type: "text" },
      { key: "period", label: "触发时段", type: "select", options: PERIOD_OPTIONS },
    ],
    defaults: { text: "", w: 24, h: 48 },
  },
  bridge: {
    name: "木桥", ground: false, color: "#e0bd82",
    props: [
      { key: "w", label: "宽度（两头的柱子之间）", type: "number" },
      { key: "cond", label: "修好的条件（标记；没有这个标记时是断桥）", type: "text" },
    ],
    defaults: { w: 96, cond: "bridge" },
  },
  light: {
    name: "光柱", ground: false, color: "#fff0c8",
    props: [{ key: "w", label: "顶部宽度", type: "number" }, { key: "h", label: "长度", type: "number" }],
    defaults: { w: 24, h: 120 },
  },
  pillar: { name: "石柱（装饰）", ground: true, color: "#e8e8f7", props: [{ key: "h", label: "高度", type: "number" }, { key: "broken", label: "断的", type: "bool" }], defaults: { h: 36 } },
};

export const OBJ_ORDER: ObjType[] = [
  "tree", "rock", "crystal", "slime", "rabbit", "boar", "cloud", "sign", "lantern", "door", "pit", "landing",
  "gate", "tablet", "zone", "pillar", "cottage", "boss", "scar", "npc", "trigger", "bridge", "light",
];

/** JSON with one tile row and one object per line, so git diffs of maps stay readable. */
export function formatMap(m: MapData) {
  const head = { id: m.id, name: m.name, kind: m.kind, bg: m.bg, w: m.w, h: m.h, depth: m.depth };
  const lines = Object.entries(head).filter(([, v]) => v !== undefined).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  for (const key of ["curve", "ceil"] as const) {
    const c = m[key];
    if (!c) continue;
    const pts = c.pts.map((p, i) => `      ${JSON.stringify(p)}${i < c.pts.length - 1 ? "," : ""}`);
    lines.push(`  "${key}": {\n    "noise": ${c.noise},\n    "pts": [\n${pts.join("\n")}\n    ]\n  },`);
  }
  const rows = m.rows.map((r, i) => `    ${JSON.stringify(r)}${i < m.rows.length - 1 ? "," : ""}`);
  const objs = m.objects.map((o, i) => `    ${JSON.stringify(o)}${i < m.objects.length - 1 ? "," : ""}`);
  return `{\n${lines.join("\n")}\n  "rows": [\n${rows.join("\n")}\n  ],\n  "objects": [\n${objs.join("\n")}\n  ]\n}\n`;
}

/** "mapId/doorId" → parts. */
export function parseDest(to: string | undefined): [string, string] | null {
  if (!to) return null;
  const i = to.indexOf("/");
  if (i <= 0 || i === to.length - 1) return null;
  return [to.slice(0, i), to.slice(i + 1)];
}

/** A placed gate's kind; unknown kinds fall back to a crack. */
export function gateKind(o: MapObj) {
  return GATE_KINDS.some(([k]) => k === o.kind) ? o.kind! : "crack";
}

/** The id a gate is saved under: its own id, or one derived from where it stands. */
export function gateId(mapId: string, o: MapObj) {
  return o.id || `${mapId}:${gateKind(o)}@${o.x}`;
}

/** A short fingerprint of a map's content; any edit to the map changes it. */
export function mapStamp(m: MapData) {
  const s = formatMap(m);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
