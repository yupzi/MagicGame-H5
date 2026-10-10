import { SCRIPT_DATA, Typer, type Line } from "./dialogue";
import { Bubble, findAnchor, headOf, onScreen, splitThought, type Anchor, type Speech } from "./bubbles";
import type { Game } from "./game";
import { LOOK_BY_NAME, type Npc } from "./people";

/**
 * Mutterings: a few lines that pop up in bubbles as the witch walks past
 * someone (or into a spot), without stopping her. Lines type out, wait a
 * moment, and move on by themselves; walking away lets them trail off.
 */

export interface BarkSource {
  /** Remembers when this source last spoke. */
  key: string;
  /** Dialogue (group or section) to play. */
  section: string;
  /** The muttering trails off once the witch is further than `leave` px from (x, y). */
  x: number;
  y: number;
  leave: number;
  /** Seconds of quiet after it's done. */
  rest: number;
  /** Lines with this person's name float over them. */
  npc?: Npc;
}

interface Run {
  src: BarkSource;
  lines: Line[];
  pc: number;
  hops: number;
  say: Extract<Line, { t: "say" }> | null;
  anchor: Anchor;
  thought: boolean;
  typer: Typer;
  /** Seconds the finished line stays up before the next. */
  hold: number;
  lineT: number;
  bubble: Bubble;
  /** Counting down while the bubble fades away. */
  gone: number;
}

/** Quieter than a conversation: walking past shouldn't be noisy. */
const VOLUME = 0.009;

export class Barks {
  private runs: Run[] = [];
  /** Per source: seconds until it may speak again, and whether the witch has stepped away since. */
  private rest = new Map<string, { t: number; armed: boolean }>();

  constructor(private game: Game, private host: HTMLElement) {}

  /** Starts a source muttering if it's rested and the witch has come back since last time. */
  offer(src: BarkSource) {
    const r = this.rest.get(src.key);
    if (r && (r.t > 0 || !r.armed)) return false;
    if (this.runs.some((x) => x.src.key === src.key)) return false;
    const section = src.section;
    const lines = SCRIPT_DATA[section];
    this.rest.set(src.key, { t: src.rest, armed: false });
    if (!lines) {
      console.warn(`[script.txt] 找不到自言自语的段落 ${section}`);
      return false;
    }
    const run: Run = {
      src, lines, pc: 0, hops: 0, say: null, anchor: null, thought: false,
      typer: new Typer(), hold: 0, lineT: 0, bubble: new Bubble(this.host, "bark"), gone: 0,
    };
    this.runs.push(run);
    this.next(run);
    return true;
  }

  /** The witch is out of this source's range: it may speak again once rested. */
  away(key: string) {
    const r = this.rest.get(key);
    if (r) r.armed = true;
  }

  /** Runs lines until the next one to say; ends the run when there's nothing left to say. */
  private next(run: Run) {
    run.say = null;
    while (true) {
      if (++run.hops > 200) return this.end(run);
      const l = run.lines[run.pc++];
      if (!l) return this.end(run);
      switch (l.t) {
        case "say": {
          // Narration has no one to float over; a speaker who isn't here is skipped too.
          const anchor = findAnchor(this.game, l.who, run.src.npc);
          if (!anchor) break;
          // One bubble per head: an older muttering from the same mouth gives way.
          for (const o of this.runs) if (o !== run && o.anchor === anchor && o.say) this.end(o);
          const { thought, text } = splitThought(l.text);
          run.say = l;
          run.anchor = anchor;
          run.thought = thought;
          run.typer.set(text);
          run.lineT = 0;
          run.hold = Math.min(4.5, Math.max(1.6, 1 + text.length * 0.09));
          run.bubble.setName("");
          run.bubble.setText(text);
          run.bubble.mode({ thought });
          run.bubble.show(true);
          return;
        }
        case "choice":
          return this.end(run);
        case "goto":
          run.lines = SCRIPT_DATA[l.to] ?? [];
          run.pc = 0;
          break;
        case "if":
          if (this.game.scriptCond(l.cond)) {
            run.lines = SCRIPT_DATA[l.to] ?? [];
            run.pc = 0;
          }
          break;
        case "cmd":
          if (l.name === "end" || l.name === "wait") return this.end(run);
          this.game.scriptCommand(l.name, l.args);
          break;
      }
    }
  }

  private end(run: Run) {
    if (run.gone > 0) return;
    run.say = null;
    run.bubble.hide();
    run.gone = 0.25;
    const r = this.rest.get(run.src.key);
    if (r) r.t = run.src.rest;
  }

  /** Everyone falls quiet at once (a conversation starts, a menu opens...). */
  stopAll() {
    for (const run of this.runs) {
      this.end(run);
      run.bubble.el.remove();
    }
    this.runs = [];
  }

  get active() {
    return this.runs.length > 0;
  }

  update(dt: number) {
    for (const r of this.rest.values()) r.t = Math.max(0, r.t - dt);
    const p = this.game.player;
    for (const run of this.runs) {
      if (run.gone > 0) {
        run.gone -= dt;
        if (run.gone <= 0) run.bubble.el.remove();
        continue;
      }
      if (Math.abs(p.x - run.src.x) > run.src.leave || Math.abs(p.y - run.src.y) > 90) {
        this.end(run);
        continue;
      }
      run.lineT += dt;
      const t = run.typer;
      if (t.typing) {
        const voice = run.thought ? 0 : (run.say?.who && LOOK_BY_NAME[run.say.who]?.voice) || 520;
        t.step(dt, voice, VOLUME);
        run.bubble.reveal(t.shown);
      } else if ((run.hold -= dt) <= 0) {
        this.next(run);
      }
    }
    this.runs = this.runs.filter((r) => r.gone > 0 || r.say);
  }

  speeches(): Speech[] {
    return this.runs.filter((r) => r.say).map((r) => ({ anchor: r.anchor, expr: r.say!.expr, typing: r.typer.typing, t: r.lineT }));
  }

  /** Points each bubble at its speaker for this frame; bubbles whose speaker is off screen hide. */
  place(camX: number, camY: number, vw: number, vh: number): Bubble[] {
    for (const run of this.runs) {
      if (!run.say) continue;
      const head = headOf(this.game, run.anchor);
      const seen = !!head && onScreen(head, camX, camY, vw, vh);
      run.bubble.head = head;
      if (seen && !run.bubble.visible) run.bubble.show(false);
      else if (!seen && run.bubble.visible) run.bubble.hide();
    }
    return this.runs.map((r) => r.bubble);
  }
}
