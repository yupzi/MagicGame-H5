import type { HitKind } from "./entity";
import { P } from "./palette";

/**
 * Rune weaving: every spell is an element rune + a form rune.
 * Elements are lit on the star chart (materials); forms are copied from
 * ancient tablets out in the world (exploration).
 */
export type ElementId = "star" | "fire" | "ice" | "thunder" | "flower";
export type FormId = "bolt" | "ring" | "pillar" | "lob";

export const ELEMENT_ORDER: ElementId[] = ["star", "fire", "ice", "thunder", "flower"];
export const FORM_ORDER: FormId[] = ["bolt", "ring", "pillar", "lob"];

export interface Weave {
  el: ElementId;
  form: FormId;
}

export interface ElementInfo {
  name: string;
  main: string;
  accent: string;
  kind: HitKind;
  kw: string; // .kw-* CSS class for the DOM card
  glyphs: number; // offset into the rune glyph table, so each element's circle reads differently
}

export const ELEMENTS: Record<ElementId, ElementInfo> = {
  star: { name: "星", main: P.magicPink, accent: P.magicYellow, kind: "bolt", kw: "star", glyphs: 0 },
  fire: { name: "火", main: P.fire, accent: P.fireHi, kind: "fire", kw: "fire", glyphs: 2 },
  ice: { name: "冰", main: P.ice, accent: P.iceHi, kind: "ice", kw: "ice", glyphs: 4 },
  thunder: { name: "雷", main: P.volt, accent: P.voltBlue, kind: "thunder", kw: "volt", glyphs: 5 },
  flower: { name: "花", main: P.leaf, accent: P.blossom, kind: "bloom", kw: "leaf", glyphs: 3 },
};

export const FORMS: Record<FormId, { name: string; desc: string }> = {
  bolt: { name: "弹", desc: "向前射出" },
  ring: { name: "环", desc: "以自己为中心扩散" },
  pillar: { name: "柱", desc: "在前方的地面升起" },
  lob: { name: "抛", desc: "抛出去，落地生效" },
};

export interface WeaveInfo {
  name: string;
  tag: string; // pixel-font label shown when swapping
  desc: string; // light markup, see skilltree markup()
  use?: string; // what it does out in the world
  cooldown: number;
}

type Key = `${ElementId}_${FormId}`;

const WEAVES: Record<Key, WeaveInfo> = {
  star_bolt: {
    name: "星星弹", tag: "STAR", cooldown: 0.2,
    desc: "又快又轻的[star]星星[]，打中第一个目标。",
  },
  star_ring: {
    name: "星光环", tag: "STAR RING", cooldown: 0.7,
    desc: "以自己为中心炸开[star]星光[]，\n把周围的东西统统推开。",
    use: "被围住的时候很好用，也能一次打到好几棵树。",
  },
  star_pillar: {
    name: "星芒柱", tag: "STAR SPIRE", cooldown: 0.6,
    desc: "在前方升起一道[star]星光[]，\n把上面的敌人挑上天。",
  },
  fire_bolt: {
    name: "火球术", tag: "FIREBALL", cooldown: 0.42,
    desc: "抛出会爆炸的[fire]火球[]，\n让敌人[fire]燃烧[]。",
    use: "能烧掉[fire]荆棘墙[]。",
  },
  fire_ring: {
    name: "烈焰之环", tag: "FLAME RING", cooldown: 0.9,
    desc: "身边燃起一圈[fire]火焰[]，\n点燃附近的所有敌人。",
    use: "能烧掉[fire]荆棘墙[]。",
  },
  fire_pillar: {
    name: "火焰喷泉", tag: "GEYSER", cooldown: 1.1,
    desc: "地面喷出持续的[fire]火柱[]，\n站在上面的敌人会一直被烧。",
    use: "能烧掉[fire]荆棘墙[]。",
  },
  ice_bolt: {
    name: "冰锥术", tag: "ICE SHARD", cooldown: 0.3,
    desc: "穿透多个目标的[ice]冰锥[]，\n会[ice]冻住[]敌人。",
    use: "掠过水面能冻出一条[ice]冰路[]。",
  },
  ice_ring: {
    name: "霜华新星", tag: "FROST NOVA", cooldown: 1.0,
    desc: "[ice]冻住[]身边的一切。",
    use: "脚下的水面也会[ice]结冰[]。",
  },
  ice_pillar: {
    name: "冰晶石柱", tag: "ICE PILLAR", cooldown: 0.9,
    desc: "升起一根[ice]冰柱[]，\n可以站上去，一会儿会融化。",
    use: "在湖面上也能立起来，当作[ice]踏脚石[]。",
  },
  thunder_bolt: {
    name: "落雷术", tag: "THUNDER", cooldown: 0.75,
    desc: "天上劈下[volt]落雷[]，自动瞄准前方，\n还会[volt]连锁[]附近的敌人。",
    use: "能唤醒[volt]远古魔法门[]。",
  },
  thunder_ring: {
    name: "静电爆发", tag: "STATIC", cooldown: 1.0,
    desc: "向身边所有敌人放出[volt]电弧[]，\n让它们[volt]麻痹[]。",
    use: "能唤醒[volt]远古魔法门[]。",
  },
  thunder_pillar: {
    name: "避雷针", tag: "THUNDER ROD", cooldown: 1.4,
    desc: "立起一根[volt]避雷针[]，\n自动电击靠近的敌人。",
    use: "能唤醒[volt]远古魔法门[]。",
  },
  star_lob: {
    name: "星屑炸弹", tag: "STAR BOMB", cooldown: 0.5,
    desc: "抛出一团[star]星屑[]，\n落地炸开，波及周围。",
    use: "能越过矮墙，打到后面的东西。",
  },
  fire_lob: {
    name: "燃烧瓶", tag: "FIREBOMB", cooldown: 0.9,
    desc: "落地后留下一片[fire]火海[]，\n走进去的敌人会被烧。",
    use: "能烧掉[fire]荆棘墙[]。",
  },
  ice_lob: {
    name: "冰霜弹", tag: "FROST BOMB", cooldown: 0.8,
    desc: "落地[ice]冻住[]一片区域。",
    use: "落在湖面上会冻出一块[ice]浮冰[]。",
  },
  thunder_lob: {
    name: "引雷种", tag: "STORM SEED", cooldown: 1.0,
    desc: "落地的种子会引来一道[volt]落雷[]。",
    use: "能唤醒[volt]远古魔法门[]。",
  },
  flower_bolt: {
    name: "花瓣弹", tag: "PETAL", cooldown: 0.3,
    desc: "花瓣会用[leaf]藤蔓[]缠住敌人。",
    use: "打中[heart]小动物[]不会伤害它，\n而是和它交朋友。",
  },
  flower_ring: {
    name: "花开之环", tag: "BLOSSOM", cooldown: 4,
    desc: "身边开满鲜花，[heart]恢复 1 颗心[]，\n[leaf]缠住[]附近的敌人。",
    use: "砍倒的树、打碎的石头会马上[leaf]长回来[]。",
  },
  flower_pillar: {
    name: "藤蔓阶梯", tag: "VINE", cooldown: 1.2,
    desc: "长出一段[leaf]藤蔓[]，\n叶片可以一级一级跳上去。",
    use: "用来够到高处的平台。",
  },
  flower_lob: {
    name: "弹跳蘑菇", tag: "MUSHROOM", cooldown: 1.0,
    desc: "种子落地长出[leaf]蘑菇[]，\n踩上去会高高弹起。",
    use: "落在湖面上会长出一片[leaf]荷叶[]。",
  },
};

export function weaveInfo(w: Weave): WeaveInfo {
  return WEAVES[`${w.el}_${w.form}`];
}

export function sameWeave(a: Weave | null, b: Weave | null) {
  return !!a && !!b && a.el === b.el && a.form === b.form;
}

export function isElement(v: unknown): v is ElementId {
  return typeof v === "string" && (ELEMENT_ORDER as string[]).includes(v);
}

export function isForm(v: unknown): v is FormId {
  return typeof v === "string" && (FORM_ORDER as string[]).includes(v);
}
