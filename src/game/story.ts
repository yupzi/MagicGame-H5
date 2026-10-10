import raw from "../story/content.json";

export interface StoryAction { name: string; args: string[] }
export interface QuestStage {
  id: string;
  title: string;
  hint: string;
  /** Same conditions used by dialogue branches: flags, items, day and period. */
  condition: string;
  autoAdvance: boolean;
}
export interface QuestDef { id: string; title: string; stages: QuestStage[] }
export interface PeriodDef { id: string; name: string }
export interface TimelineEvent {
  id: string;
  /** 0 means every day. Each event fires at most once per matching day. */
  day: number;
  period: string;
  condition: string;
  /** A script section to play. */
  dialogue: string;
  actions: StoryAction[];
}
/** Quests and day/period events. The dialogue itself lives in src/story/script.txt. */
export interface StoryContent {
  version: number;
  quests: QuestDef[];
  periods: PeriodDef[];
  timeline: TimelineEvent[];
}

/** In-memory copy, shared by the editor and the running game. */
export const STORY: StoryContent = structuredClone(raw) as StoryContent;

export function periodName(id: string) {
  return STORY.periods.find((p) => p.id === id)?.name ?? id;
}

export function questDef(id: string) {
  return STORY.quests.find((q) => q.id === id);
}

/** Problems in quests and events; `sections` are the script's section ids. */
export function storyErrors(story: StoryContent, sections: Set<string>): string[] {
  const errors: string[] = [];
  const questIds = new Set<string>();
  const periodIds = new Set<string>();
  for (const p of story.periods) {
    if (!p.id || periodIds.has(p.id)) errors.push(`时段 ID 重复或为空：${p.id}`);
    periodIds.add(p.id);
  }
  for (const q of story.quests) {
    if (!q.id || questIds.has(q.id)) errors.push(`任务 ID 重复或为空：${q.id}`);
    questIds.add(q.id);
    if (!q.stages.length) errors.push(`任务 ${q.id} 没有阶段`);
    const stages = new Set<string>();
    for (const stage of q.stages) {
      if (!stage.id || stages.has(stage.id)) errors.push(`任务 ${q.id} 的阶段 ID 重复或为空：${stage.id}`);
      stages.add(stage.id);
      if (stage.autoAdvance && !stage.condition) errors.push(`任务 ${q.id} 的自动推进阶段需要条件：${stage.id}`);
    }
  }
  const eventIds = new Set<string>();
  for (const event of story.timeline) {
    if (!event.id || eventIds.has(event.id)) errors.push(`时间事件 ID 重复或为空：${event.id}`);
    eventIds.add(event.id);
    if (!periodIds.has(event.period)) errors.push(`事件 ${event.id} 的时段不存在`);
    if (!Number.isInteger(event.day) || event.day < 0) errors.push(`事件 ${event.id} 的天数不正确`);
    if (event.dialogue && !sections.has(event.dialogue)) errors.push(`事件 ${event.id} 的对话不存在`);
  }
  return errors;
}
