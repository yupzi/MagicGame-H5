// Renders every sound effect of src/engine/audio.ts to WAV files for the
// TapTap Maker version. The synth's two building blocks (tone and noise) are
// swapped for an offline renderer, so each sound is made exactly as written.
//
//   node scripts/maker/export-audio.mjs [path/to/MagicGame-Maker]
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const maker = resolve(process.argv[2] ?? join(root, "../MagicGame-Maker"));
if (!existsSync(join(maker, "scripts"))) throw new Error(`Not a Maker project: ${maker}`);
const out = join(maker, "assets/Sounds");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const RATE = 22050;
const MASTER = 0.55;
const VARIANTS = 3;

const bundle = join(here, ".audio-bundle.mjs");
await build({ entryPoints: [join(root, "src/engine/audio.ts")], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "error" });
const { sfx } = await import(pathToFileURL(bundle).href + "?t=" + Date.now());
rmSync(bundle, { force: true });

// ------------------------------------------------------------------ synth
let buf = null;
function ensure(n) {
  if (buf.length >= n) return;
  const b = new Float32Array(Math.max(n, buf.length * 2));
  b.set(buf);
  buf = b;
}
const expAt = (a, b, k) => a * Math.pow(b / a, Math.max(0, Math.min(1, k)));

function wave(type, ph) {
  const x = ph - Math.floor(ph);
  if (type === "sine") return Math.sin(x * Math.PI * 2);
  if (type === "square") return x < 0.5 ? 1 : -1;
  if (type === "sawtooth") return 2 * x - 1;
  return x < 0.25 ? x * 4 : x < 0.75 ? 2 - x * 4 : x * 4 - 4; // triangle
}

function tone(type, f0, f1, dur, vol, delay = 0, attack = 0.004) {
  const start = Math.round(delay * RATE);
  const n = Math.round((dur + 0.02) * RATE);
  ensure(start + n);
  f1 = Math.max(20, f1);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = t < dur ? expAt(f0, f1, t / dur) : f1;
    const g = t < attack ? expAt(0.0001, vol, t / attack) : t < dur ? expAt(vol, 0.0001, (t - attack) / (dur - attack)) : 0.0001;
    buf[start + i] += wave(type, ph) * g;
    ph += f / RATE;
  }
}

/** RBJ biquad, matching WebAudio's filter types (lowpass/highpass Q is in dB there). */
function noise(dur, vol, filter, f0, f1, delay = 0, q = 1) {
  const start = Math.round(delay * RATE);
  const n = Math.round((dur + 0.02) * RATE);
  ensure(start + n);
  f1 = Math.max(20, f1);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = Math.min(RATE * 0.49, t < dur ? expAt(f0, f1, t / dur) : f1);
    const w0 = (2 * Math.PI * f) / RATE;
    const cos = Math.cos(w0), sin = Math.sin(w0);
    const Q = filter === "bandpass" ? q : Math.pow(10, q / 20);
    const alpha = sin / (2 * Q);
    let b0, b1, b2;
    if (filter === "lowpass") { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
    else if (filter === "highpass") { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
    else { b0 = alpha; b1 = 0; b2 = -alpha; }
    const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
    const x = Math.random() * 2 - 1;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const g = t < dur ? expAt(vol, 0.0001, t / dur) : 0.0001;
    buf[start + i] += y * g;
  }
}

sfx.tone = tone;
sfx.noise = noise;
Object.defineProperty(sfx, "ok", { get: () => true });

/** Master gain and a simple static compressor (threshold -14 dB, ratio 4), like the web mix. */
function finish(samples) {
  const th = Math.pow(10, -14 / 20);
  let end = samples.length;
  while (end > 0 && Math.abs(samples[end - 1]) < 1e-4) end--;
  const pcm = Buffer.alloc(44 + end * 2);
  for (let i = 0; i < end; i++) {
    let v = samples[i] * MASTER;
    const a = Math.abs(v);
    if (a > th) v = Math.sign(v) * (th + (a - th) / 4);
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + end * 2, 4); pcm.write("WAVE", 8);
  pcm.write("fmt ", 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(RATE, 24); pcm.writeUInt32LE(RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36); pcm.writeUInt32LE(end * 2, 40);
  return pcm;
}

function render(name, fn) {
  buf = new Float32Array(RATE);
  fn();
  writeFileSync(join(out, `${name}.wav`), finish(buf));
}

const SKIP = new Set(["init", "constructor", "tone", "noise", "blip", "startCharge", "setCharge", "stopCharge", "pickup", "blast", "treeTick", "levelUp", "ding"]);
const names = Object.getOwnPropertyNames(Object.getPrototypeOf(sfx)).filter((k) => !SKIP.has(k) && typeof sfx[k] === "function");
const manifest = { rate: RATE, variants: VARIANTS, sounds: {} };
for (const k of names) {
  for (let v = 1; v <= VARIANTS; v++) render(`${k}_${v}`, () => sfx[k]());
  manifest.sounds[k] = VARIANTS;
}
const withArg = { pickup: [0, 13], blast: [1, 2], treeTick: [1, 14], levelUp: [1, 6], ding: [1, 2] };
for (const [k, [a, b]] of Object.entries(withArg)) {
  for (let n = a; n <= b; n++) render(`${k}${n}`, () => sfx[k](n));
  manifest.sounds[k] = [a, b];
}
// A talking blip at 520 Hz (the game pitches it per voice) and the charge hum loop
// (a triangle and a sine a fifth up; 2 s holds whole cycles of both, so it loops cleanly).
render("blip", () => tone("square", 520, 520 * 1.04, 0.045, 0.022));
buf = new Float32Array(RATE * 2);
for (let i = 0; i < RATE * 2; i++) {
  const t = i / RATE;
  buf[i] = (wave("triangle", t * 300) + wave("sine", t * 451.5)) * 0.035;
}
writeFileSync(join(out, "charge_loop.wav"), finish(buf));
writeFileSync(join(maker, "assets/Data/sounds.json"), JSON.stringify(manifest));
console.log(`rendered ${names.length * VARIANTS + 30} sounds to ${out}`);
