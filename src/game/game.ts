import { sfx } from "../engine/audio";
import { ring, type Ctx } from "../engine/gfx";
import type { Input } from "../engine/input";
import { chance, clamp, damp, rand } from "../engine/math";
import { HOME_MAP, MAPS } from "../maps";
import { Background } from "./background";
import { KingSlime } from "./boss";
import type { Door } from "./doors";
import { Enemy } from "./enemies";
import { FlashFx, FloatText, HeartFx, LightningFx, PillarFx, RingFx, SkySigilFx, type Effect } from "./effects";
import { overlap, type Entity } from "./entity";
import { Gate, type Lantern } from "./gates";
import { drawHud } from "./hud";
import { Item } from "./items";
import { Level, makeEnemy, RESPAWN_TIME, type WildKind } from "./level";
import type { Backdrop } from "./mapdata";
import { P } from "./palette";
import { Particles } from "./particles";
import { Player } from "./player";
import { Bolt, type Projectile } from "./projectile";
import { BRANCH_COLOR, type Skill } from "./skills";
import { SkillTree } from "./skilltree";
import { ELEMENTS, FORMS, isElement, isForm } from "./runes";
import { GARDEN_CAP, Progress } from "./spells";
import { ITEM_ORDER, type ItemType } from "./sprites";
import type { RuneTablet } from "./tablets";
import { Mat, TILE, tileMat } from "./tiles";
import { Ui } from "./ui";
import { WeaveTable } from "./weaveui";
import { Pet } from "./home";
import { Dialogue, ITEM_NAMES } from "./dialogue";
import { Barks } from "./barks";
import { drawEmote, layoutBubbles, type Speech } from "./bubbles";
import { Npc } from "./people";
import { Stagecraft } from "./stagecraft";
import { periodName, questDef, STORY } from "./story";
import { CottageInterior } from "./interior";
import type { Platform } from "./world";

export const VW = 320;
export const VH = 180;

/** Where every lantern stands, across all maps (ids are global). */
function findLantern(id: string) {
  for (const m of Object.values(MAPS)) {
    const o = m.objects.find((o) => o.type === "lantern" && o.id === id);
    if (o) return { map: m.id, x: o.x, y: o.y };
  }
  return null;
}

export class Game {
  readonly bgs: Record<Backdrop, Background>;
  readonly particles: Particles;
  readonly player: Player;
  /** Maps visited this session, kept so they stay as you left them. */
  private levels = new Map<string, Level>();
  level!: Level;
  effects: Effect[] = [];
  readonly interior: CottageInterior;
  pets: Pet[] = [];
  private gardenFullT = 0;
  private warpT = 0; // holding down at a lantern
  private warpLantern: Lantern | null = null;
  private fade = 0; // screen fade for doors and travel, 0..1
  private fadeDir = 0;
  private fadeMid: (() => void) | null = null;
  /** Arrived through this door: it won't fire again until you step off it. */
  private doorLock: Door | null = null;
  private doorHintCd = 0;
  boss: KingSlime | null = null;
  private bossState: "waiting" | "fighting" | "done" = "waiting";
  private zone = "";
  readonly ui: Ui;
  readonly dialogue: Dialogue;
  /** People muttering as the witch walks past. */
  readonly barks: Barks;
  /** Staging for conversations: pauses, hops, walks, camera, shakes, sounds. */
  readonly stagecraft: Stagecraft;
  /** Who is saying something this frame (conversation and mutterings). */
  private speeches: Speech[] = [];
  private canvasEl: HTMLCanvasElement | null;
  /** Set once the title card is dismissed: story triggers wait for it. */
  started = false;
  private timers: { t: number; fn: () => void }[] = [];

  readonly progress = new Progress(ITEM_ORDER);
  readonly tree: SkillTree;
  readonly weave: WeaveTable;
  private celebration: { main: string; accent: string; msg: string } | null = null;
  private saveT = 15;
  private noSave = false;
  spellBump = 0;
  hudBump = Object.fromEntries(ITEM_ORDER.map((t) => [t, 0])) as Record<ItemType, number>;

  time = 0;
  camX = 0;
  camY = 0;
  private freeze = 0; // hitstop frames remaining
  private trauma = 0; // screen shake, 0..1
  redFlash = 0;
  whiteFlash = 0;
  private pickupCombo = 0;
  private lastPickup = -10;

  get viewW() {
    return VW;
  }

  get viewH() {
    return VH;
  }

  get inventory() {
    return this.progress.inventory;
  }

  // The current map's contents.
  get world() { return this.level.world; }
  get resources() { return this.level.resources; }
  get enemies() { return this.level.enemies; }
  set enemies(v: Enemy[]) { this.level.enemies = v; }
  get items() { return this.level.items; }
  set items(v: Item[]) { this.level.items = v; }
  get projectiles() { return this.level.projectiles; }
  set projectiles(v: Projectile[]) { this.level.projectiles = v; }
  get gates(): Gate[] { return this.level.gates; }
  get lanterns(): Lantern[] { return this.level.lanterns; }
  get tablets(): RuneTablet[] { return this.level.tablets; }
  get cottage() { return this.level.cottage; }
  get arenaX() { return this.level.arenaX; }

  constructor(readonly input: Input, uiHost: HTMLElement) {
    this.bgs = { sky: new Background(VW, VH, "sky"), burrow: new Background(VW, VH, "burrow") };
    this.progress.load();
    if (this.progress.bossDefeated) this.bossState = "done";
    this.level = this.getLevel(HOME_MAP);
    this.particles = new Particles(this.world);
    this.player = new Player(0, 0);
    this.player.applyUpgrades(this);
    this.player.hp = this.player.maxHp;
    this.tree = new SkillTree(this, uiHost);
    this.weave = new WeaveTable(this, uiHost);
    this.ui = new Ui(uiHost);
    this.dialogue = new Dialogue(this, uiHost);
    this.barks = new Barks(this, uiHost);
    this.stagecraft = new Stagecraft(this);
    this.canvasEl = uiHost.querySelector("canvas");
    this.interior = new CottageInterior(this);
    this.makePets();
    const flush = () => this.save();
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flush();
    });
    // A new day starts by stepping out of the front door (or at the last lantern).
    this.respawnAtCheckpoint();
  }

  // ------------------------------------------------------------- maps

  /** The level for a map id, built on first visit. */
  getLevel(id: string) {
    let lv = this.levels.get(id);
    if (!lv) {
      const map = MAPS[id] ?? MAPS[HOME_MAP];
      lv = new Level(map, this.progress);
      this.levels.set(map.id, lv);
    }
    return lv;
  }

  get homeLevel() {
    return this.getLevel(HOME_MAP);
  }

  /** Makes a map the current one (effects and timers belong to the map you leave). */
  enterLevel(id: string) {
    const lv = this.getLevel(id);
    if (lv !== this.level) {
      this.barks?.stopAll();
      this.level = lv;
      this.effects = [];
      this.timers = [];
      this.particles.world = lv.world;
      this.particles.list.length = 0;
      this.doorLock = null;
    }
    return lv;
  }

  /** Throws away a map's saved state (the editor changed it) and rebuilds it if it's the current one. */
  rebuildLevel(id: string) {
    this.levels.delete(id);
    if (this.level.id === id) {
      this.level = this.getLevel(id);
      this.particles.world = this.level.world;
      this.particles.list.length = 0;
      this.effects = [];
      this.timers = [];
      this.doorLock = null;
      if (this.bossState === "fighting") this.bossState = "waiting";
      this.boss = null;
    }
    if (id === HOME_MAP) this.makePets();
  }

  /** Garden friends, living beside the home map's cottage. */
  makePets() {
    const c = this.homeLevel.cottage;
    this.pets = c ? this.progress.pets.map((k) => new Pet(k, rand(c.gardenX0, c.gardenX1), c, this.homeLevel.world)) : [];
  }

  /**
   * Puts the witch back at her checkpoint lantern, or at the cottage door when
   * there is none. Returns true when she's at home.
   */
  respawnAtCheckpoint() {
    const l = this.progress.checkpoint ? findLantern(this.progress.checkpoint) : null;
    if (l) {
      this.enterLevel(l.map);
      this.placePlayer(l.x - 14, l.y, 1);
      return false;
    }
    const home = this.enterLevel(HOME_MAP);
    const c = home.cottage;
    if (c) {
      this.placePlayer(c.doorX, c.y, 1);
      c.openDoor();
    } else this.placePlayer(40, 0, 1);
    return true;
  }

  /** Stands the witch on the ground near (x, y) and snaps the camera. */
  placePlayer(x: number, y: number, facing: number) {
    const p = this.player;
    p.placeAt(x, this.world.restY(x, y), facing);
    this.camX = x + facing * 26 - VW / 2;
    this.camY = p.y - VH * 0.7;
    this.clampCamera();
    this.zone = this.world.zoneAt(x);
  }

  private clampCamera() {
    const w = this.world;
    this.camX = w.w <= VW ? (w.w - VW) / 2 : clamp(this.camX, 0, w.w - VW);
    this.camY = w.h <= VH ? (w.h - VH) / 2 : clamp(this.camY, 0, w.h - VH);
  }

  /** Friends close enough to come along through a door or on a journey. */
  private followers() {
    const p = this.player;
    return this.enemies.filter((e) => e.friend && !e.dead && Math.abs(e.x - p.x) < 90 && Math.abs(e.y - p.y) < 60);
  }

  /** Moves friends into the current level beside the witch (after a map change). */
  private bringAlong(friends: Enemy[], from: Level) {
    const p = this.player;
    friends.forEach((e, i) => {
      if (from !== this.level) {
        from.enemies = from.enemies.filter((x) => x !== e);
        for (const s of from.spawners) if (s.enemy === e) { s.enemy = null; s.t = RESPAWN_TIME; }
        this.level.enemies.push(e);
      }
      e.x = clamp(p.x - p.facing * (14 + i * 10), e.hw + 1, this.world.w - e.hw - 1);
      e.y = this.world.restY(e.x, p.y);
      e.vx = e.vy = 0;
      e.onGround = false;
    });
  }

  private useDoor(d: Door) {
    const p = this.player;
    if (!d.dest || !MAPS[d.dest[0]]) {
      if (this.doorHintCd <= 0) {
        this.doorHintCd = 1;
        this.floatText("?", d.x, d.y - 30, P.cream, true);
      }
      return;
    }
    const [mapId, doorId] = d.dest;
    const friends = this.followers();
    const from = this.level;
    p.cancelCharge();
    p.vx = 0;
    sfx.poof();
    this.transition(() => {
      const lv = this.enterLevel(mapId);
      const t = lv.door(doorId);
      let x = t ? t.x : lv.world.w / 2;
      // Step clear of a walk-through edge, towards the middle of the map.
      if (t?.auto) x = clamp(x + (t.x < lv.world.w / 2 ? 1 : -1) * (t.w / 2 + p.hw + 2), p.hw + 1, lv.world.w - p.hw - 1);
      this.placePlayer(x, t ? t.y : 0, p.facing);
      if (t?.style === "drop") {
        // Fall in from above: appear in mid-air and keep falling (the ground below is the safe spot).
        p.y = t.y;
        p.onGround = false;
        p.vy = 90;
        this.camY = p.y - VH * 0.5;
        this.clampCamera();
      }
      this.doorLock = t;
      this.bringAlong(friends, from);
      p.squash(0.7, 1.35);
    });
  }

  private updateDoors() {
    this.doorHintCd -= 1 / 60;
    if (this.doorLock && !this.doorLock.touching(this)) this.doorLock = null;
    for (const d of this.level.doors) {
      if (d === this.doorLock || !d.touching(this)) continue;
      if (d.auto || (this.input.pressed("up") && !this.player.charging)) {
        this.useDoor(d);
        return true;
      }
    }
    return false;
  }

  private doorTip() {
    for (const d of this.level.doors) {
      if (d.auto || !d.touching(this)) continue;
      if (!d.dest || !MAPS[d.dest[0]]) return "这里好像还没有通到别的地方。";
      return d.style === "hole" ? "兔子洞 · 按 ↑ 钻进去" : d.style === "cave" ? "山洞 · 按 ↑ 进去" : "按 ↑ 从这里出去";
    }
    return null;
  }

  // ------------------------------------------------------------- setup

  /** Walked up to a tablet and finished tracing its circle. */
  onTabletRead(t: RuneTablet) {
    if (!t.form || !this.progress.learnForm(t.form)) return;
    this.save();
    const p = this.player;
    sfx.unlock();
    this.ui.showBanner(`获得符文 · ${FORMS[t.form].name}`);
    this.floatText("NEW RUNE!", p.x, p.y - 34, P.magicYellow);
    this.addFx(new RingFx(t.x, t.y - 14, 6, 34, 0.5, P.magicYellow, 1, 2));
    this.addFx(new RingFx(p.x, p.y, 6, 30, 0.5, P.magicPink, 0.3, 2));
    p.squash(0.6, 1.5);
    this.particles.burst(t.x, t.y - 14, {
      count: 24, colors: [P.magicPink, P.magicYellow, P.white], speed: [60, 170], life: [0.4, 0.8], shape: "spark", additive: true, drag: 3,
    });
    this.particles.burst(p.x, p.cy, {
      count: 6, colors: [P.white], speed: [60, 130], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.6, 0.9], shape: "star", gravity: 200,
    });
  }

  /** n is in whole hearts. */
  healPlayer(n: number) {
    const p = this.player;
    if (!p.alive || p.hp >= p.maxHp) return;
    p.hp = Math.min(p.maxHp, p.hp + n * 2);
    this.floatText(`+${n}`, p.x + 8, p.y - 30, P.heart);
    this.addFx(new HeartFx(p.x, p.y - 20));
  }

  /** Flower magic washing over an area: stumps regrow, trees fruit. */
  bloomArea(x: number, y: number, r: number) {
    for (const res of this.resources) {
      if (Math.abs(res.x - x) < r && Math.abs(res.y - y) < 40) res.nourish(this);
    }
  }

  /** An animal was won over with flower magic for the first time. */
  onBefriend(e: Enemy) {
    this.progress.friends++;
    sfx.friend();
    this.floatText("FRIEND!", e.x, e.y - e.h - 14, P.blossom);
    this.save();
  }

  // ------------------------------------------------------------- story

  /** People on this map who are around right now (their story condition holds). */
  get npcs(): Npc[] {
    return this.level.npcs.filter((n) => this.storyCond(n.cond) && (!n.period || n.period === this.progress.period));
  }

  storyCond(cond: string) {
    return this.scriptCond(cond);
  }

  /** The witch has her wand out of the hat: magic works. */
  get hasWand() {
    return this.progress.flags.has("wand");
  }

  /**
   * A `?condition` in the script: space-separated parts that must all hold.
   * Flags, item counts, day, period and quest stage share one condition syntax.
   */
  scriptCond(cond: string) {
    return cond.split(/[\s,&]+/).filter(Boolean).every((part) => {
      const day = part.match(/^day(>=|<=|>|<|=)(\d+)$/);
      if (day) return this.compare(this.progress.day, day[1], Number(day[2]));
      const period = part.match(/^period=(\w+)$/);
      if (period) return this.progress.period === period[1];
      const quest = part.match(/^quest:([\w-]+)=(done|active|\d+)$/);
      if (quest) {
        const id = quest[1], state = quest[2];
        return state === "done" ? this.progress.completedQuests.has(id)
          : state === "active" ? id in this.progress.quests
          : this.progress.questStages[id] === Number(state);
      }
      const m = part.match(/^(.+?)(>=|<=|>|<|=)(\d+)$/);
      if (!m) return part.startsWith("!") ? !this.progress.flags.has(part.slice(1)) : this.progress.flags.has(part);
      const item = ITEM_NAMES[m[1]] as ItemType | undefined;
      if (!item) {
        console.warn(`[script.txt] 条件里不认识的东西「${m[1]}」`);
        return false;
      }
      return this.compare(this.inventory[item], m[2], Number(m[3]));
    });
  }

  private compare(a: number, op: string, b: number) {
    return op === ">=" ? a >= b : op === "<=" ? a <= b : op === ">" ? a > b : op === "<" ? a < b : a === b;
  }

  /** The person you'd talk to by pressing up. */
  private npcInReach() {
    const p = this.player;
    if (!p.alive || !p.onGround || this.dialogue.waiting) return null;
    return this.npcs.find((n) => n.near(p.x, p.y)) ?? null;
  }

  /** Starts a conversation: the witch stops, and the talker turns to face her. */
  talk(section: string, npc?: Npc, at = 0) {
    const p = this.player;
    if (!this.dialogue.has(section)) {
      this.floatText("...", npc?.x ?? p.x, (npc?.y ?? p.y) - 40, P.cream);
      return;
    }
    p.cancelCharge();
    p.vx = 0;
    if (npc) {
      npc.facing = Math.sign(p.x - npc.x) || -1;
      p.facing = Math.sign(npc.x - p.x) || p.facing;
    }
    this.ui.setTip(null);
    this.barks.stopAll();
    this.dialogue.start(section, () => this.save(), npc, at);
  }

  /** Walked into a story trigger for the first time. */
  private updateTriggers() {
    const p = this.player;
    if (!this.started || !p.alive || this.fading || this.dialogue.waiting) return false;
    for (const t of this.level.triggers) {
      const seen = `seen:${t.key}`;
      if (t.mode === "bark" || this.progress.flags.has(seen) || !this.storyCond(t.cond) || (t.period && t.period !== this.progress.period) || !t.contains(p.x, p.y)) continue;
      this.progress.flags.add(seen);
      this.talk(t.talk);
      return true;
    }
    return false;
  }

  /**
   * Mutterings: people with a bark line say it as the witch comes near, and
   * bark-mode triggers play when she walks in. Neither stops her.
   */
  private updateBarks(dt: number) {
    const p = this.player;
    const quiet = !this.started || !p.alive || this.fading || this.dialogue.waiting;
    for (const n of this.npcs) {
      if (!n.bark) continue;
      const key = `npc:${this.level.id}:${n.bark}@${Math.round(n.x)}`;
      if (Math.abs(p.x - n.x) > n.barkR || Math.abs(p.y - n.y) > 48) this.barks.away(key);
      else if (!quiet) this.barks.offer({ key, section: n.bark, x: n.x, y: n.y, leave: n.barkR + 48, rest: n.barkCd, npc: n });
    }
    for (const t of this.level.triggers) {
      if (t.mode !== "bark" || !this.storyCond(t.cond) || (t.period && t.period !== this.progress.period)) continue;
      const key = `said:${this.level.id}:${t.key}@${Math.round(t.x)}`;
      if (!t.contains(p.x, p.y)) {
        this.barks.away(key);
        continue;
      }
      if (quiet || (!t.repeat && this.progress.flags.has(key))) continue;
      if (this.barks.offer({ key, section: t.talk, x: t.x, y: t.y, leave: 200, rest: 4 }) && !t.repeat) this.progress.flags.add(key);
    }
    this.barks.update(dt);
  }

  /** `!name args` lines in the dialogue script. */
  scriptCommand(name: string, args: string[]) {
    const p = this.player;
    const prog = this.progress;
    switch (name) {
      case "flag":
        for (const a of args) prog.flags.add(a);
        break;
      case "unflag":
        for (const a of args) prog.flags.delete(a);
        break;
      case "learn": {
        const el = args[0];
        if (!isElement(el)) return console.warn(`[script.txt] !learn ${el}: unknown element`);
        if (prog.learnElement(el)) {
          p.applyUpgrades(this);
          this.spellBump = 1;
          this.runeFanfare(`获得符文 · ${ELEMENTS[el].name}`, ELEMENTS[el].main, ELEMENTS[el].accent);
        }
        break;
      }
      case "form": {
        const f = args[0];
        if (!isForm(f)) return console.warn(`[script.txt] !form ${f}: unknown form`);
        if (prog.learnForm(f)) this.runeFanfare(`获得符文 · ${FORMS[f].name}`, P.magicPink, P.magicYellow);
        break;
      }
      case "item":
      case "take": {
        const t = ITEM_NAMES[args[0]] as ItemType | undefined;
        const n = Math.max(1, Number(args[1]) || 1);
        if (!t || !ITEM_ORDER.includes(t)) return console.warn(`[script.txt] !${name} ${args[0]}: unknown item`);
        this.inventory[t] = Math.max(0, this.inventory[t] + (name === "take" ? -n : n));
        this.hudBump[t] = 1;
        sfx.pickup(0);
        this.floatText(`${name === "take" ? "-" : "+"}${n}`, p.x, p.y - 30, name === "take" ? P.cheek : P.cream);
        break;
      }
      case "wand":
        if (!prog.flags.has("wand")) {
          prog.flags.add("wand");
          this.spellBump = 1;
          this.runeFanfare("获得 · 法杖", P.magicPink, P.magicYellow);
        }
        break;
      case "quest": {
        const [id, ...text] = args;
        if (!id) return;
        prog.completedQuests.delete(id);
        prog.quests[id] = text.join(" ") || questDef(id)?.title || id;
        if (questDef(id)) prog.questStages[id] = 0;
        sfx.bookOpen();
        break;
      }
      case "stage": {
        const [id, stage] = args;
        const def = questDef(id);
        const index = def?.stages.findIndex((s) => s.id === stage);
        if (def && index !== undefined && index >= 0 && id in prog.quests) prog.questStages[id] = index;
        break;
      }
      case "done":
        for (const id of args) {
          if (!(id in prog.quests)) continue;
          this.ui.questDone(this.questText(prog.quests[id]));
          delete prog.quests[id];
          delete prog.questStages[id];
          prog.completedQuests.add(id);
          sfx.checkpoint();
        }
        break;
      case "period":
        if (STORY.periods.some((v) => v.id === args[0])) this.setPeriod(args[0]);
        break;
      case "nextperiod": {
        const i = STORY.periods.findIndex((v) => v.id === prog.period);
        if (i >= 0 && i < STORY.periods.length - 1) this.setPeriod(STORY.periods[i + 1].id);
        break;
      }
      case "heal":
        this.healPlayer(99);
        break;
      case "banner":
        this.ui.showBanner(args.join(" "));
        break;
      case "ending":
        sfx.victory();
        this.ui.showCard("阿梨梨去上学", "第一章 · 完", "感谢游玩！", "继续散步");
        break;
      // Staging; in a conversation the dialogue waits for these (dialogue.ts), mutterings just start them.
      case "pause":
      case "act":
      case "camera":
      case "shake":
      case "sfx":
        this.stagecraft.run(name, args);
        break;
    }
  }

  /** A quest line with its {木头}-style counters filled in. */
  questText(text: string) {
    return text.replace(/\{(.+?)\}/g, (all, k: string) => {
      const t = ITEM_NAMES[k] as ItemType | undefined;
      return t ? String(this.inventory[t]) : all;
    });
  }

  setPeriod(id: string) {
    if (this.progress.period === id) return;
    this.progress.period = id;
    this.ui.showBanner(`第 ${this.progress.day} 天 · ${periodName(id)}`);
    this.save();
  }

  private updateQuestStages() {
    for (const id of Object.keys(this.progress.quests)) {
      const def = questDef(id);
      if (!def) continue;
      const i = this.progress.questStages[id] ?? 0;
      const stage = def.stages[i];
      if (!stage?.autoAdvance || !stage.condition || !this.scriptCond(stage.condition)) continue;
      if (i + 1 < def.stages.length) this.progress.questStages[id] = i + 1;
      else this.scriptCommand("done", [id]);
      this.save();
    }
  }

  private questLines() {
    return Object.entries(this.progress.quests).map(([id, fallback]) => {
      const def = questDef(id);
      const stage = def?.stages[this.progress.questStages[id] ?? 0];
      const ready = stage?.condition && !stage.autoAdvance && this.scriptCond(stage.condition) ? " ✓ 可交付" : "";
      return this.questText(stage ? `${def!.title}：${stage.hint || stage.title}${ready}` : fallback);
    });
  }

  /** Fire each matching timeline entry once for this day, when play can resume. */
  private updateTimeline() {
    if (!this.started || this.dialogue.open || this.dialogue.waiting || this.interior.open) return false;
    for (const event of STORY.timeline) {
      if ((event.day && event.day !== this.progress.day) || event.period !== this.progress.period || !this.scriptCond(event.condition)) continue;
      const key = `${event.id}@${this.progress.day}`;
      if (this.progress.timelineSeen.has(key)) continue;
      this.progress.timelineSeen.add(key);
      for (const action of event.actions) this.scriptCommand(action.name, action.args);
      if (event.dialogue) this.talk(event.dialogue);
      this.save();
      return true;
    }
    return false;
  }

  /** Sparkles and a banner for a freshly learned rune. */
  private runeFanfare(text: string, main: string, accent: string) {
    const p = this.player;
    sfx.unlock();
    this.ui.showBanner(text);
    this.addFx(new RingFx(p.x, p.cy, 4, 40, 0.5, main, 1, 2));
    this.addFx(new RingFx(p.x, p.y, 6, 34, 0.5, accent, 0.3, 2));
    p.squash(0.6, 1.5);
    this.particles.burst(p.x, p.cy, {
      count: 24, colors: [main, accent, P.white], speed: [60, 180], life: [0.4, 0.8], shape: "spark", additive: true, drag: 3,
    });
  }

  // ------------------------------------------------------------- home

  /** Fades the screen out, runs mid while it's dark, then fades back in. */
  transition(mid: () => void) {
    if (this.fadeDir !== 0) return;
    this.fadeDir = 1;
    this.fadeMid = mid;
  }

  get fading() {
    return this.fadeDir !== 0;
  }

  enterHome() {
    const p = this.player;
    const c = this.cottage!;
    p.cancelCharge();
    c.openDoor();
    sfx.bookOpen();
    this.transition(() => {
      this.interior.enter();
      this.ui.setTip(null);
    });
    p.vx = 0;
  }

  leaveHome() {
    this.ui.setTip(null);
    this.transition(() => {
      this.interior.close();
      const c = this.enterLevel(HOME_MAP).cottage;
      if (c) {
        this.placePlayer(c.doorX, c.y, 1);
        c.openDoor();
      }
    });
  }

  /**
   * Sleeping in the cottage bed: a new day. Hearts refill, stumps regrow and
   * each friend in the garden leaves a gift out. Returns the number of gifts.
   */
  nextDay() {
    const prog = this.progress;
    prog.day++;
    prog.period = STORY.periods[0]?.id ?? "morning";
    this.player.hp = this.player.maxHp;
    for (const lv of this.levels.values()) for (const r of lv.resources) r.regrowNow();
    const home = this.homeLevel;
    const c = home.cottage;
    let gifts = 0;
    const gift = (type: ItemType, x: number) => {
      if (!c) return;
      const it = new Item(type, x, c.groundAt(home.world, x) - 6, rand(-30, 30), -rand(90, 150));
      it.keep = true;
      home.items.push(it);
      gifts++;
    };
    for (const pet of this.pets) {
      if (pet.kind === "rabbit") {
        gift("fur", pet.x);
        if (chance(0.4)) gift("apple", pet.x);
      } else {
        gift("stone", pet.x);
        gift("stone", pet.x);
        if (chance(0.25)) gift("crystal", pet.x);
      }
    }
    this.save();
    return gifts;
  }

  /** A friend who followed you home moves into the garden. */
  private moveIn(e: Enemy) {
    const c = this.cottage!;
    const kind = e.kind === "boar" ? "boar" : "rabbit";
    e.dead = true;
    e.hurtable = false;
    this.progress.pets.push(kind);
    const pet = new Pet(kind, e.x, c, this.world);
    pet.hopIn();
    this.pets.push(pet);
    this.save();
    sfx.friend();
    this.addFx(new HeartFx(e.x, e.y - 18, 1.4));
    this.addFx(new RingFx(e.x, e.y - 6, 4, 26, 0.4, P.blossom, 1, 2));
    this.ui.showBanner(kind === "rabbit" ? "小兔子搬进了花园" : "小野猪搬进了花园");
  }

  private updateHome(dt: number) {
    const c = this.cottage;
    if (!c) return;
    c.update(this, dt);
    for (const pet of this.pets) pet.update(this, dt);
    this.gardenFullT = Math.max(0, this.gardenFullT - dt);
    for (const e of this.enemies) {
      if (!e.friend || e.dead || !e.animal || e.x > c.gardenX1 + 4 || e.x < c.x - 30 || Math.abs(e.y - c.y) > 40) continue;
      if (this.progress.pets.length < GARDEN_CAP) this.moveIn(e);
      else if (this.gardenFullT <= 0) {
        this.gardenFullT = 4;
        this.floatText("FULL", e.x, e.y - e.h - 12, P.cream);
      }
    }
  }

  /**
   * Hold down at a lit lantern to travel: from the garden-gate lantern out to
   * your checkpoint lantern, from any other straight home. Friends trotting
   * along beside you come too.
   */
  private updateTravel(dt: number) {
    const p = this.player;
    let at: Lantern | null = null;
    if (p.alive && p.onGround && Math.abs(p.vx) < 12) {
      for (const l of this.lanterns) if (l.lit && Math.abs(l.x - p.x) < 12 && Math.abs(l.y - p.y) < 6) at = l;
    }
    const cp = this.progress.checkpoint;
    const dest = !at ? null : at.id === "home" ? (cp && cp !== "home" && findLantern(cp) ? cp : null) : "home";
    this.warpLantern = at && dest ? at : null;
    if (!dest || !this.input.down("down")) {
      this.warpT = Math.max(0, this.warpT - dt * 3);
      return;
    }
    this.warpT += dt;
    if (this.warpT < 0.7) return;
    this.warpT = 0;
    const friends = this.followers();
    const from = this.level;
    sfx.unlock();
    this.addFx(new RingFx(p.x, p.cy, 4, 30, 0.35, P.magicYellow, 1, 2));
    this.transition(() => {
      if (dest === "home") {
        const c = this.enterLevel(HOME_MAP).cottage;
        if (c) this.placePlayer(c.doorX + 14, c.y, 1);
      } else {
        const l = findLantern(dest)!;
        this.enterLevel(l.map);
        this.placePlayer(l.x - 14, l.y, 1);
      }
      this.bringAlong(friends, from);
      p.squash(0.6, 1.5);
      this.poof(p.x, p.cy, 10, [P.magicYellow, P.white]);
    });
  }

  /** Takes a temporary platform (ice pillar, vine, mushroom) out of the world, dropping whoever stood on it. */
  removePlatform(p: Platform) {
    const i = this.world.platforms.indexOf(p);
    if (i >= 0) this.world.platforms.splice(i, 1);
    for (const e of [this.player, ...this.enemies]) {
      if (e.platform !== p) continue;
      e.platform = null;
      e.onGround = false;
    }
  }

  spawnEnemy(kind: WildKind, x: number, y: number): Enemy {
    const e = makeEnemy(kind, x, y);
    this.enemies.push(e);
    return e;
  }

  // ------------------------------------------------------------- services for entities

  hitstop(frames: number) {
    this.freeze = Math.max(this.freeze, frames);
  }

  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  addFx(e: Effect) {
    this.effects.push(e);
  }

  floatText(text: string, x: number, y: number, color: string, big = false) {
    this.addFx(new FloatText(text, x, y, color, 0.7, big));
  }

  hurtables(): Entity[] {
    const out: Entity[] = [];
    for (const r of this.resources) if (r.hurtable) out.push(r);
    for (const e of this.enemies) if (e.hurtable && !e.dead) out.push(e);
    for (const g of this.gates) if (g.hurtable) out.push(g);
    return out;
  }

  spawnItem(type: ItemType, x: number, y: number, dir: number) {
    const vx = (dir === 0 ? rand(-40, 40) : dir * rand(20, 80)) + rand(-15, 15);
    this.items.push(new Item(type, x, y, vx, -rand(120, 190)));
  }

  spawnBolt(x: number, y: number, dir: number, vy = 0) {
    this.projectiles.push(new Bolt(x, y, dir, 1 + this.progress.level("star_dmg"), vy));
  }

  /** Harvest skill: better odds of materials dropping on each hit. */
  dropChance(base: number) {
    return Math.min(0.95, base + 0.15 * this.progress.level("harvest"));
  }

  splash(x: number, y: number) {
    const top = this.world.water(x, y) || this.world.water(x, y - 1) ? this.world.waterTop(x, y) : y;
    sfx.splash();
    this.addFx(new RingFx(x, top + 1, 3, 20, 0.35, P.white, 0.3, 1));
    this.particles.burst(x, top, {
      count: 18, colors: ["#d8f2ff", P.white, "#6fb8f0"], speed: [60, 170], angle: [-Math.PI * 0.8, -Math.PI * 0.2],
      life: [0.4, 0.7], size: [1, 2.5], gravity: 500, shape: "circle", shrink: true,
    });
  }

  /** Ice passing over water freezes a path beneath it (water up to `range` below y). */
  freezeWater(x: number, y: number, range = 60) {
    if (!this.world.freezeAt(x, y, 10, range)) return;
    const s = this.world.surfaceBelow(x, y - 6, range + 6);
    this.particles.burst(x, s ? s.y : y, {
      count: 2, colors: [P.iceHi, P.white], speed: [10, 40], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.3, 0.5], shape: "px", gravity: 100,
    });
  }

  /** Magic hitting the ground crumbles soft earth within r of (x, y). */
  hitTerrain(x: number, y: number, r: number) {
    const w = this.world;
    r = Math.max(r, 12); // even a small bolt knocks out a good chunk
    const tx0 = Math.floor((x - r - TILE) / TILE), tx1 = Math.floor((x + r + TILE) / TILE);
    const ty0 = Math.floor((y - r - TILE) / TILE), ty1 = Math.floor((y + r + TILE) / TILE);
    let broke = 0;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tileMat(w.tileAt(tx, ty)) !== Mat.Soft) continue;
        const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
        if (Math.hypot(cx - x, cy - y) > r + TILE * 0.75) continue;
        w.setTile(tx, ty, 0);
        broke++;
        this.particles.burst(cx, cy, {
          count: 6, colors: [P.dirt, P.dirtDark, P.pebble], speed: [40, 130], angle: [-Math.PI * 0.95, -Math.PI * 0.05],
          life: [0.5, 0.9], size: [1, 2.5], gravity: 520, bounce: 0.4, shape: "chunk", spread: 3,
        });
      }
    }
    if (!broke) return;
    w.refresh(tx0, ty0, tx1 + 1, ty1 + 1);
    // Anything standing on what just crumbled starts to fall.
    for (const e of [this.player, ...this.enemies, ...this.items]) {
      if (e.onGround && !e.platform && !w.solid(e.x, e.y)) e.onGround = false;
    }
    sfx.breakStone();
    this.shake(0.2);
    this.poof(x, y, 4, [P.cream, P.pebble]);
  }

  onGateOpened(g: Gate) {
    if (g.kind === "seal") return;
    this.progress.gates.add(g.id);
    this.save();
  }

  onBossDefeated(_boss: KingSlime) {
    this.bossState = "done";
    this.boss = null;
    this.progress.bossDefeated = true;
    this.progress.flags.add("boss");
    this.save();
    // Minions pop along with their king.
    for (const e of this.enemies) {
      if (e.kind === "slime" && e.x > this.arenaX && !e.dead) e.hurt(this, 99, 0, 1, "blast");
    }
    this.after(1.2, () => {
      this.level.arenaSeal?.setClosed(false);
      sfx.victory();
      this.ui.showBanner("打败了史莱姆大王！");
    });
  }

  /** Player went down: reset an unfinished boss fight so it can be retried. */
  onPlayerDown() {
    if (this.bossState !== "fighting") return;
    this.bossState = "waiting";
    this.boss = null;
    for (const e of this.enemies) if (e.x > this.arenaX - 10) e.dead = true;
    this.level.arenaSeal?.setClosed(false);
  }

  private updateLandmarks(dt: number) {
    const p = this.player;
    for (const g of this.gates) g.update(this, dt);
    for (const l of this.lanterns) l.update(this, dt);
    for (const t of this.tablets) t.update(this, dt);
    // Lanterns light up as you walk past them on solid ground; the last one touched is your checkpoint.
    if (p.alive && p.onGround) {
      for (const l of this.lanterns) {
        if (l.id === "home" || Math.abs(p.x - l.x) > 18 || Math.abs(p.y - l.y) > 10) continue;
        if (!l.lit) {
          l.light(this);
          this.progress.lit.add(l.id);
        }
        if (this.progress.checkpoint !== l.id) {
          this.progress.checkpoint = l.id;
          this.save();
        }
      }
    }
    // Hints from the nearest signpost.
    let tip: string | null = null;
    for (const s of this.level.signs) if (Math.abs(s.x - p.x) < 26 && Math.abs(s.y - p.y) < 40) tip = s.text;
    for (const t of this.tablets) {
      if (t.form && t.learned && t.near(this)) tip = `古老的石碑，刻着「${FORMS[t.form].name}」之符文。按 R 打开符文编织，把它织进你的魔法里。`;
    }
    tip = this.doorTip() ?? tip;
    const npc = this.npcInReach();
    if (npc) tip = `按 ↑ 和${npc.look.name}说话`;
    if (this.dialogue.waitFor?.tip) tip = this.dialogue.waitFor.tip;
    if (this.warpLantern?.id === "home") tip = "旅行灯笼 · 按住 ↓ 前往你的存档灯笼";
    else if (this.warpLantern) tip = "按住 ↓ 回到小屋（身边的动物朋友会跟你一起走）";
    else if (this.cottage?.atDoor(this)) tip = `小屋 · 按 ↑ 进门${this.pets.length ? `（花园里住着 ${this.pets.length} 位朋友）` : ""}`;
    this.ui.setTip(tip);
    const zone = this.world.zoneAt(p.x);
    if (zone !== this.zone) {
      this.zone = zone;
      this.ui.showBanner(zone);
    }
    this.ui.update(dt);
    // The king drops in once you step into his arena.
    if (this.bossState === "waiting" && p.alive && p.x > this.arenaX + 50) {
      this.bossState = "fighting";
      this.level.arenaSeal?.setClosed(true);
      sfx.rumble();
      const bx = Math.min(this.world.w - 60, p.x + 150);
      this.boss = new KingSlime(bx, this.world.restY(bx, p.y) - 170);
      this.enemies.push(this.boss);
      this.ui.showBanner("史莱姆大王");
    }
  }

  /** Runs fn after `t` seconds of game time (paused by hitstop and the star chart). */
  after(t: number, fn: () => void) {
    this.timers.push({ t, fn });
  }

  save() {
    if (!this.noSave) this.progress.save();
  }

  resetSave() {
    this.noSave = true;
    Progress.wipe();
    location.reload();
  }

  /** Called by the star chart each time a node levels up. */
  onUpgraded(s: Skill) {
    this.save();
    this.player.applyUpgrades(this);
    if (s.spell) this.spellBump = 1;
    const col = BRANCH_COLOR[s.branch];
    const msg = s.spell ? "NEW RUNE!" : s.id === "heart" ? "MAX HP UP!" : "POWER UP!";
    // Spells outrank plain power-ups when several were bought in one visit.
    if (!this.celebration || s.spell || this.celebration.msg !== "NEW RUNE!") this.celebration = { ...col, msg };
  }

  /** Little fanfare on the player once the chart closes. */
  private celebrate() {
    const c = this.celebration!;
    this.celebration = null;
    const p = this.player;
    this.addFx(new RingFx(p.x, p.cy, 4, 40, 0.5, c.main, 1, 2));
    this.addFx(new RingFx(p.x, p.y, 6, 34, 0.5, c.accent, 0.3, 2));
    sfx.heal();
    p.squash(0.6, 1.5);
    this.floatText(c.msg, p.x, p.y - 34, c.accent);
    this.particles.burst(p.x, p.cy, {
      count: 24, colors: [c.main, c.accent, P.white], speed: [60, 180], life: [0.4, 0.8], shape: "spark", additive: true, drag: 3,
    });
    this.particles.burst(p.x, p.cy, {
      count: 6, colors: [P.white], speed: [60, 130], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.6, 0.9], shape: "star", gravity: 200,
    });
  }

  /**
   * Lightning: a sigil opens in the sky over the best target in front of the
   * player, then a bolt slams down and arcs to up to two neighbours.
   */
  castThunder(p: Player) {
    const dir = p.facing;
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const h of this.hurtables()) {
      const dx = (h.x - p.x) * dir;
      const b = h.box();
      if (dx < -4 || dx > 150 || p.cy < b.y0 - 90 || p.cy > b.y1 + 90) continue;
      const score = Math.abs(dx - 20) + (h instanceof Enemy ? 0 : 80);
      if (score < bestScore) {
        bestScore = score;
        best = h;
      }
    }
    const tx = best ? best.x : clamp(p.x + dir * 70, 4, this.world.w - 4);
    const groundUnder = (x: number, y: number) => this.world.surfaceBelow(x, y - 30, 150)?.y ?? y;
    const skyY = Math.max(this.camY - 4, (best ? best.y - best.h : groundUnder(tx, p.y)) - 110);
    this.addFx(new SkySigilFx(tx, skyY, 0.16));
    sfx.thunderCharge();
    const aimed = best;
    this.after(0.14, () => {
      const target = aimed && !aimed.dead && aimed.hurtable ? aimed : null;
      const x = target ? target.x : tx;
      // Gates are tall: strike their crystal rather than their middle.
      const ground = groundUnder(x, target ? target.y : p.y);
      const y = target ? (target instanceof Gate ? target.y - 26 : target.cy) : ground;
      this.addFx(new LightningFx(x, skyY, x, y, 0.3, 2));
      this.addFx(new FlashFx(x, y, 12, 0.1, P.white, P.volt));
      const scorch = new RingFx(x, ground, 3, 26, 0.35, P.volt, 0.3, 2);
      scorch.layer = "back";
      this.addFx(scorch);
      this.particles.burst(x, y, {
        count: 22, colors: [P.white, P.volt, P.voltBlue], speed: [80, 260], life: [0.15, 0.35], shape: "spark", additive: true, drag: 5,
      });
      this.particles.burst(x, ground - 1, {
        count: 8, colors: [P.cream, P.white], speed: [40, 120], angle: [-Math.PI, 0], life: [0.3, 0.5], size: [2, 4], shape: "circle", shrink: true, drag: 5,
      });
      this.whiteFlash = 0.06;
      this.shake(0.45);
      sfx.thunder();
      if (!target) {
        this.hitTerrain(x, ground + 2, 10);
        this.hitstop(3);
        return;
      }
      const bonus = this.progress.level("thunder_dmg");
      target.hurt(this, 3 + bonus, Math.sign(target.x - p.x) || dir, 1.3, "thunder");
      this.hitstop(7);
      // Chain to nearby creatures.
      const hit = new Set<Entity>([target]);
      let from: Entity = target;
      for (let c = 0; c < 2 + this.progress.level("thunder_chain"); c++) {
        let next: Enemy | null = null;
        let nd = 70;
        for (const e of this.enemies) {
          if (e.dead || hit.has(e)) continue;
          const d = Math.hypot(e.x - from.x, e.cy - from.cy);
          if (d < nd) {
            nd = d;
            next = e;
          }
        }
        if (!next) break;
        const a = from, b: Enemy = next;
        hit.add(b);
        from = b;
        this.after(0.06 * (c + 1), () => {
          if (b.dead) return;
          this.addFx(new LightningFx(a.x, a.cy, b.x, b.cy, 0.2, 1));
          b.hurt(this, 2 + bonus, Math.sign(b.x - a.x) || dir, 1, "thunder");
          sfx.zap();
        });
      }
    });
  }

  dust(x: number, y: number, count: number, dir: number) {
    this.particles.burst(x, y - 1, {
      count, colors: [P.cream, P.white, P.pebble], speed: [10, 45],
      angle: dir > 0 ? [-0.6, 0] : dir < 0 ? [Math.PI, Math.PI + 0.6] : [Math.PI, Math.PI * 2],
      life: [0.25, 0.45], size: [1.5, 3], shape: "circle", shrink: true, drag: 5,
    });
  }

  poof(x: number, y: number, count: number, colors: string[]) {
    this.particles.burst(x, y, {
      count, colors, speed: [30, 100], life: [0.3, 0.6], size: [2.5, 5], shape: "circle", shrink: true, drag: 5, spread: 3,
    });
  }

  collect(item: Item) {
    const t = item.type;
    this.inventory[t]++;
    this.hudBump[t] = 1;
    this.pickupCombo = this.time - this.lastPickup < 0.7 ? this.pickupCombo + 1 : 0;
    this.lastPickup = this.time;
    sfx.pickup(this.pickupCombo);
    const p = this.player;
    this.floatText("+1", p.x, p.y - 24, P.cream);
    p.squash(1.08, 0.94);
    const heal = t === "apple" ? 1 : t === "meat" ? 2 : 0;
    if (heal && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + heal * 2);
      this.inventory[t]--;
      sfx.heal();
      this.floatText(`+${heal}`, p.x + 8, p.y - 30, P.heart);
      this.particles.burst(p.x, p.y - 8, {
        count: 8, colors: [P.heart, P.heartHi, P.white], speed: [20, 50], angle: [-Math.PI * 0.8, -Math.PI * 0.2],
        life: [0.4, 0.7], shape: "px", additive: true,
      });
    }
    this.particles.burst(p.x, p.y - 8, {
      count: 3, colors: [P.white, P.magicYellow], speed: [30, 60], life: [0.15, 0.3], shape: "px", additive: true,
    });
  }

  /** The charged spell: a pillar of starlight from the ground circle. */
  castBlast(x: number, y: number, level: number, dir: number) {
    const big = level >= 2;
    const pw = this.progress.level("charge_power");
    const r = (big ? 36 : 25) + pw * 5;
    const dmg = (big ? 6 : 3) + pw * 2;
    const power = big ? 3 : 2;
    this.addFx(new PillarFx(x, y, big ? 12 : 8, big ? 0.5 : 0.38, big ? 175 : 125));
    const ground = new RingFx(x, y, 4, r + 16, 0.35, P.white, 0.34, 2);
    ground.layer = "back";
    this.addFx(ground);
    this.addFx(new RingFx(x, y, 2, r + 30, 0.5, P.magicPink, 0.34));
    this.addFx(new RingFx(x, y - 40, 4, r + 10, 0.3, P.magicYellow, 1));
    this.addFx(new FlashFx(x, y - 8, big ? 16 : 11, 0.08));
    this.particles.burst(x, y - 4, {
      count: big ? 22 : 12, colors: [P.white], speed: [90, 240], angle: [-Math.PI * 0.85, -Math.PI * 0.15],
      life: [0.5, 0.9], shape: "star", gravity: 260, drag: 1.2,
    });
    this.particles.burst(x, y - 20, {
      count: big ? 50 : 30, colors: [P.white, P.magicYellow, P.magicPink, P.magicCyan], speed: [80, 320],
      life: [0.2, 0.5], shape: "spark", additive: true, drag: 4, spread: 10,
    });
    this.particles.burst(x, y - 2, {
      count: 14, colors: [P.cream, P.white], speed: [60, 160], angle: [Math.PI - 0.25, Math.PI + 0.05],
      life: [0.3, 0.6], size: [2, 5], shape: "circle", shrink: true, drag: 5,
    });
    this.particles.burst(x, y - 2, {
      count: 14, colors: [P.cream, P.white], speed: [60, 160], angle: [-0.05, 0.25],
      life: [0.3, 0.6], size: [2, 5], shape: "circle", shrink: true, drag: 5,
    });
    let hits = 0;
    for (const h of this.hurtables()) {
      const b = h.box();
      if (b.x1 > x - r && b.x0 < x + r && b.y1 > y - 100 && b.y0 < y + 12) {
        h.hurt(this, dmg, Math.sign(h.x - x) || dir, power, "blast");
        hits++;
      }
    }
    this.hitTerrain(x, y + 2, r * 0.7);
    this.hitstop(hits ? (big ? 10 : 7) : 4);
    this.shake(big ? 0.8 : 0.55);
    this.whiteFlash = big ? 0.12 : 0.07;
    sfx.blast(level);
  }

  // ------------------------------------------------------------- simulation

  tick(dt: number) {
    if (this.fadeDir !== 0) {
      // Doors and travel: everything holds still while the screen is dark.
      this.input.poll();
      this.fade = clamp(this.fade + dt * 5 * this.fadeDir, 0, 1);
      if (this.fadeDir > 0 && this.fade >= 1) {
        this.fadeMid?.();
        this.fadeMid = null;
        this.fadeDir = -1;
      } else if (this.fadeDir < 0 && this.fade <= 0) this.fadeDir = 0;
      return;
    }
    if (this.tree.open) {
      this.input.poll();
      this.tree.update(dt, this.input);
      return;
    }
    if (this.weave.open) {
      this.input.poll();
      this.weave.update(dt, this.input);
      return;
    }
    if (this.interior.open) {
      this.input.poll();
      this.interior.update(dt, this.input);
      return;
    }
    if (this.dialogue.open) {
      // The world holds still while people talk, but they keep breathing and blinking.
      this.input.poll();
      this.dialogue.update(dt, this.input);
      this.stagecraft.update(dt);
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      if (this.stagecraft.focus) this.updateCamera(dt);
      this.time += dt;
      this.effects = this.effects.filter((e) => e.update(dt));
      this.particles.update(dt);
      for (const n of this.level.npcs) n.update(dt, this.player.x, this.player.y);
      return;
    }
    if (this.celebration) this.celebrate();
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.redFlash = Math.max(0, this.redFlash - dt);
    this.whiteFlash = Math.max(0, this.whiteFlash - dt);
    if (this.freeze > 0) {
      this.freeze--;
      return;
    }
    this.input.poll();
    const p = this.player;
    this.stagecraft.update(dt);
    this.dialogue.updateWait(dt, this.input);
    this.updateQuestStages();
    this.ui.setQuests(this.questLines());
    this.ui.setStoryTime(this.progress.day, periodName(this.progress.period));
    if (this.ui.victoryOpen) {
      const inp = this.input;
      if (inp.pressed("confirm") || inp.pressed("jump") || inp.pressed("bolt") || inp.pressed("menu")) this.ui.closeVictory();
      return;
    }
    if (this.input.pressed("menu") || this.input.pressed("weave")) {
      p.cancelCharge();
      this.ui.setTip(null);
      if (this.input.pressed("menu")) this.tree.show();
      else this.weave.show();
      return;
    }
    if (this.updateTimeline()) return;
    if (this.input.pressed("up") && this.cottage?.atDoor(this) && !p.charging) {
      this.enterHome();
      return;
    }
    if (this.input.pressed("up") && !p.charging) {
      const npc = this.npcInReach();
      if (npc) {
        this.talk(npc.talk, npc);
        return;
      }
    }
    if (this.updateDoors()) return;
    if (this.updateTriggers()) return;
    this.updateBarks(dt);
    this.time += dt;
    this.spellBump = Math.max(0, this.spellBump - dt * 4);
    for (const t of this.timers) t.t -= dt;
    const due = this.timers.filter((t) => t.t <= 0);
    this.timers = this.timers.filter((t) => t.t > 0);
    for (const t of due) t.fn();
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 15;
      this.save();
    }

    p.update(this, dt);

    for (const e of this.enemies) e.update(this, dt);
    if (p.alive && p.inv <= 0) {
      const pb = p.box();
      pb.x0 += 2; pb.x1 -= 2; pb.y0 += 3;
      for (const e of this.enemies) {
        if (!e.dead && !e.disabled && e.dealsContactDamage() && overlap(pb, e.box())) {
          p.takeHit(this, 1, Math.sign(p.x - e.x) || -e.facing);
          break;
        }
      }
    }
    for (const r of this.resources) r.update(this, dt);
    for (const n of this.level.npcs) n.update(dt, p.x, p.y);
    for (const b of this.level.bridges) b.update(this, dt);
    this.world.update(dt);
    this.updateLandmarks(dt);
    this.updateHome(dt);
    this.updateTravel(dt);
    for (const it of this.items) it.update(this, dt);
    for (const b of this.projectiles) b.update(this, dt);
    this.effects = this.effects.filter((e) => e.update(dt));
    this.particles.update(dt);
    for (const t of ITEM_ORDER) this.hudBump[t] = Math.max(0, this.hudBump[t] - dt * 4);

    this.enemies = this.enemies.filter((e) => !e.dead);
    this.items = this.items.filter((i) => !i.dead);
    this.projectiles = this.projectiles.filter((b) => !b.dead);

    this.respawnEnemies(dt);
    this.updateCamera(dt);

    // Drifting pollen (or dust motes underground) keeps the air alive.
    if (Math.random() < dt * 4) {
      const under = this.world.bg === "burrow";
      this.particles.burst(this.camX + Math.random() * VW, this.camY + Math.random() * VH * 0.8, {
        count: 1, colors: under ? ["#ffd98a", "#fff2a0", P.cream] : [P.white, P.magicYellow, P.blossomHi],
        speed: [4, 12], angle: [-2.6, -0.5], life: [2, 4], shape: "px", additive: under,
      });
    }
  }

  /** Placed creatures come back a while after they're gone, out of sight. */
  private respawnEnemies(dt: number) {
    const cx = this.camX + VW / 2, cy = this.camY + VH / 2;
    for (const s of this.level.spawners) {
      if (s.enemy && !s.enemy.dead && this.enemies.includes(s.enemy)) continue;
      if (s.enemy) {
        s.enemy = null;
        s.t = RESPAWN_TIME;
      }
      s.t -= dt;
      if (s.t > 0) continue;
      if (Math.abs(s.x - cx) < VW / 2 + 40 && Math.abs(s.y - cy) < VH / 2 + 40) continue;
      if (s.x > this.arenaX - 10) continue;
      s.enemy = makeEnemy(s.kind, s.x, s.y, s.big);
      this.enemies.push(s.enemy);
    }
  }

  private updateCamera(dt: number) {
    const p = this.player;
    // A conversation can point the camera at someone else for a while.
    const f = this.stagecraft.focus;
    const tx = f ? f.x - VW / 2 : p.x + p.facing * 26 + p.vx * 0.15 - VW / 2;
    const ty = f ? f.y - VH * 0.7 : p.y - VH * 0.7;
    this.camX += (tx - this.camX) * damp(4.5, dt);
    this.camY += (ty - this.camY) * damp(p.vy > 150 ? 8 : 3.5, dt);
    this.clampCamera();
  }

  // ------------------------------------------------------------- rendering

  /** Faces, mouths and speech bubbles follow whoever is talking. */
  private updateSpeech() {
    const inWorld = !this.interior.open;
    if (!inWorld || this.tree.open || this.weave.open) this.barks.stopAll();
    this.speeches = [...this.dialogue.speeches(), ...this.barks.speeches()];
    for (const n of this.level.npcs) n.speaking = n.talking = false;
    for (const s of this.speeches) {
      if (!(s.anchor instanceof Npc)) continue;
      s.anchor.speaking = true;
      s.anchor.talking = s.typing;
      s.anchor.expr = s.expr;
    }
    if (!this.canvasEl) return;
    const camX = Math.round(this.camX), camY = Math.round(this.camY);
    const bubbles = [...this.dialogue.place(camX, camY, VW, VH, inWorld), ...this.barks.place(camX, camY, VW, VH)];
    const px = layoutBubbles(bubbles, this.canvasEl, camX, camY, VW);
    this.dialogue.fitCaption(px, this.canvasEl.clientWidth);
  }

  render(ctx: Ctx) {
    this.updateSpeech();
    if (this.interior.open) {
      this.interior.draw(ctx);
      if (this.tree.open) this.tree.draw(ctx);
      else if (this.weave.open) this.weave.draw(ctx);
    } else {
      const s = this.trauma * this.trauma * 7;
      const shx = Math.round((Math.random() * 2 - 1) * s);
      const shy = Math.round((Math.random() * 2 - 1) * s);
      this.renderWorld(ctx, Math.round(this.camX), Math.round(this.camY), VW, VH, shx, shy);
      if (this.whiteFlash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, this.whiteFlash * 5)})`;
        ctx.fillRect(0, 0, VW, VH);
      }
      if (this.redFlash > 0) {
        ctx.fillStyle = `rgba(255,70,110,${Math.min(0.35, this.redFlash * 2)})`;
        ctx.fillRect(0, 0, VW, VH);
      }
      if (this.tree.open) this.tree.draw(ctx);
      else if (this.weave.open) this.weave.draw(ctx);
      else drawHud(ctx, this, VW);
    }
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(28,20,50,${this.fade})`;
      ctx.fillRect(0, 0, VW, VH);
    }
  }

  /** Draws the current map as seen from (camX, camY); also used by the editor at other zooms. */
  renderWorld(ctx: Ctx, camX: number, camY: number, vw: number, vh: number, shx = 0, shy = 0) {
    const lv = this.level;
    const world = lv.world;
    const p = this.player;
    this.bgs[world.bg].draw(ctx, camX, camY, this.time, vw, vh);
    ctx.save();
    ctx.translate(-camX + shx, -camY + shy);

    const inView = (x: number, m = 40) => x > camX - m && x < camX + vw + m;
    world.drawLights(ctx, this.time, camX, camY, vw, vh);
    world.draw(ctx, camX, camY, vw, vh);
    world.drawPlatforms(ctx, this.time);
    for (const b of lv.bridges) if (b.x1 > camX - 20 && b.x0 < camX + vw + 20) b.draw(ctx, this.time);
    if (lv.scar && inView(lv.scar.x, 80)) lv.scar.draw(ctx, this.time, this.progress.bossDefeated);
    for (const e of this.effects) if (e.layer === "back") e.draw(ctx, this.time);
    p.drawChargeGround(ctx);
    for (const d of lv.doors) if (inView(d.x)) d.draw(ctx, this.time, !d.auto && p.onGround && d.touching(this));
    for (const s of lv.signs) if (inView(s.x)) s.draw(ctx, Math.abs(s.x - p.x) < 26 && Math.abs(s.y - p.y) < 40, this.time);
    for (const l of lv.lanterns) if (inView(l.x)) l.draw(ctx, this.time);
    if (this.warpLantern && this.warpT > 0) {
      // Travel charge: a ring fills around the lantern flame.
      const l = this.warpLantern;
      ring(ctx, l.x, l.y - 16, 11, 11, P.magicYellow, -Math.PI / 2, -Math.PI / 2 + (this.warpT / 0.7) * Math.PI * 2);
    }
    for (const t of lv.tablets) if (inView(t.x)) t.draw(ctx, this.time);
    const reach = this.dialogue.open ? null : this.npcInReach();
    for (const n of lv.npcs) if (inView(n.x) && this.storyCond(n.cond) && (!n.period || n.period === this.progress.period)) n.draw(ctx, this.time, n === reach);
    const c = lv.cottage;
    if (c && inView(c.x, 60)) {
      c.draw(ctx, this.time, c.atDoor(this));
      c.drawFence(ctx, world);
      for (const pet of this.pets) pet.draw(ctx, this);
    }

    for (const r of lv.resources) if (inView(r.x)) r.draw(ctx, this);
    for (const it of lv.items) if (inView(it.x)) it.draw(ctx, this);
    for (const e of lv.enemies) {
      if (!inView(e.x)) continue;
      e.draw(ctx, this);
      e.drawStatus(ctx, this);
    }
    if (this.stagecraft.playerHop) p.drawAt(ctx, this, p.x, p.y - this.stagecraft.playerHop, p.facing, 0, 0);
    else p.draw(ctx, this);
    for (const s of this.speeches) {
      // Next to the back of the head, a little above its centre.
      const a = s.anchor;
      if (a === "player") drawEmote(ctx, p.x, p.y - 20, p.facing, s.expr, s.t);
      else if (a) drawEmote(ctx, a.x, a.y - 20 - a.look.tall, a.facing, s.expr, s.t);
    }
    for (const g of lv.gates) if (inView(g.x)) g.draw(ctx, this);
    for (const b of lv.projectiles) b.draw(ctx);
    world.drawWater(ctx, this.time, camX, camY, vw, vh);
    p.drawChargeSigil(ctx, this.time);

    this.particles.draw(ctx, false);
    for (const e of this.effects) if (e.layer === "front") e.draw(ctx, this.time);
    this.particles.draw(ctx, true);
    ctx.restore();
  }
}
