import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";

const result = await build({
  entryPoints: ["scripts/map-canvases.test.ts"], bundle: true, write: false,
  platform: "node", format: "esm", loader: { ".woff2": "empty" },
  plugins: [{ name: "raw-script", setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]maps[\\/]index\.ts$/ }, () => ({ contents: "export const MAPS = {};", loader: "js" }));
    b.onResolve({ filter: /\?raw$/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")), namespace: "raw" }));
    b.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({ contents: await readFile(args.path, "utf8"), loader: "text" }));
  } }],
});
try {
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
