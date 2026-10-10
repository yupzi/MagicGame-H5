/** Looks for the story editor's node mode (node-editor.ts). */
export const NODE_CSS = `
.nd-shell { flex: 1; min-width: 0; display: grid; grid-template-columns: 210px minmax(0, 1fr) 392px; height: 100%; }

/* ---------- people and events */
.nd-side { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid #3d2f5a; background: #1c1430; }
.nd-side-head { padding: 10px; border-bottom: 1px solid #3d2f5a; }
.nd-list { flex: 1; overflow: auto; padding: 4px 8px 30px; display: flex; flex-direction: column; gap: 4px; }
.nd-group { color: #ffd36e; font-weight: bold; margin: 12px 2px 2px; letter-spacing: .05em; }
.nd-canvas { display: flex; align-items: center; gap: 8px; text-align: left; border-radius: 8px; padding: 5px 8px !important; background: #251b3d !important; border: 1px solid transparent !important; }
.nd-canvas:hover { border-color: #6c56a0 !important; }
.nd-canvas.on { background: #3a2b62 !important; border-color: #ffe478 !important; }
.nd-map-children { display: flex; flex-direction: column; gap: 4px; margin-left: 15px; padding-left: 5px; border-left: 1px solid #594577; }
.nd-map-child { width: 100%; }
.nd-map-icon { color: #a48dc8; }
.nd-canvas-title { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ffe478; font-size: 12px; }
.nd-canvas i { font-style: normal; font-size: 12px; } .nd-canvas .nd-off { color: #6f6388; }
.nd-canvas-name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.nd-canvas-name b { font-weight: normal; color: #fff6e8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nd-canvas-name small { color: #9d8cbc; font-size: 11px; }
.nd-avatar { width: 22px; height: 30px; image-rendering: pixelated; flex: none; display: inline-grid; place-items: center; }
.nd-event, .nd-noface { font-size: 16px; }
.nd-new { border-radius: 8px; border-style: dashed !important; color: #c9a0ff !important; background: transparent !important; }

/* ---------- canvas */
.nd-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.nd-toolbar { display: flex; align-items: center; gap: 5px; padding: 6px 10px; border-bottom: 1px solid #3d2f5a; background: #1c1430; }
.nd-toolbar { flex-wrap: wrap; }
.nd-toolbar button { border-radius: 5px; padding: 3px 9px !important; }
.nd-zoom { width: 44px; text-align: center; color: #b9a8d6; font-size: 12px; }
.nd-hint { margin-left: auto; color: #8f80a8; font-size: 12px; }
.nd-hint.warn { color: #ffcf96; }
.nd-viewport { flex: 1; position: relative; overflow: hidden; cursor: grab; background-color: #171126; background-image: radial-gradient(#34285299 1.2px, transparent 1.2px); background-size: 22px 22px; }
.nd-viewport.panning { cursor: grabbing; }
.nd-viewport { user-select: none; -webkit-user-select: none; }
.nd-viewport input, .nd-viewport textarea, .nd-viewport [contenteditable="true"] { user-select: text; -webkit-user-select: text; }
.nd-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.nd-edges { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; }
.nd-edge { fill: none; stroke: #9b8bc8; stroke-width: 2.2; pointer-events: none; }
.nd-edge.e-option { stroke: #5fd0c4; } .nd-edge.e-yes { stroke: #7ad38a; } .nd-edge.e-no { stroke: #e38a8a; }
.nd-edge.nd-temp { stroke: #ffe478; stroke-dasharray: 6 4; }
.nd-hit { fill: none; stroke: transparent; stroke-width: 12; cursor: pointer; pointer-events: stroke; }
.nd-hit:hover { stroke: #ffe47833; }
.nd-layer { position: absolute; left: 0; top: 0; }
.nd-node { position: absolute; box-sizing: border-box; background: #2a2044; border: 2px solid #3f3163; border-radius: 10px; box-shadow: 0 6px 16px #0006; cursor: default; font-size: 12px; }
.nd-node header { display: flex; align-items: center; gap: 7px; padding: 6px 10px; border-radius: 8px 8px 0 0; background: color-mix(in srgb, var(--c) 70%, #1a1230); color: #fff; }
.nd-node header b { flex: 1; min-width: 0; font-weight: normal; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nd-node header code, .nd-node header small { color: #ffffffb0; font: 11px Consolas, monospace; }
.nd-ico { width: 20px; height: 20px; border-radius: 5px; display: inline-grid; place-items: center; background: #0003; color: #fff; font-size: 12px; flex: none; }
.nd-ins-head .nd-ico { background: var(--c); }
.nd-body { padding: 7px 10px; color: #e3d8f7; line-height: 1.55; }
.nd-body p { margin: 2px 0; overflow-wrap: anywhere; }
.nd-body small { color: #ff9ac2; margin-left: 2px; }
.nd-who { display: inline-block; padding: 0 4px; border-radius: 3px; background: var(--c); color: #fff; font-size: 11px; margin-right: 3px; }
.nd-muted, .nd-body em { color: #8f80a8; font-style: normal; }
.nd-use { color: #b8f5a0; }
.nd-cond { color: #ffcf96; font: 11px Consolas, monospace; }
.nd-bad { color: #ff9fb3; }
.nd-opt { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 3px -10px 3px 0; padding: 3px 0 3px 8px; border-left: 3px solid #2f9e96; background: #1f2d3a; border-radius: 3px 0 0 3px; }
.nd-out { display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding: 2px 0 6px; margin-right: -2px; color: #9d8cbc; font-size: 11px; }
.nd-out.yes span { color: #9fe3ac; } .nd-out.no span { color: #f0a4a4; }
.nd-out.yes { padding-bottom: 0; }
.nd-dot { width: 13px; height: 13px; border-radius: 50%; border: 2px solid var(--c); background: #171126; margin-right: -8px; cursor: crosshair; flex: none; box-sizing: border-box; }
.nd-dot.on { background: var(--c); }
.nd-dot:hover { transform: scale(1.35); }
.nd-opt .nd-dot { border-color: #5fd0c4; } .nd-opt .nd-dot.on { background: #5fd0c4; }
.nd-out.yes .nd-dot { border-color: #7ad38a; } .nd-out.yes .nd-dot.on { background: #7ad38a; }
.nd-out.no .nd-dot { border-color: #e38a8a; } .nd-out.no .nd-dot.on { background: #e38a8a; }
.nd-in { position: absolute; left: -8px; top: 12px; width: 13px; height: 13px; border-radius: 50%; border: 2px solid #9b8bc8; background: #171126; box-sizing: border-box; }
.nd-node.sel { border-color: #ffe478; box-shadow: 0 0 0 3px #ffe47833, 0 8px 20px #0008; }
.nd-node.playing { border-color: #7ad38a; box-shadow: 0 0 0 4px #7ad38a55, 0 0 24px #7ad38a66; }
.nd-node.bad { border-color: #e0566f; }
.nd-node.pending .nd-dot { animation: ndBlink .6s steps(2) infinite; }
@keyframes ndBlink { 50% { background: #ffe478; } }
.nd-t-start { border-radius: 22px 10px 10px 22px; }
.nd-t-start header { border-radius: 20px 8px 0 0; }
.nd-t-end { border-radius: 10px 22px 22px 10px; }

.nd-menu { position: absolute; z-index: 10; display: none; min-width: 180px; max-width: 330px; background: #241a3b; border: 1px solid #8a6fd0; border-radius: 8px; box-shadow: 0 10px 30px #000a; padding: 6px; cursor: default; }
.nd-menu.show { display: block; }
.nd-menu > button { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: 0 !important; background: transparent !important; border-radius: 5px; }
.nd-menu > button:hover { background: #3a2b62 !important; }
.nd-menu .danger { color: #ff9fb3 !important; }
.nd-menu .nd-avatar { width: 15px; height: 20px; }
.nd-menu-title { color: #ffe478; padding: 2px 6px 6px; }
.nd-menu-tip { color: #8f80a8; font-size: 11px; padding: 4px 6px 0; }
.nd-menu-group { color: #9d8cbc; font-size: 11px; margin: 6px 6px 3px; }
.nd-menu-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.nd-menu-grid button { display: flex; align-items: center; gap: 5px; padding: 5px 6px !important; border-radius: 6px; font-size: 12px; border-color: #3f3163 !important; }
.nd-menu-grid button span { width: 18px; height: 18px; border-radius: 4px; display: inline-grid; place-items: center; background: var(--c); color: #fff; font-size: 11px; }
.nd-menu-grid button:hover { border-color: var(--c) !important; }

/* ---------- right: stage and properties */
.nd-right { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid #3d2f5a; background: #1c1430; }
.nd-right .sc-preview { padding: 10px 14px 8px; border-bottom: 1px solid #3d2f5a; display: flex; flex-direction: column; gap: 6px; }
.nd-inspector { flex: 1; overflow: auto; padding: 10px 14px 40px; }
.nd-empty { color: #b9a8d6; } .nd-empty b { color: #ffe478; font-size: 15px; font-weight: normal; } .nd-empty p { margin: 8px 0; font-size: 12px; }
.nd-ins-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.nd-ins-head b { font-weight: normal; font-size: 15px; color: #fff6e8; }
.nd-ins-head small { flex-basis: 100%; color: #9d8cbc; font-size: 11px; }
.nd-del { margin-left: auto; color: #ff9fb3 !important; border-color: #8a4458 !important; border-radius: 5px; padding: 2px 10px !important; }
.nd-field { display: flex; flex-direction: column; gap: 3px; margin: 8px 0; color: #b9a8d6; font-size: 12px; }
.nd-field input, .nd-field select, .nd-field textarea { width: 100%; border-radius: 5px; }
.nd-field textarea { resize: vertical; }
.nd-row { display: flex; gap: 5px; } .nd-row input, .nd-row select { flex: 1; min-width: 0; }
.nd-uses { background: #1f2d3a; border-radius: 6px; padding: 6px 10px; margin: 8px 0; font-size: 12px; color: #d8cbee; }
.nd-uses b { color: #b8f5a0; font-weight: normal; } .nd-uses p { margin: 3px 0; }
.nd-lines { display: flex; flex-direction: column; gap: 6px; }
.nd-line { border: 1px solid #3f3163; border-radius: 8px; padding: 5px; background: #221938; }
.nd-line.on { border-color: #ffe478; }
.nd-line-top { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
.nd-line-top select { padding: 2px 4px !important; border-radius: 4px; }
.nd-line-top select:first-of-type { border-left: 4px solid var(--c) !important; max-width: 118px; }
.nd-line-top button { padding: 1px 6px !important; border-radius: 4px; font-size: 11px; }
.nd-line-top button:disabled { opacity: .35; }
.nd-think.on { background: #5b3fa0 !important; border-color: #c9a0ff !important; }
.nd-grow { flex: 1; }
.nd-line-no { color: #7f6fa6; font: 11px Consolas, monospace; width: 16px; text-align: right; flex: none; }
.nd-line textarea { width: 100%; box-sizing: border-box; resize: vertical; border-radius: 5px; font-size: 14px !important; line-height: 1.5; background: #17112a !important; }
.nd-add { width: 100%; margin-top: 6px; border-radius: 6px; border-style: dashed !important; color: #c9a0ff !important; }
.nd-choice-row { display: grid; grid-template-columns: 18px 1fr auto auto; gap: 4px; align-items: center; margin: 5px 0; }
.nd-choice-row input { border-radius: 5px; }
.nd-choice-row small { grid-column: 2 / 5; color: #8f80a8; font-size: 11px; }
.nd-choice-row button { padding: 1px 7px !important; border-radius: 4px; }
.nd-more { margin-top: 14px; color: #b9a8d6; } .nd-more summary { cursor: pointer; font-size: 12px; }
.nd-inspector .nd-muted { font-size: 12px; }

@media (max-width: 1150px) {
  .nd-shell { grid-template-columns: 180px minmax(0, 1fr) 340px; }
}
`;
