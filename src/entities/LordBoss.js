// LordBoss：终局 Boss「沉眠之主」（GDD 第7节）。
// 3 阶段（阈值 66% / 34%）；每阶段引入新机制：
//   P1 苏醒：swipe(冲刺扑) + dreamOrb(梦境弹，扇形投射)
//   P2 寂瘴同化：+ blightRing(扩张瘴环，听声揭示安全缝) + summon(召唤回响)；场上出现瘴区
//   P3 终焉：全招式 + enrage(提速/加伤)
// 难度随元进度自适应：scene 先按 meta tier 算 metaScale{hpBonus, cdMult} 再传入本构造。
// 招式生成（投射物/瘴环/小怪）一律委托 scene 的 hooks，boss 自身只跑状态机 + 视觉。
// 所有数值来自 balance.boss.lord，[PLACEHOLDER] 待 playtest。
export class LordBoss {
  constructor(scene, x, y, balance, hooks, metaScale) {
    this.scene = scene;
    this.balance = balance || {};
    const cfg = (balance && balance.boss && balance.boss.lord) || {};
    this.cfg = cfg;
    this.hooks = hooks || {}; // { onDefeated, spawnMinion, spawnProjectile, spawnBlightRing }

    const ms = metaScale || {};
    this.maxHP = (cfg.hp ?? 800) + (ms.hpBonus || 0);
    this.hp = this.maxHP;
    this.phaseThresholds = cfg.phaseThresholds || [0.66, 0.34];
    this.contactDamage = cfg.contactDamage ?? 1;
    this.phaseShiftInvulnMs = cfg.phaseShiftInvulnMs ?? 1400;
    this.cdMult = ms.cdMult ?? 1; // <1 = 出招更频繁（更难）

    // 合并各阶段招式配置（先出现优先；P3 继承 P1/P2 定义）
    this.moveCfg = {};
    for (const ph of ['p1', 'p2', 'p3']) {
      const pc = cfg.phases?.[ph] || {};
      for (const mk of Object.keys(pc)) {
        if (['title', 'moves', 'moveCooldownMs', 'enrage', 'blightZones', 'listenRevealGap'].includes(mk)) continue;
        if (!this.moveCfg[mk]) this.moveCfg[mk] = pc[mk];
      }
    }
    this.blightZones = cfg.phases?.p2?.blightZones || [];
    this.listenRevealGapP2 = !!cfg.phases?.p2?.listenRevealGap;
    this.enrage = cfg.phases?.p3?.enrage || null;

    this.dead = false;
    this.active = false;
    this.phase = 1;
    this.state = 'idle'; // idle | telegraph | active | recover
    this.moveStart = 0;
    this.nextMoveAt = 0;
    this.currentMove = null;
    this.dashDir = -1;
    this.invulnUntil = 0;
    this.speedMult = 1;
    this.damageBonus = 0;
    this.revealGap = false; // 当前瘴环是否听声揭示（仅 P2）

    const w = 92, h = 72;
    this.w = w;
    this.h = h;
    this.sprite = scene.add.rectangle(x, y, w, h, 0x4a2f6a).setDepth(10);
    scene.physics.add.existing(this.sprite);
    this.sprite.body.setCollideWorldBounds(true);
    this.sprite.kind = 'boss';
    this.sprite.ref = this;

    // 眼（随阶段睁大）
    this.eyeL = scene.add.rectangle(x - 18, y - 8, 14, 6, 0x140a1f).setDepth(11);
    this.eyeR = scene.add.rectangle(x + 18, y - 8, 14, 6, 0x140a1f).setDepth(11);
    // 沉默之冠（光环）
    this.halo = scene.add.rectangle(x, y - h / 2 - 10, w * 0.7, 12, 0xb98cff, 0.5).setDepth(9);

    // 招式预警
    this.tellBox = scene.add
      .rectangle(x, y, w + 10, h + 10)
      .setStrokeStyle(3, 0xff6688, 0.9)
      .setDepth(12)
      .setVisible(false);
    this.tellArrow = scene.add
      .text(x, y - h / 2 - 26, '', { fontFamily: 'monospace', fontSize: '20px', color: '#ff99bb' })
      .setOrigin(0.5)
      .setDepth(12)
      .setVisible(false);

    // 招式攻击范围预警
    this.rangeFx = scene.add.graphics().setDepth(13);
    this.aimAngle = null; // 梦境弹预瞄角（telegraph 时锁定）
  }

  get x() {
    return this.sprite.x;
  }
  get y() {
    return this.sprite.y;
  }
  get currentPhaseTitle() {
    return this.cfg.phases?.[`p${this.phase}`]?.title || `阶段${this.phase}`;
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.nextMoveAt = this.scene.time.now + 900; // 进战喘息
  }

  moveTable() {
    const ph = this.cfg.phases?.[`p${this.phase}`] || {};
    return ph.moves || ['swipe'];
  }

  cooldown() {
    const ms = (this.cfg.phases?.[`p${this.phase}`]?.moveCooldownMs) ?? 1300;
    return ms * this.cdMult;
  }

  scheduleNext(time) {
    const table = this.moveTable();
    this.currentMove = table[Math.floor(Math.random() * table.length)];
    this.state = 'telegraph';
    this.moveStart = time;
    this.tellBox.setVisible(true).setStrokeStyle(3, 0xff6688, 0.9);
    this.tellArrow.setVisible(true);
    if (this.scene.sfx) this.scene.sfx.bite();
  }

  moveDamage(base) {
    return base + (this.phase === 3 && this.enrage ? this.enrage.damageBonus || 0 : 0);
  }

  update(time, delta, player) {
    // 视觉跟随
    const sx = this.sprite.x, sy = this.sprite.y;
    this.eyeL.setPosition(sx - 18, sy - 8);
    this.eyeR.setPosition(sx + 18, sy - 8);
    this.halo.setPosition(sx, sy - this.h / 2 - 10);
    this.tellBox.setPosition(sx, sy);
    this.tellArrow.setPosition(sx, sy - this.h / 2 - 26);
    // 阶段越高眼越亮
    const eyeA = 0.4 + this.phase * 0.2;
    this.eyeL.setFillStyle(0x140a1f).setAlpha(eyeA);
    this.eyeR.setFillStyle(0x140a1f).setAlpha(eyeA);

    if (this.dead) return;
    if (!this.active) {
      const s = 1 + Math.sin(time / 500) * 0.025;
      this.sprite.setScale(1, s);
      return;
    }

    const now = time;
    const m = this.currentMove;
    const mc = this.moveCfg[m] || {};

    if (this.state === 'idle') {
      if (now >= this.nextMoveAt) this.scheduleNext(now);
      return;
    }

    if (this.state === 'telegraph') {
      const tw = mc.telegraphMs ?? 600;
      this.tellBox.setAlpha(0.4 + 0.5 * Math.abs(Math.sin(now / 60)));
      if (m === 'swipe' && player) {
        this.dashDir = player.sprite.x < sx ? -1 : 1;
        this.tellArrow.setText(this.dashDir < 0 ? '◀ 横扫' : '横扫 ▶');
        this.drawRange(0.14 + 0.1 * Math.abs(Math.sin(now / 70)), 0.5);
      } else if (m === 'dreamOrb') {
        this.tellArrow.setText('✦ 梦境弹');
        this.aimAngle = Math.atan2((player?.sprite.y ?? this.y) - this.y, (player?.sprite.x ?? this.x) - this.x);
        this.drawRange(0.14 + 0.1 * Math.abs(Math.sin(now / 70)), 0.5);
      } else if (m === 'blightRing') {
        this.tellArrow.setText('◎ 瘴环');
        this.drawRange(0, 0.5);
      } else if (m === 'summon') {
        this.tellArrow.setText('✦ 召唤回响');
        this.drawRange(0, 0.5);
      }
      if (now - this.moveStart >= tw) this.enterActive(now);
      return;
    }

    if (this.state === 'active') {
      const activeMs = mc.activeMs ?? 200;
      if (m === 'swipe') {
        const sp = (mc.speed ?? 230) * this.speedMult;
        this.sprite.body.setVelocityX(this.dashDir * sp);
        this.drawRange(0.3, 0.85); // 命中中：带变亮
      } else if (m === 'dreamOrb') {
        this.drawRange(0.28, 0.85);
      } else {
        this.rangeFx.clear(); // 瘴环/召唤在 active 瞬间生成实体，清预警
      }
      if (now - this.moveStart >= activeMs) this.endMove(now);
      return;
    }

    if (this.state === 'recover') {
      this.rangeFx.clear();
      const rec = mc.recoverMs ?? 600;
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
    const mc = this.moveCfg[m] || {};
    if (m === 'swipe') {
      if (this.scene.sfx) this.scene.sfx.dash();
    } else if (m === 'dreamOrb') {
      this.sprite.body.setVelocityX(0);
      const count = mc.count ?? 3;
      const speed = mc.speed ?? 170;
      const dmg = this.moveDamage(mc.damage ?? 1);
      const spread = (mc.spreadDeg ?? 26) * Math.PI / 180;
      const base = Math.atan2(this.scene.player?.sprite.y - this.y, this.scene.player?.sprite.x - this.x) || 0;
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : i / (count - 1) - 0.5; // -0.5..0.5
        const ang = base + t * spread;
        if (this.hooks.spawnProjectile) this.hooks.spawnProjectile(this.x, this.y, ang, speed, dmg);
      }
      if (this.scene.sfx) this.scene.sfx.summon();
    } else if (m === 'blightRing') {
      this.sprite.body.setVelocityX(0);
      const revealGap = this.phase === 2 ? this.listenRevealGapP2 : false;
      this.revealGap = revealGap;
      if (this.hooks.spawnBlightRing) {
        this.hooks.spawnBlightRing({
          x: this.x,
          y: this.y,
          expandSpeed: mc.expandSpeed ?? 150,
          bandWidth: mc.bandWidth ?? 46,
          damage: this.moveDamage(mc.damage ?? 1),
          gapDeg: mc.gapDeg ?? 70,
          lifeMs: mc.lifeMs ?? 2600,
          revealGap,
        });
      }
      if (this.scene.sfx) this.scene.sfx.summon();
    } else if (m === 'summon') {
      this.sprite.body.setVelocityX(0);
      const n = mc.count ?? 2;
      for (let i = 0; i < n; i++) {
        const ox = this.x + (i === 0 ? -90 : 90);
        if (this.hooks.spawnMinion) this.hooks.spawnMinion(ox, this.y);
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

  isDangerous() {
    return this.active && !this.dead && this.state === 'active' && this.currentMove === 'swipe';
  }

  takeHit(dmg, fromX) {
    if (this.dead) return false;
    if (this.scene.time.now < this.invulnUntil) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.sprite.setFillStyle(0xffffff);
    this.scene.time.delayedCall(70, () => {
      if (!this.dead) this.sprite.setFillStyle(0x4a2f6a);
    });
    const dir = Math.sign(this.sprite.x - fromX) || 1;
    this.sprite.body.setVelocityX(dir * 60);
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    this.checkPhase();
    return false;
  }

  checkPhase() {
    const ratio = this.hp / this.maxHP;
    for (let i = 0; i < this.phaseThresholds.length; i++) {
      if (ratio <= this.phaseThresholds[i] && this.phase < i + 2) {
        this.enterPhase(i + 2);
      }
    }
  }

  enterPhase(n) {
    this.phase = n;
    this.invulnUntil = this.scene.time.now + this.phaseShiftInvulnMs;
    this.state = 'idle';
    this.currentMove = null;
    this.tellBox.setVisible(false);
    this.tellArrow.setVisible(false);
    this.rangeFx.clear();
    this.sprite.body.setVelocity(0, 0);
    this.nextMoveAt = this.scene.time.now + 1000;
    // P3 终焉：enrage
    if (n === 3 && this.enrage) {
      this.speedMult = this.enrage.speedMult ?? 1.25;
      this.damageBonus = this.enrage.damageBonus ?? 1;
      this.sprite.setFillStyle(0x6a1f3a);
    } else if (n === 2) {
      this.sprite.setFillStyle(0x3a2f5a);
    }
    this.scene.cameras.main.flash(360, 120, 30, 60);
    if (this.scene.sfx) this.scene.sfx.phaseShift();
    this.scene.onLordPhase && this.scene.onLordPhase(n);
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.sprite.body.setVelocity(0, 0);
    this.tellBox.setVisible(false);
    this.tellArrow.setVisible(false);
    this.rangeFx.clear();
    this.scene.tweens.add({
      targets: [this.sprite, this.eyeL, this.eyeR, this.halo],
      alpha: 0,
      angle: 8,
      duration: 900,
      onComplete: () => {
        this.sprite.destroy();
        this.eyeL.destroy();
        this.eyeR.destroy();
        this.halo.destroy();
      },
    });
    if (this.hooks.onDefeated) this.hooks.onDefeated();
  }

  // 招式攻击范围预警（按招式绘制：横扫带 / 梦境弹扇 / 瘴环 / 召唤点）
  drawRange(alpha, strokeA) {
    const g = this.rangeFx;
    g.clear();
    const m = this.currentMove;
    const mc = this.moveCfg[m] || {};
    const sx = this.sprite.x, sy = this.sprite.y;
    if (m === 'swipe') {
      const range = mc.range ?? 280;
      const x0 = sx + this.dashDir * (this.w / 2 + 4);
      const len = this.dashDir > 0 ? range : -range;
      const bandH = this.h + 20;
      const left = Math.min(x0, x0 + len);
      const top = sy - bandH / 2;
      g.fillStyle(0xff6688, alpha);
      g.fillRect(left, top, Math.abs(len), bandH);
      g.lineStyle(2, 0xff99bb, strokeA);
      g.strokeRect(left, top, Math.abs(len), bandH);
    } else if (m === 'dreamOrb') {
      const base = (this.aimAngle != null) ? this.aimAngle : 0;
      const spread = (mc.spreadDeg ?? 26) * Math.PI / 180;
      const r = mc.telegraphRange ?? 210;
      g.fillStyle(0xc9a8ff, alpha);
      g.slice(sx, sy, r, base - spread / 2, base + spread / 2, false);
      g.fillPath();
      g.lineStyle(2, 0xe0c0ff, strokeA);
      g.beginPath();
      g.arc(sx, sy, r, base - spread / 2, base + spread / 2, false);
      g.strokePath();
    } else if (m === 'blightRing') {
      const r = (mc.bandWidth ?? 46) * 1.6;
      g.lineStyle(4, 0x8a4fbf, strokeA);
      g.strokeCircle(sx, sy, r);
    } else if (m === 'summon') {
      const n = mc.count ?? 2;
      g.lineStyle(2, 0xc9a8ff, strokeA);
      for (let i = 0; i < n; i++) {
        const ox = sx + (i === 0 ? -90 : 90);
        g.strokeCircle(ox, sy, 22);
      }
    }
  }
}
