import { sfx } from "../engine/audio";
import { findAnchor, PLAYER_NAME } from "./bubbles";
import type { Game } from "./game";
import type { Npc } from "./people";

/**
 * Little bits of staging a conversation can ask for: a beat of silence,
 * people hopping, turning, walking or leaving, the camera looking at someone,
 * the screen shaking and one-off sounds. `run` starts one and says how long
 * the conversation should wait for it.
 */

/** Actions `!act` knows, in the script's words. */
export const ACTS: Record<string, string> = { 转身: "turn", 跳: "hop", 走: "walk", 退场: "leave", 出场: "enter" };

/** Sounds `!sfx` can play, by the names the script uses. */
export const SOUNDS: Record<string, (s: typeof sfx) => void> = {
  叮: (s) => s.ding(2), 跳: (s) => s.jump(), 噗: (s) => s.poof(), 魔法: (s) => s.bolt(), 得到: (s) => s.pickup(0),
  回血: (s) => s.heal(), 解锁: (s) => s.unlock(), 轰隆: (s) => s.rumble(), 水花: (s) => s.splash(), 吼叫: (s) => s.bossRoar(),
  跺地: (s) => s.bossSlam(), 胜利: (s) => s.victory(), 翻书: (s) => s.bookOpen(), 不行: (s) => s.denied(), 存档: (s) => s.checkpoint(),
  弹跳: (s) => s.boing(), 交朋友: (s) => s.friend(), 爆炸: (s) => s.explode(), 闪电: (s) => s.thunder(), 开花: (s) => s.bloom(),
  嘶: (s) => s.fizzle(), 心跳: (s) => s.snort(),
};

const HOP_TIME = 0.42;
const WALK_SPEED = 45;
const FADE_TIME = 0.5;

type Who = Npc | "player";

export class Stagecraft {
  /** Where the camera looks while someone other than the witch has the stage. */
  focus: { x: number; y: number } | null = null;
  /** The witch's hop, in pixels above the ground. */
  playerHop = 0;
  private hops = new Map<Who, number>();
  private walks = new Map<Npc, number>();
  private fades = new Map<Npc, number>();
  /** People the script has touched this conversation: they get their own will back afterwards. */
  private touched = new Set<Npc>();

  constructor(private game: Game) {}

  private who(name: string): Who | null {
    if (name === PLAYER_NAME) return "player";
    const a = findAnchor(this.game, name);
    return a && a !== "player" ? a : null;
  }

  /**
   * Starts a staging command. Returns the seconds a conversation should wait
   * (0 for things that happen at once). `blocking` is false for mutterings,
   * which never wait.
   */
  run(name: string, args: string[]): number {
    switch (name) {
      case "pause":
        return Math.max(0, Math.min(10, Number(args[0]) || 1));
      case "sfx":
        SOUNDS[args[0]]?.(sfx);
        return 0;
      case "shake":
        this.game.shake(0.22 * Math.max(1, Math.min(3, Number(args[0]) || 1)));
        return 0.25;
      case "camera": {
        const who = this.who(args[0] ?? PLAYER_NAME);
        if (!who || who === "player") {
          if (!this.focus) return 0;
          this.focus = null;
          return 0.6;
        }
        this.focus = { x: who.x, y: who.y };
        return 0.7;
      }
      case "act": {
        const who = this.who(args[0] ?? "");
        const act = ACTS[args[1] ?? ""];
        if (!who || !act) return 0;
        if (act === "turn") {
          if (who === "player") this.game.player.facing *= -1;
          else { who.facing *= -1; who.scripted = true; this.touched.add(who); }
          return 0.15;
        }
        if (act === "hop") {
          this.hops.set(who, 0);
          sfx.jump();
          return HOP_TIME;
        }
        if (who === "player") return 0;
        this.touched.add(who);
        who.scripted = true;
        if (act === "walk") {
          const dx = Number(args[2]) || 0;
          if (!dx) return 0;
          who.facing = Math.sign(dx);
          this.walks.set(who, who.x + dx);
          return Math.abs(dx) / WALK_SPEED;
        }
        if (act === "leave") { this.fades.set(who, -1); return FADE_TIME; }
        if (act === "enter") { who.gone = false; this.fades.set(who, 1); return FADE_TIME; }
        return 0;
      }
    }
    return 0;
  }

  update(dt: number) {
    for (const [who, t0] of this.hops) {
      const t = t0 + dt;
      const h = t >= HOP_TIME ? 0 : Math.sin((t / HOP_TIME) * Math.PI) * 7;
      if (who === "player") this.playerHop = h;
      else who.hop = h;
      if (t >= HOP_TIME) this.hops.delete(who);
      else this.hops.set(who, t);
    }
    for (const [npc, to] of this.walks) {
      const step = WALK_SPEED * dt;
      if (Math.abs(to - npc.x) <= step) {
        npc.x = to;
        this.walks.delete(npc);
      } else npc.x += Math.sign(to - npc.x) * step;
    }
    for (const [npc, dir] of this.fades) {
      npc.alpha = Math.max(0, Math.min(1, npc.alpha + (dir * dt) / FADE_TIME));
      if (dir < 0 && npc.alpha <= 0) { npc.gone = true; this.fades.delete(npc); }
      if (dir > 0 && npc.alpha >= 1) this.fades.delete(npc);
    }
  }

  /** The conversation is over: the camera goes back to the witch and people turn to her again. */
  endScene() {
    this.focus = null;
    for (const n of this.touched) n.scripted = false;
    this.touched.clear();
  }
}
