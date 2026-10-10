import assert from "node:assert/strict";
import { parseScript } from "../src/game/dialogue";
import { dialogueEntryBindings, syncMapCanvases } from "../src/editor/map-canvases";
import { parseGraph, serializeGraph, layoutFor, EMPTY_LAYOUT, type Graph } from "../src/editor/story-graph";
import { OBJ_INFO, type MapData } from "../src/game/mapdata";
import { ScriptDoc } from "../src/editor/script-doc";
import { MAPS } from "../src/maps";

const names = { mom: "妈妈" };
const map = (id: string, text = "talk", bark = ""): MapData => ({ id, name: `地图 ${id}`, kind: "overworld", bg: "sky", w: 100, h: 40, rows: [], objects: [{ type: "npc", kind: "mom", x: 0, y: 0, text, bark }] });
const entries = (maps: MapData[]) => new Set(maps.flatMap((m) => m.objects.flatMap((o) => [o.text, o.bark].filter(Boolean) as string[])));
function sync(g: Graph, maps: MapData[]) {
  const result = syncMapCanvases(g, maps, names);
  for (const b of result.bindings) b.obj[b.field] = b.value;
  return result;
}
function roundtrip(g: Graph, maps: MapData[]) {
  const { text, keys, starts } = serializeGraph(g);
  assert.deepEqual(parseScript(text).errors, [], "split script must remain valid");
  const layout = layoutFor(g, keys, text, starts, entries(maps));
  const restored = parseGraph(text, JSON.parse(JSON.stringify(layout)), entries(maps));
  const ids = restored.canvases.flatMap((c) => c.nodes.flatMap((n) => n.sec ? [n.sec] : []));
  assert.equal(new Set(ids).size, ids.length, "section IDs must be globally unique");
  return restored;
}
const script = `【妈妈】
== talk == 打招呼
妈妈: 你好
?met -> again
* 再见 -> 结束
* 再问 -> again
== again == 再次见面
妈妈: 又见面啦
-> talk
== mutter == 自言自语
妈妈: 天气不错
!end
== draft == 未使用的草稿
妈妈: 等以后再用
!end
`;

// Shared dialogue, choices, conditions, loops and barks all become independent.
{
  const maps = [map("village", "talk", "mutter"), map("cave", "talk", "mutter")];
  let g = parseGraph(script, EMPTY_LAYOUT, entries(maps));
  assert.ok(sync(g, maps).changed);
  assert.notEqual(maps[0].objects[0].text, maps[1].objects[0].text);
  assert.notEqual(maps[0].objects[0].bark, maps[1].objects[0].bark);
  g = roundtrip(g, maps);
  const a = g.canvases.find((c) => c.scope?.map === "village")!;
  const b = g.canvases.find((c) => c.scope?.map === "cave")!;
  assert.equal(a.nodes.filter((n) => n.type === "say").length, b.nodes.filter((n) => n.type === "say").length);
  const line = a.nodes.find((n) => n.type === "say")!.lines![0];
  line.text = "只修改村庄";
  assert.ok(!b.nodes.some((n) => n.lines?.some((l) => l.text === line.text)));
  assert.ok(g.canvases.find((c) => !c.scope)?.nodes.some((n) => n.sec === "draft"), "unused drafts survive");
  assert.ok(!b.nodes.some((n) => n.type === "jump" && ["talk", "again", "mutter"].includes(n.target!)), "copies must not jump back into original dialogue");
  assert.equal(sync(g, maps).changed, false, "reopening must not split again");
  g = roundtrip(g, maps);
  maps.push(map("forest"));
  assert.ok(sync(g, maps).changed);
  assert.equal(new Set(maps.map((m) => m.objects[0].text)).size, 3);
  assert.equal(sync(roundtrip(g, maps), maps).changed, false);
}

// Already different conversations are separated by their actual map bindings.
{
  const maps = [map("a", "one"), map("b", "two")];
  let g = parseGraph("【妈妈】\n== one ==\n妈妈: 村庄\n!end\n== two ==\n妈妈: 山洞\n!end\n", EMPTY_LAYOUT, entries(maps));
  sync(g, maps);
  g = roundtrip(g, maps);
  for (const [i, text] of ["村庄", "山洞"].entries()) {
    const c = g.canvases.find((c) => c.scope?.map === maps[i].id)!;
    assert.deepEqual(c.nodes.flatMap((n) => n.lines?.map((l) => l.text) ?? []), [text]);
  }
}

// Empty/new maps get an editable entry; multiple instances in one map share it.
{
  const maps = [map("a", ""), map("b", "")];
  maps[1].objects.push({ ...maps[1].objects[0] });
  let g: Graph = { preamble: "", canvases: [] };
  sync(g, maps);
  assert.ok(maps[0].objects[0].text);
  assert.notEqual(maps[0].objects[0].text, maps[1].objects[0].text);
  assert.equal(maps[1].objects[0].text, maps[1].objects[1].text);
  g = roundtrip(g, maps);
  assert.equal(sync(g, maps).changed, false);
}

// Single-map people and unrelated event canvases remain unchanged.
{
  const maps = [map("a", "", "mutter"), map("b", "", "mutter")];
  const g = parseGraph("【妈妈】\n== mutter ==\n妈妈: 自言自语\n!end\n", EMPTY_LAYOUT, entries(maps));
  sync(g, maps);
  for (const m of maps) assert.notEqual(m.objects[0].text, m.objects[0].bark, "barks must not become the conversation entry");
  assert.equal(sync(roundtrip(g, maps), maps).changed, false);
}

// Single-map people also receive automatic entries without changing their lines.
{
  const maps = [map("a")];
  let g = parseGraph(script, EMPTY_LAYOUT, entries(maps));
  const before = g.canvases.flatMap((c) => c.nodes.flatMap((n) => n.lines?.map((l) => l.text) ?? [])).sort();
  assert.equal(sync(g, maps).changed, true);
  g = roundtrip(g, maps);
  assert.equal(maps[0].objects[0].text, "talk");
  assert.deepEqual(g.canvases.flatMap((c) => c.nodes.flatMap((n) => n.lines?.map((l) => l.text) ?? [])).sort(), before);
  assert.equal(sync(g, maps).changed, false);
}

// A new single-map NPC, or a stale deleted entry, gets an editable start.
for (const text of ["", "missing_section"]) {
  const maps = [map("a", text)];
  const g: Graph = { preamble: "", canvases: [] };
  sync(g, maps);
  assert.ok(g.canvases[0].nodes.some((n) => n.type === "start" && n.sec === maps[0].objects[0].text));
  assert.equal(sync(roundtrip(g, maps), maps).changed, false);
}

// Selecting a different start changes only this map/person and preserves barks.
{
  const maps = [map("a", "talk", "mutter"), map("b", "talk", "mutter")];
  maps[0].objects.push({ type: "npc", kind: "other", x: 30, y: 0, text: "talk" });
  let g = parseGraph(script, EMPTY_LAYOUT, entries(maps));
  sync(g, maps);
  g = roundtrip(g, maps);
  const c = g.canvases.find((c) => c.scope?.map === "a")!;
  const alternate = c.nodes.find((n) => n.sec === "mutter")!;
  const beforeB = maps[1].objects[0].text;
  const bindings = dialogueEntryBindings(c, alternate.sec!, maps, names);
  assert.equal(bindings.length, 1);
  for (const b of bindings) b.obj[b.field] = b.value;
  assert.equal(maps[0].objects[0].text, "mutter");
  assert.equal(maps[0].objects[0].bark, "mutter");
  assert.equal(maps[1].objects[0].text, beforeB);
  assert.equal(maps[0].objects[1].text, "talk");
  assert.equal(sync(roundtrip(g, maps), maps).changed, false);
  assert.deepEqual(dialogueEntryBindings(c, "not_a_start", maps, names), []);
}

assert.ok(!OBJ_INFO.npc.props.some((p) => p.key === "text"));
assert.ok(OBJ_INFO.trigger.props.some((p) => p.key === "text"));
assert.ok(OBJ_INFO.npc.props.some((p) => p.key === "bark"));
assert.equal(OBJ_INFO.npc.defaults?.text, undefined);

// An unassigned start that shares a tail keeps its connection after the split.
{
  const maps = [map("a"), map("b")];
  const g = parseGraph("【妈妈】\n== talk ==\n妈妈: 开始\n-> tail\n== draft ==\n妈妈: 草稿\n-> tail\n== tail ==\n妈妈: 共同结尾\n!end\n", EMPTY_LAYOUT, entries(maps));
  sync(g, maps);
  const restored = roundtrip(g, maps);
  const draft = restored.canvases.find((c) => !c.scope)!;
  assert.ok(draft.nodes.some((n) => n.type === "jump" && n.target), "leftover links must not silently become end nodes");
}

console.log("Map dialogue regression checks passed (shared flows, independent edits, map-specific roots, drafts, new maps, reloads).");

// Saving must publish script/layout before the maps that reference them, retain
// failed map writes for retry, and not publish links from a newer edit too soon.
{
  Object.assign(globalThis, {
    document: { createElement: () => ({}) },
    window: { addEventListener: () => {}, setTimeout: () => 0 },
  });
  const m = map("save-test");
  MAPS[m.id] = m;
  const doc = new ScriptDoc();
  const old = doc.mapBindings();
  const requests: string[] = [];
  let failMap = true;
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    return new Response("test", { status: url === "/__maps/save" && failMap ? 500 : 200 });
  }) as typeof fetch;
  doc.set("【妈妈】\n== separate ==\n妈妈: 独立\n!end\n", null);
  doc.setMapBindings([{ map: m.id, obj: m.objects[0], field: "text", value: "separate" }]);
  await doc.saveNow();
  assert.equal(doc.state, "error");
  assert.deepEqual(requests, ["/__story/script", "/__story/layout", "/__maps/save"]);
  failMap = false;
  await doc.saveNow();
  assert.equal(doc.state, "saved");
  assert.equal(requests.at(-1), "/__maps/save");
  doc.setMapBindings(old);
  assert.equal(m.objects[0].text, "talk", "undo restores the map entry as well as the graph");
  let release!: () => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => began = resolve);
  const pending = new Promise<void>((resolve) => release = resolve);
  requests.length = 0;
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    if (url === "/__story/script") { began(); await pending; }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  doc.set("【妈妈】\n== older ==\n妈妈: 旧版本\n!end\n", null);
  const saving = doc.saveNow();
  await started;
  doc.set("【妈妈】\n== newer ==\n妈妈: 新版本\n!end\n", null);
  doc.setMapBindings([{ map: m.id, obj: m.objects[0], field: "text", value: "newer" }]);
  release();
  await saving;
  assert.ok(!requests.includes("/__maps/save"), "new links must wait for the new script");
  await doc.saveNow();
  assert.equal(doc.state, "saved");
  assert.equal(requests.at(-1), "/__maps/save");
  console.log("Map save checks passed (ordering, retry, undo bindings, concurrent edits).");
}
