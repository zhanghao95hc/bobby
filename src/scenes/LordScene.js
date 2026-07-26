// LordScene：终局「寂灭之眼」沉眠之主战（GDD 第7节）。
// · 进房锁门；3 阶段（阈值 66%/34%，随元进度自适应 + 种子重组）。
// · 每阶段新机制（swipe / dreamOrb / blightRing[听声揭示安全缝] / summon）。
// · 击败后按「探索完成度 / 是否回收全部灵影 / 项圈流派」触发 3 结局分支（环境叙事，少对话）。
// · 周目：已通关后再次进入用新种子重组 Boss（接阶段9）；F 强制重组。
import { Player } from '../entities/Player.js';
import { LordBoss } from '../entities/LordBoss.js';
import { Enemy } from '../entities/Enemy.js';
import { Shade } from '../entities/Shade.js';
import { Hud } from '../ui/Hud.js';
import { Sfx } from '../systems/Sfx.js';
import { Save } from '../systems/Save.js';
import { CollarSystem } from '../systems/Collars.js';
import { MetaProgress } from '../systems/MetaProgress.js';
import { Blight } from '../systems/Blight.js';
import { Rng, makeSeed } from '../systems/Rng.js';

const WORLD_W = 960;
const WORLD_H = 540;

export class LordScene extends Phaser.Scene {
  constructor() {
    super('Lord');
  }

  create(data) {
    this.balance = this.registry.get('balance') || {};
    const p = this.balance.player || {};

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor('#0c0712');
    this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x1a0f2a, 0.22).setDepth(-10);

    this.ground = this.add.rectangle(WORLD_W / 2, 520, WORLD_W, 40, 0x241a2e).setOrigin(0.5);
    this.physics.add.existing(this.ground, true);

    // —— 元数据 ——
    this.ensureMeta();
    this.cap = this.meta.motePoolMax;
    this.motes = 0;
    this.fish = this.profile.fish;
    this.fluff = this.profile.fluff;
    this.nineLifeCharge = false;
    this.shade = null;
    this.minions = [];
    this.projectiles = [];
    this.rings = [];
    this.hittables = [];
    this.blight = null;

    // —— 种子 / 重组（阶段9）——
    const firstTime = !this.profile.bossesDefeated.includes('lord');
    const reseed = !!(data && data.reseed);
    this.seed = !firstTime || reseed ? String(makeSeed()) : 'lord-first';
    this.lordCfg = this.buildLordCfg();

    // 难度自适应：tier = 元进度已解锁等级之和
    const tier = Object.values(this.meta.unlocked || {}).reduce((a, r) => a + (r || 0), 0);
    const ms = this.balance.boss.lord.metaScale || {};
    this.metaScale = {
      hpBonus: tier * (ms.hpPerTier ?? 70),
      cdMult: Math.max(ms.cdMultMin ?? 0.65, 1 + tier * (ms.cdMultPerTier ?? -0.04)),
    };

    // 玩家
    this.player = new Player(this, 80, 470, this.balance, this.derived);
    this.physics.add.collider(this.player.sprite, this.ground);
    this.player.onDeath = () => this.onPlayerDeath();

    // 锁门闸
    this.gate = this.add.rectangle(54, 380, 26, 320, 0x4a3a5a).setDepth(6).setVisible(false);
    this.physics.add.existing(this.gate, true);
    this.gateLocked = false;

    // 终局 Boss
    this.boss = new LordBoss(this, 640, 460, this.lordCfg, {
      onDefeated: () => this.onBossDefeated(),
      spawnMinion: (x, y) => this.spawnMinion(x, y),
      spawnProjectile: (x, y, ang, sp, dmg) => this.spawnProjectile(x, y, ang, sp, dmg),
      spawnBlightRing: (opt) => this.spawnBlightRing(opt),
    }, this.metaScale);
    this.physics.add.collider(this.boss.sprite, this.ground);
    this.hittables.push(this.boss.sprite);
    this.physics.add.overlap(this.player.sprite, this.boss.sprite, () => {
      if (this.boss.isDangerous()) this.player.takeDamage(this.boss.contactDamage, this.boss.x);
    });

    this.respawnPoint = { x: 80, y: 470 };
    this.fightOver = false;
    this.endingPlayed = false;

    // 到达「寂灭之眼」点亮区域图
    this.profile.regions = this.profile.regions || {};
    this.profile.regions['寂灭之眼'] = 100;
    this.syncProfile();

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
    this.reseedKey = this.input.keyboard.addKey('F');
    this.input.keyboard.addCapture(['SPACE', 'UP', 'L']);

    this.sfx = new Sfx();
    this.player.onClawHit = (obj, info) => this.handleHit(obj, info);

    this.hud = new Hud(this);
    this.hud.setRegions([{ name: '寂灭之眼', lit: true }]);
    this.hud.setRegionName('寂灭之眼');
    this.updateStats();

    this.add
      .text(WORLD_W / 2, 14, '沉 眠 之 主 · 终 局', {
        fontFamily: 'monospace', fontSize: '20px', color: '#c9a8ff',
      })
      .setOrigin(0.5).setScrollFactor(0).setDepth(90);
    this.add
      .text(WORLD_W / 2, 92, 'A/D 移动 · 空格 跳 · J 爪击(空中=下扑) · K 扑袭 · L 长按听声(揭示瘴环安全缝) · B 远程赎罪 · T 回教学区 · R 重战 · F 重组', {
        fontFamily: 'monospace', fontSize: '12px', color: '#a07da0',
      })
      .setOrigin(0.5, 0).setScrollFactor(0).setDepth(90);

    this.hud.setHint('向右踏入竞技场，终结沉眠之主');
    this.lastRipple = 0;
  }

  // 种子化重组：抖动阶段阈值 + 打乱各阶段招式顺序（同一 seed 必产同一布局）
  buildLordCfg() {
    const base = this.balance.boss.lord;
    const rng = new Rng(this.seed);
    const cfg = JSON.parse(JSON.stringify(base));
    cfg.phaseThresholds = (base.phaseThresholds || [0.66, 0.34]).map((t) =>
      Phaser.Math.Clamp(t + (rng.next() - 0.5) * 0.06, 0.2, 0.85)
    );
    for (const ph of ['p1', 'p2', 'p3']) {
      if (cfg.phases?.[ph]?.moves) cfg.phases[ph].moves = rng.shuffle(cfg.phases[ph].moves);
    }
    return cfg;
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
    this.meta = MetaProgress.resolve(profile, this.balance);
    MetaProgress.applyNotches(this.collars, this.meta);
    this.derived = MetaProgress.applyToDerived(this.collars.derive(), this.meta);
  }

  recomputeDerived() {
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

  lockArena() {
    if (this.gateLocked) return;
    this.gateLocked = true;
    this.gate.setVisible(true);
    this.physics.add.collider(this.player.sprite, this.gate);
    this.physics.add.collider(this.boss.sprite, this.gate);
    for (const e of this.minions) this.physics.add.collider(e.sprite, this.gate);
    this.sfx.growl();
    this.cameras.main.shake(240, 0.006);
    this.hud.setHint('门已锁！沉眠之主 苏醒 —— 击败它才能离开');
    this.floatText(WORLD_W / 2, 220, '竞技场已封闭', '#ff9a9a');
    this.boss.activate();
    this.hud.showBossBar(this.lordCfg.name || '沉眠之主', this.boss.hp, this.boss.maxHP, 1);
  }

  spawnMinion(x, y) {
    const e = new Enemy(this, x, y, this.balance, () => {});
    e.sprite.setFillStyle(0x9a6ad0);
    e.eye.setFillStyle(0x2a1040);
    this.minions.push(e);
    this.hittables.push(e.sprite);
    this.physics.add.collider(e.sprite, this.ground);
    if (this.gateLocked) this.physics.add.collider(e.sprite, this.gate);
    this.physics.add.overlap(this.player.sprite, e.sprite, () => {
      if (!e.dead) this.player.takeDamage(e.getContactDamage(), e.x);
    });
    return e;
  }

  spawnProjectile(x, y, ang, speed, damage) {
    // 发射闪光（短促线，纯表现，提升弹道可见度）
    const flash = this.add.graphics().setDepth(11);
    flash.lineStyle(3, 0xe6c9ff, 0.9);
    flash.beginPath();
    flash.moveTo(x, y);
    flash.lineTo(x + Math.cos(ang) * 30, y + Math.sin(ang) * 30);
    flash.strokePath();
    this.tweens.add({ targets: flash, alpha: 0, duration: 180, onComplete: () => flash.destroy() });
    // 梦境弹本体（加描边更醒目）
    const r = this.add.rectangle(x, y, 14, 14, 0xc9a8ff).setDepth(11).setStrokeStyle(2, 0xe6c9ff, 0.9);
    this.physics.add.existing(r);
    r.body.setAllowGravity(false);
    r.body.setVelocity(Math.cos(ang) * speed, Math.sin(ang) * speed);
    r.kind = 'projectile';
    r.hit = false;
    this.projectiles.push(r);
    this.physics.add.overlap(this.player.sprite, r, () => {
      if (!r.hit) {
        r.hit = true;
        this.player.takeDamage(damage, r.x);
        r.destroy();
        const i = this.projectiles.indexOf(r);
        if (i >= 0) this.projectiles.splice(i, 1);
      }
    });
    this.time.delayedCall(4500, () => {
      if (r && r.active) r.destroy();
      const i = this.projectiles.indexOf(r);
      if (i >= 0) this.projectiles.splice(i, 1);
    });
  }

  spawnBlightRing(opt) {
    const ring = {
      x: opt.x, y: opt.y,
      radius: 30,
      expandSpeed: opt.expandSpeed ?? 150,
      bandWidth: opt.bandWidth ?? 46,
      damage: opt.damage ?? 1,
      gapDeg: (opt.gapDeg ?? 70) * Math.PI / 180,
      gapCenter: Math.random() * Math.PI * 2,
      life: opt.lifeMs ?? 2600,
      revealGap: !!opt.revealGap,
      born: this.time.now,
      g: this.add.graphics().setDepth(8),
    };
    this.rings.push(ring);
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
      if (killed) this.addMotes(Math.round((this.balance.player.motePerKill ?? 3) * mm));
      this.hud.showBossBar(b.cfg.name || '沉眠之主', b.hp, b.maxHP, b.phase);
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

  onLordPhase(n) {
    const title = this.boss.currentPhaseTitle;
    this.hud.setHint(`沉眠之主 进入「${title}」！`);
    this.floatText(this.boss.x, this.boss.y - 50, `阶段 ${n} · ${title}`, '#ff99bb');
    if (n === 2) {
      // 寂瘴同化：场上出现瘴区
      const zones = this.lordCfg.phases?.p2?.blightZones || [];
      if (zones.length) {
        this.blight = new Blight(this, this.balance, zones);
        this.floatText(WORLD_W / 2, 260, '寂瘴涌出 —— 长按 L 听声揭示瘴环安全缝', '#b98cff');
      }
    }
  }

  onBossDefeated() {
    if (this.fightOver) return;
    this.fightOver = true;
    const fishReward = this.lordCfg.fishReward ?? 50;
    const fluffReward = this.lordCfg.fluffReward ?? 3;
    const bossId = 'lord';
    const firstKill = !this.profile.bossesDefeated.includes(bossId);

    if (firstKill) {
      this.profile.bossesDefeated.push(bossId);
      this.fish += fishReward;
      this.fluff += fluffReward;
      this.syncProfile();
      this.floatText(WORLD_W / 2, 200, `胜利! 沉眠之主 倒下 — 小鱼干+${fishReward} 记忆绒毛+${fluffReward}`, '#ffd866');
    } else {
      const extra = this.balance.meta?.repeatBossFishBonus ?? 25;
      this.fish += fishReward + extra;
      this.syncProfile();
      this.floatText(WORLD_W / 2, 200, `再战胜利! 沉眠之主 已收录 — 小鱼干+${fishReward + extra}（重复击杀不再掉绒毛）`, '#ffd866');
    }
    this.gateLocked = false;
    this.physics.world.disable(this.gate);
    this.gate.setVisible(false);
    this.hud.hideBossBar();
    this.cameras.main.flash(500, 240, 220, 255);
    this.sfx.chime();
    this.updateStats();

    // 结局判定（探索完成度 / 灵影回收 / 项圈流派）
    const ending = this.decideEnding();
    this.playEnding(ending);
  }

  // 结局分支：slumber(安眠/真结局) | flame(燎原) | silence(寂灭)
  decideEnding() {
    const fullExplore = this.isFullyExplored();
    const allReclaimed = !this.profile.everLostShade;
    const style = this.collarStyle();
    if (fullExplore && allReclaimed) return 'slumber';
    if (style === 'warrior') return 'flame';
    return 'silence';
  }

  isFullyExplored() {
    const nodes = this.balance.regionsMap?.nodes || [];
    const reg = this.profile.regions || {};
    let need = 0, got = 0;
    for (const n of nodes) {
      if (n.id === '寂灭之眼') continue; // 终点自身不算探索度
      need++;
      if ((reg[n.id] || 0) >= 100) got++;
    }
    return need > 0 && got >= need;
  }

  collarStyle() {
    const eq = this.collars.equipped;
    const hasClaw = eq.has('claw');
    const defensive = eq.has('ninelife') || eq.has('moss');
    if (hasClaw && !defensive) return 'warrior';
    if (defensive) return 'guardian';
    return 'balanced';
  }

  // 环境叙事结局（少对话，靠视觉 + 短句）
  playEnding(ending) {
    if (this.endingPlayed) return;
    this.endingPlayed = true;
    this.profile.ending = ending;
    this.syncProfile();

    const captions = {
      slumber: [
        '灵毛如萤，自裂隙中升起。',
        '沉眠之主阖眼，寂静化作温软的绒光。',
        '你坐了下来。这一次，没有谁需要被拯救。',
      ],
      flame: [
        '你爪尖的火，是它从未见过的东西。',
        '寂瘴在怒意里蜷缩、成灰。',
        '它退进黑暗，留下一地冷却的星屑。',
      ],
      silence: [
        '你赢了，可有什么被留在了途中。',
        '绒光一盏盏暗下去，没人来替它们续。',
        '沉眠之主化回寂静——和你一样，独自。',
      ],
    }[ending] || ['……'];

    // 视觉基调
    if (ending === 'slumber') {
      this.cameras.main.flash(800, 255, 240, 200);
    } else if (ending === 'flame') {
      this.cameras.main.flash(800, 255, 140, 60);
    } else {
      this.cameras.main.flash(800, 60, 40, 90);
    }

    let y = 150;
    captions.forEach((line, i) => {
      this.time.delayedCall(900 + i * 1700, () => {
        const t = this.add
          .text(WORLD_W / 2, y + i * 36, line, {
            fontFamily: 'serif', fontSize: '18px', color: '#e9def7', align: 'center',
          })
          .setOrigin(0.5).setScrollFactor(0).setDepth(95).setAlpha(0);
        this.tweens.add({ targets: t, alpha: 1, duration: 700 });
      });
    });

    this.time.delayedCall(900 + captions.length * 1700 + 600, () => {
      this.hud.setHint(`结局「${this.endingName(ending)}」· 按 R 重战 · 按 F 重组周目 · 按 T 回教学区`);
    });
  }

  endingName(id) {
    return { slumber: '安眠', flame: '燎原', silence: '寂灭' }[id] || id;
  }

  // —— 死亡循环 ——
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
      this.profile.everLostShade = true;
    }
    this.motes = 0;
    this.updateStats();
    this.spawnShade(sx, sy, total);
    this.floatText(sx, sy - 24, '灵影诞生 · 携走灵毛', '#c9a8ff');
    const distM = Math.max(1, Math.round(Math.abs(sx - this.respawnPoint.x) / (this.balance.listen.pxPerMeter || 32)));
    const dir = sx < this.respawnPoint.x ? '左' : '右';
    const fishCost = Math.ceil(total * (this.balance.shade?.atonementFactor ?? 0.5));
    this.hud.showDeath({ carried: total, dir, distM, fishCost });
    this.time.delayedCall(700, () => {
      if (this.player.dead) {
        this.player.respawnAt(this.respawnPoint.x, this.respawnPoint.y);
        this.hud.setHint('在房门口重生（寂灭之眼无猫窝）。回收灵影或按 B 远程赎罪');
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
      this.scene.restart({ reseed: false });
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.reseedKey)) {
      this.scene.restart({ reseed: true });
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.tutorialKey)) {
      this.scene.start('FuzzNest');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.atonementKey)) {
      this.remoteAtonement();
    }

    if (!this.gateLocked && !this.fightOver && this.player.sprite.x > 320) {
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
      holdUp: this.cursors.up.isDown || this.wasd.W.isDown,
      attackJust,
      pounceJust,
      listenDown: this.listenKey.isDown,
      hittables: this.hittables,
    };

    this.player.update(time, delta, input);
    this.boss.update(time, delta, this.player);
    for (const e of this.minions) e.update(time, delta, this.player);
    if (this.shade && !this.shade.dead) this.shade.update(time, delta, this.player);

    // 瘴区（P2 起）
    if (this.blight) {
      this.blight.update();
      this.blight.tickPlayer(this.player, delta, this.derived.blightResist || 0);
    }
    // 瘴环
    this.updateRings(time, delta);

    this.minions = this.minions.filter((e) => !e.dead);

    const status = [
      this.player.dead ? '已死' : null,
      this.gateLocked && !this.fightOver ? '终局!' : null,
    ].filter(Boolean).join('/') || 'idle';

    this.hud.update(this.player.sprite.x, this.player.sprite.y, this.game.loop.actualFps, status, null);

    if (this.gateLocked && !this.fightOver && this.boss && !this.boss.dead) {
      this.hud.showBossBar(this.lordCfg.name || '沉眠之主', this.boss.hp, this.boss.maxHP, this.boss.phase);
    }
  }

  updateRings(time, delta) {
    const listening = this.listenKey.isDown;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      const dt = delta / 1000;
      r.radius += r.expandSpeed * dt;
      r.life -= delta;
      if (r.life <= 0 || r.radius > 900) {
        r.g.destroy();
        this.rings.splice(i, 1);
        continue;
      }
      // 危险判定
      const px = this.player.sprite.x, py = this.player.sprite.y;
      const dx = px - r.x, dy = py - r.y;
      const dist = Math.hypot(dx, dy);
      const inBand = dist >= r.radius && dist <= r.radius + r.bandWidth;
      if (inBand) {
        let ang = Math.atan2(dy, dx);
        let d = Math.abs(ang - r.gapCenter);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d > r.gapDeg / 2) {
          this.player.takeDamage(r.damage, px);
        }
      }
      // 绘制
      r.g.clear();
      r.g.lineStyle(6, 0x8a4fbf, 0.55);
      r.g.strokeCircle(r.x, r.y, r.radius + r.bandWidth / 2);
      if (r.revealGap && listening) {
        // 听声揭示安全缝
        r.g.lineStyle(10, 0x6effa8, 0.9);
        r.g.beginPath();
        r.g.arc(r.x, r.y, r.radius + r.bandWidth / 2, r.gapCenter - r.gapDeg / 2, r.gapCenter + r.gapDeg / 2);
        r.g.strokePath();
      }
    }
  }
}
