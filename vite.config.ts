import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const MAP_DIR = fileURLToPath(new URL("./src/maps/", import.meta.url));
const STORY_FILE = fileURLToPath(new URL("./src/story/content.json", import.meta.url));
const SCRIPT_FILE = fileURLToPath(new URL("./src/story/script.txt", import.meta.url));
const LAYOUT_FILE = fileURLToPath(new URL("./src/story/layout.json", import.meta.url));

/**
 * Lets the in-game map editor (F2) save straight into src/maps/*.json while the
 * dev server runs, without the page reloading under your hands.
 */
function mapEditor(): Plugin {
  return {
    name: "map-editor",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__maps/save", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => (body += chunk));
        req.on("end", () => {
          try {
            const map = JSON.parse(body);
            if (typeof map.id !== "string" || !/^[a-z0-9_-]+$/i.test(map.id)) throw new Error("地图 id 只能用英文字母、数字、- 和 _");
            writeFileSync(MAP_DIR + `${map.id}.json`, body.endsWith("\n") ? body : body + "\n", "utf8");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e instanceof Error ? e.message : e));
          }
        });
      });
      server.middlewares.use("/__story/save", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 2_000_000) req.destroy();
        });
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (data.version !== 1 || !Array.isArray(data.quests) || !Array.isArray(data.periods) || !Array.isArray(data.timeline)) {
              throw new Error("剧情数据格式不正确");
            }
            writeFileSync(STORY_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e instanceof Error ? e.message : e));
          }
        });
      });
      // Where the story editor's nodes sit on their canvases.
      server.middlewares.use("/__story/layout", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => { body += chunk; });
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (typeof data.pos !== "object" || !Array.isArray(data.starts) || !Array.isArray(data.loose)) throw new Error("布局数据格式不正确");
            writeFileSync(LAYOUT_FILE, JSON.stringify(data, null, 1) + "\n", "utf8");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e instanceof Error ? e.message : e));
          }
        });
      });
      // The story editor writes the dialogue script as plain text.
      server.middlewares.use("/__story/script", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 2_000_000) req.destroy();
        });
        req.on("end", () => {
          try {
            if (!body.trim()) throw new Error("台词脚本是空的，没有保存");
            writeFileSync(SCRIPT_FILE, body, "utf8");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e instanceof Error ? e.message : e));
          }
        });
      });
    },
    // The editor already holds the new map in memory: don't reload the page when it saves.
    handleHotUpdate(ctx) {
      const f = ctx.file.replace(/\\/g, "/");
      if (f.includes("/src/maps/") && f.endsWith(".json")) return [];
      if (f.endsWith("/src/story/content.json") || f.endsWith("/src/story/layout.json")) return [];
    },
  };
}

export default defineConfig({
  plugins: [mapEditor()],
});
