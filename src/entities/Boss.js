// Boss：区域1 小 Boss「锈齿鼠王」（GDD 第7节 进度曲线骨架）。
// 2 阶段；招式完全由 balance.boss.rustooth.moves 驱动，方便 v0.2 扩成终局多阶段。
// 阶段1：冲刺咬；阶段2（血量≤50%）：冲刺咬 + 召唤小怪。
// 接口：sprite.kind='boss' / sprite.ref=this（Player.checkHits 命中）；onDefeated / spawnMinion 由场景注入。
export class Boss {
  constructor(scene, x, y, balance, hooks) {
    this.scene = scene;
    this.balance = balance || {};
    const cfg = (balance && balance.boss && balance.boss.rustooth) || {};
    this.cfg = cfg;
    this.hooks = hooks || {}; // { onDefeated, spawnMinion }

    this.maxHP = cfg.hp ?? 120;
    this.hp = this.maxHP;
    this.phase2Threshold = cfg.phase2Threshold ?? 0.5;
    this.contactDamage = cfg.contactDamage ?? 1;

    this.dead = false;
    this.active = false; // 锁门后进入战斗才激活
    this.phase = 1;
    this.state = 'idle'; // idle | telegraph | active | recover
    this.moveStart = 0;
    this.nextMoveAt = 0;
    this.currentMove = null;
    this.dashDir = -1;
    this.invulnUntil = 0;

    const w = 58, h = 46;
    this.w = w;
    this.h = h;
    this.sprite = scene.add.rectangle(x, y, w, h, 0x9c6b3f).setDepth(10);
    scene.physics.add.existing(this.sprite);
    this.sprite.body.setCollideWorldBounds(true);
    this.sprite.kind = 'boss';
    this.sprite.ref = this;

    // 王冠（鼠王标识）
    this.crown = scene.add.rectangle(x, y - h / 2 - 6, w * 0.6, 10, 0xd8b24a).setDepth(11);
    // 锈齿（下方尖牙）
    this.teeth = scene.add.rectangle(x, y + h / 2, w * 0.7, 7, 0xe8d7a0).setDepth(11);
    this.eyeL = scene.add.rectangle(x - 12, y - 6, 10, 6, 0x2a1010).setDepth(11);
    this.eyeR = scene.add.rectangle(x + 12, y - 6, 10, 6, 0x2a1010).setDepth(11);

    // 招式预警（telegraph）：红框 + 方向箭头
    this.tellBox = scene.add
      .rectangle(x, y, w + 8, h + 8)
      .setStrokeStyle(3, 0xff5555, 0.9)
      .setDepth(12)
      .setVisible(false);
    this.tellArrow = scene.add
      .text(x, y - h / 2 - 22, '', { fontFamily: 'monospace', fontSize: '20px', color: '#ff7777' })
      .setOrigin(0.5)
      .setDepth(12)
      .setVisible(false);

    // 招式攻击范围预警（冲刺路径带）
    this.rangeFx = scene.add.graphics().setDepth(13);
  }

  get x() {
    return this.sprite.x;
  }
  get y() {
    return this.sprite.y;
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.nextMoveAt = this.scene.time.now + 700; // 进战后短暂喘息
  }

  // 当前阶段的招式表
  moveTable() {
    const t = this.cfg.moves || {};
    return (this.phase === 2 ? t.p2 : t.p1) || ['dashBite'];
  }

  cooldown() {
    const c = this.cfg.moveCooldownMs || {};
    return (this.phase === 2 ? c.p2 : c.p1) ?? 1300;
  }

  scheduleNext(time) {
    const table = this.moveTable();
    this.currentMove = table[Math.floor(Math.random() * table.length)];
    this.state = 'telegraph';
    this.moveStart = time;
    this.tellBox.setVisible(true).setStrokeStyle(3, 0xff5555, 0.9);
    this.tellArrow.setVisible(true);
    if (this.scene.sfx) this.scene.sfx.bite();
  }

  update(time, delta, player) {
    // 视觉跟随
    const sx = this.sprite.x, sy = this.sprite.y;
    this.crown.setPosition(sx, sy - this.h / 2 - 6);
    this.teeth.setPosition(sx, sy + this.h / 2);
    this.eyeL.setPosition(sx - 12, sy - 6);
    this.eyeR.setPosition(sx + 12, sy - 6);
    this.tellBox.setPosition(sx, sy);
    this.tellArrow.setPosition(sx, sy - this.h / 2 - 22);

    if (this.dead) return;
    // 非战斗：轻微呼吸缩放 idle（不碰 sprite.y，避免与物理体脱节）
    if (!this.active) {
      const s = 1 + Math.sin(time / 400) * 0.03;
      this.sprite.setScale(1, s);
      return;
    }

    const now = time;
    const m = this.currentMove;

    if (this.state === 'idle') {
      if (now >= this.nextMoveAt) this.scheduleNext(now);
      return;
    }

    if (this.state === 'telegraph') {
      // 预警闪烁 + 锁定冲刺方向
      const tw = (this.cfg.dashBite?.telegraphMs) ?? 520;
      const k = (now - this.moveStart) / tw;
      this.tellBox.setAlpha(0.4 + 0.5 * Math.abs(Math.sin(now / 60)));
      if (m === 'dashBite' && player) {
        this.dashDir = player.sprite.x < sx ? -1 : 1;
        this.tellArrow.setText(this.dashDir < 0 ? '◀ 冲刺咬' : '冲刺咬 ▶');
      } else if (m === 'summon') {
        this.tellArrow.setText('✦ 召唤');
      }
      if (now - this.moveStart >= tw) {
        this.enterActive(now);
      } else if (m === 'dashBite') {
        // 路径预警带：红带表示会扫过多远
        this.drawDashBand(0.14 + 0.1 * Math.abs(Math.sin(now / 70)), 0.5);
      }
      return;
    }

    if (this.state === 'active') {
      if (m === 'dashBite') {
        const sp = (this.cfg.dashBite?.speed) ?? 360;
        // 仅在地面附近冲刺；撞墙即转 recover
        this.sprite.body.setVelocityX(this.dashDir * sp);
        this.drawDashBand(0.32, 0.85); // 命中中：带变亮实色
        if (now - this.moveStart >= (this.cfg.dashBite?.activeMs ?? 430)) {
          this.endMove(now);
        }
      } else if (m === 'summon') {
        // 召唤在 active 起始瞬间发生（enterActive 内已 spawn），这里短暂显形后转 recover
        if (now - this.moveStart >= 220) this.endMove(now);
      }
      return;
    }

    if (this.state === 'recover') {
      this.rangeFx.clear();
      const rec = m === 'summon'
        ? (this.cfg.summon?.recoverMs ?? 760)
        : (this.cfg.dashBite?.recoverMs ?? 520);
      this.sprite.body.setVelocityX(this.sprite.body.velocity.x * 0.8);
      if (now - this.moveStart >= rec) {
        this.state = 'idle';
        this.currentMove = null;
        this.tellBox.setVisible(false);
        this.tellArrow.setVisible(false);
        this.nextMoveAt = now + this.cooldown();
      }
    }
  }

  enterActive(now) {
    this.state = 'active';
    this.moveStart = now;
    this.tellBox.setAlpha(0.9);
    const m = this.currentMove;
    if (m === 'dashBite') {
      // 起跳一点便于越过玩家低位；实际伤害在场景 overlap 中按 state==='active' 判定
      if (this.scene.sfx) this.scene.sfx.dash();
    } else if (m === 'summon') {
      this.sprite.body.setVelocityX(0);
      const n = this.cfg.summon?.count ?? 2;
      for (let i = 0; i < n; i++) {
        const ox = this.sprite.x + (i === 0 ? -70 : 70);
        if (this.hooks.spawnMinion) this.hooks.spawnMinion(ox, this.sprite.y);
      }
      if (this.scene.sfx) this.scene.sfx.summon();
    }
  }

  endMove(now) {
    this.state = 'recover';
    this.moveStart = now;
    this.sprite.body.setVelocityX(0);
    this.tellBox.setVisible(false);
    this.tellArrow.setVisible(false);
  }

  // 是否正在造成伤害（仅冲刺咬 active 阶段）
  isDangerous() {
    return this.active && !this.dead && this.state === 'active' && this.currentMove === 'dashBite';
  }

  takeHit(dmg, fromX) {
    if (this.dead) return false;
    if (this.scene.time.now < this.invulnUntil) return false;
    this.hp = Math.max(0, this.hp - dmg);
    // 受击闪白 + 轻微击退
    this.sprite.setFillStyle(0xffffff);
    this.scene.time.delayedCall(70, () => {
      if (!this.dead) this.sprite.setFillStyle(0x9c6b3f);
    });
    const dir = Math.sign(this.sprite.x - fromX) || 1;
    this.sprite.body.setVelocityX(dir * 60);
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    // 阶段切换
    if (this.phase === 1 && this.hp <= this.maxHP * this.phase2Threshold) {
      this.enterPhase2();
    }
    return false;
  }

  enterPhase2() {
    this.phase = 2;
    this.invulnUntil = this.scene.time.now + (this.cfg.phaseShiftInvulnMs ?? 1200);
    this.state = 'idle';
    this.currentMove = null;
    this.tellBox.setVisible(false);
    this.tellArrow.setVisible(false);
    this.rangeFx.clear();
    this.sprite.body.setVelocity(0, 0);
    this.nextMoveAt = this.scene.time.now + 900;
    // 视觉：变暗红 + 短暂全屏闪
    this.sprite.setFillStyle(0x7a3b2f);
    this.scene.cameras.main.flash(320, 120, 30, 30);
    if (this.scene.sfx) this.scene.sfx.phaseShift();
    this.scene.onBossPhase2 && this.scene.onBossPhase2();
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.sprite.body.setVelocity(0, 0);
    this.tellBox.setVisible(false);
    this.tellArrow.setVisible(false);
    this.rangeFx.clear();
    this.scene.tweens.add({
      targets: [this.sprite, this.crown, this.teeth, this.eyeL, this.eyeR],
      alpha: 0,
      angle: 12,
      duration: 700,
      onComplete: () => {
        this.sprite.destroy();
        this.crown.destroy();
        this.teeth.destroy();
        this.eyeL.destroy();
        this.eyeR.destroy();
      },
    });
    if (this.hooks.onDefeated) this.hooks.onDefeated();
  }

  // 冲刺咬路径预警带（让玩家看到会扫过多远）
  drawDashBand(alpha, strokeA) {
    const g = this.rangeFx;
    g.clear();
    if (this.currentMove !== 'dashBite') return;
    const range = this.cfg.dashBite?.telegraphRange ?? 260;
    const sx = this.sprite.x, sy = this.sprite.y;
    const x0 = sx + this.dashDir * (this.w / 2 + 4);
    const len = this.dashDir > 0 ? range : -range;
    const bandH = this.h + 18;
    const left = Math.min(x0, x0 + len);
    const top = sy - bandH / 2;
    g.fillStyle(0xff5555, alpha);
    g.fillRect(left, top, Math.abs(len), bandH);
    g.lineStyle(2, 0xff7777, strokeA);
    g.strokeRect(left, top, Math.abs(len), bandH);
  }
}
