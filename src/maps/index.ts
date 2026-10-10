import type { MapData } from "../game/mapdata";

// Every JSON file in this folder is a map. The editor (F2) writes them back here.
const files = import.meta.glob<MapData>("./*.json", { eager: true, import: "default" });

/** All maps by id. The editor edits these objects in place. */
export const MAPS: Record<string, MapData> = {};
for (const m of Object.values(files)) MAPS[m.id] = structuredClone(m);

/** The map a new game starts on (it holds the cottage). */
export const HOME_MAP = "hills";
