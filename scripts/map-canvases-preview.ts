import { MAPS } from "../src/maps";
import { ScriptDoc } from "../src/editor/script-doc";
import { NodeEditor } from "../src/editor/node-editor";
import { NODE_CSS } from "../src/editor/node-editor-style";
import { SCRIPT_CSS } from "../src/editor/script-editor-style";
import { EMPTY_LAYOUT } from "../src/editor/story-graph";
import { installPixelUi } from "../src/game/pixelui";

// This harness deliberately intercepts every editor write, including unload beacons.
// No test NPC, script or layout is ever saved into project files.
const key = "map-dialogue-preview";
const stored = JSON.parse(sessionStorage.getItem(key) ?? "{}");
const persist = (url: string, body: string) => {
  if (url === "/__maps/save") (stored.maps ??= {})[JSON.parse(body).id] = JSON.parse(body);
  else stored[url] = body;
  sessionStorage.setItem(key, JSON.stringify(stored));
};
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("/__")) {
    persist(url, String(init?.body ?? ""));
    return new Response("{}", { status: 200 });
  }
  return originalFetch(input, init);
};
navigator.sendBeacon = () => true;
for (const id of Object.keys(MAPS)) delete MAPS[id];
for (const [id, name] of [["village", "村庄"], ["cave", "山洞"]]) MAPS[id] = stored.maps?.[id] ?? {
  id, name, kind: "overworld", bg: "sky", w: 100, h: 40, rows: [], objects: [{ type: "npc", kind: "mom", x: 40, y: 100, text: "talk", bark: "mutter" }],
};
const style = document.createElement("style");
style.textContent = SCRIPT_CSS + NODE_CSS;
document.head.append(style);
installPixelUi();
const doc = new ScriptDoc();
doc.setLayout(JSON.parse(stored["/__story/layout"] ?? JSON.stringify(EMPTY_LAYOUT)));
doc.set(stored["/__story/script"] ?? `【妈妈】
== talk == 打招呼
妈妈: 这是两个地图起初共用的一句台词。
* 继续聊 -> again
* 再见 -> 结束
== again ==
妈妈: 这也是各地图独立的后续台词。
!end
== mutter == 自言自语
妈妈: 今天天气真好。
!end
`, null);
doc.onStatus((text) => document.querySelector("#status")!.textContent = text);
const editor = new NodeEditor(doc, { play: () => {} });
editor.mount(document.querySelector("#editor")!);
document.querySelector<HTMLButtonElement>("#reset")!.onclick = () => { sessionStorage.removeItem(key); location.reload(); };
document.querySelector<HTMLButtonElement>("#save")!.onclick = () => void doc.saveNow();
document.querySelector<HTMLButtonElement>("#reopen")!.onclick = () => { editor.unmount(); editor.mount(document.querySelector("#editor")!); };
