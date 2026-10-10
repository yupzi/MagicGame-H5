// Every sound is synthesised with WebAudio, so the game ships no audio files.
import { rand } from "./math";

type Wave = OscillatorType;

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];

class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private chargeOsc: OscillatorNode | null = null;
  private chargeOsc2: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
  }

  private get ok() {
    return !!this.ctx && !this.muted;
  }

  private tone(type: Wave, f0: number, f1: number, dur: number, vol: number, delay = 0, attack = 0.004) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1: number, delay = 0, q = 1) {
    if (!this.ok) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(f0, t);
    bq.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  jump() { this.tone("square", 280, 560, 0.11, 0.05); }
  flap() { this.tone("triangle", 520, 760, 0.09, 0.07); this.noise(0.08, 0.05, "bandpass", 1500, 900, 0, 2); }
  land() { this.noise(0.07, 0.08, "lowpass", 600, 200); }
  step() { this.noise(0.03, 0.025, "lowpass", 900, 400); }

  bolt() {
    const p = rand(0.94, 1.06);
    this.tone("triangle", 1100 * p, 1700 * p, 0.09, 0.09);
    this.tone("sine", 2200 * p, 3000 * p, 0.06, 0.03, 0.02);
    this.noise(0.08, 0.04, "highpass", 3000, 6000);
  }
  poof() { this.noise(0.12, 0.06, "bandpass", 2400, 800, 0, 1.5); }

  hitWood() {
    const p = rand(0.9, 1.1);
    this.tone("sine", 220 * p, 90 * p, 0.12, 0.35);
    this.noise(0.09, 0.25, "lowpass", 1400, 300);
    this.tone("square", 140 * p, 60, 0.05, 0.06);
  }
  hitStone() {
    const p = rand(0.92, 1.08);
    this.tone("square", 900 * p, 500 * p, 0.05, 0.08);
    this.tone("triangle", 1800 * p, 1500 * p, 0.12, 0.08, 0.005);
    this.noise(0.1, 0.22, "highpass", 2500, 1500);
    this.tone("sine", 160, 70, 0.08, 0.2);
  }
  hitCrystal() {
    const p = rand(0.95, 1.05);
    this.tone("sine", 1760 * p, 1760 * p, 0.35, 0.08);
    this.tone("sine", 2637 * p, 2637 * p, 0.3, 0.05, 0.03);
    this.noise(0.08, 0.12, "highpass", 4000, 3000);
  }
  hitSoft() {
    const p = rand(0.9, 1.15);
    this.tone("sine", 420 * p, 110 * p, 0.14, 0.3);
    this.tone("triangle", 200 * p, 90, 0.08, 0.12);
    this.noise(0.06, 0.12, "lowpass", 1200, 300);
  }
  hitFlesh() {
    const p = rand(0.9, 1.1);
    this.tone("sine", 300 * p, 80 * p, 0.12, 0.32);
    this.noise(0.1, 0.2, "bandpass", 900, 300, 0, 1.2);
  }
  breakWood() {
    this.noise(0.35, 0.3, "lowpass", 2000, 150);
    this.tone("sine", 160, 45, 0.3, 0.35);
    this.tone("square", 90, 40, 0.18, 0.06, 0.05);
  }
  breakStone() {
    this.noise(0.4, 0.32, "lowpass", 3500, 200);
    this.tone("sine", 130, 35, 0.35, 0.35);
    for (let i = 0; i < 4; i++) this.tone("square", rand(700, 1200), rand(300, 500), 0.05, 0.04, 0.04 + i * 0.05);
  }
  breakCrystal() {
    [0, 4, 7, 12, 16].forEach((s, i) => this.tone("sine", 1320 * 2 ** (s / 12), 1320 * 2 ** (s / 12), 0.3, 0.06, i * 0.045));
    this.noise(0.2, 0.15, "highpass", 5000, 2500);
  }
  pop() {
    this.tone("sine", 700, 160, 0.16, 0.25);
    this.noise(0.18, 0.18, "bandpass", 2000, 500, 0, 1);
    this.tone("triangle", 1400, 2100, 0.1, 0.05, 0.08);
  }
  hurt() {
    this.tone("square", 520, 140, 0.25, 0.1);
    this.tone("sawtooth", 260, 90, 0.2, 0.05, 0.02);
    this.noise(0.12, 0.15, "lowpass", 1500, 300);
  }
  snort() { this.noise(0.18, 0.15, "bandpass", 500, 250, 0, 3); this.tone("sawtooth", 110, 80, 0.15, 0.05); }
  crash() { this.noise(0.3, 0.3, "lowpass", 1200, 100); this.tone("sine", 120, 40, 0.25, 0.3); }
  heal() { [0, 4, 7, 12].forEach((s, i) => this.tone("triangle", 660 * 2 ** (s / 12), 660 * 2 ** (s / 12), 0.12, 0.06, i * 0.05)); }

  pickup(combo: number) {
    const semi = PENTA[Math.min(combo, PENTA.length - 1)];
    const f = 700 * 2 ** (semi / 12);
    this.tone("square", f, f, 0.06, 0.045);
    this.tone("triangle", f * 2, f * 2, 0.1, 0.05, 0.03);
  }

  blast(level: number) {
    const v = level >= 2 ? 1 : 0.75;
    this.noise(0.7 * v, 0.4 * v, "lowpass", 4000, 120);
    this.tone("sine", 150, 32, 0.6, 0.45 * v);
    this.tone("square", 80, 40, 0.3, 0.08 * v);
    [0, 7, 12, 19, 24].forEach((s, i) => this.tone("triangle", 880 * 2 ** (s / 12), 880 * 2 ** (s / 12), 0.25, 0.04, 0.05 + i * 0.04));
  }
  fireCast() {
    const p = rand(0.94, 1.06);
    this.noise(0.18, 0.12, "bandpass", 900 * p, 2400 * p, 0, 1.2);
    this.tone("triangle", 300 * p, 520 * p, 0.12, 0.08);
  }
  explode() {
    this.noise(0.35, 0.3, "lowpass", 2600, 160);
    this.tone("sine", 180, 45, 0.3, 0.35);
    this.noise(0.25, 0.08, "highpass", 3000, 1200, 0.03);
  }
  sizzle() { this.noise(0.1, 0.035, "highpass", 5000, 2500); }
  iceCast() {
    const p = rand(0.95, 1.05);
    this.tone("sine", 2000 * p, 2600 * p, 0.08, 0.07);
    this.tone("triangle", 3100 * p, 3100 * p, 0.12, 0.03, 0.02);
    this.noise(0.08, 0.06, "highpass", 6000, 4000);
  }
  freeze() {
    [0, 5, 10].forEach((s, i) => this.tone("sine", 1800 * 2 ** (s / 12), 1800 * 2 ** (s / 12), 0.2, 0.05, i * 0.03));
    this.noise(0.15, 0.08, "highpass", 5000, 7000);
  }
  shatter() {
    for (let i = 0; i < 6; i++) this.tone("sine", rand(2200, 4200), rand(1500, 2500), 0.08, 0.05, i * 0.018);
    this.noise(0.22, 0.25, "highpass", 4500, 1800);
    this.tone("sine", 240, 90, 0.12, 0.2);
  }
  thunderCharge() { this.tone("sawtooth", 90, 900, 0.14, 0.03); this.noise(0.14, 0.04, "bandpass", 3000, 6000, 0, 3); }
  thunder() {
    this.noise(0.08, 0.45, "highpass", 7000, 2000);
    this.noise(0.8, 0.35, "lowpass", 1800, 80, 0.03);
    this.tone("sawtooth", 120, 40, 0.35, 0.12);
    this.tone("sine", 90, 30, 0.6, 0.35, 0.02);
  }
  zap() { this.tone("square", rand(1400, 2000), rand(300, 500), 0.07, 0.05); this.noise(0.06, 0.1, "highpass", 5000, 3000); }
  swap() { this.tone("triangle", 880, 1320, 0.07, 0.06); this.tone("sine", 1760, 1760, 0.08, 0.03, 0.05); }

  bookOpen() { [0, 4, 7].forEach((s, i) => this.tone("triangle", 523 * 2 ** (s / 12), 523 * 2 ** (s / 12), 0.12, 0.05, i * 0.04)); this.noise(0.15, 0.04, "bandpass", 2000, 4000, 0, 1); }
  bookClose() { [7, 4, 0].forEach((s, i) => this.tone("triangle", 523 * 2 ** (s / 12), 523 * 2 ** (s / 12), 0.1, 0.04, i * 0.035)); }
  /** One syllable of a talking voice. */
  blip(f: number, volume = 0.022) { const k = f * (0.94 + Math.random() * 0.12); this.tone("square", k, k * 1.04, 0.045, volume); }
  menuMove() { this.tone("square", 990, 990, 0.035, 0.03); }
  denied() { this.tone("square", 220, 180, 0.09, 0.06); this.tone("square", 180, 150, 0.1, 0.06, 0.09); }
  unlock() {
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone("triangle", 523 * 2 ** (s / 12), 523 * 2 ** (s / 12), 0.22, 0.07, i * 0.06));
    [0, 7, 12].forEach((s) => this.tone("sine", 1046 * 2 ** (s / 12), 1046 * 2 ** (s / 12), 0.9, 0.035, 0.45));
    this.noise(0.5, 0.05, "highpass", 6000, 3000, 0.4);
  }

  burnUp() {
    this.noise(1.2, 0.2, "bandpass", 600, 2400, 0, 0.8);
    this.noise(0.4, 0.2, "lowpass", 1500, 200);
    this.tone("sine", 140, 60, 0.5, 0.25);
  }
  rumble() {
    this.noise(1.4, 0.3, "lowpass", 300, 60);
    this.tone("sawtooth", 55, 40, 1.3, 0.08);
    [0, 5, 10, 15].forEach((s, i) => this.tone("sine", 880 * 2 ** (s / 12), 880 * 2 ** (s / 12), 0.3, 0.05, 0.1 + i * 0.1));
  }
  checkpoint() { [0, 7, 12].forEach((s, i) => this.tone("triangle", 784 * 2 ** (s / 12), 784 * 2 ** (s / 12), 0.2, 0.06, i * 0.06)); }
  splash() {
    this.noise(0.4, 0.3, "bandpass", 1800, 400, 0, 0.8);
    this.tone("sine", 500, 150, 0.2, 0.15);
    for (let i = 0; i < 4; i++) this.tone("sine", rand(900, 1600), rand(1600, 2400), 0.05, 0.04, 0.08 + i * 0.05);
  }
  dampFlap() { this.noise(0.12, 0.08, "lowpass", 800, 300); this.tone("triangle", 300, 200, 0.1, 0.04); }
  bossRoar() {
    this.tone("sawtooth", 110, 70, 0.9, 0.12);
    this.tone("square", 165, 90, 0.8, 0.06, 0.05);
    this.noise(0.9, 0.2, "bandpass", 400, 150, 0, 2);
  }
  bossJump() { this.tone("square", 120, 260, 0.2, 0.08); this.noise(0.15, 0.1, "lowpass", 800, 300); }
  bossSlam() {
    this.noise(0.6, 0.45, "lowpass", 1500, 60);
    this.tone("sine", 90, 28, 0.6, 0.5);
    this.tone("square", 60, 30, 0.3, 0.1);
  }
  victory() {
    const mel = [0, 4, 7, 12, 7, 12, 16, 19, 24];
    mel.forEach((s, i) => this.tone("square", 523 * 2 ** (s / 12), 523 * 2 ** (s / 12), 0.16, 0.05, i * 0.11));
    mel.forEach((s, i) => this.tone("triangle", 262 * 2 ** (s / 12), 262 * 2 ** (s / 12), 0.2, 0.06, i * 0.11));
    [0, 4, 7, 12].forEach((s) => this.tone("sine", 1046 * 2 ** (s / 12), 1046 * 2 ** (s / 12), 1.4, 0.03, 1.0));
  }

  /** Materials lift off towards a star. */
  treeCharge() {
    this.tone("sine", 400, 900, 0.18, 0.05);
    this.noise(0.2, 0.04, "bandpass", 1500, 4000, 0, 2);
  }
  /** Each material landing in a star: a climbing pentatonic plink. */
  treeTick(n: number) {
    const semi = PENTA[Math.min(n - 1, PENTA.length - 1)];
    const f = 880 * 2 ** (semi / 12);
    this.tone("triangle", f, f, 0.07, 0.05);
    this.tone("sine", f * 2, f * 2, 0.05, 0.02, 0.01);
  }
  levelUp(level: number) {
    const base = 523 * 2 ** ((level - 1) * 2 / 12);
    [0, 4, 7, 12].forEach((s, i) => this.tone("square", base * 2 ** (s / 12), base * 2 ** (s / 12), 0.12, 0.045, i * 0.045));
    this.tone("sine", 150, 60, 0.25, 0.3);
    this.noise(0.25, 0.08, "highpass", 5000, 2500, 0.05);
  }
  maxStamp() {
    this.tone("sine", 120, 40, 0.3, 0.35, 0.18);
    this.noise(0.2, 0.2, "lowpass", 1200, 150, 0.18);
    [0, 7, 12, 19].forEach((s, i) => this.tone("triangle", 1046 * 2 ** (s / 12), 1046 * 2 ** (s / 12), 0.3, 0.04, 0.25 + i * 0.05));
  }

  /** A ground circle opening under a pillar spell. */
  sigil() { this.tone("sine", 700, 1400, 0.12, 0.05); this.noise(0.1, 0.03, "bandpass", 3000, 5000, 0, 2); }
  /** A rune clicking into a woven circle, then the circle humming shut. */
  weave() {
    this.tone("square", 660, 660, 0.05, 0.04);
    [0, 5, 9, 12].forEach((s, i) => this.tone("triangle", 880 * 2 ** (s / 12), 880 * 2 ** (s / 12), 0.16, 0.05, 0.06 + i * 0.05));
    this.tone("sine", 220, 440, 0.4, 0.05, 0.05);
  }
  /** Flower magic: a soft bell glissando. */
  bloom() {
    [0, 4, 7, 11, 14].forEach((s, i) => this.tone("sine", 784 * 2 ** (s / 12), 784 * 2 ** (s / 12), 0.25, 0.04, i * 0.035));
    this.noise(0.2, 0.02, "highpass", 6000, 4000, 0.05);
  }
  /** Something tossed underhand. */
  lob() { this.tone("triangle", 300, 700, 0.12, 0.05); this.noise(0.1, 0.03, "bandpass", 1200, 2400, 0, 2); }
  /** Springing off a mushroom cap. */
  boing() { this.tone("sine", 180, 720, 0.22, 0.12); this.tone("triangle", 360, 1080, 0.14, 0.04, 0.02); }
  /** An animal decides it likes you. */
  friend() { [0, 7, 12, 16].forEach((s, i) => this.tone("triangle", 880 * 2 ** (s / 12), 880 * 2 ** (s / 12), 0.14, 0.05, i * 0.07)); }
  /** Copying a tablet: a soft rising shimmer while the circle draws itself. */
  tabletHum() { this.tone("sine", 330, 660, 1.3, 0.04); this.tone("sine", 495, 990, 1.3, 0.025, 0.1); }

  fizzle() { this.tone("triangle", 600, 300, 0.12, 0.05); }
  ding(level: number) {
    const f = level >= 2 ? 1568 : 1175;
    this.tone("sine", f, f, 0.4, 0.09);
    this.tone("sine", f * 1.5, f * 1.5, 0.3, 0.05, 0.02);
  }

  startCharge() {
    if (!this.ok || this.chargeOsc) return;
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 0.1);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 300;
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = 303;
    o.connect(g);
    o2.connect(g);
    g.connect(this.master);
    o.start();
    o2.start();
    this.chargeOsc = o;
    this.chargeOsc2 = o2;
    this.chargeGain = g;
  }
  setCharge(t: number) {
    if (!this.chargeOsc || !this.ctx) return;
    const f = 300 + t * 500;
    this.chargeOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.03);
    this.chargeOsc2!.frequency.setTargetAtTime(f * 1.505, this.ctx.currentTime, 0.03);
  }
  stopCharge() {
    if (!this.chargeOsc || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.chargeGain!.gain.cancelScheduledValues(t);
    this.chargeGain!.gain.setTargetAtTime(0.0001, t, 0.02);
    this.chargeOsc.stop(t + 0.1);
    this.chargeOsc2!.stop(t + 0.1);
    this.chargeOsc = this.chargeOsc2 = null;
    this.chargeGain = null;
  }
}

export const sfx = new Sfx();
