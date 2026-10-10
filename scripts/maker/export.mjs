// Exports everything the TapTap Maker (Lua) version of the game reads from this
// project: maps, the dialogue script and story data, plus pictures baked with the
// game's own drawing code (terrain per map, sky and parallax layers, light shafts).
//
//   node scripts/maker/export.mjs [path/to/MagicGame-Maker]
//
// Run it again after editing maps or the story here; then refresh the Maker preview.
import { build } from "esbuild";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { installDom } from "./softcanvas.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const maker = resolve(process.argv[2] ?? join(root, "../MagicGame-Maker"));
if (!existsSync(join(maker, "scripts"))) throw new Error(`Not a Maker project: ${maker}`);
const assets = join(maker, "assets");

/** Widest view the Lua game uses (phones are wider than 16:9); the sky is baked this wide. */
const SKY_W = 432;
const VH = 180;
/** Terrain pictures are cut into strips no wider than this (texture size limits on phones). */
const STRIP = 1024;

const fresh = (dir) => { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); };

// ---------------------------------------------------------------- data files
const dataDir = join(assets, "Data");
fresh(join(dataDir, "maps"));
mkdirSync(join(dataDir, "story"), { recursive: true });
const maps = [];
for (const f of readdirSync(join(root, "src/maps")).filter((f) => f.endsWith(".json"))) {
  const m = JSON.parse(readFileSync(join(root, "src/maps", f), "utf8"));
  maps.push(m);
  writeFileSync(join(dataDir, "maps", f), JSON.stringify(m));
}
for (const f of ["content.json", "people.json"]) copyFileSync(join(root, "src/story", f), join(dataDir, "story", f));
// The Maker builder doesn't ship .txt files: the script goes out wrapped in JSON.
writeFileSync(join(dataDir, "story", "script.json"), JSON.stringify({ text: readFileSync(join(root, "src/story/script.txt"), "utf8") }));

// ---------------------------------------------------------------- baked pictures
installDom();
const bundle = join(here, ".bake-bundle.mjs");
await build({
  entryPoints: [join(here, "bake-entry.ts")],
  bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "error",
  loader: { ".txt": "text" },
});
const bake = await import(pathToFileURL(bundle).href + "?t=" + Date.now());

// Map ids with a fingerprint of each map's content (saves forget landmarks on edited maps).
writeFileSync(join(dataDir, "maps", "index.json"), JSON.stringify(Object.fromEntries(maps.map((m) => [m.id, bake.mapStamp(m)]))));

const tex = join(assets, "Textures");
fresh(join(tex, "terrain"));
fresh(join(tex, "bg"));
fresh(join(tex, "light"));
const meta = { skyW: SKY_W, terrain: {}, bg: {}, lights: [] };

const lightSizes = new Map();
let lightWorld = null;
for (const m of maps) {
  const t0 = Date.now();
  const { canvas, lights, world } = bake.bakeTerrain(m);
  const strips = [];
  for (let x = 0, i = 0; x < canvas.width; x += STRIP, i++) {
    const w = Math.min(STRIP, canvas.width - x);
    const name = `${m.id}_${i}.png`;
    writeFileSync(join(tex, "terrain", name), canvas.crop(x, 0, w, canvas.height).toPNG());
    strips.push({ x, w, file: `Textures/terrain/${name}` });
  }
  meta.terrain[m.id] = { w: canvas.width, h: canvas.height, strips };
  for (const [w, h] of lights) lightSizes.set(`${w}x${h}`, [w, h]);
  lightWorld ??= world;
  console.log(`terrain ${m.id} ${canvas.width}x${canvas.height} (${Date.now() - t0} ms)`);
}
for (const [key, [w, h]] of lightSizes) {
  const c = bake.bakeLight(lightWorld, w, h);
  writeFileSync(join(tex, "light", `${key}.png`), c.toPNG());
  meta.lights.push({ w, h, cw: c.width, ch: c.height, file: `Textures/light/${key}.png` });
}
for (const kind of ["sky", "burrow"]) {
  const bg = bake.bakeBackground(kind, SKY_W, VH);
  writeFileSync(join(tex, "bg", `${kind}_sky.png`), bg.sky.toPNG());
  meta.bg[kind] = {
    sky: `Textures/bg/${kind}_sky.png`,
    layers: bg.layers.map((L, i) => {
      const file = `Textures/bg/${kind}_${i}.png`;
      writeFileSync(join(assets, file), L.canvas.toPNG());
      return { file, w: L.canvas.width, h: L.canvas.height, factor: L.factor, drift: L.drift, baseY: L.baseY };
    }),
  };
}
writeFileSync(join(dataDir, "bake.json"), JSON.stringify(meta, null, 1));
rmSync(bundle, { force: true });

// ---------------------------------------------------------------- font
// The Chinese pixel font, cut down to the characters the game uses (needs Python + fonttools).
const fontOut = spawnSync("python", [join(here, "subset-font.py"), maker], { encoding: "utf8" });
if (fontOut.status === 0) process.stdout.write(fontOut.stdout);
else console.warn("font subset failed (pip install fonttools brotli):\n" + (fontOut.stderr || fontOut.error));
console.log(`exported ${maps.length} maps to ${maker}`);
