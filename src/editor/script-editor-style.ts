/** Looks for the story editor's dialogue tab (script-editor.ts). */
export const SCRIPT_CSS = `
.sc-shell { flex: 1; min-width: 0; display: grid; grid-template-columns: 236px minmax(0, 1fr) 392px; height: 100%; }

/* ---------- outline */
.sc-outline { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid #3d2f5a; background: #1c1430; }
.sc-outline-head { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-bottom: 1px solid #3d2f5a; }
.sc-search { width: 100%; border-radius: 6px; }
.sc-add { border-radius: 6px; color: #ffe478 !important; }
.sc-outline-list { flex: 1; overflow: auto; padding: 6px 8px 40px; display: flex; flex-direction: column; gap: 3px; }
.sc-chapter { margin-top: 12px; background: transparent !important; border: 0 !important; border-bottom: 1px dashed #5b4884 !important; color: #ffd36e !important; text-align: left; font-weight: bold; letter-spacing: .05em; padding: 4px 2px !important; }
.sc-chapter:first-child { margin-top: 0; }
.sc-sec { display: flex; flex-direction: column; align-items: stretch; gap: 3px; text-align: left; border-radius: 6px; padding: 6px 8px !important; background: #251b3d !important; border: 1px solid transparent !important; }
.sc-sec:hover { border-color: #6c56a0 !important; }
.sc-sec.on { background: #3a2b62 !important; border-color: #ffe478 !important; }
.sc-sec-top { display: flex; justify-content: space-between; gap: 6px; }
.sc-sec-top b { color: #fff6e8; font-weight: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-sec small { color: #9d8cbc; flex: none; }
.sc-sec code { color: #a98fd6; font: 11px Consolas, monospace; }
.sc-badges { display: flex; flex-wrap: wrap; gap: 3px; }
.sc-badges span { font-size: 11px; line-height: 16px; padding: 0 5px; border-radius: 8px; background: #2f4a3c; color: #b8f5a0; white-space: nowrap; }
.sc-badges .b-trigger, .sc-badges .b-time { background: #2e3f5c; color: #a9d4ff; }
.sc-badges .b-bark { background: #4a3a2c; color: #ffd9a0; }
.sc-badges .b-unused { background: #3a3346; color: #9d93ad; }
.sc-badges .b-err { background: #5c2436; color: #ffb3c3; }
.sc-hit { text-align: left; margin-left: 10px; font-size: 12px; color: #d8cbee !important; background: #1e1733 !important; border: 0 !important; border-left: 2px solid #ffe478 !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sc-empty { color: #8f80a8; padding: 12px; text-align: center; }

/* ---------- script */
.sc-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #15101f; }
.sc-toolbar { display: flex; align-items: center; gap: 10px; padding: 7px 14px; border-bottom: 1px solid #3d2f5a; color: #b9a8d6; font-size: 12px; position: relative; }
.sc-tip { flex: 1; min-width: 0; }
.sc-tip b { color: #ffe9a8; font-weight: normal; }
.sc-toolbar kbd { font: 11px Consolas, monospace; background: #2c2245; border: 1px solid #54437a; border-bottom-width: 2px; border-radius: 3px; padding: 0 4px; color: #fff6e8; }
.sc-help summary { cursor: pointer; color: #ffe478; white-space: nowrap; }
.sc-help-body { position: absolute; right: 12px; top: 34px; z-index: 5; width: 430px; background: #261c3f; border: 1px solid #6a4fb0; border-radius: 8px; padding: 8px 14px; box-shadow: 0 10px 30px #0009; color: #d8cbee; }
.sc-help-body p { margin: 6px 0; } .sc-help-body b { color: #ffe9a8; font-weight: normal; font-family: Consolas, "Microsoft YaHei", monospace; }
.sc-banner { display: none; padding: 8px 14px; background: #5c2436; color: #fff; }
.sc-banner.show { display: block; } .sc-banner button { margin-left: 8px; }
.sc-scroll { flex: 1; overflow: auto; position: relative; }
.sc-stack { position: relative; min-height: 100%; }
.sc-hl, .sc-input {
  box-sizing: border-box; margin: 0; border: 0; padding: 14px 24px 50vh 64px;
  font: 15px/26px "Microsoft YaHei", "PingFang SC", sans-serif; letter-spacing: 0; tab-size: 4;
  white-space: pre-wrap; word-break: break-all; overflow-wrap: anywhere;
}
.sc-hl { color: #efe6ff; pointer-events: none; }
#story-editor .sc-input {
  position: absolute; inset: 0; width: 100%; height: 100%; resize: none; overflow: hidden; outline: none;
  background: transparent; color: transparent; caret-color: #ffe478; border: 0; padding: 14px 24px 50vh 64px;
  font: 15px/26px "Microsoft YaHei", "PingFang SC", sans-serif;
}
.sc-input::selection { background: #6a4fb099; color: transparent; }
.ln { position: relative; min-height: 26px; }
.ln::before { content: attr(data-n); position: absolute; left: -58px; width: 40px; text-align: right; color: #54467a; font: 11px/26px Consolas, monospace; }
.ln.cur { background: #ffffff0a; } .ln.cur::before { color: #ffe478; }
.ln.in-sec { box-shadow: inset 3px 0 0 #6a4fb0; }
.ln.err::before { content: "●"; color: #ff6b8a; }
.ln.warn::before { content: "▲"; color: #ffc864; }
.ln.err > span { text-decoration: underline wavy #ff6b8a; text-underline-offset: 5px; }
.ln.warn .t-name { text-decoration: underline wavy #ffc864; text-underline-offset: 5px; }
.k-section { background: linear-gradient(90deg, #3b2a66, #3b2a6600 80%); }
.k-chapter { background: linear-gradient(90deg, #5a4214, #5a421400 80%); }
.t-comment { color: #6f6388; }
.t-chapter { color: #ffd36e; }
.t-punct { color: #7f6fa6; }
.t-id { color: #ffe478; }
.t-title { color: #d9c6ff; }
.t-name { color: var(--f, #1d1430); background: var(--c); border-radius: 4px; box-shadow: 0 0 0 2px var(--c); }
.t-narrator { color: #a9d4ff; }
.t-narration { color: #a9d4ff; }
.t-expr { color: #ff9ac2; }
.t-text { color: #fff6e8; }
.t-thought { color: #b9aee0; }
.t-mark, .t-arrow { color: #8de2d8; }
.t-choice { color: #b9fff4; }
.t-target { color: #ffe478; text-decoration: underline dotted #ffe47888; text-underline-offset: 4px; }
.t-cond { color: #ffb86c; }
.t-cmd { color: #ff8ab8; }
.t-args { color: #ffc6dc; }

.sc-popup { position: absolute; z-index: 6; display: none; min-width: 220px; max-width: 320px; max-height: 280px; overflow: auto; background: #241a3b; border: 1px solid #8a6fd0; border-radius: 6px; box-shadow: 0 10px 30px #000a; padding: 3px; }
.sc-popup.show { display: block; }
.sc-sg { display: flex; align-items: center; gap: 7px; padding: 4px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.sc-sg i { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.sc-sg b { font-weight: normal; color: #fff6e8; }
.sc-sg small { color: #9d8cbc; overflow: hidden; text-overflow: ellipsis; }
.sc-sg.on { background: #5b3fa0; } .sc-sg.on small { color: #e3d4ff; }
.sc-sg-hint { font-size: 11px; color: #8672ab; padding: 3px 8px 1px; border-top: 1px solid #3d2f5a; margin-top: 2px; }

.sc-statusline { display: flex; align-items: center; gap: 12px; min-height: 30px; padding: 4px 14px; border-top: 1px solid #3d2f5a; background: #1c1430; font-size: 12px; color: #b9a8d6; }
.sc-pos { color: #7f6fa6; font-family: Consolas, monospace; flex: none; }
.sc-hint { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .sc-hint b { color: #ffe478; font-weight: normal; }
.sc-err { color: #ff9fb3; } .sc-warn { color: #ffd38a; } .sc-ok { color: #b8f5a0; } .sc-say { color: #ffe9a8; }
.sc-issues { color: #ffb3c3 !important; background: #5c2436 !important; border-color: #a0455e !important; border-radius: 4px; padding: 1px 8px !important; }

/* ---------- preview + flow */
.sc-side { border-left: 1px solid #3d2f5a; background: #1c1430; overflow: auto; padding: 10px 14px 30px; display: flex; flex-direction: column; gap: 8px; }
.sc-preview { display: flex; flex-direction: column; gap: 8px; }
.sc-side-title { color: #c9a0ff; font-size: 14px; margin-top: 4px; } .sc-side-title small { color: #7f6fa6; font-size: 11px; margin-left: 6px; }
.sc-stage { position: relative; width: 360px; height: 208px; flex: none; overflow: hidden; border-radius: 4px; box-shadow: 0 0 0 2px #120c22, 0 0 0 4px #54437a; cursor: pointer; }
.sc-stage canvas { width: 360px; height: 208px; image-rendering: pixelated; display: block; }
.sc-stage .bb { transition: none; }
.sc-stage .bb.choosing .bb-opt { cursor: pointer; }
.sc-caption { position: absolute; top: 8px; left: 0; display: none; max-width: 320px; box-sizing: border-box; border: 4px solid transparent; padding: 2px 18px;
  background-size: 100% 100%; image-rendering: pixelated; font: 12px/14px FusionPixel, "Microsoft YaHei", sans-serif; color: #e6dcf7; text-align: center; -webkit-font-smoothing: none; }
.sc-caption.show { display: block; }
.sc-note { position: absolute; left: 8px; right: 8px; bottom: 8px; display: none; justify-content: space-between; align-items: center; gap: 6px; padding: 5px 9px; background: #120c22e6; color: #fff6e8; border: 2px solid #ffe478; font-size: 12px; }
.sc-note.show { display: flex; } .sc-note b { color: #ffe478; font-weight: normal; }
.sc-yn { display: flex; gap: 4px; flex: none; } .sc-yn button { padding: 1px 8px !important; }
.sc-stage-info { color: #9d8cbc; font-size: 12px; min-height: 18px; } .sc-stage-info b { color: #e3d4ff; font-weight: normal; }
.sc-stage-buttons { display: flex; gap: 5px; flex-wrap: wrap; }
.sc-stage-buttons button { border-radius: 5px; }
.sc-primary { background: #6a4fb0 !important; border-color: #ffe478 !important; color: #ffe478 !important; }
.sc-flow { position: relative; }
.sc-flow-from { color: #9d8cbc; font-size: 12px; margin-bottom: 6px; } .sc-flow-from b { color: #b8f5a0; font-weight: normal; }
.sc-flow-canvas { position: relative; width: 340px; }
.sc-flow svg { position: absolute; inset: 0; overflow: visible; }
.sc-flow path { fill: none; stroke: #8a78b5; stroke-width: 1.5; }
.sc-flow path.f-choice { stroke: #8de2d8; } .sc-flow path.f-if { stroke: #ffb86c; } .sc-flow path.f-back { stroke-dasharray: 4 3; }
.sc-flow marker path { fill: #b9a8d6; stroke: none; }
.sc-flow text { font-size: 11px; paint-order: stroke; stroke: #1c1430; stroke-width: 4px; fill: #d8cbee; }
.sc-flow text.t-choice { fill: #b9fff4; } .sc-flow text.t-if { fill: #ffcf96; }
.sc-node { position: absolute; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 1px; padding: 3px 7px !important; border-radius: 6px; text-align: left; overflow: hidden; background: #2c2147 !important; }
.sc-node b { font-weight: normal; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sc-node small { font-size: 10px; color: #9d8cbc; }
.sc-node.root { border-color: #b8f5a0 !important; }
.sc-node.on { background: #5b3fa0 !important; border-color: #ffe478 !important; }

/* ---------- condition pickers in the quest and event forms */
.dg-conditions h3 { font-size: 12px; color: #c9a0ff; }
.dg-condition-row { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 0; }
.dg-condition-row select { flex: 1; min-width: 85px; }
.dg-condition-row input { width: 80px; }
.dg-conditions details { margin: 10px 0 6px; color: #9d8cbc; font-size: 11px; }
.dg-conditions details input { width: 100%; margin-top: 6px; }

@media (max-width: 1150px) {
  .sc-shell { grid-template-columns: 200px minmax(0, 1fr); }
  .sc-side { display: none; }
}
`;
