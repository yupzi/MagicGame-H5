import { MAPS } from "../maps";
import { gateId, mapStamp } from "./mapdata";
import { ELEMENT_ORDER, isElement, isForm, sameWeave, type ElementId, type FormId, type Weave } from "./runes";
import { maxLevel, SKILL, SKILLS, type Cost, type Skill, type SkillId } from "./skills";
import type { ItemType } from "./sprites";

/** Star-chart nodes that teach a spell teach an element rune. */
export type SpellId = ElementId;

export const LOADOUT_SIZE = 3;

export type PetKind = "rabbit" | "boar";
/** How many friends fit in the cottage garden. */
export const GARDEN_CAP = 6;

const SAVE_KEY = "magic-hills-save-v1";

/** Fingerprints of the maps as shipped, saved so later map edits can be noticed. */
const MAP_STAMPS: Record<string, string> = Object.fromEntries(Object.values(MAPS).map((m) => [m.id, mapStamp(m)]));

/** Everything the player has earned; this is what gets saved. */
export class Progress {
  inventory: Record<ItemType, number>;
  levels: Partial<Record<SkillId, number>> = { grimoire: 1 };
  /** Form runes copied from tablets. The bolt is known from the start. */
  forms = new Set<FormId>(["bolt"]);
  /** Woven spells, swapped with Q. Slot 0 is never empty. */
  loadout: (Weave | null)[] = [{ el: "star", form: "bolt" }, null, null];
  slot = 0;
  /** A rune was learned since the weaving table was last opened. */
  newRune = false;
  /** Animals won over with flower magic, ever. */
  friends = 0;
  /** Friends who moved into the cottage garden. */
  pets: PetKind[] = [];
  /** Days pass by sleeping in the cottage bed. */
  day = 1;
  /** Narrative time changes only when sleeping or a story action advances it. */
  period = "morning";
  gates = new Set<string>();
  /** Lanterns lit so far (ids are unique across maps). */
  lit = new Set<string>();
  /** The lantern you come back to after a fall: "" means the cottage. */
  checkpoint = "";
  bossDefeated = false;
  /** Story flags set by the dialogue script (and seen:<id> for triggers that already fired). */
  flags = new Set<string>();
  /** Open quests shown in the corner: id → text (may hold {木头}-style counters). */
  quests: Record<string, string> = {};
  /** Current stage of structured quests; legacy text-only quests still use quests above. */
  questStages: Record<string, number> = {};
  completedQuests = new Set<string>();
  /** Timeline events already fired, keyed by event ID and day. */
  timelineSeen = new Set<string>();

  constructor(items: readonly ItemType[]) {
    this.inventory = Object.fromEntries(items.map((t) => [t, 0])) as Record<ItemType, number>;
  }

  level(id: SkillId) {
    return this.levels[id] ?? 0;
  }

  get elements(): Set<ElementId> {
    const out = new Set<ElementId>(["star"]);
    for (const s of SKILLS) if (s.spell && this.level(s.id) > 0) out.add(s.spell);
    return out;
  }

  /** The spell in hand. */
  get current(): Weave {
    return this.loadout[this.slot] ?? this.loadout.find((w) => w) ?? { el: "star", form: "bolt" };
  }

  /** Indices of the slots that hold a spell. */
  get filledSlots() {
    return this.loadout.flatMap((w, i) => (w ? [i] : []));
  }

  knows(w: Weave) {
    return this.elements.has(w.el) && this.forms.has(w.form);
  }

  get hearts() {
    return this.level("heart");
  }

  get feathers() {
    return this.level("feather");
  }

  maxed(s: Skill) {
    return this.level(s.id) >= maxLevel(s);
  }

  /** Buyable once its parent has at least one level. */
  available(s: Skill) {
    return !s.parent || this.level(s.parent) > 0;
  }

  /** Shown as a "?" silhouette: its parent is available but not yet bought. */
  hinted(s: Skill) {
    return !!s.parent && !this.available(s) && this.available(SKILL[s.parent]);
  }

  nextCost(s: Skill): Cost | null {
    return this.maxed(s) ? null : s.costs[this.level(s.id)];
  }

  affordable(s: Skill) {
    const c = this.nextCost(s);
    return !!c && (Object.entries(c) as [ItemType, number][]).every(([t, n]) => this.inventory[t] >= n);
  }

  canUpgrade(s: Skill) {
    return this.available(s) && !this.maxed(s) && this.affordable(s);
  }

  upgrade(s: Skill) {
    if (!this.canUpgrade(s)) return false;
    for (const [t, n] of Object.entries(this.nextCost(s)!) as [ItemType, number][]) this.inventory[t] -= n;
    this.levels[s.id] = this.level(s.id) + 1;
    if (s.spell && this.level(s.id) === 1) {
      // A fresh element comes ready to use as a bolt in a free slot.
      this.equip({ el: s.spell, form: "bolt" });
      this.newRune = true;
    }
    return true;
  }

  /** Put a weave in the first empty slot (or the last one) and hold it. */
  private equip(w: Weave) {
    const have = this.loadout.findIndex((x) => sameWeave(x, w));
    if (have >= 0) {
      this.slot = have;
      return;
    }
    let i = this.loadout.findIndex((x) => !x);
    if (i < 0) i = LOADOUT_SIZE - 1;
    this.loadout[i] = w;
    this.slot = i;
  }

  /** An element rune taught by someone on the road. Returns false if it was already known. */
  learnElement(el: ElementId) {
    this.flags.add(el);
    if (this.elements.has(el)) return false;
    const s = SKILLS.find((k) => k.spell === el);
    if (!s) return false;
    this.levels[s.id] = Math.max(1, this.level(s.id));
    this.equip({ el, form: "bolt" });
    this.newRune = true;
    return true;
  }

  learnForm(f: FormId) {
    if (this.forms.has(f)) return false;
    this.forms.add(f);
    this.newRune = true;
    return true;
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        inventory: this.inventory, levels: this.levels,
        forms: [...this.forms], loadout: this.loadout, slot: this.slot, newRune: this.newRune, friends: this.friends, pets: this.pets, day: this.day, period: this.period,
        gates: [...this.gates], lit: [...this.lit], checkpoint: this.checkpoint, bossDefeated: this.bossDefeated, flags: [...this.flags], quests: this.quests,
        questStages: this.questStages, completedQuests: [...this.completedQuests], timelineSeen: [...this.timelineSeen],
        maps: MAP_STAMPS,
      }));
    } catch {
      // Storage may be unavailable (private mode); the game still works, it just won't remember.
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      for (const t of Object.keys(this.inventory) as ItemType[]) {
        const n = d.inventory?.[t];
        if (typeof n === "number" && n >= 0) this.inventory[t] = Math.floor(n);
      }
      if (d.levels && typeof d.levels === "object") {
        for (const s of SKILLS) {
          const n = d.levels[s.id];
          if (typeof n === "number") this.levels[s.id] = Math.max(0, Math.min(maxLevel(s), n | 0));
        }
      } else {
        // Older saves stored spells and upgrades separately.
        for (const sp of d.spells ?? []) if (sp === "fire" || sp === "ice" || sp === "thunder") this.levels[sp as SkillId] = 1;
        if (d.hearts) this.levels.heart = Math.min(3, d.hearts | 0);
        if (d.feathers) this.levels.feather = Math.min(2, d.feathers | 0);
      }
      this.levels.grimoire = 1;
      for (const f of d.forms ?? []) if (isForm(f)) this.forms.add(f);
      this.loadLoadout(d);
      this.newRune = !!d.newRune;
      if (typeof d.friends === "number") this.friends = Math.max(0, d.friends | 0);
      if (Array.isArray(d.pets)) this.pets = d.pets.filter((k: unknown) => k === "rabbit" || k === "boar").slice(0, GARDEN_CAP);
      if (typeof d.day === "number") this.day = Math.max(1, d.day | 0);
      if (typeof d.period === "string") this.period = d.period;
      for (const g of d.gates ?? []) if (typeof g === "string") this.gates.add(g);
      for (const l of d.lit ?? []) if (typeof l === "string") this.lit.add(l);
      if (typeof d.checkpoint === "string") this.checkpoint = d.checkpoint;
      else if (typeof d.checkpoint === "number") {
        // Older saves counted lanterns along the one long road: they are L1..L4 now.
        const n = Math.max(0, Math.min(4, d.checkpoint | 0));
        for (let i = 1; i <= n; i++) this.lit.add(`L${i}`);
        this.checkpoint = n > 0 ? `L${n}` : "";
      }
      this.forgetEditedMaps(d.maps);
      this.bossDefeated = !!d.bossDefeated;
      for (const f of d.flags ?? []) if (typeof f === "string") this.flags.add(f);
      // Saves from before the story began already had their wand.
      if (!Array.isArray(d.flags)) this.flags.add("wand");
      if (d.quests && typeof d.quests === "object") {
        for (const [k, v] of Object.entries(d.quests)) if (typeof v === "string") this.quests[k] = v;
      }
      if (d.questStages && typeof d.questStages === "object") {
        for (const [k, v] of Object.entries(d.questStages)) if (typeof v === "number" && v >= 0) this.questStages[k] = Math.floor(v);
      }
      for (const id of d.completedQuests ?? []) if (typeof id === "string") this.completedQuests.add(id);
      for (const id of d.timelineSeen ?? []) if (typeof id === "string") this.timelineSeen.add(id);
      if (this.bossDefeated) this.flags.add("boss");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Opened gates and lit lanterns only count on maps unchanged since the save
   * was written: an edited map starts its landmarks fresh (saves from before
   * map stamps count as edited everywhere). Everything else is kept.
   */
  private forgetEditedMaps(saved: unknown) {
    const old = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
    const gates = new Set<string>();
    const lanterns = new Set<string>();
    for (const m of Object.values(MAPS)) {
      if (old[m.id] !== MAP_STAMPS[m.id]) continue;
      for (const o of m.objects) {
        if (o.type === "gate") gates.add(gateId(m.id, o));
        else if (o.type === "lantern" && o.id) lanterns.add(o.id);
      }
    }
    for (const g of this.gates) if (!gates.has(g)) this.gates.delete(g);
    for (const l of this.lit) if (!lanterns.has(l)) this.lit.delete(l);
    if (!this.lit.has(this.checkpoint)) this.checkpoint = "";
  }

  private loadLoadout(d: { loadout?: unknown; slot?: unknown; current?: unknown }) {
    const saved = Array.isArray(d.loadout) ? d.loadout : null;
    if (saved) {
      this.loadout = Array.from({ length: LOADOUT_SIZE }, (_, i) => {
        const w = saved[i];
        const ok = w && isElement(w.el) && isForm(w.form) && this.knows(w);
        return ok ? { el: w.el, form: w.form } : null;
      });
    } else {
      // Saves from before rune weaving: every learned spell becomes a bolt.
      const els = ELEMENT_ORDER.filter((e) => e !== "star" && this.elements.has(e));
      if (els.length < LOADOUT_SIZE) els.unshift("star");
      this.loadout = Array.from({ length: LOADOUT_SIZE }, (_, i) => (els[i] ? { el: els[i], form: "bolt" as FormId } : null));
      const cur = this.loadout.findIndex((w) => w?.el === d.current);
      if (cur >= 0) this.slot = cur;
    }
    if (!this.loadout[0]) {
      const i = this.loadout.findIndex((w) => w);
      this.loadout[0] = i > 0 ? this.loadout[i] : { el: "star", form: "bolt" };
      if (i > 0) this.loadout[i] = null;
    }
    if (typeof d.slot === "number") this.slot = d.slot | 0;
    if (!this.loadout[this.slot]) this.slot = 0;
  }

  static wipe() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // ignore
    }
  }
}
