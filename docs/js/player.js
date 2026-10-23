// Player movement, survival stats (health, hunger, air) and damage.
import { moveBody } from './physics.js';
import { B } from './blocks.js';

export class Player {
  constructor() {
    Object.assign(this, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, w: 0.3, h: 1.8, ground: false });
    this.yaw = 0; this.pitch = 0;
    this.eye = 1.62;
    this.creative = false;
    this.flying = false;
    this.perks = {}; // passive artifact effects: feather, tide, ember
    // skill effects from the player's profile
    this.fx = { speed: 1, jump: 1, hunger: 1, fall: 1, breath: 1, maxHealth: 20, regen: 1 };
    this.reset();
  }

  reset() {
    this.health = this.fx?.maxHealth || 20; this.hunger = 20; this.air = 10 * (this.fx?.breath || 1);
    this.exhaust = 0; this.regenT = 0; this.starveT = 0; this.lavaT = 0; this.drownT = 0;
    this.hurtT = 0; this.dead = false; this.peakY = null;
  }

  spawnAt(p) { this.x = p.x; this.y = p.y; this.z = p.z; this.vx = this.vy = this.vz = 0; this.peakY = null; }

  // input: { fwd, strafe, jump, sprint, down }
  update(dt, input, world, events) {
    if (this.dead) return;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let f = input.fwd, s = input.strafe;
    const m = Math.hypot(f, s); if (m > 1) { f /= m; s /= m; }

    if (this.flying) {
      const sp = input.sprint ? 18 : 10;
      this.vx = (-sin * f + cos * s) * sp;
      this.vz = (-cos * f - sin * s) * sp;
      this.vy = (input.jump ? 1 : 0) * 8 - (input.down ? 1 : 0) * 8;
      moveBody(world, this, dt);
      if (this.ground && input.down) this.flying = false;
      this.peakY = null;
      return;
    }

    const canSprint = input.sprint && (this.creative || this.hunger > 6) && f > 0;
    let speed = (canSprint ? 5.8 : 4.3) * this.fx.speed;
    if (this.inWater) speed *= this.perks.tide ? 1.25 : 0.55;
    const ax = (-sin * f + cos * s) * speed, az = (-cos * f - sin * s) * speed;
    // a bit of momentum on the ground, more in the air
    const grip = this.ground ? (this.onBlock === B.ICE ? 0.12 : 1) : 0.18;
    this.vx += (ax - this.vx) * Math.min(1, grip * dt * 18);
    this.vz += (az - this.vz) * Math.min(1, grip * dt * 18);

    if (this.inWater || this.inLava) {
      this.vy -= 9 * dt;
      this.vy = Math.max(this.vy, -2.5);
      if (input.jump) this.vy = Math.min(this.vy + 22 * dt, 3.6);
    } else {
      this.vy -= 28 * dt;
      this.vy = Math.max(this.vy, this.perks.feather ? -6 : -50);
      if (input.jump && this.ground) { this.vy = 8.7 * this.fx.jump; this.exhaust += 0.2 * this.fx.hunger; }
    }

    const wasGround = this.ground;
    moveBody(world, this, dt);

    // fall damage
    if (!this.ground && !this.inWater) this.peakY = this.peakY === null ? this.y : Math.max(this.peakY, this.y);
    if (this.inWater) this.peakY = null;
    if (this.ground && !wasGround && this.peakY !== null) {
      const fall = this.peakY - this.y;
      if (fall > 3.6 && !this.creative && !this.perks.feather) { const n = Math.floor((fall - 3) * this.fx.fall); if (n > 0) this.damage(n, events, 'fell too far'); }
      this.peakY = null;
    }

    if (this.creative) return;
    // hunger
    const moved = Math.hypot(this.vx, this.vz) * dt;
    this.exhaust += moved * (canSprint ? 0.1 : 0.01) * this.fx.hunger;
    if (this.exhaust >= 4) { this.exhaust -= 4; this.hunger = Math.max(0, this.hunger - 1); }
    this.regenT += dt;
    if (this.hunger >= 16 && this.health < this.fx.maxHealth && this.regenT > 3 / this.fx.regen) { this.regenT = 0; this.health++; this.exhaust += 1.5 * this.fx.hunger; }
    if (this.hunger <= 0) { this.starveT += dt; if (this.starveT > 4) { this.starveT = 0; this.damage(1, events, 'starved'); } }
    // lava
    if (this.inLava && !this.perks.ember) { this.lavaT -= dt; if (this.lavaT <= 0) { this.lavaT = 0.5; this.damage(4, events, 'melted'); } }
    // breath
    if (this.headInWater && !this.perks.tide) {
      this.air = Math.max(0, this.air - dt);
      if (this.air <= 0) { this.drownT -= dt; if (this.drownT <= 0) { this.drownT = 1; this.damage(2, events, 'drowned'); } }
    } else this.air = Math.min(10 * this.fx.breath, this.air + dt * 4);
    if (this.y < -20) this.damage(100, events, 'fell out of the world');
    this.hurtT = Math.max(0, this.hurtT - dt);
  }

  damage(n, events, cause = 'was hurt') {
    if (this.creative || this.dead) return;
    this.health = Math.max(0, this.health - n);
    this.hurtT = 0.4;
    events.hurt?.(n);
    if (this.health <= 0) { this.dead = true; events.died?.(cause); }
  }

  eat(food) {
    if (this.hunger >= 20) return false;
    this.hunger = Math.min(20, this.hunger + food);
    return true;
  }
}
