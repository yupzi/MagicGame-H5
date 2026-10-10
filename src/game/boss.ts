import { sfx } from "../engine/audio";
import { blob, ellipse, px, rect, setOverride, type Ctx } from "../engine/gfx";
import { approach, clamp, rand, sign } from "../engine/math";
import { FlashFx, RingFx } from "./effects";
import { Enemy, type EnemyKind } from "./enemies";
import type { HitKind } from "./entity";
import type { Game } from "./game";
import { P } from "./palette";
import type { Projectile } from "./projectile";

const GOLD = "#ffd24a";
const GOLD_DARK = "#d49a2a";

type State = "intro" | "idle" | "hop" | "windup" | "leap" | "summon";

/**
 * King Slime. Cycles through three moves:
 *  - hop:    a few bouncy hops towards the player
 *  - leap:   crouch, jump sky-high over the player and slam down, sending
 *            shockwaves along the ground (jump over them!)
 *  - summon: jiggles and spits out little slimes
 * Below half health it gets faster and the slam sends out two waves each way.
 */
export class KingSlime extends Enemy {
  kind: EnemyKind = "king";
  private state: State = "intro";
  private timer = 0;
  private hops = 0;
  private cycle = 0;
  private airborne = true;
  private angryShown = false;

  constructor(x: number, y: number) {
    super(x, y);
    this.hw = 19;
    this.h = 30;
    this.hp = this.maxHp = 60;
    this.weight = 8;
    this.freezeDur = 1.1;
    this.shockDur = 0.35;
    this.rootDur = 0.5;
    this.facing = -1;
    this.maxFall = 520;
  }

  get phase2() {
    return this.hp <= this.maxHp / 2;
  }

  dealsContactDamage() {
    return true;
  }

  /** The king barely budges: keep his own momentum through hits. */
  hurt(game: Game, dmg: number, dir: number, power: number, kind: HitKind) {
    const { vx, vy, onGround } = this;
    super.hurt(game, dmg, dir, power, kind);
    if (this.dead) return;
    this.vx = vx;
    this.vy = vy;
    this.onGround = onGround;
    if (this.phase2 && !this.angryShown) {
      this.angryShown = true;
      sfx.bossRoar();
      game.shake(0.6);
      game.floatText("GRRR!", this.x, this.y - this.h - 14, P.red, true);
    }
  }

  private launchAt(vx: number, vy: number) {
    this.launch(vx, vy);
    this.airborne = true;
  }

  protected act(game: Game, dt: number) {
    this.baseUpdate(game, dt);
    this.moveBody(game.world, dt, false);
    if (this.airborne && this.onGround) {
      this.airborne = false;
      this.onLanded(game);
    }
    const p = game.player;
    const dx = p.x - this.x;
    this.timer -= dt;
    const fast = this.phase2 ? 0.7 : 1;

    switch (this.state) {
      case "intro":
      case "leap":
        break;
      case "idle":
        if (this.onGround) this.vx = approach(this.vx, 0, 600 * dt);
        if (this.timer <= 0 && this.onGround) {
          this.cycle++;
          this.facing = sign(dx) || this.facing;
          const move = this.cycle % 3;
          if (move === 0) {
            this.state = "summon";
            this.timer = 0.9;
          } else if (move === 1) {
            this.state = "hop";
            this.hops = this.phase2 ? 4 : 3;
            this.timer = 0;
          } else {
            this.state = "windup";
            this.timer = 0.6 * fast;
            sfx.snort();
          }
        }
        break;
      case "hop":
        if (this.onGround) this.vx = approach(this.vx, 0, 800 * dt);
        if (this.onGround && this.timer <= 0) {
          this.facing = sign(dx) || this.facing;
          this.launchAt(this.facing * (this.phase2 ? 115 : 85), -rand(210, 250));
          this.squash(0.75, 1.3);
          sfx.bossJump();
        }
        break;
      case "windup":
        this.vx = 0;
        this.sx = 1.35;
        this.sy = 0.68;
        if (Math.random() < 0.4) game.dust(this.x + rand(-this.hw, this.hw), this.y, 1, 0);
        if (this.timer <= 0) {
          const tx = clamp(p.x, game.arenaX + 40, game.world.w - 30);
          const vy = -440;
          const air = (2 * -vy) / this.gravity;
          this.launchAt((tx - this.x) / air, vy);
          this.state = "leap";
          this.squash(0.6, 1.5);
          sfx.bossJump();
          game.dust(this.x, this.y, 10, 0);
        }
        break;
      case "summon": {
        this.vx = 0;
        const j = Math.sin(this.timer * 40) * 0.08;
        this.sx = 1 + j;
        this.sy = 1 - j;
        if (this.timer <= 0) {
          const minions = game.enemies.filter((e) => e.kind === "slime" && e.x > game.arenaX).length;
          const n = Math.min(2, 4 - minions);
          for (let i = 0; i < n; i++) {
            const side = i === 0 ? -1 : 1;
            const s = game.spawnEnemy("slime", this.x + side * 8, this.y - this.h);
            s.launch(side * rand(60, 110), -rand(200, 260));
          }
          if (n > 0) {
            sfx.pop();
            game.poof(this.x, this.y - this.h, 8, [P.slime, P.slimeHi]);
          }
          this.squash(1.3, 0.75);
          this.state = "idle";
          this.timer = 0.8 * fast;
        }
        break;
      }
    }
  }

  private onLanded(game: Game) {
    const hard = this.landSpeed > 330;
    if (this.state === "intro") {
      this.slamFx(game, false);
      sfx.bossRoar();
      this.state = "idle";
      this.timer = 1.2;
      return;
    }
    if (this.state === "leap") {
      this.slamFx(game, true);
      this.state = "idle";
      this.timer = (this.phase2 ? 0.55 : 0.9);
      return;
    }
    if (this.state === "hop") {
      this.squash(1.35, 0.7);
      sfx.land();
      game.shake(0.2);
      game.dust(this.x, this.y, 6, 0);
      this.hops--;
      if (this.hops > 0) this.timer = this.phase2 ? 0.12 : 0.25;
      else {
        this.state = "idle";
        this.timer = 0.7;
      }
      return;
    }
    if (hard) this.slamFx(game, false);
  }

  private slamFx(game: Game, waves: boolean) {
    this.squash(1.6, 0.55);
    sfx.bossSlam();
    game.shake(0.85);
    game.hitstop(5);
    game.addFx(new RingFx(this.x, this.y, 8, 60, 0.4, P.white, 0.3, 2));
    game.addFx(new FlashFx(this.x, this.y - 4, 14, 0.08));
    game.dust(this.x - this.hw, this.y, 8, -1);
    game.dust(this.x + this.hw, this.y, 8, 1);
    game.particles.burst(this.x, this.y - 4, {
      count: 14, colors: [P.slime, P.slimeHi, P.slimeDark], speed: [60, 180], angle: [-Math.PI, 0],
      life: [0.4, 0.8], size: [1.5, 3], gravity: 420, bounce: 0.3, shape: "circle", shrink: true,
    });
    if (!waves) return;
    const speed = this.phase2 ? 175 : 140;
    for (const d of [-1, 1]) {
      game.projectiles.push(new Shockwave(this.x + d * this.hw, this.y, d, speed));
      if (this.phase2) game.after(0.45, () => game.projectiles.push(new Shockwave(this.x + d * this.hw, this.y, d, speed)));
    }
  }

  protected onHurt(game: Game, dir: number) {
    sfx.hitSoft();
    game.particles.burst(this.x, this.cy, {
      count: 8, colors: [P.slime, P.slimeHi, P.slimeDark], speed: [50, 140],
      angle: dir > 0 ? [-Math.PI * 0.6, 0.2] : [Math.PI - 0.2, Math.PI * 1.6], life: [0.4, 0.7], size: [1.5, 3],
      gravity: 450, bounce: 0.2, shape: "circle",
    });
  }

  protected onDeath(game: Game, dir: number) {
    game.hitstop(16);
    game.shake(1);
    game.whiteFlash = 0.2;
    sfx.bossSlam();
    game.addFx(new RingFx(this.x, this.cy, 6, 90, 0.7, P.white, 1, 3));
    game.addFx(new RingFx(this.x, this.cy, 4, 60, 0.5, GOLD, 1, 2));
    game.particles.burst(this.x, this.cy, {
      count: 60, colors: [P.slime, P.slimeHi, P.slimeDark], speed: [80, 260], angle: [-Math.PI, 0],
      life: [0.7, 1.3], size: [2, 4], gravity: 420, bounce: 0.3, shape: "circle", shrink: true,
    });
    game.particles.burst(this.x, this.cy, {
      count: 12, colors: [P.white], speed: [80, 180], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.8, 1.2], shape: "star", gravity: 200,
    });
    for (let i = 0; i < 8; i++) game.spawnItem("gel", this.x, this.y - 12, i % 2 ? dir : -dir);
    for (let i = 0; i < 5; i++) game.spawnItem("crystal", this.x, this.y - 12, 0);
    game.spawnItem("apple", this.x, this.y - 12, 0);
    game.spawnItem("apple", this.x, this.y - 12, 0);
    game.onBossDefeated(this);
  }

  draw(ctx: Ctx, game: Game) {
    if (this.flash > 0) setOverride(P.white);
    const s = 2.7;
    const rx = 7.5 * s * this.sx;
    const ry = 7 * s * this.sy;
    const cy = this.y - ry + 1;
    const y = Math.round(this.y);
    const body = this.phase2 ? "#6fd6a8" : P.slime;
    blob(ctx, this.x, cy, rx, ry, P.slimeDark, P.outline, y);
    ellipse(ctx, this.x - 1, cy - 2, rx - 2.5, ry - 3, body, y - 2);
    ellipse(ctx, this.x - rx * 0.45, cy - ry * 0.5, 4, 2.5, P.slimeHi);
    ellipse(ctx, this.x - rx * 0.2, cy - ry * 0.72, 1.5, 1, P.slimeHi);
    // A little slime friend visible inside
    ellipse(ctx, this.x + rx * 0.35, cy + ry * 0.35, 3, 2, P.slimeDark);

    const p = game.player;
    const look = clamp((p.x - this.x) * 0.04, -2.5, 2.5);
    const ex = this.x + look;
    const ey = cy - 2;
    if (this.state === "windup" || this.disabled) {
      rect(ctx, ex - 8, ey + 1, 4, 1, P.eye);
      rect(ctx, ex + 5, ey + 1, 4, 1, P.eye);
    } else {
      rect(ctx, ex - 7, ey - 2, 3, 5, P.eye);
      rect(ctx, ex + 5, ey - 2, 3, 5, P.eye);
      px(ctx, ex - 7, ey - 2, P.white);
      px(ctx, ex + 5, ey - 2, P.white);
    }
    if (this.phase2) {
      // Angry brows
      rect(ctx, ex - 9, ey - 5, 3, 1, P.eye); rect(ctx, ex - 6, ey - 4, 2, 1, P.eye);
      rect(ctx, ex + 7, ey - 5, 3, 1, P.eye); rect(ctx, ex + 5, ey - 4, 2, 1, P.eye);
    }
    rect(ctx, ex - 2, ey + 6, 5, 2, P.eye);
    px(ctx, ex - 1, ey + 7, P.cheek);
    rect(ctx, ex - 12, ey + 4, 3, 1, P.cheek);
    rect(ctx, ex + 10, ey + 4, 3, 1, P.cheek);

    // Crown, riding the squash
    const top = cy - ry;
    const cx = this.x - 1;
    const cw = 9;
    rect(ctx, cx - cw - 1, top - 5, cw * 2 + 2, 6, P.outline);
    for (const o of [-cw, -1, cw - 2]) rect(ctx, cx + o - 1, top - 10, 5, 6, P.outline);
    rect(ctx, cx - cw, top - 4, cw * 2, 4, GOLD);
    rect(ctx, cx - cw, top - 1, cw * 2, 1, GOLD_DARK);
    for (const o of [-cw, -1, cw - 2]) {
      rect(ctx, cx + o, top - 9, 3, 5, GOLD);
      px(ctx, cx + o + 1, top - 10, P.outline);
    }
    px(ctx, cx - cw + 1, top - 8, P.white);
    rect(ctx, cx - 1, top - 3, 2, 2, P.heart);
    px(ctx, cx - 5, top - 3, P.magicCyan);
    px(ctx, cx + 4, top - 3, P.magicCyan);
    setOverride(null);
  }
}

/** A ripple of slime rolling along the ground after the king's slam. */
export class Shockwave implements Projectile {
  dead = false;
  private t = 0;
  constructor(private x: number, private y: number, private dir: number, private speed: number) {}

  update(game: Game, dt: number) {
    this.t += dt;
    this.x += this.dir * this.speed * dt;
    this.y = game.world.restY(this.x, this.y);
    if (this.t > 2.2 || game.world.blocked(this.x, this.y - 10, this.y) || this.x < 4 || this.x > game.world.w - 4) {
      this.dead = true;
      game.dust(this.x, this.y, 4, -this.dir);
      return;
    }
    if (Math.random() < 0.6) game.dust(this.x - this.dir * 4, this.y, 1, -this.dir);
    const p = game.player;
    if (p.alive && Math.abs(p.x - this.x) < 7 && p.y > this.y - 9) p.takeHit(game, 1, this.dir);
  }

  draw(ctx: Ctx) {
    const x = this.x, y = this.y;
    const wob = Math.sin(this.t * 30) * 0.5;
    blob(ctx, x, y - 3, 5 + wob, 4 - wob, P.slimeDark, P.outline, Math.round(y));
    ellipse(ctx, x - this.dir, y - 4, 3.5, 2.5, P.slime, Math.round(y));
    px(ctx, x - this.dir * 2, y - 6, P.slimeHi);
    px(ctx, x - this.dir * 8, y - 2, P.slime);
    px(ctx, x - this.dir * 11, y - 1, P.slimeDark);
  }
}
