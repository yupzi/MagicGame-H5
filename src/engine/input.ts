export type Action = "left" | "right" | "up" | "down" | "jump" | "bolt" | "charge" | "swap" | "menu" | "weave" | "confirm";

const KEYMAP: Record<string, Action[]> = {
  ArrowLeft: ["left"], KeyA: ["left"],
  ArrowRight: ["right"], KeyD: ["right"],
  ArrowUp: ["jump", "up"], KeyW: ["jump", "up"], Space: ["jump"], KeyZ: ["jump"],
  ArrowDown: ["down"], KeyS: ["down"],
  KeyJ: ["bolt"], KeyX: ["bolt"],
  KeyK: ["charge"], KeyC: ["charge"],
  KeyQ: ["swap"], KeyL: ["swap"], ShiftLeft: ["swap"],
  KeyE: ["menu"], Tab: ["menu"], Escape: ["menu"],
  KeyR: ["weave"],
  Enter: ["confirm"], NumpadEnter: ["confirm"],
};

/** Typing into a text box shouldn't move the witch. */
function typing(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

/**
 * Keyboard + gamepad input. Presses are queued between ticks so a tap is never
 * lost, even when the game is frozen for hitstop.
 */
export class Input {
  private keysHeld = new Set<Action>();
  private padHeld = new Set<Action>();
  private queuedPressed = new Set<Action>();
  private queuedReleased = new Set<Action>();
  private pressedNow = new Set<Action>();
  private releasedNow = new Set<Action>();
  onAnyKey: (() => void) | null = null;

  /** While set (the map editor is open), the game ignores the keyboard. */
  muted = false;

  constructor() {
    window.addEventListener("keydown", (e) => {
      if (this.muted || typing(e.target)) return;
      this.onAnyKey?.();
      const acts = KEYMAP[e.code];
      if (!acts) return;
      e.preventDefault();
      for (const a of acts) {
        if (!this.keysHeld.has(a) && !this.padHeld.has(a)) this.queuedPressed.add(a);
        this.keysHeld.add(a);
      }
    });
    window.addEventListener("keyup", (e) => {
      const acts = KEYMAP[e.code];
      if (!acts) return;
      e.preventDefault();
      for (const a of acts) {
        this.keysHeld.delete(a);
        if (!this.padHeld.has(a)) this.queuedReleased.add(a);
      }
    });
    window.addEventListener("blur", () => {
      for (const a of this.keysHeld) this.queuedReleased.add(a);
      this.keysHeld.clear();
    });
  }

  private pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p && p.connected);
    const next = new Set<Action>();
    if (pad) {
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (ax < -0.35 || b(14)) next.add("left");
      if (ax > 0.35 || b(15)) next.add("right");
      if (ay > 0.5 || b(13)) next.add("down");
      if (ay < -0.5 || b(12)) next.add("up");
      if (b(0)) next.add("jump");
      if (b(2)) next.add("bolt");
      if (b(1) || b(3)) next.add("charge");
      if (b(4) || b(5)) next.add("swap");
      if (b(9)) next.add("menu");
      if (b(8)) next.add("weave");
      if (next.size) this.onAnyKey?.();
    }
    for (const a of next) if (!this.padHeld.has(a) && !this.keysHeld.has(a)) this.queuedPressed.add(a);
    for (const a of this.padHeld) if (!next.has(a) && !this.keysHeld.has(a)) this.queuedReleased.add(a);
    this.padHeld = next;
  }

  /** Forget every held key and queued press (e.g. when coming back from the editor). */
  reset() {
    this.keysHeld.clear();
    this.queuedPressed.clear();
    this.queuedReleased.clear();
    this.pressedNow.clear();
    this.releasedNow.clear();
  }

  /** Call once per simulation tick (skip during hitstop to keep presses queued). */
  poll() {
    this.pollGamepad();
    this.pressedNow = this.queuedPressed;
    this.releasedNow = this.queuedReleased;
    this.queuedPressed = new Set();
    this.queuedReleased = new Set();
  }

  down(a: Action) {
    return this.keysHeld.has(a) || this.padHeld.has(a);
  }
  pressed(a: Action) {
    return this.pressedNow.has(a);
  }
  released(a: Action) {
    return this.releasedNow.has(a);
  }
}
