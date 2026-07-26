// Player：波比实体（阶段2：移动+爪击+扑袭+下扑pogo；阶段3：折耳听声+受击打断）。
// 所有数值从 registry.balance 读取，不硬编码。
export class Player {
  constructor(scene, x, y, balance, derived) {
    this.scene = scene;
    this.balance = balance || {};
    const d = derived || {}; // 项圈/面具派生属性（Collars.derive()）
    const c = this.balance.combat || {};
    const L = this.balance.listen || {};
    const m = this.balance.movement || {};

    // 占位美术：蓝灰方块（折耳蓝猫波比）
    this.sprite = scene.add.rectangle(x, y, 28, 28, 0x6b8fb5);
    scene.physics.add.existing(this.sprite);
    this.sprite.body.setCollideWorldBounds(true);

    // 折耳：默认折叠（scaleY 0.4），听声时竖起（scaleY 1.2）
    this.earL = scene.add.rectangle(x - 7, y - 16, 9, 12, 0x6b8fb5).setDepth(39);
    this.earR = scene.add.rectangle(x + 7, y - 16, 9, 12, 0x6b8fb5).setDepth(39);
    this.earPerk = 0;

    // 移动参数（从 balance.json 读取，不硬编码）
    this.speed = m.moveSpeed ?? 220;
    this.jumpVelocity = m.jumpVelocity ?? 480;

    // 生命（GDD 4.4 / 5.2：maxHP=5，受面具(+maskLevel)与项圈(maxHP 修正)影响）
    const p = this.balance.player || {};
    this.maxHP = d.maxHP ?? p.maxHP ?? 5;
    this.hp = this.maxHP;
    this.clawDamage = d.clawDamage ?? p.clawDamage ?? 1;
    this.listenThresholdMult = d.listenThresholdMult ?? 1;
    this.listenRadiusMult = d.listenRadiusMult ?? 1;
    this.blightResist = d.blightResist || 0; // 瘴减伤（GDD 4.7，项圈派生）
    // 元进度解锁的移动技（GDD 4.8）：二段扑（空中再扑一次）/ 滑翔（空中长按缓降）
    this.airPounces = d.airPounces ?? 0; // 允许的空气扑击次数
    this.glide = !!(d.glide);
    this.airPounceCharges = this.airPounces; // 当前剩余充能（落地重置）
    this.contactDamage = this.balance.enemy?.contactDamage ?? 1;
    this.dead = false;
    this.onDeath = null; // 由场景注入：死亡时生成灵影 + 重生
    this.respawnInvulnUntil = 0; // 重生后短暂无敌（真实时间）

    // 状态
    this.facing = 1;
    this.isAttacking = false;
    this.attackStart = 0;
    this.attackPhase = 'none'; // windup | active | recovery
    this.diving = false;
    this.isPouncing = false;
    this.pounceStart = 0;
    this.invulnerable = false;
    this.invulnUntil = 0;
    this.hitThisSwing = new Set();

    // 听声状态（阶段3）
    this.listening = false;      // 是否正在听（按键按住且未被打断）
    this.listenHold = 0;         // 已持续按住时长(ms, 真实时间)
    this.listenRevealed = false; // 是否已达显形阈值
    this.listenProgress = 0;     // 0..1 显形进度
    this.hitstunRemaining = 0;   // 受击硬直剩余(ms)
    this.hurtCooldown = 0;       // 受击冷却，防连击连锁硬直
    this.inBlight = false;       // 是否处于寂瘴（由场景每帧设置，驱动 HUD/视觉）

    // 爪击可视命中区（仅反馈用，不参与物理；尺寸固定，只移动/调透明度）
    this.hitbox = scene.add
      .rectangle(x, y, c.clawRange || 36, c.clawHeight || 24, 0xffe08a, 0)
      .setDepth(40);

    // 攻击特效层（弧/锥/拖影，尺寸与真实判定一致，让玩家"看到攻击范围"）
    this.attackFx = scene.add.graphics().setDepth(41);
    this.pogoLanded = true; // 下扑落地冲击波是否已触发

    // 命中回调：由场景注入反馈逻辑（灵毛+1飘字 / 屏震 / 音效）
    this.onClawHit = null;
  }

  get body() {
    return this.sprite.body;
  }

  update(time, delta, input) {
    const body = this.body;
    const left = input.left;
    const right = input.right;
    const up = input.up;

    // 死亡冻结：场景负责重生（生成灵影 + respawnAt）
    if (this.dead) {
      body.setVelocity(0, 0);
      this.updateEars();
      return {
        attacking: false,
        pouncing: false,
        iframe: this.invulnerable,
        listening: false,
        listenRevealed: false,
        listenProgress: 0,
        hitstun: false,
      };
    }

    const stunned = this.hitstunRemaining > 0;
    const locked = this.isAttacking || this.isPouncing || stunned;

    // 朝向
    if (left && !right) this.facing = -1;
    else if (right && !left) this.facing = 1;

    // 水平移动（攻击/扑袭/硬直中锁定，手感更稳）
    if (!locked) {
      if (left) body.setVelocityX(-this.speed);
      else if (right) body.setVelocityX(this.speed);
      else body.setVelocityX(0);
    }
    // 地面横扫钉在原地，避免滑步
    if (this.isAttacking && !this.diving) body.setVelocityX(0);

    // 跳跃（仅地面且未被锁定/硬直）
    if (up && body.blocked.down && !locked) {
      body.setVelocityY(-this.jumpVelocity);
    }

    // 落地重置二段扑充能
    if (body.blocked.down) this.airPounceCharges = this.airPounces;

    // 触发攻击 / 扑袭（硬直中不可）
    if (input.attackJust && !stunned && !this.isAttacking && !this.isPouncing) this.startAttack(time);
    if (input.pounceJust && !stunned && !this.isPouncing && !this.isAttacking) {
      const grounded = body.blocked.down;
      // 地面直接扑；空中仅在有二段扑充能时允许（grounded 或 有充能才调用，避免空挥）
      if (grounded || this.airPounceCharges > 0) this.startPounce(time, grounded);
    }

    this.updateAttackState(time);
    this.updatePounceState(time);

    // 绒羽滑翔（元进度解锁）：空中且长按跳/上时，限制下落速度缓降
    if (this.glide && !body.blocked.down && input.holdUp && body.velocity.y > 90) {
      body.setVelocityY(90);
    }

    // —— 折耳听声（阶段3）——
    this.updateListen(delta, input, stunned);

    // 计时器衰减（用真实 delta，不受慢动作影响）
    if (this.hurtCooldown > 0) this.hurtCooldown -= delta;
    if (this.hitstunRemaining > 0) this.hitstunRemaining -= delta;

    // i-frame 视觉（含重生无敌）
    const inv = this.invulnerable || time < this.respawnInvulnUntil;
    this.sprite.setAlpha(inv ? 0.55 : 1);

    // 命中检测（active 帧 或 扑袭中）
    if ((this.attackPhase === 'active' || this.isPouncing) && this.onClawHit) {
      this.checkHits(input.hittables || input.dummies || []);
    }

    this.updateHitboxVisual();

    // 下扑落地震荡特效（纯表现）
    if (this.diving && body.blocked.down && !this.pogoLanded) {
      this.pogoLanded = true;
      this.spawnLandingFx();
    }

    this.updateEars();

    return {
      attacking: this.isAttacking,
      pouncing: this.isPouncing,
      iframe: this.invulnerable,
      listening: this.listening,
      listenRevealed: this.listenRevealed,
      listenProgress: this.listenProgress,
      hitstun: stunned,
    };
  }

  // —— 听声核心 ——
  updateListen(delta, input, stunned) {
    const L = this.balance.listen || {};
    const thrMs = (L.revealThreshold || 0.6) * 1000 * (this.listenThresholdMult || 1);

    // 能听的条件：按住键 + 非硬直 + 非攻击/扑袭中 + 没在出招瞬间
    const canListen = !stunned && !this.isAttacking && !this.isPouncing && !input.attackJust;
    const listeningNow = input.listenDown && canListen;

    if (listeningNow) {
      this.listenHold += delta; // 真实时间累积
    } else {
      // 松开/被打断 → 快速衰减，松开即隐藏（防永久透视）
      this.listenHold = Math.max(0, this.listenHold - delta * 3);
    }

    this.listening = listeningNow;
    this.listenRevealed = this.listenHold >= thrMs;
    this.listenProgress = Math.min(1, this.listenHold / thrMs);
  }

  cancelListen() {
    this.listening = false;
    this.listenHold = 0;
    this.listenRevealed = false;
  }

  // 受击通用表现：打断听声 + 硬直 + 击退 + 闪红（不扣血，供双锁①等用）
  applyHurt(srcX) {
    this.cancelListen();
    this.hitstunRemaining = this.balance.listen?.hitstunMs || 400;
    const dir = Math.sign(this.sprite.x - srcX) || -1;
    this.body.setVelocityX(dir * 200);
    this.body.setVelocityY(-160);
    this.sprite.setFillStyle(0xff5555);
    this.scene.time.delayedCall(120, () => this.sprite.setFillStyle(0x6b8fb5));
    if (this.scene.sfx) this.scene.sfx.thud();
  }

  // 受击（无伤害，仅打断听声+硬直）——阶段3 听声双锁①仍走这条
  takeHit(srcX) {
    if (this.dead) return;
    if (this.scene.time.now < this.respawnInvulnUntil) return;
    if (this.hurtCooldown > 0) return;
    this.hurtCooldown = 500;
    this.applyHurt(srcX);
  }

  // 受伤（扣 HP）——敌人接触伤害走这条
  takeDamage(amount, srcX) {
    if (this.dead) return;
    if (this.scene.time.now < this.respawnInvulnUntil) return;
    if (this.hurtCooldown > 0) return;
    this.hurtCooldown = 500;
    this.applyHurt(srcX);
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.die();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    if (this.onDeath) this.onDeath();
  }

  // 寂瘴持续掉血（逐帧调用，无视硬直冷却；重生无敌期不扣；不触发硬直以防卡死）
  drainHP(amount) {
    if (this.dead) return;
    if (this.scene.time.now < this.respawnInvulnUntil) return;
    this.hp = Math.max(0, this.hp - amount);
    this.sprite.setFillStyle(0x7a5b9b);
    this.scene.time.delayedCall(60, () => {
      if (!this.dead) this.sprite.setFillStyle(0x6b8fb5);
    });
    if (this.hp <= 0) this.die();
  }

  // 重生：回猫窝/复活点（阶段6 接猫窝系统；此处提供基础入口）
  respawnAt(x, y) {
    this.dead = false;
    this.hp = this.maxHP;
    this.sprite.setPosition(x, y);
    this.body.setVelocity(0, 0);
    this.hitstunRemaining = 0;
    this.hurtCooldown = 0;
    this.cancelListen();
    const t = this.scene.time.now;
    this.invulnerable = true;
    this.invulnUntil = t + (this.balance.player?.respawnInvulnMs || 1200);
    this.respawnInvulnUntil = t + (this.balance.player?.respawnInvulnMs || 1200);
  }

  updateEars() {
    const targetPerk = this.listening ? 1 : 0;
    this.earPerk += (targetPerk - this.earPerk) * 0.35;
    const sy = 0.4 + 0.8 * this.earPerk; // 0.4 折叠 → 1.2 竖起
    const lift = (sy - 1) * 6;
    this.earL.setScale(1, sy).setPosition(this.sprite.x - 7, this.sprite.y - 16 - lift);
    this.earR.setScale(1, sy).setPosition(this.sprite.x + 7, this.sprite.y - 16 - lift);
  }

  startAttack(time) {
    const c = this.balance.combat || {};
    this.isAttacking = true;
    this.attackStart = time;
    this.attackPhase = 'windup';
    this.diving = !this.body.blocked.down; // 空中 = 下扑
    if (this.diving) this.pogoLanded = false; // 准备落地冲击波
    this.hitThisSwing.clear();
    if (this.diving) {
      // 下扑下扎
      this.body.setVelocityY(Math.max(this.body.velocity.y, c.diveLungeVel || 280));
    }
  }

  updateAttackState(time) {
    if (!this.isAttacking) return;
    const c = this.balance.combat || {};
    const e = time - this.attackStart;
    const w = c.clawWindupMs || 40;
    const a = c.clawActiveMs || 120;
    const r = c.clawRecoveryMs || 110;
    if (e < w) this.attackPhase = 'windup';
    else if (e < w + a) this.attackPhase = 'active';
    else if (e < w + a + r) this.attackPhase = 'recovery';
    else {
      this.isAttacking = false;
      this.attackPhase = 'none';
      this.diving = false;
    }
  }

  startPounce(time, grounded) {
    const c = this.balance.combat || {};
    // 空中二段扑：仅当仍有充能时允许；否则不触发（防空挥）
    if (!grounded) {
      if (this.airPounceCharges <= 0) return false;
      this.airPounceCharges -= 1;
    }
    this.isPouncing = true;
    this.pounceStart = time;
    this.hitThisSwing.clear();
    const vy = grounded ? 0 : -120; // 空中二段扑带一点上抬，手感更像"再跳一次"
    this.body.setVelocity(this.facing * (c.pounceSpeed || 430), vy);
    // i-frame
    this.invulnerable = true;
    this.invulnUntil = time + (c.pounceIFrameMs || 300);
    return true;
  }

  updatePounceState(time) {
    if (!this.isPouncing) return;
    const c = this.balance.combat || {};
    if (time - this.pounceStart > (c.pounceDurationMs || 180)) this.isPouncing = false;
    if (this.invulnerable && time > this.invulnUntil) this.invulnerable = false;
  }

  updateHitboxVisual() {
    const c = this.balance.combat || {};
    const reach = c.clawRange || 36;
    const h = c.clawHeight || 24;
    const active = this.attackPhase === 'active' || this.isPouncing;
    const hx = this.sprite.x + this.facing * (14 + reach / 2);
    const hy = this.sprite.y + (this.diving ? 12 : 0);

    // 命中区矩形（反馈用，比原版更醒目）
    this.hitbox.setPosition(hx, hy);
    this.hitbox.setAlpha(active ? 0.34 : 0);
    this.hitbox.setStrokeStyle(active ? 2 : 0, 0xffe08a, active ? 0.9 : 0);

    // 攻击特效层（尺寸与真实判定一致，让玩家"看到攻击范围"）
    const g = this.attackFx;
    g.clear();
    const fx = 0xffe08a;
    const arcDeg = (this.balance.combat?.fxClawArcDeg) || 112;
    if (this.diving && (this.attackPhase === 'active' || this.isPouncing)) {
      // 下扑：向下冲击锥，明确表示踩踏区
      const footY = this.sprite.y + 20;
      const w = reach * 0.95;
      const depth = reach * 1.7;
      g.fillStyle(fx, 0.3);
      g.fillTriangle(this.sprite.x - w, footY, this.sprite.x + w, footY, this.sprite.x, footY + depth);
      g.lineStyle(3, fx, 0.85);
      g.strokeTriangle(this.sprite.x - w, footY, this.sprite.x + w, footY, this.sprite.x, footY + depth);
    } else if (this.isPouncing && !this.diving) {
      // 扑袭：水平突进拖影
      const len = reach * 1.8;
      const th = 18;
      const cy = this.sprite.y;
      const x0 = this.sprite.x - this.facing * 6;
      g.fillStyle(0xffcf6a, 0.3);
      g.lineStyle(2, 0xffcf6a, 0.75);
      if (this.facing > 0) {
        g.fillRect(x0, cy - th / 2, len, th);
        g.strokeRect(x0, cy - th / 2, len, th);
      } else {
        g.fillRect(x0 - len, cy - th / 2, len, th);
        g.strokeRect(x0 - len, cy - th / 2, len, th);
      }
    } else if (this.attackPhase === 'active') {
      // 地面爪击：扇形弧（半径 = reach，与判定一致）
      const a0 = Phaser.Math.DegToRad(this.facing > 0 ? -arcDeg / 2 : 180 - arcDeg / 2);
      const a1 = Phaser.Math.DegToRad(this.facing > 0 ? arcDeg / 2 : 180 + arcDeg / 2);
      g.fillStyle(fx, 0.32);
      g.slice(this.sprite.x, hy, reach + 6, a0, a1, false);
      g.fillPath();
      g.lineStyle(3, fx, 0.9);
      g.beginPath();
      g.arc(this.sprite.x, hy, reach + 6, a0, a1, false);
      g.strokePath();
    } else if (this.attackPhase === 'windup') {
      // 预兆：淡弧，提示"即将挥击"
      const a0 = Phaser.Math.DegToRad(this.facing > 0 ? -arcDeg / 2 : 180 - arcDeg / 2);
      const a1 = Phaser.Math.DegToRad(this.facing > 0 ? arcDeg / 2 : 180 + arcDeg / 2);
      g.lineStyle(2, fx, 0.4);
      g.beginPath();
      g.arc(this.sprite.x, hy, reach + 6, a0, a1, false);
      g.strokePath();
    }
  }

  // 下扑落地：地面震荡波纹（纯表现）
  spawnLandingFx() {
    const scene = this.scene;
    const cx = this.sprite.x;
    const cy = this.sprite.y + 20;
    const ring = scene.add.circle(cx, cy, 10, 0xffe08a, 0)
      .setStrokeStyle(3, 0xffe08a, 0.85)
      .setDepth(12);
    scene.tweens.add({
      targets: ring,
      scale: 3.2,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.Out',
      onComplete: () => ring.destroy(),
    });
    if (scene.cameras && scene.cameras.main) scene.cameras.main.shake(70, 0.003);
  }

  checkHits(hittables) {
    const c = this.balance.combat || {};
    const reach = c.clawRange || 36;
    const h = c.clawHeight || 24;
    const hx = this.sprite.x + this.facing * (14 + reach / 2);
    const hy = this.sprite.y + (this.diving ? 12 : 0);
    const hb = {
      left: hx - reach / 2,
      right: hx + reach / 2,
      top: hy - h / 2,
      bottom: hy + h / 2,
    };
    for (const d of hittables) {
      if (this.hitThisSwing.has(d)) continue;
      const b = d.getBounds();
      if (hb.left < b.right && hb.right > b.left && hb.top < b.bottom && hb.bottom > b.top) {
        this.hitThisSwing.add(d);
        // pogo：下扑且从上方落下 → 弹起（noBounce 物体不触发，如隐藏小鱼干堆）
        let pogo = false;
        if (this.diving && !d.noBounce && this.sprite.y < d.y && this.body.velocity.y > 0) {
          this.body.setVelocityY(-this.jumpVelocity * (c.diveBounceMult || 1.2));
          pogo = true;
        }
        if (this.onClawHit) this.onClawHit(d, { pogo, diving: this.diving });
      }
    }
  }
}
