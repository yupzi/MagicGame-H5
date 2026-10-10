import { STORY } from "../game/story";
import { ITEM_NAMES, SCRIPT_DATA } from "../game/dialogue";

const flags: Record<string, string> = { wand: "已获得法杖", bridge: "桥已修好", boss: "已打败首领", school: "已入学", fire: "已学会火魔法", ice: "已学会冰魔法", thunder: "已学会雷魔法", intro: "已完成开场" };
const operators: Record<string, string> = { ">=": "至少", "=": "等于", "<=": "至多", ">": "大于", "<": "小于" };
export function describeCondition(condition: string): string {
  return condition.split(/[\s,&]+/).filter(Boolean).map(part => {
    const quest = part.match(/^quest:([\w-]+)=(done|active|\d+)$/);
    if (quest) { const def = STORY.quests.find(q => q.id === quest[1]); return `${def?.title || quest[1]} · ${quest[2] === "done" ? "已完成" : quest[2] === "active" ? "进行中" : def?.stages[Number(quest[2])]?.title || "指定阶段"}`; }
    if (part.startsWith("period=")) return `时段是${STORY.periods.find(p => p.id === part.slice(7))?.name || part.slice(7)}`;
    const amount = part.match(/^(.+?)(>=|<=|>|<|=)(\d+)$/);
    if (amount) return `${amount[1] === "day" ? "天数" : amount[1]}${operators[amount[2]]}${amount[3]}`;
    return part.startsWith("!") ? `未满足「${flags[part.slice(1)] || part.slice(1)}」` : flags[part] || part;
  }).join("，并且") || "默认情境 · 其他条件都不满足时";
}

export function renderConditions(parent: HTMLElement, condition: string, commit: (value: string) => void, fallback = true) {
  const parts = condition.split(/[\s,&]+/).filter(Boolean);
  const box = document.createElement("section"); box.className = "dg-conditions"; parent.append(box);
  const title = document.createElement("h3"); title.textContent = "需要同时满足"; box.append(title);
  const select = (host: HTMLElement, label: string, options: [string, string][], value: string, change: (v: string) => void) => {
    const el = document.createElement("select"); el.setAttribute("aria-label", label);
    if (!options.some(([id]) => id === value)) options.unshift([value, value || "请选择"]);
    for (const [id, name] of options) el.add(new Option(name, id));
    el.value = value; el.onchange = () => change(el.value); host.append(el); return el;
  };
  parts.forEach((part, index) => {
    const row = document.createElement("div"); row.className = "dg-condition-row"; box.append(row);
    const replace = (value: string) => { parts[index] = value; commit(parts.join(" ")); };
    const amount = part.match(/^(.+?)(>=|<=|>|<|=)(\d+)$/);
    const quest = part.match(/^quest:([\w-]+)=(done|active|\d+)$/);
    const category = quest ? "quest" : part.startsWith("period=") ? "period" : amount ? amount[1] === "day" ? "day" : "item" : "flag";
    select(row, "条件类型", [["flag", "剧情标记"], ["item", "持有物品"], ["quest", "任务状态"], ["day", "天数"], ["period", "时段"]], category, value => replace({ flag: "wand", item: "木头>=1", quest: `quest:${STORY.quests[0]?.id || "task"}=active`, day: "day>=1", period: `period=${STORY.periods[0]?.id || "morning"}` }[value]!));
    if (category === "quest" && quest) {
      select(row, "任务", STORY.quests.map(q => [q.id, q.title]), quest[1], value => replace(`quest:${value}=active`));
      select(row, "任务状态", [["active", "进行中"], ["done", "已完成"], ...(STORY.quests.find(q => q.id === quest[1])?.stages.map((s, i) => [String(i), s.title] as [string, string]) || [])], quest[2], value => replace(`quest:${quest[1]}=${value}`));
    } else if (category === "period") select(row, "时段", STORY.periods.map(p => [p.id, p.name]), part.slice(7), value => replace(`period=${value}`));
    else if (amount) {
      if (category === "item") select(row, "物品", Object.keys(ITEM_NAMES).filter(name => /[^a-z]/i.test(name)).map(name => [name, name]), amount[1], value => replace(`${value}${amount[2]}${amount[3]}`));
      select(row, "比较", Object.entries(operators), amount[2], value => replace(`${amount[1]}${value}${amount[3]}`));
      const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.value = amount[3]; input.setAttribute("aria-label", "数量或天数"); input.onchange = () => replace(`${amount[1]}${amount[2]}${Math.max(0, Math.floor(Number(input.value) || 0))}`); row.append(input);
    } else {
      const key = part.replace(/^!/, "");
      const known = new Set([...Object.keys(flags), ...Object.values(SCRIPT_DATA).flatMap(lines => lines.flatMap(line => line.t === "cmd" && ["flag", "unflag"].includes(line.name) ? line.args : []))]);
      select(row, "剧情标记", [...known].map(id => [id, flags[id] || id]), key, value => replace(`${part.startsWith("!") ? "!" : ""}${value}`));
      select(row, "是否满足", [["yes", "已满足"], ["no", "未满足"]], part.startsWith("!") ? "no" : "yes", value => replace(`${value === "no" ? "!" : ""}${key}`));
    }
    const remove = document.createElement("button"); remove.textContent = "移除"; remove.onclick = () => { parts.splice(index, 1); commit(parts.join(" ")); }; row.append(remove);
  });
  if (!parts.length) { const text = document.createElement("p"); text.textContent = fallback ? "没有条件，作为默认情境。" : "未添加判断条件，目前总是成立。"; box.append(text); }
  const add = document.createElement("button"); add.textContent = "＋ 添加条件"; add.onclick = () => commit([...parts, "day>=1"].join(" ")); box.append(add);
  const advanced = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "高级：条件表达式"; advanced.append(summary);
  const input = document.createElement("input"); input.value = condition; input.setAttribute("aria-label", "条件表达式"); input.onchange = () => commit(input.value.trim()); advanced.append(input); box.append(advanced);
}
