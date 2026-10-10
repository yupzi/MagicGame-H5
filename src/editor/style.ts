export const PANEL_W = 250;

export const EDITOR_CSS = `
#editor {
  position: fixed; left: 0; top: 0; bottom: 0; width: ${PANEL_W - 14}px; overflow-y: auto; padding: 8px 7px;
  background: #221838; color: #fff6e8; border-right: 3px solid #120c22; font-size: 12px; line-height: 1.45;
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif; user-select: none; z-index: 10;
}
#editor.hidden { display: none; }
body.editing #wrap { margin-left: ${PANEL_W}px; }
body.editing #hint, body.editing #tip, body.editing #banner { display: none; }
#editor button, #editor select, #editor input, #editor textarea {
  font: inherit; color: #fff6e8; background: #34285a; border: 1px solid #5e4a8a; padding: 2px 5px; border-radius: 0;
}
#editor button { cursor: pointer; }
#editor button:hover { border-color: #ffe478; }
#editor button.on { background: #6a4fb0; border-color: #ffe478; color: #ffe478; }
#editor select, #editor textarea, #editor input[type=text] { width: 100%; box-sizing: border-box; }
#editor input[type=number] { width: 64px; }
#editor textarea { min-height: 70px; resize: vertical; }
.ed-title { font-size: 15px; color: #ffe478; letter-spacing: 2px; margin-bottom: 6px; }
.ed-key { font-size: 10px; color: #9f8fc0; }
.ed-row { display: flex; gap: 4px; align-items: center; margin: 4px 0; }
.ed-row > button { flex: 1; }
.ed-status { margin: 2px 0 6px; color: #b8f5a0; font-size: 11px; }
.ed-status.warn { color: #ff9eb8; }
.ed-tools { display: flex; gap: 3px; margin: 6px 0; }
.ed-tools button { flex: 1; padding: 4px 2px; }
.ed-h { margin: 8px 0 3px; color: #c9a0ff; font-size: 12px; }
.ed-grid, .ed-objs { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }
.ed-grid button, .ed-objs button { text-align: left; display: flex; align-items: center; gap: 5px; }
#editor i { display: inline-block; width: 9px; height: 9px; border: 1px solid #120c22; flex: none; }
.ed-shapes { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
.ed-shapes button { padding: 2px; line-height: 0; }
.ed-shapes canvas { width: 20px; height: 20px; image-rendering: pixelated; background: #1c1432; }
.ed-help { margin-top: 6px; color: #9f8fc0; font-size: 11px; }
.ed-field { display: block; margin: 4px 0; color: #b9a6dd; }
.ed-field > input[type=checkbox] { margin-left: 6px; }
.ed-del { margin-top: 6px; width: 100%; color: #ff9eb8 !important; }
.ed-map { margin-top: 10px; border-top: 1px dashed #4a3a78; padding-top: 6px; }
.ed-map summary { cursor: pointer; color: #c9a0ff; }
.ed-msg { margin-top: 8px; color: #ffe478; white-space: pre-line; }
`;
