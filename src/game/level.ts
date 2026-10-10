import { Bridge } from "./bridge";
import { Door } from "./doors";
import { Boar, Rabbit, Slime, type Enemy, type EnemyKind } from "./enemies";
import { Gate, Lantern, Sign, type GateKind } from "./gates";
import { Cottage } from "./home";
import type { Item } from "./items";
import { gateId, gateKind, type MapData, type MapObj } from "./mapdata";
import type { Projectile } from "./projectile";
import { CrystalNode, Resource, Rock, Tree } from "./resources";
import { condMet, isLook, LOOKS, Npc, Trigger } from "./people";
import { isForm } from "./runes";
import type { Progress } from "./spells";
import { RuneTablet, ScarCircle } from "./tablets";
import { World } from "./world";

export type WildKind = Exclude<EnemyKind, "king">;

/** A placed creature: it comes back a while after it's gone, once you aren't looking. */
export interface Spawner {
  kind: WildKind;
  x: number;
  y: number;
  big?: boolean;
  enemy: Enemy | null;
  t: number;
}

export const RESPAWN_TIME = 14;

export function makeEnemy(kind: WildKind, x: number, y: number, big?: boolean): Enemy {
  return kind === "slime" ? new Slime(x, y, big) : kind === "rabbit" ? new Rabbit(x, y) : new Boar(x, y);
}

/**
 * Everything that lives on one map. Levels are kept while you're elsewhere,
 * so stumps stay stumps and critters stay where they wandered.
 */
export class Level {
  readonly world: World;
  resources: Resource[] = [];
  enemies: Enemy[] = [];
  items: Item[] = [];
  projectiles: Projectile[] = [];
  gates: Gate[] = [];
  signs: Sign[] = [];
  lanterns: Lantern[] = [];
  tablets: RuneTablet[] = [];
  doors: Door[] = [];
  spawners: Spawner[] = [];
  npcs: Npc[] = [];
  triggers: Trigger[] = [];
  bridges: Bridge[] = [];
  cottage: Cottage | null = null;
  scar: ScarCircle | null = null;
  /** Left edge of the boss arena (Infinity: no boss here). */
  arenaX = Infinity;
  arenaSeal: Gate | null = null;

  constructor(readonly map: MapData, progress: Progress) {
    this.world = new World(map);
    this.populate(progress);
  }

  get id() {
    return this.map.id;
  }

  /** (Re)creates every placed thing from the map's object list. */
  populate(progress: Progress) {
    const w = this.world;
    this.resources = [];
    this.enemies = [];
    this.items = [];
    this.projectiles = [];
    this.gates = [];
    this.signs = [];
    this.lanterns = [];
    this.tablets = [];
    this.doors = [];
    this.spawners = [];
    this.npcs = [];
    this.triggers = [];
    this.bridges = [];
    this.cottage = null;
    this.scar = null;
    this.arenaX = Infinity;
    this.arenaSeal = null;
    w.barriers.length = 0;
    for (let i = w.platforms.length - 1; i >= 0; i--) if (!w.platforms[i].plank) w.platforms.splice(i, 1);

    for (const o of this.map.objects) this.place(o, progress);
    // Things that stand behind others first: bigger resources at the back.
    this.resources.sort((a, b) => b.h - a.h);
  }

  private place(o: MapObj, progress: Progress) {
    const w = this.world;
    const { x, y } = o;
    const seed = o.seed ?? Math.floor(x * 7919 + y * 31);
    switch (o.type) {
      case "tree": this.resources.push(new Tree(x, y, seed)); break;
      case "rock": this.resources.push(new Rock(x, y, seed)); break;
      case "crystal": this.resources.push(new CrystalNode(x, y, seed)); break;
      case "slime":
      case "rabbit":
      case "boar": {
        const s: Spawner = { kind: o.type, x, y, big: o.big || undefined, enemy: null, t: 0 };
        s.enemy = makeEnemy(s.kind, x, y, s.big);
        this.enemies.push(s.enemy);
        this.spawners.push(s);
        break;
      }
      case "cloud": {
        const cw = o.w ?? 44;
        w.platforms.push({ x: Math.round(x - cw / 2), y, w: cw, seed: seed % 1000 });
        break;
      }
      case "sign": this.signs.push(new Sign(x, y, o.text ?? "")); break;
      case "lantern": {
        const l = new Lantern(x, y, o.id ?? "");
        l.lit = l.id === "home" || progress.lit.has(l.id);
        this.lanterns.push(l);
        break;
      }
      case "gate": {
        const kind = gateKind(o) as GateKind;
        const g = new Gate(w, kind, x, y, gateId(this.map.id, o));
        if (kind === "seal") this.arenaSeal = g;
        else if (progress.gates.has(g.id)) g.forceOpen();
        this.gates.push(g);
        break;
      }
      case "tablet": {
        const form = isForm(o.form) ? o.form : null;
        const decay = Math.max(0, Math.min(2, Number(o.decay) || 0)) as 0 | 1 | 2;
        this.tablets.push(new RuneTablet(x, y, form, decay, !!form && progress.forms.has(form)));
        break;
      }
      case "door":
      case "pit":
      case "landing":
        this.doors.push(new Door(x, y, o));
        break;
      case "npc": {
        const look = isLook(o.kind) ? LOOKS[o.kind] : Object.values(LOOKS)[0];
        this.npcs.push(new Npc(x, w.restY(x, y - 2), look, o.text ?? "", o.cond ?? "", o.face === 1 ? 1 : -1, o.period ?? "", o.bark ?? "", o.barkR || 64, o.barkCd ?? 12));
        break;
      }
      case "trigger":
        this.triggers.push(new Trigger(x, y, o.w ?? 24, o.h ?? 48, o.text ?? "", o.cond ?? "", o.text ?? "", o.period ?? "", o.mode ?? "", !!o.repeat));
        break;
      case "bridge":
        this.bridges.push(new Bridge(w, x, y, o.w ?? 96, o.cond ?? "", condMet(o.cond, (f) => progress.flags.has(f))));
        break;
      case "cottage": this.cottage = new Cottage(w, x, y); break;
      case "boss": this.arenaX = x; break;
      case "scar": this.scar = new ScarCircle(x, y); break;
      case "zone":
      case "pillar":
      case "light":
        break; // drawn by the world
    }
  }

  door(id: string) {
    return this.doors.find((d) => d.id === id) ?? null;
  }
}
