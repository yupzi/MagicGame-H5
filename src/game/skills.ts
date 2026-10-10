import { P } from "./palette";
import type { SpellId } from "./spells";
import type { IconId, ItemType } from "./sprites";

export type SkillId =
  | "grimoire"
  | "star_dmg" | "star_multi" | "charge_speed" | "charge_power"
  | "fire" | "fire_radius" | "fire_burn"
  | "ice" | "ice_pierce" | "ice_freeze" | "shatter"
  | "thunder" | "thunder_chain" | "thunder_dmg"
  | "heart" | "feather" | "speed"
  | "harvest" | "magnet" | "lucky" | "flower";

export type Branch = "core" | "star" | "fire" | "ice" | "thunder" | "body" | "harvest";
export type Cost = Partial<Record<ItemType, number>>;

export interface Skill {
  id: SkillId;
  parent: SkillId | null;
  /** Polar position on the star chart: degrees (0 = right, -90 = up) and radius in px. */
  angle: number;
  r: number;
  name: string;
  /**
   * Description with light markup: [fire]text[] colours a keyword (see the
   * .kw-* CSS classes), {v} is replaced with value(level).
   */
  desc: string;
  value?: (lvl: number) => string;
  costs: Cost[]; // one entry per level
  icon: IconId;
  branch: Branch;
  spell?: SpellId; // unlocking this teaches a spell (gets the rainbow treatment)
}

export const BRANCH_COLOR: Record<Branch, { main: string; accent: string }> = {
  core: { main: P.magicPurple, accent: P.white },
  star: { main: P.magicYellow, accent: P.magicPink },
  fire: { main: P.fire, accent: P.fireHi },
  ice: { main: P.ice, accent: P.iceHi },
  thunder: { main: P.volt, accent: P.voltBlue },
  body: { main: P.heart, accent: P.heartHi },
  harvest: { main: P.leaf, accent: P.leafHi },
};

const pct = (per: number) => (l: number) => `${Math.round(l * per)}%`;
const plus = (per: number, base = 0) => (l: number) => `+${base + l * per}`;

export const SKILLS: Skill[] = [
  {
    id: "grimoire", parent: null, angle: 0, r: 0, name: "魔导书", branch: "core", icon: "grimoire", costs: [{}],
    desc: "一切魔法的起点。\n收集材料，点亮整片[star]星盘[]吧！",
  },
  // --- Star
  {
    id: "star_dmg", parent: "grimoire", angle: -90, r: 32, name: "闪耀星辰", branch: "star", icon: "star_dmg",
    desc: "所有[star]星之魔法[]的伤害 {v}", value: plus(1),
    costs: [{ wood: 4, stone: 4 }, { stone: 10, crystal: 2 }],
  },
  {
    id: "star_multi", parent: "star_dmg", angle: -104, r: 60, name: "流星连射", branch: "star", icon: "star_multi",
    desc: "每次同时射出 {v} 颗[star]星星弹[]", value: (l) => `${1 + l}`,
    costs: [{ gel: 4, crystal: 2 }, { gel: 8, crystal: 4 }],
  },
  {
    id: "charge_speed", parent: "star_dmg", angle: -76, r: 60, name: "快速咏唱", branch: "star", icon: "charge_speed",
    desc: "[star]蓄力[]所需时间减少 {v}", value: pct(15),
    costs: [{ wood: 6 }, { wood: 10, fur: 2 }, { wood: 14, crystal: 3 }],
  },
  {
    id: "charge_power", parent: "charge_speed", angle: -72, r: 90, name: "星光巨柱", branch: "star", icon: "charge_power",
    desc: "[star]星光柱[]伤害 {v}，范围也更大", value: plus(2),
    costs: [{ stone: 8, crystal: 2 }, { stone: 14, crystal: 5 }],
  },
  // --- Fire
  {
    id: "fire", parent: "grimoire", angle: -30, r: 32, name: "火之符文", branch: "fire", icon: "fire", spell: "fire",
    desc: "点亮[rainbow]火之符文[]！\n织出的火焰魔法会让敌人[fire]燃烧[]，\n还能烧掉[fire]荆棘墙[]",
    costs: [{ wood: 10, gel: 4 }],
  },
  {
    id: "fire_radius", parent: "fire", angle: -44, r: 60, name: "爆裂之心", branch: "fire", icon: "fire_radius",
    desc: "[fire]火球[]和[fire]火环[]的范围扩大 {v}", value: pct(25),
    costs: [{ wood: 10, gel: 3 }, { wood: 16, gel: 6 }],
  },
  {
    id: "fire_burn", parent: "fire", angle: -16, r: 60, name: "余烬不熄", branch: "fire", icon: "fire_burn",
    desc: "[fire]燃烧[]多持续 {v} 跳伤害", value: (l) => `${l * 2}`,
    costs: [{ gel: 5, meat: 1 }, { gel: 10, meat: 2 }],
  },
  // --- Ice
  {
    id: "ice", parent: "grimoire", angle: 30, r: 32, name: "冰之符文", branch: "ice", icon: "ice", spell: "ice",
    desc: "点亮[rainbow]冰之符文[]！\n织出的冰霜魔法会[ice]冻住[]敌人，\n还能让水面[ice]结冰[]",
    costs: [{ stone: 10, crystal: 3 }],
  },
  {
    id: "ice_pierce", parent: "ice", angle: 16, r: 60, name: "寒霜穿刺", branch: "ice", icon: "ice_pierce",
    desc: "[ice]冰锥[]可以穿透的目标 {v}", value: plus(1),
    costs: [{ stone: 8, crystal: 2 }, { stone: 14, crystal: 4 }],
  },
  {
    id: "ice_freeze", parent: "ice", angle: 44, r: 60, name: "永冻", branch: "ice", icon: "ice_freeze",
    desc: "[ice]冰冻[]时间延长 {v} 秒", value: (l) => `${l}`,
    costs: [{ crystal: 3, fur: 2 }, { crystal: 6, fur: 4 }],
  },
  {
    id: "shatter", parent: "ice_freeze", angle: 40, r: 90, name: "碎冰冲击", branch: "ice", icon: "shatter",
    desc: "打碎[ice]冰冻[]的敌人时，\n额外伤害从 +2 变为 {v}", value: (l) => `+${2 + l * 2}`,
    costs: [{ crystal: 6, stone: 10 }],
  },
  // --- Thunder
  {
    id: "thunder", parent: "grimoire", angle: 90, r: 32, name: "雷之符文", branch: "thunder", icon: "thunder", spell: "thunder",
    desc: "点亮[rainbow]雷之符文[]！\n织出的雷电魔法会让敌人[volt]麻痹[]，\n还能唤醒[volt]远古魔法门[]",
    costs: [{ crystal: 6, fur: 3, gel: 3 }],
  },
  {
    id: "thunder_chain", parent: "thunder", angle: 76, r: 60, name: "雷链", branch: "thunder", icon: "thunder_chain",
    desc: "[volt]落雷[]额外连锁 {v} 个敌人", value: plus(1),
    costs: [{ crystal: 4, fur: 3 }, { crystal: 8, fur: 5 }],
  },
  {
    id: "thunder_dmg", parent: "thunder", angle: 104, r: 60, name: "天罚", branch: "thunder", icon: "thunder_dmg",
    desc: "所有[volt]雷电魔法[]的伤害 {v}", value: plus(1),
    costs: [{ crystal: 5, gel: 5 }, { crystal: 10, gel: 8 }],
  },
  // --- Body
  {
    id: "heart", parent: "grimoire", angle: 150, r: 32, name: "生命之心", branch: "body", icon: "heart",
    desc: "[heart]生命上限[] {v}", value: plus(1),
    costs: [{ fur: 3, crystal: 2, apple: 2 }, { fur: 5, crystal: 3, apple: 3 }, { fur: 8, crystal: 5, apple: 4 }],
  },
  {
    id: "feather", parent: "heart", angle: 136, r: 60, name: "云朵之羽", branch: "body", icon: "feather",
    desc: "空中[heart]飘浮次数[] {v}", value: plus(2),
    costs: [{ gel: 6, fur: 2, wood: 4 }, { gel: 10, fur: 4, wood: 8 }],
  },
  {
    id: "speed", parent: "heart", angle: 164, r: 60, name: "凌波微步", branch: "body", icon: "speed",
    desc: "[heart]移动速度[]提升 {v}", value: pct(10),
    costs: [{ fur: 3, wood: 6 }, { fur: 6, wood: 10 }],
  },
  // --- Harvest
  {
    id: "harvest", parent: "grimoire", angle: -150, r: 32, name: "丰收", branch: "harvest", icon: "harvest",
    desc: "打树、石头、水晶时\n[leaf]掉落材料[]的几率提升 {v}", value: pct(15),
    costs: [{ wood: 5, stone: 5 }, { wood: 10, stone: 10 }],
  },
  {
    id: "magnet", parent: "harvest", angle: -164, r: 60, name: "触手可及", branch: "harvest", icon: "magnet",
    desc: "[leaf]拾取范围[]扩大 {v}", value: pct(40),
    costs: [{ gel: 3, stone: 4 }, { gel: 6, stone: 8 }],
  },
  {
    id: "lucky", parent: "harvest", angle: -136, r: 60, name: "幸运矿脉", branch: "harvest", icon: "lucky",
    desc: "打碎石头时掉落[leaf]水晶[]的几率\n从 30% 提升到 {v}", value: () => "70%",
    costs: [{ crystal: 4, stone: 8 }],
  },
  {
    id: "flower", parent: "harvest", angle: -150, r: 90, name: "花之符文", branch: "harvest", icon: "flower", spell: "flower",
    desc: "点亮[rainbow]花之符文[]！\n织出的花之魔法会用[leaf]藤蔓[]缠住敌人，\n和[heart]小动物[]交朋友，让草木[leaf]重新生长[]",
    costs: [{ wood: 12, apple: 3, gel: 4 }],
  },
];

export const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<SkillId, Skill>;

export const maxLevel = (s: Skill) => s.costs.length;

/** Chart position of a node. */
export function skillPos(s: Skill): [number, number] {
  const a = (s.angle * Math.PI) / 180;
  return [Math.round(Math.cos(a) * s.r), Math.round(Math.sin(a) * s.r)];
}
