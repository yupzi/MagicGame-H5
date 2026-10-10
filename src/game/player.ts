import { sfx } from "../engine/audio";
import { blob, ellipse, line, px, rect, ring, setOverride, type Ctx } from "../engine/gfx";
import { approach, clamp, damp, lerp, rand } from "../engine/math";
import { outlined, spans } from "./draw";
import { CastCircleFx, drawMagicCircle, RingFx } from "./effects";
import { Entity } from "./entity";
import type { Game } from "./game";
import { P } from "./palette";
import { FireBall, IceShard } from "./projectile";
import { ELEMENTS, weaveInfo } from "./runes";
import { LobSpell, PetalBolt, PillarSpell, RingSpell } from "./weavespells";
import type { Platform } from "./world";

const RUN_SPEED = 96;
const STRIDE = 15; // run-cycle radians per unit of runT

const JUMP_V = 240;
const FLAP_V = 150;
const BASE_FLAPS = 5;
/** Hearts at the start; hp counts half hearts. */
/** Hearts at the start; hp itself counts half hearts. */
const BASE_HP = 5;
const CHARGE_L1 = 0.45;
const CHARGE_L2 = 1.1;
const BOUNCE_LOW = 300;
const BOUNCE_HIGH = 380;

export class Player extends Entity {
  facing = 1;
  alive = true;
  inv = 0;
  stun = 0;
  private coyote = 0;
  private jumpBuf = 0;
  private jumping = false;
  private flaps = 0;
  floating = false;
  private dropT = 0;
  private castCd = 0;
  /** No wand yet: the little "?" puff doesn't spam. */
  private fizzleCd = 0;
  private castAnim = 0;
  charging = false;
  chargeT = 0;
  chargeLevel = 0;
  chargeX = 0;
  chargeY = 0;
  private chargeRot = 0;
  private runT = 0;
  private blinkT = 2;
  private hatTilt = 0;
  private hatVel = 0;
  private respawnT = 0;
  /** Last solid footing away from water: where a dunk puts you back. */
  lastSafeX = 0;
  lastSafeY = 0;
  private dampT = 0;

  constructor(x: number, y: number) {
    super();
    this.x = x;
    this.y = y;
    this.hw = 5;
    this.h = 14;
    this.hp = this.maxHp = BASE_HP * 2;
  }

  /** Re-derive stats from crafted upgrades (hearts heal the new slot too). */
  /** Stat multipliers from the star chart, refreshed by applyUpgrades. */
  private speedMul = 1;
  private chargeMul = 1;

  private get l1() { return CHARGE_L1 * this.chargeMul; }
  private get l2() { return CHARGE_L2 * this.chargeMul; }

  applyUpgrades(game: Game) {
    this.speedMul = 1 + 0.1 * game.progress.level("speed");
    this.chargeMul = 1 - 0.15 * game.progress.level("charge_speed");
    const max = (BASE_HP + game.progress.hearts) * 2;
    if (max > this.maxHp && this.alive) this.hp += max - this.maxHp;
    this.maxHp = max;
    this.hp = Math.min(this.hp, max);
  }

  update(game: Game, dt: number) {
    this.flash = Math.max(0, this.flash - dt);
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn(game);
      return;
    }
    const inp = game.input;
    this.inv = Math.max(0, this.inv - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.blinkT -= dt;
    if (this.blinkT < -0.12) this.blinkT = rand(1.8, 4);

    // --- horizontal movement
    const move = this.stun > 0 ? 0 : (inp.down("right") ? 1 : 0) - (inp.down("left") ? 1 : 0);
    const maxSpd = (this.charging ? 38 : this.floating ? 74 : RUN_SPEED) * this.speedMul;
    let accel = this.onGround ? (move !== 0 ? 950 : 1250) : 700;
    if (move !== 0 && Math.sign(this.vx) === -move) accel *= 1.7; // snappy turnarounds
    if (this.stun > 0) accel = this.onGround ? 500 : 80;
    this.vx = approach(this.vx, move * maxSpd, accel * dt);
    if (move !== 0) this.facing = move;

    // --- jumping, flapping (puff-up float), dropping through clouds
    if (inp.pressed("jump")) this.jumpBuf = 0.13;
    if (this.onGround) {
      this.coyote = 0.1;
      this.flaps = 0;
    } else this.coyote -= dt;
    this.jumpBuf -= dt;

    if (this.jumpBuf > 0 && this.stun <= 0) {
      if (this.onGround && this.platform && inp.down("down")) {
        this.dropT = 0.25;
        this.onGround = false;
        this.platform = null;
        this.vy = 40;
        this.jumpBuf = 0;
        this.squash(1.2, 0.85);
      } else if (this.coyote > 0) {
        this.launch(this.vx, -JUMP_V);
        this.jumping = true;
        this.coyote = 0;
        this.jumpBuf = 0;
        this.squash(0.68, 1.38);
        sfx.jump();
        game.dust(this.x, this.y, 5, 0);
      } else if (game.world.overWater(this.x, this.y)) {
        // The lake mist soaks the puff: no floating out here.
        this.jumpBuf = 0;
        if (this.dampT <= 0) {
          this.dampT = 0.3;
          sfx.dampFlap();
          this.squash(1.15, 0.9);
          game.particles.burst(this.x, this.y - 6, {
            count: 4, colors: [P.cloudShade, "#b8d4f0"], speed: [10, 30], angle: [0, Math.PI], life: [0.3, 0.5], size: [1, 2], shape: "circle", shrink: true,
          });
        }
      } else if (!this.charging && this.flaps < BASE_FLAPS + game.progress.feathers * 2) {
        this.vy = -FLAP_V;
        this.flaps++;
        this.floating = true;
        this.jumping = false;
        this.jumpBuf = 0;
        this.squash(1.35, 0.78);
        sfx.flap();
        game.particles.burst(this.x - this.facing * 4, this.y - 2, {
          count: 5, colors: [P.white, P.cloudShade], speed: [20, 60], angle: [Math.PI * 0.3, Math.PI * 0.7],
          life: [0.25, 0.4], size: [1.5, 3], shape: "circle", shrink: true, drag: 5,
        });
      }
    }
    if (this.jumping && this.vy < 0 && !inp.down("jump")) {
      this.vy *= 0.45;
      this.jumping = false;
    }
    if (this.vy >= 0) this.jumping = false;

    this.dampT -= dt;
    if (this.floating && game.world.overWater(this.x, this.y)) {
      this.floating = false;
      sfx.dampFlap();
      game.particles.burst(this.x, this.y - 7, {
        count: 6, colors: [P.white, P.cloudShade], speed: [20, 50], life: [0.2, 0.4], size: [1.5, 2.5], shape: "circle", shrink: true, drag: 4,
      });
    }
    this.gravity = this.floating ? 430 : this.vy > 0 ? 780 : 640;
    this.maxFall = this.floating ? (inp.down("down") ? 200 : 52) : 300;
    this.dropT -= dt;

    const wasGround = this.onGround;
    this.moveBody(game.world, dt, true, this.dropT > 0);
    if (!wasGround && this.onGround) this.onLand(game);
    if (this.onGround && this.platform?.bouncy) this.bounce(game, this.platform, inp.down("jump"));
    if (this.onGround && !this.platform?.spell && !game.world.waterNear(this.x, this.y, 24)) {
      this.lastSafeX = this.x;
      this.lastSafeY = this.y;
    }
    if (game.world.inWater(this.x, this.y) || this.fellOut(game.world)) {
      this.dunk(game);
      return;
    }

    // --- running animation & footsteps
    if (this.onGround && Math.abs(this.vx) > 8) {
      const before = Math.cos(this.runT * STRIDE);
      this.runT += dt * (Math.abs(this.vx) / RUN_SPEED);
      // A foot touches down each time the stride crosses zero.
      if (Math.sign(Math.cos(this.runT * STRIDE)) !== Math.sign(before)) {
        sfx.step();
        if (Math.abs(this.vx) > 60) game.dust(this.x - this.facing * 3, this.y, 1, -this.facing);
      }
    }

    // --- hat spring
    const hatTarget = clamp(-this.vx * 0.04 + (this.floating ? Math.sin(game.time * 12) * 1.2 : 0), -4, 4);
    this.hatVel += ((hatTarget - this.hatTilt) * 140 - this.hatVel * 9) * dt;
    this.hatTilt += this.hatVel * dt;

    // --- casting
    this.castCd -= dt;
    this.fizzleCd -= dt;
    this.castAnim -= dt;
    if (inp.pressed("swap") && !this.charging) this.swapSpell(game);
    if (!game.hasWand) {
      // No wand yet: magic just fizzles.
      if ((inp.pressed("bolt") || inp.pressed("charge")) && this.fizzleCd <= 0) {
        this.fizzleCd = 0.8;
        sfx.fizzle();
        game.floatText("?", this.x + this.facing * 6, this.y - 30, P.cream);
      }
    } else if (inp.pressed("bolt") && this.castCd <= 0 && !this.charging && this.stun <= 0) this.castSpell(game);

    if (game.hasWand && !this.charging && inp.down("charge") && this.castCd <= 0 && this.stun <= 0) this.startCharge(game);
    if (this.charging) {
      if (!inp.down("charge")) this.releaseCharge(game);
      else this.updateCharge(game, dt);
    }

    this.updateSquash(dt);
  }

  private onLand(game: Game) {
    const amt = clamp(this.landSpeed / 320, 0.12, 0.45);
    this.squash(1 + amt, 1 - amt);
    this.hatVel -= this.facing * amt * 20;
    if (this.landSpeed > 140) {
      sfx.land();
      game.dust(this.x, this.y, 6, 0);
    }
    if (this.floating) {
      this.floating = false;
      // Exhale a little puff when landing out of a float.
      game.particles.burst(this.x + this.facing * 8, this.y - 7, {
        count: 4, colors: [P.white], speed: [40, 80], angle: this.facing > 0 ? [-0.3, 0.3] : [Math.PI - 0.3, Math.PI + 0.3],
        life: [0.2, 0.35], size: [2, 3], shape: "circle", shrink: true, drag: 6,
      });
    }
  }

  /** Springs off a mushroom cap; holding jump sends you higher. */
  private bounce(game: Game, p: Platform, held: boolean) {
    this.launch(this.vx, held ? -BOUNCE_HIGH : -BOUNCE_LOW);
    this.jumping = false;
    this.floating = false;
    this.flaps = 0;
    p.bounced = game.time;
    this.squash(0.6, 1.5);
    sfx.boing();
    game.particles.burst(this.x, this.y, {
      count: 8, colors: [P.blossom, P.blossomHi, P.white], speed: [30, 90], angle: [Math.PI * 0.1, Math.PI * 0.9], life: [0.25, 0.45], shape: "px",
    });
  }

  wandTip(): [number, number] {
    return [this.x + this.facing * 13, this.y - 13];
  }

  private swapSpell(game: Game) {
    const prog = game.progress;
    const slots = prog.filledSlots;
    if (slots.length < 2) {
      game.floatText(prog.forms.size > 1 || prog.elements.size > 1 ? "R: WEAVE" : "E: BOOK", this.x, this.y - 30, P.cream);
      return;
    }
    prog.slot = slots[(slots.indexOf(prog.slot) + 1) % slots.length];
    game.spellBump = 1;
    const w = prog.current;
    const el = ELEMENTS[w.el];
    sfx.swap();
    game.floatText(weaveInfo(w).tag, this.x, this.y - 30, el.accent);
    this.squash(1.12, 0.9);
    const [tx, ty] = this.wandTip();
    game.particles.burst(tx, ty, {
      count: 8, colors: [el.main, el.accent, P.white], speed: [30, 80], life: [0.2, 0.4], shape: "px", additive: true, drag: 5,
    });
  }

  private castSpell(game: Game) {
    const w = game.progress.current;
    const info = ELEMENTS[w.el];
    const [tx, ty] = this.wandTip();
    this.castCd = weaveInfo(w).cooldown;
    this.castAnim = 0.16;
    if (w.form === "ring") {
      game.projectiles.push(new RingSpell(game, this, w.el));
      this.castAnim = 0.3;
      this.squash(1.35, 0.72);
    } else if (w.form === "pillar") {
      const [px, py] = this.pillarTarget(game);
      game.projectiles.push(new PillarSpell(game, px, py, w.el, this.facing));
      this.castAnim = 0.25;
      this.squash(0.8, 1.2);
      game.addFx(new CastCircleFx(tx + this.facing * 2, ty + 1, this.facing, 0.2, info.main, info.accent, 9, "pillar", info.glyphs));
    } else if (w.form === "lob") {
      game.projectiles.push(new LobSpell(tx, ty - 1, w.el, this.facing, this.vx));
      this.castAnim = 0.22;
      this.squash(0.85, 1.15);
      game.addFx(new CastCircleFx(tx + this.facing * 2, ty + 1, this.facing, 0.2, info.main, info.accent, 8, "lob", info.glyphs));
    } else switch (w.el) {
      case "flower":
        game.projectiles.push(new PetalBolt(tx, ty + 1, this.facing));
        sfx.bloom();
        this.squash(0.88, 1.1);
        game.addFx(new CastCircleFx(tx + this.facing * 2, ty + 1, this.facing, 0.18, info.main, info.accent, 8, "bolt", info.glyphs));
        break;
      case "star":
        {
          // Meteor volley: extra bolts fan out slightly up and down.
          const n = 1 + game.progress.level("star_multi");
          for (let i = 0; i < n; i++) game.spawnBolt(tx, ty + 1, this.facing, (i - (n - 1) / 2) * 45);
        }
        sfx.bolt();
        this.vx -= this.facing * 30;
        this.squash(0.84, 1.14);
        break;
      case "fire":
        game.projectiles.push(new FireBall(tx, ty + 1, this.facing, 22 * (1 + 0.25 * game.progress.level("fire_radius"))));
        sfx.fireCast();
        this.vx -= this.facing * 55;
        this.squash(0.8, 1.2);
        game.addFx(new CastCircleFx(tx + this.facing * 2, ty + 1, this.facing, 0.22, P.fire, P.fireHi, 10, "bolt", ELEMENTS.fire.glyphs));
        break;
      case "ice":
        game.projectiles.push(new IceShard(tx, ty + 1, this.facing, 3 + game.progress.level("ice_pierce")));
        sfx.iceCast();
        this.vx -= this.facing * 20;
        this.squash(0.88, 1.1);
        game.addFx(new CastCircleFx(tx + this.facing * 2, ty + 1, this.facing, 0.18, P.ice, P.iceHi, 8, "bolt", ELEMENTS.ice.glyphs));
        break;
      case "thunder":
        game.castThunder(this);
        this.castAnim = 0.3;
        this.squash(1.2, 0.85);
        break;
    }
    game.particles.burst(tx, ty, {
      count: 6, colors: [P.white, info.main, info.accent], speed: [30, 90],
      life: [0.12, 0.25], shape: "px", additive: true, drag: 6,
    });
  }

  private startCharge(game: Game) {
    this.charging = true;
    this.chargeT = 0;
    this.chargeLevel = 0;
    this.chargeRot = 0;
    const [tx, ty] = this.chargeTarget(game);
    this.chargeX = tx;
    this.chargeY = ty;
    sfx.startCharge();
  }

  /** Ground under x near the witch's feet (up a slope or down a step), or her own footing. */
  private groundNear(game: Game, x: number) {
    const s = game.world.surfaceBelow(x, this.y - 18, 70);
    return s ? s.y : this.y;
  }

  private chargeTarget(game: Game): [number, number] {
    const w = game.world;
    let tx = this.x;
    // Walk the circle out in front, stopping at walls.
    for (let i = 0; i < 46; i += 2) {
      const nx = clamp(this.x + this.facing * (i + 2), 8, w.w - 8);
      if (w.solid(nx, this.y - 10) || w.blocked(nx, this.y - 10)) break;
      tx = nx;
    }
    const p = this.platform;
    if (p && tx >= p.x && tx <= p.x + p.w) return [tx, p.y];
    return [tx, this.groundNear(game, tx)];
  }

  /** Ground in front for pillar spells: stops short of walls and closed gates, sits on the water surface. */
  private pillarTarget(game: Game): [number, number] {
    const w = game.world;
    let x = this.x;
    for (let i = 0; i < 40; i += 2) {
      const nx = this.x + this.facing * (i + 2);
      const ahead = nx + this.facing * 8;
      if (nx < 8 || nx > w.w - 8 || w.blocked(ahead, this.y - 12) || w.solid(ahead, this.y - 10)) break;
      x = nx;
    }
    const p = this.platform;
    if (p && x >= p.x && x <= p.x + p.w) return [x, p.y];
    return [x, this.groundNear(game, x)];
  }

  chargeRadius() {
    return 7 + Math.min(1, this.chargeT / this.l2) * 21;
  }

  private updateCharge(game: Game, dt: number) {
    this.chargeT += dt;
    const lvl = this.chargeT >= this.l2 ? 2 : this.chargeT >= this.l1 ? 1 : 0;
    const [tx, ty] = this.chargeTarget(game);
    this.chargeX = lerp(this.chargeX, tx, damp(16, dt));
    this.chargeY = lerp(this.chargeY, ty, damp(22, dt));
    this.chargeRot += dt * (1.6 + lvl * 1.8);
    sfx.setCharge(Math.min(1, this.chargeT / this.l2));

    if (lvl > this.chargeLevel) {
      this.chargeLevel = lvl;
      sfx.ding(lvl);
      this.squash(1.15, 0.88);
      game.addFx(new RingFx(this.chargeX, this.chargeY, this.chargeRadius(), this.chargeRadius() + 12, 0.3, P.white, 0.35));
      const [wx, wy] = this.wandTip();
      game.particles.burst(wx, wy, {
        count: 10, colors: [P.white, P.magicYellow], speed: [40, 110], life: [0.2, 0.4], shape: "spark", additive: true, drag: 5,
      });
    }

    // Motes rising off the circle, denser at higher levels.
    const r = this.chargeRadius();
    const rate = 1 + lvl * 2;
    for (let i = 0; i < rate; i++) {
      if (Math.random() > 0.5) continue;
      const a = Math.random() * Math.PI * 2;
      game.particles.burst(this.chargeX + Math.cos(a) * r, this.chargeY + Math.sin(a) * r * 0.35, {
        count: 1, colors: lvl >= 2 ? [P.white, P.magicYellow] : [P.magicPink, P.magicPurple, P.magicYellow],
        speed: [15, 45], angle: [-Math.PI * 0.6, -Math.PI * 0.4], life: [0.3, 0.6], shape: "px", additive: true,
      });
    }
    // Wand tip sparkle.
    if (Math.random() < 0.5) {
      const [wx, wy] = this.wandTip();
      game.particles.burst(wx, wy, {
        count: 1, colors: [P.magicYellow, P.white], speed: [5, 25], life: [0.15, 0.3], shape: "px", additive: true, spread: 1.5,
      });
    }
  }

  private releaseCharge(game: Game) {
    sfx.stopCharge();
    if (this.chargeLevel === 0) {
      sfx.fizzle();
      game.particles.burst(this.chargeX, this.chargeY - 2, {
        count: 6, colors: [P.magicPink, P.magicPurple], speed: [10, 40], angle: [-Math.PI, 0], life: [0.2, 0.4], shape: "px",
      });
      this.castCd = 0.12;
    } else {
      game.castBlast(this.chargeX, this.chargeY, this.chargeLevel, this.facing);
      this.castCd = 0.4;
      this.castAnim = 0.25;
      this.squash(1.25, 0.8);
    }
    this.charging = false;
    this.chargeT = 0;
    this.chargeLevel = 0;
  }

  cancelCharge() {
    if (!this.charging) return;
    sfx.stopCharge();
    this.charging = false;
    this.chargeT = 0;
    this.chargeLevel = 0;
  }

  /** dmg is in whole hearts. */
  takeHit(game: Game, dmg: number, dir: number) {
    if (this.inv > 0 || !this.alive) return;
    this.hp -= dmg * 2;
    this.inv = 1.3;
    this.stun = 0.32;
    this.floating = false;
    this.cancelCharge();
    this.launch(dir * 150, -170);
    this.flash = 0.12;
    this.squash(1.45, 0.6);
    game.hitstop(7);
    game.shake(0.55);
    game.redFlash = 0.18;
    sfx.hurt();
    game.particles.burst(this.x, this.y - 16, {
      count: 5, colors: [P.magicYellow], speed: [40, 90], angle: [-Math.PI * 0.9, -Math.PI * 0.1], life: [0.4, 0.6],
      shape: "starSmall", gravity: 200,
    });
    if (this.hp <= 0) this.die(game);
  }

  /** Fell in the water (or down a pit): splash, lose half a heart, pop back out on the last safe ground. */
  private dunk(game: Game) {
    if (game.world.inWater(this.x, this.y)) game.splash(this.x, this.y);
    this.cancelCharge();
    this.floating = false;
    this.hp -= 1;
    game.redFlash = 0.15;
    game.shake(0.3);
    sfx.hurt();
    if (this.hp <= 0) {
      this.die(game);
      return;
    }
    this.x = this.lastSafeX;
    this.y = game.world.restY(this.lastSafeX, this.lastSafeY) - 24;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.platform = null;
    this.inv = 1.3;
    this.squash(0.6, 1.5);
    game.poof(this.x, this.y, 8, [P.white, "#d8f2ff"]);
  }

  private die(game: Game) {
    this.alive = false;
    this.respawnT = 2;
    this.hp = 0;
    game.shake(0.8);
    sfx.pop();
    game.poof(this.x, this.y - 7, 14, [P.white, P.hair, P.dress, P.hat]);
    game.onPlayerDown();
  }

  private respawn(game: Game) {
    this.alive = true;
    this.hp = this.maxHp;
    // At home you step out of the cottage door; elsewhere you drop in by the lantern.
    const home = game.respawnAtCheckpoint();
    if (!home) {
      this.y -= 40;
      this.onGround = false;
    }
    this.inv = 2;
    this.squash(0.6, 1.5);
    game.particles.burst(this.x, this.y, {
      count: 16, colors: [P.white, P.magicYellow, P.magicPink], speed: [40, 120], life: [0.3, 0.6], shape: "px", additive: true, drag: 4,
    });
  }

  /** Stands the witch at (x, y), still and on the ground. */
  placeAt(x: number, y: number, facing: number) {
    this.x = x;
    this.y = y;
    this.vx = this.vy = 0;
    this.onGround = true;
    this.platform = null;
    this.floating = false;
    this.facing = facing;
    this.lastSafeX = x;
    this.lastSafeY = y;
  }

  /** Rune ring on the ground where the pillar will erupt; drawn behind entities. */
  drawChargeGround(ctx: Ctx) {
    if (!this.charging) return;
    const r = this.chargeRadius();
    const full = this.chargeLevel >= 2;
    const cx = this.chargeX, cy = this.chargeY - 1;
    const main = full ? P.magicYellow : P.magicPink;
    const span = Math.min(1, this.chargeT / this.l1) * Math.PI * 2;
    ctx.globalAlpha = 0.3;
    ellipse(ctx, cx, cy, r + 1, r * 0.28 + 1, "#3d2366");
    ctx.globalAlpha = 1;
    ring(ctx, cx, cy, r, r * 0.28, main, this.chargeRot, this.chargeRot + span);
    ring(ctx, cx, cy, r - 4, (r - 4) * 0.28, P.white, -this.chargeRot, -this.chargeRot + span);
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = this.chargeRot * 0.7 + (i / n) * Math.PI * 2;
      px(ctx, cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2) * 0.28, full ? P.white : P.magicYellow);
    }
  }

  /** Upright sigil hovering over the target; drawn in front of entities. */
  drawChargeSigil(ctx: Ctx, time: number) {
    if (!this.charging) return;
    const k = Math.min(1, this.chargeT / this.l2);
    const R = 7 + k * 13;
    const full = this.chargeLevel >= 2;
    drawMagicCircle(ctx, this.chargeX, this.chargeY - 8 - R + Math.sin(time * 3) * 1.5, R, this.chargeRot, {
      ax: 1, ay: 1, progress: Math.min(1, this.chargeT / this.l1),
      main: full ? P.magicYellow : P.magicPink,
      accent: full ? P.white : P.magicPurple,
      pulse: full ? (Math.sin(time * 30) > 0 ? 1 : 0) : 0,
      alpha: 0.95,
    });
  }

  /**
   * Draws the witch somewhere else (the cottage interior) without disturbing
   * where she really is in the world.
   */
  drawAt(ctx: Ctx, game: Game, x: number, y: number, facing: number, speed: number, runT: number) {
    const saved = [this.x, this.y, this.vx, this.facing, this.onGround, this.floating, this.charging, this.inv, this.flash, this.runT, this.stun] as const;
    this.x = x; this.y = y; this.vx = speed; this.facing = facing; this.onGround = true;
    this.floating = false; this.charging = false; this.inv = 0; this.flash = 0; this.runT = runT; this.stun = 0;
    this.draw(ctx, game);
    [this.x, this.y, this.vx, this.facing, this.onGround, this.floating, this.charging, this.inv, this.flash, this.runT, this.stun] = saved;
  }

  draw(ctx: Ctx, game: Game) {
    if (!this.alive) return;
    if (this.inv > 0 && this.flash <= 0 && Math.floor(this.inv * 18) % 2 === 0) return;
    if (this.flash > 0) setOverride(P.white);

    const f = this.facing;
    const running = this.onGround && Math.abs(this.vx) > 8;
    const phase = this.runT * STRIDE;
    const bob = running ? -Math.abs(Math.sin(phase)) : !this.onGround ? 0 : Math.sin(game.time * 3) * 0.4;
    const x = Math.round(this.x);
    const hy = Math.round(this.y - 14 * this.sy + bob); // head centre
    const dTop = hy + 5;
    const dBot = Math.round(this.y - 3 + bob) - (this.floating ? 1 : 0);
    // Floating: the skirt opens like a little parasol and flutters with each flap.
    const spread = this.floating ? 3.5 + Math.sin(game.time * 22) : 0;

    // Long hair behind: streams back when running, lifts while floating.
    const hairEnd = this.floating ? hy + 7 : Math.round(this.y - 5 + bob);
    const stream = running ? Math.min(1, Math.abs(this.vx) / RUN_SPEED) : !this.onGround && !this.floating ? 0.5 : 0;
    const hairShift = (t: number) => -f * (1.5 + stream * 3 * t * t);
    const hairHalf = (t: number) => lerp(5.5, this.floating ? 7 : 5, t);
    outlined((dx, dy, c) => spans(ctx, x, hy - 2, hairEnd, hairHalf, hairShift, dx, dy, c), P.hair);
    spans(ctx, x - f, hy + 2, hairEnd, (t) => lerp(2, 3, t), hairShift, 0, 0, P.hairShade);

    // Legs: striped stockings and little boots.
    const legs: [number, number][] = [];
    if (running) {
      // The lifted foot swings forward, whichever way she faces.
      const a = -f * Math.sin(phase);
      legs.push([x - 2 + a * 2, this.y - 1 - Math.max(0, -Math.cos(phase)) * 1.5]);
      legs.push([x + 2 - a * 2, this.y - 1 - Math.max(0, Math.cos(phase)) * 1.5]);
    } else if (this.onGround) {
      legs.push([x - 2, this.y - 1], [x + 2, this.y - 1]);
    } else {
      const dangle = this.floating ? 2 : this.vy < 0 ? 0 : 1;
      legs.push([x - 1.5, this.y - 1 + dangle], [x + 1.5, this.y + dangle]);
    }
    for (const [lx, ly] of legs) {
      const cx = Math.round(lx);
      for (let yy = dBot; yy < Math.round(ly) - 1; yy++) px(ctx, cx, yy, yy % 2 ? P.outline : P.white);
      blob(ctx, lx, ly - 0.3, 1.8, 1.2, P.boot, P.outline);
    }

    // Dress: a little bell skirt with a starry hem.
    const half = (t: number) => lerp(3.5, 6 + spread, Math.pow(t, 1.2)) * this.sx;
    const sway = (t: number) => -f * (running ? 1.5 : 0) * t * t;
    outlined((dx, dy, c) => spans(ctx, x, dTop, dBot, half, sway, dx, dy, c), P.dress);
    spans(ctx, x - f, dTop + 2, dBot, (t) => half(t) * 0.45, sway, 0, 0, P.dressShade);
    for (let i = -11; i <= 11; i++) if (Math.abs(i) < half(1)) px(ctx, x + sway(1) + i, dBot, i % 2 ? P.magicYellow : P.dress);
    px(ctx, x + f, dTop + 2, P.magicYellow); // bow

    // Head, with the hair framing a 3/4 face.
    blob(ctx, x, hy, 6.5, 6, P.skin, P.outline);
    ellipse(ctx, x, hy, 6.5, 6, P.hair, hy - 1);
    ellipse(ctx, x - f * 3.5, hy + 0.5, 3.2, 5.5, P.hair);
    for (let i = -5; i <= 6; i++) {
      // Fringe, with a soft lilac shadow where it meets the face.
      if ((i * f + 6) % 3 !== 0) px(ctx, x + i, hy - 1, P.hair);
      else if (i * f > -1) px(ctx, x + i, hy - 1, P.hairShade);
    }
    for (let yy = hy; yy <= hy + 4; yy++) px(ctx, x - f, yy, P.hairShade);
    const lockX = x + f * 6 - (f > 0 ? 1 : 0);
    rect(ctx, lockX, hy - 1, 1, 5, P.hair);
    px(ctx, lockX, hy + 3, P.hairShade);

    // Face: bead eyes, a dab of blush, tiny mouth.
    const eyes = [x + f, x + f * 4];
    if (this.stun > 0) {
      // Dizzy > < squint.
      for (const [ex, o] of [[eyes[0], -f], [eyes[1], f]]) {
        px(ctx, ex + o, hy, P.eye); px(ctx, ex, hy + 1, P.eye); px(ctx, ex + o, hy + 2, P.eye);
      }
    } else if (this.blinkT < 0) {
      for (const ex of eyes) px(ctx, ex, hy + 2, P.eye);
    } else {
      for (const ex of eyes) rect(ctx, ex, hy + 1, 1, 2, P.eye);
    }
    px(ctx, x, hy + 3, P.cheek);
    px(ctx, x + f * 5, hy + 3, P.cheek);
    if (this.castAnim > 0 || this.floating) rect(ctx, x + f * 3, hy + 4, 1, 2, P.mouth);
    else px(ctx, x + f * 3, hy + 4, P.mouth);

    // Hat: bent cone that lags behind movement, sitting on a brim.
    const hbY = hy - 5.5;
    const coneH = 11;
    const baseX = x - f * 0.5;
    const tipX = x - f * 3 + this.hatTilt;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= coneH; i++) {
        const t = i / coneH;
        const cx = lerp(baseX, tipX, t * t);
        const half = 5 * (1 - t) + 0.6;
        const y = hbY - i;
        if (pass === 0) rect(ctx, cx - half - 1, y - 1, half * 2 + 2, 3, P.outline);
        else {
          rect(ctx, cx - half, y, half * 2, 1, i <= 2 ? P.hatDark : P.hat);
          if (i > 2) px(ctx, cx - half * 0.5 * f, y, P.hatHi);
        }
      }
    }
    // Star emblem on the band
    const sx = Math.round(baseX + f * 1);
    px(ctx, sx, hbY - 2, P.magicYellow);
    px(ctx, sx - 1, hbY - 1, P.magicYellow); px(ctx, sx + 1, hbY - 1, P.magicYellow); px(ctx, sx, hbY - 1, P.white);
    blob(ctx, baseX, hbY + 0.5, 9 * this.sx, 1.5, P.hat, P.outline);
    px(ctx, tipX, hbY - coneH - 1, P.magicYellow);

    // Wand hand (front)
    const casting = this.castAnim > 0 || this.charging;
    const hx = x + f * (casting ? 8.5 : 6);
    const handY = dTop + (casting ? 0 : 2) + (this.floating ? -Math.sin(game.time * 22) : 0);
    const [tx, ty] = casting ? this.wandTip() : [hx + f * 3, handY - 5];
    const wand = game.hasWand;
    if (wand) {
      line(ctx, hx, handY, tx, ty, P.outline);
      line(ctx, hx, handY - 1, tx, ty - 1, P.barkLight);
    }
    blob(ctx, hx, handY, 1.3, 1.3, P.skin, P.outline);
    if (wand) {
      const el = game.progress.current.el;
      const tip = el === "star" ? P.magicYellow : ELEMENTS[el].main;
      px(ctx, tx, ty - 1, tip);
      px(ctx, tx - 1, ty - 1, tip); px(ctx, tx + 1, ty - 1, tip);
      px(ctx, tx, ty - 2, tip); px(ctx, tx, ty, tip);
    }

    setOverride(null);

    if (this.charging) {
      const k = Math.min(1, this.chargeT / this.l2);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(game.time * 25);
      ellipse(ctx, tx, ty - 1, 2 + k * 3, 2 + k * 3, this.chargeLevel >= 2 ? P.magicYellow : P.magicPink);
      ctx.restore();
    }
  }
}
