import { sfx } from "./engine/audio";
import { Input } from "./engine/input";
import { Editor } from "./editor/editor";
import { PANEL_W } from "./editor/style";
import { Game, VH, VW } from "./game/game";
import { buildSprites } from "./game/sprites";

const STEP = 1 / 60;

const canvas = document.getElementById("game") as HTMLCanvasElement;
const overlay = document.getElementById("overlay")!;
canvas.width = VW;
canvas.height = VH;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

function resize() {
  const panel = document.body.classList.contains("editing") ? PANEL_W : 0;
  const scale = Math.max(1, Math.floor(Math.min((window.innerWidth - panel) / VW, (window.innerHeight - 40) / VH)));
  canvas.style.width = `${VW * scale}px`;
  canvas.style.height = `${VH * scale}px`;
}
window.addEventListener("resize", resize);
resize();

buildSprites();
const input = new Input();
const game = new Game(input, document.getElementById("wrap")!);

let started = false;
function start() {
  sfx.init();
  if (started) return;
  started = true;
  game.started = true;
  overlay.classList.add("hidden");
}
input.onAnyKey = start;
overlay.addEventListener("pointerdown", start);

// The map editor lives behind F2 while developing (it saves through the dev server).
const editor = import.meta.env.DEV ? new Editor(game, canvas, resize) : null;
window.addEventListener("keydown", (e) => {
  if (e.code === "F2" && editor) start();
  // F3 goes straight to the story editor (dialogue script, quests, events).
  if (e.code === "F3" && editor) {
    e.preventDefault();
    start();
    editor.openStory();
  }
  // F4 wipes the save and starts over, no questions asked (development only).
  if (e.code === "F4" && import.meta.env.DEV && !editor?.open) {
    e.preventDefault();
    game.resetSave();
  }
});

// Exposed for debugging from the console.
(window as unknown as { game: Game; editor: Editor | null }).game = game;
(window as unknown as { editor: Editor | null }).editor = editor;

let last = performance.now();
let acc = 0;
function frame(now: number) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  if (editor?.open) {
    editor.update(acc);
    acc = 0;
    editor.render(ctx);
  } else {
    while (acc >= STEP) {
      game.tick(STEP);
      acc -= STEP;
    }
    game.render(ctx);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
