import { drawSprite, ellipse, line, type Ctx } from "../engine/gfx";
import { pick, rand } from "../engine/math";
import { starSmall, starSprite } from "./sprites";
import type { World } from "./world";

export type Shape = "px" | "circle" | "spark" | "star" | "starSmall" | "chunk";

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number;
  size: number; color: string;
  gravity: number; drag: number;
  shape: Shape;
  additive: boolean;
  bounce: number; // >0: collides with the ground and bounces
  shrink: boolean;
}

export interface BurstOpts {
  count: number;
  colors: string[];
  speed: [number, number];
  angle?: [number, number]; // radians; default full circle
  life: [number, number];
  size?: [number, number];
  gravity?: number;
  drag?: number;
  shape?: Shape;
  additive?: boolean;
  bounce?: number;
  shrink?: boolean;
  spread?: number; // spawn position jitter
}

export class Particles {
  list: Particle[] = [];

  constructor(public world: World) {}

  burst(x: number, y: number, o: BurstOpts) {
    const [a0, a1] = o.angle ?? [0, Math.PI * 2];
    for (let i = 0; i < o.count; i++) {
      const a = rand(a0, a1);
      const s = rand(o.speed[0], o.speed[1]);
      const life = rand(o.life[0], o.life[1]);
      const sp = o.spread ?? 0;
      this.list.push({
        x: x + rand(-sp, sp), y: y + rand(-sp, sp),
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life, maxLife: life,
        size: o.size ? rand(o.size[0], o.size[1]) : 1,
        color: pick(o.colors),
        gravity: o.gravity ?? 0,
        drag: o.drag ?? 0,
        shape: o.shape ?? "px",
        additive: o.additive ?? false,
        bounce: o.bounce ?? 0,
        shrink: o.shrink ?? false,
      });
    }
  }

  update(dt: number) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) {
        list[i] = list[list.length - 1];
        list.pop();
        continue;
      }
      p.vy += p.gravity * dt;
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.bounce > 0 && this.world.solid(p.x, p.y + 0.5)) {
        // Rest on top of whatever was hit (unless it's a wall).
        let g = Math.floor(p.y + 0.5);
        for (let k = 0; k < 4 && this.world.solid(p.x, g - 1); k++) g--;
        if (!this.world.solid(p.x, g - 1)) {
          p.y = g - 0.5;
          if (p.vy > 25) {
            p.vy = -p.vy * p.bounce;
            p.vx *= 0.6;
          } else {
            p.vy = 0;
            p.vx *= 0.8;
          }
        } else {
          p.x -= p.vx * dt;
          p.vx = -p.vx * p.bounce;
        }
      }
    }
    if (list.length > 1500) list.splice(0, list.length - 1500);
  }

  draw(ctx: Ctx, additivePass: boolean) {
    if (additivePass) ctx.globalCompositeOperation = "lighter";
    for (const p of this.list) {
      if (p.additive !== additivePass) continue;
      const t = p.life / p.maxLife;
      const s = p.shrink ? p.size * t : p.size;
      switch (p.shape) {
        case "px": {
          const sz = Math.max(1, Math.round(s));
          ctx.fillStyle = p.color;
          ctx.fillRect(Math.round(p.x - sz / 2), Math.round(p.y - sz / 2), sz, sz);
          break;
        }
        case "chunk": {
          const sz = Math.max(1, Math.round(s));
          ctx.fillStyle = "#3b2a4a";
          ctx.fillRect(Math.round(p.x - sz / 2) - 1, Math.round(p.y - sz / 2) - 1, sz + 2, sz + 2);
          ctx.fillStyle = p.color;
          ctx.fillRect(Math.round(p.x - sz / 2), Math.round(p.y - sz / 2), sz, sz);
          break;
        }
        case "circle":
          if (s >= 0.6) ellipse(ctx, p.x, p.y, s, s, p.color);
          break;
        case "spark": {
          const len = Math.min(6, Math.hypot(p.vx, p.vy) * 0.03 + 1) * (0.4 + t * 0.6);
          const a = Math.atan2(p.vy, p.vx);
          line(ctx, p.x, p.y, p.x - Math.cos(a) * len, p.y - Math.sin(a) * len, p.color);
          break;
        }
        case "star":
          if (t > 0.25 || Math.floor(p.life * 30) % 2 === 0) drawSprite(ctx, starSprite, p.x - 2, p.y - 2);
          break;
        case "starSmall":
          if (t > 0.25 || Math.floor(p.life * 30) % 2 === 0) drawSprite(ctx, starSmall, p.x - 1, p.y - 1);
          break;
      }
    }
    if (additivePass) ctx.globalCompositeOperation = "source-over";
  }
}
