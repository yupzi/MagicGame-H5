/** Small DOM overlays: signpost hints, zone banners, the boss bar title and the victory card. */
export class Ui {
  private tip: HTMLDivElement;
  private banner: HTMLDivElement;
  private victoryEl: HTMLDivElement;
  private questsEl: HTMLDivElement;
  private storyTimeEl: HTMLDivElement;
  private questKey = "";
  private tipText = "";
  private bannerT = 0;

  constructor(host: HTMLElement) {
    this.tip = this.make(host, "tip");
    this.banner = this.make(host, "banner");
    this.victoryEl = this.make(host, "victory");
    this.questsEl = this.make(host, "quests");
    this.storyTimeEl = this.make(host, "story-time");
    this.victoryEl.innerHTML = `<div class="v-title"></div><div class="v-sub"></div><div class="v-sub small"></div><button class="v-btn"></button>`;
    this.victoryEl.querySelector("button")!.addEventListener("click", () => this.victoryEl.classList.remove("show"));
  }

  private make(host: HTMLElement, id: string) {
    const el = document.createElement("div");
    el.id = id;
    host.appendChild(el);
    return el;
  }

  setTip(text: string | null) {
    const t = text ?? "";
    if (t === this.tipText) return;
    this.tipText = t;
    if (t) this.tip.textContent = t;
    this.tip.classList.toggle("show", !!t);
  }

  /** The open quests in the top corner. */
  setQuests(lines: string[]) {
    const key = lines.join("\n");
    if (key === this.questKey) return;
    this.questKey = key;
    this.questsEl.innerHTML = lines.map((l) => `<div class="q">${l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</div>`).join("");
  }

  setStoryTime(day: number, period: string) {
    const label = `第 ${day} 天 · ${period}`;
    if (this.storyTimeEl.textContent !== label) this.storyTimeEl.textContent = label;
  }

  /** A finished quest flashes a tick before it leaves. */
  questDone(text: string) {
    const d = document.createElement("div");
    d.className = "q done";
    d.textContent = `✔ ${text}`;
    this.questsEl.parentElement!.appendChild(d);
    d.style.top = `${this.questsEl.offsetTop}px`;
    setTimeout(() => d.remove(), 1600);
  }

  showBanner(text: string) {
    this.banner.textContent = `～ ${text} ～`;
    this.banner.classList.remove("show");
    void this.banner.offsetWidth;
    this.banner.classList.add("show");
    this.bannerT = 2.6;
  }

  update(dt: number) {
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner.classList.remove("show");
    }
  }

  /** A full-screen card: a big title, a line or two and a button that closes it. */
  showCard(title: string, sub: string, small: string, button: string) {
    const q = (sel: string) => this.victoryEl.querySelector(sel)!;
    q(".v-title").textContent = title;
    q(".v-sub").textContent = sub;
    q(".v-sub.small").textContent = small;
    q(".v-btn").textContent = button;
    this.victoryEl.classList.add("show");
  }

  get victoryOpen() {
    return this.victoryEl.classList.contains("show");
  }

  closeVictory() {
    this.victoryEl.classList.remove("show");
  }
}
