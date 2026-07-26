// BossScene：区域1 小 Boss「锈齿鼠王」战（GDD 第7节 进度曲线骨架）。
// 进房锁门；2 阶段（HP 120，≤50% 切阶段2，增「召唤小怪」）；击败掉小鱼干 + 记忆绒毛(接口)。
// Boss 房禁用猫窝安窝（GDD 4.5 边界）；死亡循环仍走灵影，重生回房门口；可远程赎罪(B)。
import { Player } from '../entities/Player.js';
import { Boss } from '../entities/Boss.js';
import { Enemy } from '../entities/Enemy.js';
import { Shade } from '../entities/Shade.js';
import { Hud } from '../ui/Hud.js';
import { Sfx } from '../systems/Sfx.js';
import { Save } from '../systems/Save.js';
import { CollarSystem } from '../systems/Collars.js';
import { MetaProgress } from '../systems/MetaProgress.js';

const WORLD_W = 960;
const WORLD_H = 540;

export class BossScene extends Phaser.Scene {
  constructor() {
    super('Boss');
  }

  create() {
    this.balance = this.registry.get('balance') || {};
    const p = this.balance.player || {};

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor('#160d10');
    this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x3a1a1a, 0.18).setDepth(-10);

    this.ground = this.add.rectangle(WORLD_W / 2, 520, WORLD_W, 40, 0x2a1f1f).setOrigin(0.5);
    this.physics.add.existing(this.ground, true);

    // —— 元数据 ——
    this.ensureMeta();
    this.cap = this.meta.motePoolMax; // 元进度可提升灵毛池上限（GDD 4.8）
    this.motes = 0;
    this.fish = this.profile.fish;
    this.fluff = this.profile.fluff;
    this.nineLifeCharge = false;
    this.shade = null;
    this.minions = [];
    this.hittables = [];

    // 玩家
    this.player = new Player(this, 110, 430, this.balance, this.derived);
    this.physics.add.collider(this.player.sprite, this.ground);
    this.player.onDeath = () => this.onPlayerDeath();

    // —— 锁门闸（进入竞技场后落下）——
    this.gate = this.add.rectangle(54, 360, 26, 320, 0x5a3a3a).setDepth(6).setVisible(false);
    this.physics.add.existing(this.gate, true);
    this.gateLocked = false;

    // —— Boss ——
    this.boss = new Boss(this, 700, 470, this.balance, {
      onDefeated: () => this.onBossDefeated(),
      spawnMinion: (x, y) => this.spawnMinion(x, y),
    });
    this.physics.add.collider(this.boss.sprite, this.ground);
    this.hittables.push(this.boss.sprite);
    this.physics.add.overlap(this.player.sprite, this.boss.sprite, () => {
      if (this.boss.isDangerous()) this.player.takeDamage(this.boss.contactDamage, this.boss.x);
    });

    this.respawnPoint = { x: 110, y: 430 };
    this.fightOver = false;

    // —— 输入 ——
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.attackKey = this.input.keyboard.addKey('J');
    this.pounceKey = this.input.keyboard.addKey('K');
    this.jumpKey = this.input.keyboard.addKey('SPACE');
    this.listenKey = this.input.keyboard.addKey('L');
    this.atonementKey = this.input.keyboard.addKey('B');
    this.tutorialKey = this.input.keyboard.addKey('T');
    this.restartKey = this.input.keyboard.addKey('R');
    this.input.keyboard.addCapture(['SPACE', 'UP', 'L']);

    this.sfx = new Sfx();
    this.player.onClawHit = (obj, info) => this.handleHit(obj, info);

    this.hud = new Hud(this);
    this.hud.setRegions([{ name: '绒毛巢', lit: true }, { name: '沉眠回廊', lit: false }]);
    this.hud.setRegionName('锈齿鼠王战');
    this.updateStats();

    this.add
      .text(480, 14, '锈 齿 鼠 王 · 小 Boss 战', {
        fontFamily: 'monospace', fontSize: '20px', color: '#e0a0a0',
      })
      .setOrigin(0.5).setScrollFactor(0).setDepth(90);
    this.add
      .text(480, 92, '向前走踏入竞技场（门会锁上）· A/D 移动 · 空格 跳 · J 爪击(空中=下扑踩王弹起) · K 扑袭 · B 远程赎罪', {
        fontFamily: 'monospace', fontSize: '12px', color: '#a07d7d',
      })
      .setOrigin(0.5, 0).setScrollFactor(0).setDepth(90);

    this.hud.setHint('向前(右)走，踏入竞技场触发战斗');
    this.lastRipple = 0;
  }

  ensureMeta() {
    let profile = this.registry.get('profile');
    if (!profile) {
      profile = Save.load(this.balance);
      this.registry.set('profile', profile);
    }
    this.profile = profile;
    this.collars = new CollarSystem(this.balance);
    this.collars.applyProfile(profile);
    // 元进度：槽位/灵毛池/移动技 注入派生
    this.meta = MetaProgress.resolve(profile, this.balance);
    MetaProgress.applyNotches(this.collars, this.meta);
    this.derived = MetaProgress.applyToDerived(this.collars.derive(), this.meta);
  }

  recomputeDerived() {
    // 重算项圈派生后，重新注入元进度（槽位/灵毛池/移动技）保持 this.derived 一致
    this.derived = MetaProgress.applyToDerived(this.collars.derive(), this.meta);
    this.player.maxHP = this.derived.maxHP;
    if (this.player.hp > this.player.maxHP) this.player.hp = this.player.maxHP;
  }

  syncProfile() {
    const prof = this.profile;
    prof.fish = this.fish;
    prof.fluff = this.fluff;
    const c = this.collars.toProfile();
    prof.ownedCollars = c.ownedCollars;
    prof.equippedCollars = c.equippedCollars;
    prof.maskLevel = c.maskLevel;
    prof.firstRunDone = true;
    Save.save(prof);
    this.registry.set('profile', prof);
  }

  // —— 进房锁门 ——
  lockArena() {
    if (this.gateLocked) return;
    this.gateLocked = true;
    this.gate.setVisible(true);
    this.physics.add.collider(this.player.sprite, this.gate);
    this.physics.add.collider(this.boss.sprite, this.gate);
    for (const e of this.minions) this.physics.add.collider(e.sprite, this.gate);
    this.sfx.growl();
    this.cameras.main.shake(220, 0.006);
    this.hud.setHint('门已锁！锈齿鼠王 苏醒 —— 击败它才能离开');
    this.floatText(480, 200, '竞技场已封闭', '#ff9a9a');
    this.boss.activate();
    this.hud.showBossBar(this.boss.cfg.name || '锈齿鼠王', this.boss.hp, this.boss.maxHP, 1);
  }

  spawnMinion(x, y) {
    const e = new Enemy(this, x, y, this.balance, () => {});
    // 阶段2召唤的小怪为「幼鼠」外观（偏黄），自带接触伤害
    e.sprite.setFillStyle(0xc9a04a);
    e.eye.setFillStyle(0x3a2a10);
    this.minions.push(e);
    this.hittables.push(e.sprite);
    this.physics.add.collider(e.sprite, this.ground);
    if (this.gateLocked) this.physics.add.collider(e.sprite, this.gate);
    this.physics.add.overlap(this.player.sprite, e.sprite, () => {
      if (!e.dead) this.player.takeDamage(e.getContactDamage(), e.x);
    });
    return e;
  }

  // —— 命中分发 ——
  handleHit(obj, info) {
    const mm = this.derived.moteMult || 1;
    const fm = this.derived.fishMult || 1;
    if (obj.kind === 'boss') {
      const b = obj.ref;
      const killed = b.takeHit(this.player.clawDamage, this.player.sprite.x);
      this.addMotes(Math.round((this.balance.player.motePerHit ?? 1) * mm));
      this.sfx.pop();
      this.cameras.main.shake(60, 0.004);
      this.floatText(obj.x, obj.y - 10, '灵毛 +1', '#aee9ff');
      if (killed) {
        this.addMotes(Math.round((this.balance.player.motePerKill ?? 3) * mm));
      }
      this.hud.showBossBar(b.cfg.name || '锈齿鼠王', b.hp, b.maxHP, b.phase);
      this.updateStats();
    } else if (obj.kind === 'enemy') {
      const e = obj.ref;
      const killed = e.takeHit(this.player.clawDamage, this.player.sprite.x);
      this.addMotes(Math.round((this.balance.player.motePerHit ?? 1) * mm));
      this.sfx.pop();
      this.cameras.main.shake(50, 0.003);
      this.floatText(obj.x, obj.y, '灵毛 +1', '#aee9ff');
      if (killed) {
        this.addMotes(Math.round((this.balance.player.motePerKill ?? 3) * mm));
        const fish = Math.round((this.balance.enemy.fishDrop ?? 2) * fm);
        this.fish += fish;
        this.floatText(obj.x, obj.y - 16, `击杀! 小鱼干 +${fish}`, '#ffd866');
        this.sfx.chime();
      }
      this.updateStats();
    } else if (obj.kind === 'shade') {
      obj.ref.takeHit(this.player.clawDamage, this.player.sprite.x);
      this.sfx.pop();
      this.updateStats();
    }
  }

  addMotes(n) {
    this.motes = Math.min(this.cap, this.motes + n);
  }

  onBossPhase2() {
    this.hud.setHint('锈齿鼠王 进入第二阶段！召唤幼鼠 + 更频繁冲刺');
    this.floatText(this.boss.x, this.boss.y - 40, '第二阶段!', '#ff7777');
  }

  onBossDefeated() {
    this.fightOver = true;
    const fishReward = this.boss.cfg.fishReward ?? 25;
    const fluffReward = this.boss.cfg.fluffReward ?? 1;
    const bossId = 'rustooth';
    const firstKill = !this.profile.bossesDefeated.includes(bossId);

    if (firstKill) {
      // 首杀：小鱼干 + 记忆绒毛（GDD 4.8 元货币掉落）
      this.profile.bossesDefeated.push(bossId);
      this.fish += fishReward;
      this.fluff += fluffReward;
      this.syncProfile();
      this.floatText(480, 200, `胜利! 锈齿鼠王 倒下 — 小鱼干+${fishReward} 记忆绒毛+${fluffReward}`, '#ffd866');
    } else {
      // 重组周目重复击杀：二次不掉绒毛，改掉小鱼干（额外奖励，GDD 4.8 边界）
      const extra = this.balance.meta?.repeatBossFishBonus ?? 25;
      this.fish += fishReward + extra;
      this.syncProfile();
      this.floatText(480, 200, `再战胜利! 锈齿鼠王 已收录 — 小鱼干+${fishReward + extra}（重复击杀不再掉绒毛）`, '#ffd866');
    }
    // 开门
    this.gateLocked = false;
    this.physics.world.disable(this.gate);
    this.gate.setVisible(false);
    this.hud.hideBossBar();
    this.cameras.main.flash(500, 255, 240, 200);
    this.sfx.chime();
    this.hud.setHint('按 T 回教学区 · 按 R 再战 · 记忆绒毛可在猫神祭坛(M)解锁永久能力');
    this.updateStats();
  }

  // —— 死亡循环（无猫窝安窝，但灵影 + 远程赎罪可用）——
  onPlayerDeath() {
    const carried = this.motes;
    const sx = this.player.sprite.x;
    const sy = this.player.sprite.y;

    if (this.derived.nineLife && this.nineLifeCharge) {
      this.nineLifeCharge = false;
      this.floatText(sx, sy - 24, '九命项圈！原地复活', '#ffd866');
      this.sfx.chime();
      this.player.respawnAt(sx, sy);
      this.updateStats();
      return;
    }

    let total = carried;
    if (this.shade && !this.shade.dead) {
      total += this.shade.carried;
      this.shade.kill();
      this.shade = null;
      this.profile.everLostShade = true; // 遗弃了一个未回收的灵影（终局结局判定用）
    }
    this.motes = 0;
    this.updateStats();
    // Boss 房死亡：灵影生成在死亡点；重生回房门口（不走猫窝）
    this.spawnShade(sx, sy, total);
    this.floatText(sx, sy - 24, '灵影诞生 · 携走灵毛', '#c9a8ff');
    // 死亡柔化层
    const distM = Math.max(1, Math.round(Math.abs(sx - this.respawnPoint.x) / (this.balance.listen.pxPerMeter || 32)));
    const dir = sx < this.respawnPoint.x ? '左' : '右';
    const fishCost = Math.ceil(total * (this.balance.shade?.atonementFactor ?? 0.5));
    this.hud.showDeath({ carried: total, dir, distM, fishCost });
    this.time.delayedCall(700, () => {
      if (this.player.dead) {
        this.player.respawnAt(this.respawnPoint.x, this.respawnPoint.y);
        this.hud.setHint('在房门口重生（Boss 房无猫窝）。击杀灵影回收灵毛，或按 B 远程赎罪');
      }
    });
  }

  spawnShade(x, y, motes) {
    const sh = new Shade(this, x, y, motes, this.balance, (s) => this.reclaimShade(s));
    this.shade = sh;
    this.hittables.push(sh.sprite);
    this.physics.add.collider(sh.sprite, this.ground);
    this.physics.add.overlap(this.player.sprite, sh.sprite, () => {
      if (this.shade && !this.shade.dead) this.player.takeDamage(this.shade.contactDamage, this.shade.x);
    });
  }

  reclaimShade(sh) {
    const amt = sh.carried || 0;
    const gained = Math.min(this.cap - this.motes, amt);
    this.motes += gained;
    this.floatText(this.player.sprite.x, this.player.sprite.y - 20, `灵毛回收 +${amt}`, '#c9a8ff');
    this.sfx.chime();
    this.shade = null;
    this.updateStats();
  }

  remoteAtonement() {
    if (!this.shade || this.shade.dead) {
      this.hud.setHint('当前没有灵影可赎罪');
      return;
    }
    const factor = this.balance.shade?.atonementFactor ?? 0.5;
    const cost = Math.ceil(this.shade.carried * factor);
    if (this.fish < cost) {
      this.hud.setHint(`远程赎罪需 ${cost} 小鱼干（现有 ${this.fish}）`);
      return;
    }
    this.fish -= cost;
    const amt = this.shade.carried;
    const gained = Math.min(this.cap - this.motes, amt);
    this.motes += gained;
    this.floatText(this.player.sprite.x, this.player.sprite.y - 20, `远程赎罪 -${cost}小鱼干 · 灵毛+${amt}`, '#ffd866');
    this.shade.kill();
    this.shade = null;
    this.sfx.chime();
    this.syncProfile();
    this.updateStats();
  }

  equippedCollarNames() {
    const names = [];
    for (const id of this.collars.equipped) names.push(this.collars.catalog[id]?.name || id);
    return names.length ? names.join('/') : '无';
  }

  updateStats() {
    this.hud.setStats({
      motes: this.motes,
      fish: this.fish,
      fluff: this.fluff,
      cap: this.cap,
      hp: this.player.hp,
      maxHP: this.player.maxHP,
      collars: this.equippedCollarNames(),
    });
  }

  floatText(x, y, msg, color) {
    const t = this.add
      .text(x, y, msg, { fontFamily: 'monospace', fontSize: '13px', color })
      .setOrigin(0.5).setDepth(50);
    this.tweens.add({ targets: t, y: y - 32, alpha: 0, duration: 600, onComplete: () => t.destroy() });
  }

  update(time, delta) {
    if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      this.scene.restart();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.tutorialKey)) {
      this.scene.start('FuzzNest');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.atonementKey)) {
      this.remoteAtonement();
    }

    // 锁门触发：玩家踏入竞技场中线
    if (!this.gateLocked && !this.fightOver && this.player.sprite.x > 220) {
      this.lockArena();
    }

    const attackJust = Phaser.Input.Keyboard.JustDown(this.attackKey);
    const pounceJust = Phaser.Input.Keyboard.JustDown(this.pounceKey);
    const jumpJust =
      Phaser.Input.Keyboard.JustDown(this.jumpKey) ||
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.wasd.W);

    const input = {
      left: this.cursors.left.isDown || this.wasd.A.isDown,
      right: this.cursors.right.isDown || this.wasd.D.isDown,
      up: jumpJust,
      holdUp: this.cursors.up.isDown || this.wasd.W.isDown, // 滑翔：长按跳/上
      attackJust,
      pounceJust,
      listenDown: this.listenKey.isDown,
      hittables: this.hittables,
    };

    this.player.update(time, delta, input);
    this.boss.update(time, delta, this.player);
    for (const e of this.minions) e.update(time, delta, this.player);
    if (this.shade && !this.shade.dead) this.shade.update(time, delta, this.player);

    // 清理已死小怪
    this.minions = this.minions.filter((e) => !e.dead);

    const status = [
      this.player.dead ? '已死' : null,
      this.gateLocked && !this.fightOver ? '战斗!' : null,
    ].filter(Boolean).join('/') || 'idle';

    this.hud.update(
      this.player.sprite.x,
      this.player.sprite.y,
      this.game.loop.actualFps,
      status,
      null
    );

    if (this.gateLocked && !this.fightOver && this.boss && !this.boss.dead) {
      this.hud.showBossBar(this.boss.cfg.name || '锈齿鼠王', this.boss.hp, this.boss.maxHP, this.boss.phase);
    }
  }
}
