// Bundled by export.mjs and run in Node with a software canvas installed: draws
// the game's pre-rendered pictures with the game's own code.
import { Background } from "../../src/game/background";
import { mapStamp, type MapData } from "../../src/game/mapdata";

export { mapStamp };
import { Mat, tileMat } from "../../src/game/tiles";
import { World } from "../../src/game/world";

type Canvas = HTMLCanvasElement & { toPNG(): Buffer; crop(x: number, y: number, w: number, h: number): Canvas };

/** Terrain picture of a map, with breakable soft earth left out (the game draws those blocks itself). */
export function bakeTerrain(map: MapData) {
  const copy: MapData = structuredClone(map);
  copy.rows = copy.rows.map((row) =>
    row.split(" ").map((tok) => {
      if (!tok) return tok;
      const [hex, n] = tok.split("*");
      const v = parseInt(hex, 16);
      if (tileMat(v) !== Mat.Soft) return tok;
      return n ? `00*${n}` : "00";
    }).join(" "),
  );
  const world = new World(copy);
  const lights = (world as unknown as { lights: { w?: number; h?: number }[] }).lights.map((l) => [l.w ?? 24, l.h ?? 120] as [number, number]);
  return { canvas: world.canvas as Canvas, lights, world };
}

/** A light shaft's cone picture for a top width and length. */
export function bakeLight(world: World, w: number, h: number) {
  return (world as unknown as { lightCanvas(w: number, h: number): Canvas }).lightCanvas(w, h);
}

/** The sky and parallax layers of a backdrop. */
export function bakeBackground(kind: "sky" | "burrow", vw: number, vh: number) {
  const bg = new Background(vw, vh, kind) as unknown as {
    sky: Canvas;
    layers: { canvas: Canvas; factor: number; drift: number; baseY: number }[];
  };
  return bg;
}
