// TempleScene：猫神殿 / 寂瘴潮 —— 程序化重组挑战区（GDD 第3节 肉鸽重组 + 4.8）。
// 关键：进房用种子化随机生成 平台/敌人/宝箱/终点；blight 模式额外叠加寂瘴区。
//   · 每次重进用"新随机种子" → 布局重组（满足"挑战区每次重进重组"）
//   · 同种子 → 完全可复现（满足"种子化随机保证调试可复现"，按 F 重进同种子）
//   · 主探索区（绒毛巢）固定不在此场景，地图记忆不受影响。
// 元进度（项圈槽/灵毛池/移动技）在此生效——重组只改房间，不改永久能力。
import { Player } from '../entities/Player.js';
import { Enemy } from '../entities/Enemy.js';
import { Shade } from '../entities/Shade.js';
import { Hud } from '../ui/Hud.js';
import { Sfx } from '../systems/Sfx.js';
import { Save } from '../systems/Save.js';
import { CollarSystem } from '../systems/Collars.js';
import { MetaProgress } from '../systems/MetaProgress.js';
import { Blight } from '../systems/Blight.js';
import { Rng, makeSeed } from '../systems/Rng.js';

const WORLD_W = 1680;
const WORLD_H = 540;
const GROUND_TOP = 500;

export class TempleScene extends Phaser.Scene {
  constructor() {
    super('Temple');
  }

  init(data) {
    this.mode = (data && data.mode) || 'temple'; // 'temple' | 'blight'
    this.seed = typeof (data && data.seed) === 'number' ? data.seed : makeSeed();
    this.foughtSeed = this.seed;
  }

  create() {
    this.balance = this.registry.get('balance') || {};

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    const isBlight = this.mode === 'blight';
    this.cameras.main.setBackgroundColor(isBlight ? '#160d18' : '#0c0a14');
    this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, isBlight ? 0x3a1a2a : 0x2a1f2e, 0.25).setDepth(-10);

    const ground = this.add.rectangle(WORLD_W / 2, 520, WORLD_W, 40, 0x222233).setOrigin(0.5);
    this.physics.add.existing(ground, true);
    this.ground = ground;

    // —— 元进度（永久能力生效）——
    this.ensureMeta();
    this.cap = this.meta.motePoolMax;
    this.motes = 0;
    this.fish = 0;
    this.fluff = this.profile.fluff;
    this.shade = null;
    this.enemies = [];
    this.hittables = [];
    this.platforms = [];
    this.won = false;
    this.respawnPoint = { x: 110, y: 430 };

    // —— 玩家（先建，供 generateLayout 内敌人/宝箱绑定 this.player.sprite）——
    this.player = new Player(this, 110, 430, this.balance, this.derived);
    this.player.onDeath = () => this.onPlayerDeath();
    this.player.onClawHit = (obj, info) => this.handleHit(obj, info);

    // —— 种子化生成布局（同 seed 必产同布局）——
    const rng = new Rng(this.seed);
    this.generateLayout(rng, isBlight);

    // 玩家与地形碰撞（地形在 generateLayout 中生成）
    this.physics.add.collider(this.player.sprite, ground);
    for (const pf of this.platforms) this.physics.add.collider(this.player.sprite, pf);
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);

    // —— 输入 ——
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.attackKey = this.input.keyboard.addKey('J');
    this.pounceKey = this.input.keyboard.addKey('K');
    this.jumpKey = this.input.keyboard.addKey('SPACE');
    this.listenKey = this.input.keyboard.addKey('L');
    this.atonementKey = this.input.keyboard.addKey('B');
    this.recombineKey = this.input.keyboard.addKey('R'); // 新种子重组
    this.reproKey = this.input.keyboard.addKey('F'); // 同种子复现
    this.backKey = this.input.keyboard.addKey('T');
    this.input.keyboard.addCapture(['SPACE', 'UP', 'L']);

    this.sfx = new Sfx();
    this.prevListening = false;
    this.prevInBlight = false;
    this.lastRipple = 0;
    this.currentListenRadius = 0;

    // —— HUD ——
    this.hud = new Hud(this);
    this.hud.setRegions([{ name: '绒毛巢', lit: true }, { name: '猫神殿', lit: isBlight ? false : true }]);
    this.hud.setRegionName(isBlight ? '寂瘴潮' : '猫神殿');
    this.updateStats();

    const title = isBlight ? '寂 瘴 潮 · 重 组 挑 战' : '猫 神 殿 · 重 组 挑 战';
    this.add
      .text(480, 16, title, { fontFamily: 'monospace', fontSize: '20px', color: isBlight ? '#c98fff' : '#e7d4ff' })
      .setOrigin(0.5).setScrollFactor(0).setDepth(90).setFixedSize(960, 30);
    // 种子显示（可复现调试：记下此数，按 F 复现同一布局）
    this.seedText = this.add
      .text(12, 70, `种子 #${this.seed}  (R 重组 / F 同种子复现)`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#7d8aa8',
      })
      .setScrollFactor(0).setDepth(90);

    this.hud.setHint('向右穿过重组房间抵达终点旗 ✓ · R 重新随机重组 · F 同种子重玩 · T 回教学区');
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

  // —— 种子化布局生成 ——
  generateLayout(rng, isBlight) {
    // 1) 平台（避开起点与终点区）
    const platCount = rng.int(5, 8);
    for (let i = 0; i < platCount; i++) {
      const w = rng.int(90, 170);
      const x = rng.range(240, WORLD_W - 140);
      const y = rng.range(150, GROUND_TOP - 40);
      const pf = this.add.rectangle(x, y, w, 18, 0x4a4458, 0.95).setDepth(5);
      this.physics.add.existing(pf, true);
      this.platforms.push(pf);
    }

    // 2) 敌人（地面随机点，避开起点）
    const enemyCount = rng.int(3, 6);
    for (let i = 0; i < enemyCount; i++) {
      const x = rng.range(280, WORLD_W - 120);
      this.spawnEnemy(x, GROUND_TOP - 28);
    }

    // 3) 宝箱（平台顶/地面，给灵毛+小鱼干）
    const chestCount = rng.int(1, 2);
    for (let i = 0; i < chestCount; i++) {
      const onPlat = this.platforms.length && rng.next() < 0.6;
      let cx, cy;
      if (onPlat) {
        const pf = rng.pick(this.platforms);
        cx = pf.x; cy = pf.y - 22;
      } else {
        cx = rng.range(300, WORLD_W - 160); cy = GROUND_TOP - 22;
      }
      this.makeChest(cx, cy, rng.int(3, 6), rng.int(2, 4));
    }

    // 4) 寂瘴模式：叠加 1~2 个瘴区（垂直条带）
    if (isBlight) {
      const zones = [];
      const zCount = rng.int(1, 2);
      for (let i = 0; i < zCount; i++) {
        const w = rng.int(140, 300);
        const x = rng.range(280, WORLD_W - 200 - w);
        zones.push({ x, y: 40, w, h: 460 });
      }
      this.blight = new Blight(this, this.balance, zones);
    }

    // 5) 终点旗（右侧）
    const goalX = WORLD_W - 60;
    this.goal = this.add.rectangle(goalX, GROUND_TOP - 50, 16, 100, 0xffe08a, 0.9).setDepth(6);
    this.add.triangle(goalX + 14, GROUND_TOP - 96, 0, 0, 26, 12, 0, 24, 0xffd866).setDepth(6);
    this.physics.add.existing(this.goal, true);
    this.goalFlag = this.goal;
  }

  spawnEnemy(x, y) {
    const e = new Enemy(this, x, y, this.balance, (en) => this.onEnemyKilled(en));
    this.enemies.push(e);
    this.hittables.push(e.sprite);
    this.physics.add.collider(e.sprite, this.ground);
    for (const pf of this.platforms) this.physics.add.collider(e.sprite, pf);
    this.physics.add.overlap(this.player.sprite, e.sprite, () => {
      if (!e.dead) this.player.takeDamage(e.getContactDamage(), e.x);
    });
    return e;
  }

  onEnemyKilled(e) {
    const fm = this.derived.fishMult || 1;
    const mm = this.derived.moteMult || 1;
    this.addMotes(Math.round((this.balance.player.motePerKill ?? 3) * mm));
    const fish = Math.round((this.balance.enemy.fishDrop ?? 2) * fm);
    this.fish += fish;
    this.floatText(e.x, e.y - 16, `击杀! 小鱼干 +${fish}`, '#ffd866');
    this.sfx.chime();
    this.updateStats();
  }

  makeChest(x, y, motes, fish) {
    const chest = this.add.rectangle(x, y, 26, 22, 0xe0b070).setDepth(8);
    chest.kind = 'chest';
    chest._motes = motes;
    chest._fish = fish;
    chest._taken = false;
    this.physics.add.existing(chest, true);
    this.physics.add.collider(this.player.sprite, chest);
    this.physics.add.overlap(this.player.sprite, chest, () => {
      if (chest._taken) return;
      chest._taken = true;
      this.addMotes(chest._motes);
      this.fish += chest._fish;
      this.floatText(x, y - 18, `宝箱! 灵毛+${chest._motes} 小鱼干+${chest._fish}`, '#ffd866');
      this.sfx.chime();
      chest.setVisible(false);
      this.updateStats();
    });
  }

  addMotes(n) {
    this.motes = Math.min(this.cap, this.motes + n);
  }

  handleHit(obj, info) {
    if (obj.kind === 'enemy') {
      const e = obj.ref;
      const killed = e.takeHit(this.player.clawDamage, this.player.sprite.x);
      this.addMotes(Math.round((this.balance.player.motePerHit ?? 1) * (this.derived.moteMult || 1)));
      this.sfx.pop();
      this.cameras.main.shake(50, 0.003);
      this.floatText(obj.x, obj.y, '灵毛 +1', '#aee9ff');
      this.updateStats();
    } else if (obj.kind === 'shade') {
      obj.ref.takeHit(this.player.clawDamage, this.player.sprite.x);
      this.sfx.pop();
      this.updateStats();
    }
  }

  // —— 死亡循环（灵影 + 远程赎罪兜底，防卡死）——
  onPlayerDeath() {
    if (this.won) return;
    const carried = this.motes;
    const sx = this.player.sprite.x;
    const sy = this.player.sprite.y;
    let total = carried;
    if (this.shade && !this.shade.dead) {
      total += this.shade.carried;
      this.shade.kill();
      this.shade = null;
      this.profile.everLostShade = true; // 遗弃了一个未回收的灵影（终局结局判定用）
    }
    this.motes = 0;
    this.updateStats();
    let pt = { x: sx, y: sy };
    if (this.blight) {
      const z = this.blight.zoneAt(sx, sy);
      if (z) pt = this.blight.edgeSpawnPoint(z, sx, GROUND_TOP);
    }
    this.spawnShade(pt.x, pt.y, total);
    this.floatText(pt.x, pt.y - 24, '灵影诞生 · 携走灵毛', '#c9a8ff');
    // 死亡柔化层
    const distM = Math.max(1, Math.round(Math.abs(pt.x - this.respawnPoint.x) / (this.balance.listen.pxPerMeter || 32)));
    const dir = pt.x < this.respawnPoint.x ? '左' : '右';
    const fishCost = Math.ceil(total * (this.balance.shade?.atonementFactor ?? 0.5));
    this.hud.showDeath({ carried: total, dir, distM, fishCost });
    this.time.delayedCall(700, () => {
      if (this.player.dead && !this.won) this.player.respawnAt(this.respawnPoint.x, this.respawnPoint.y);
    });
  }

  spawnShade(x, y, motes) {
    const sh = new Shade(this, x, y, motes, this.balance, (s) => this.reclaimShade(s));
    this.shade = sh;
    this.hittables.push(sh.sprite);
    this.physics.add.collider(sh.sprite, this.ground);
    for (const pf of this.platforms) this.physics.add.collider(sh.sprite, pf);
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
    this.updateStats();
  }

  reachGoal() {
    if (this.won) return;
    this.won = true;
    // 通关奖励：本局小鱼干存入存档（永久）；灵毛为局内资源，不留存
    this.profile.fish += this.fish;
    Save.save(this.profile);
    this.registry.set('profile', this.profile);
    this.cameras.main.flash(500, 255, 240, 200);
    this.sfx.chime();
    this.floatText(this.goalFlag.x, this.goalFlag.y - 60, `通关! 小鱼干 +${this.fish} 已存入`, '#ffd866');
    this.hud.setHint(`挑战完成! 小鱼干+${this.fish} · 按 T 回教学区 · 按 R 再重组一局`);
    this.time.delayedCall(1600, () => {
      if (this.won) this.scene.start('FuzzNest');
    });
  }

  updateStats() {
    this.hud.setStats({
      motes: this.motes,
      fish: this.fish,
      fluff: this.fluff,
      cap: this.cap,
      hp: this.player.hp,
      maxHP: this.player.maxHP,
      collars: this.profile ? (this.collars.equipped.size ? [...this.collars.equipped].map((i) => this.collars.catalog[i]?.name || i).join('/') : '无') : '无',
    });
  }

  floatText(x, y, msg, color) {
    const t = this.add
      .text(x, y, msg, { fontFamily: 'monospace', fontSize: '13px', color })
      .setOrigin(0.5).setDepth(50);
    this.tweens.add({ targets: t, y: y - 32, alpha: 0, duration: 600, onComplete: () => t.destroy() });
  }

  applyListening() {
    const L = this.balance.listen || {};
    const baseR = (L.radius || 6) * (L.pxPerMeter || 32) * (this.derived.listenRadiusMult || 1);
    const factor = this.blight ? this.blight.getBlightFactor(this.player.sprite.x, this.player.sprite.y) : 1;
    const r = Math.max(8, baseR * factor);
    this.currentListenRadius = r;
  }

  spawnRipple(x, y, radius) {
    const ring = this.add
      .circle(x, y, Math.max(8, radius), 0x9fe0ff, 0)
      .setStrokeStyle(2, 0x9fe0ff, 0.7)
      .setDepth(30);
    ring.setScale(0.12).setAlpha(0.7);
    this.tweens.add({ targets: ring, scale: 1, alpha: 0, duration: 560, onComplete: () => ring.destroy() });
  }

  update(time, delta) {
    // 重组 / 复现 / 返回
    if (Phaser.Input.Keyboard.JustDown(this.recombineKey)) {
      this.scene.restart({ mode: this.mode, seed: makeSeed() }); // 新种子 → 布局重组
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.reproKey)) {
      this.scene.restart({ mode: this.mode, seed: this.seed }); // 同种子 → 完全可复现
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.backKey)) {
      this.scene.start('FuzzNest');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.atonementKey)) {
      this.remoteAtonement();
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
      holdUp: this.cursors.up.isDown || this.wasd.W.isDown, // 滑翔用：长按
      attackJust,
      pounceJust,
      listenDown: this.listenKey.isDown,
      hittables: this.hittables,
    };

    const s = this.player.update(time, delta, input);

    // 终点判定
    if (!this.won && Phaser.Math.Distance.Between(this.player.sprite.x, this.player.sprite.y, this.goalFlag.x, this.goalFlag.y) < 60) {
      this.reachGoal();
    }

    // 瘴区（blight 模式）
    if (this.blight) {
      this.blight.tickPlayer(this.player, delta, this.player.blightResist);
      this.blight.update();
    }

    // 敌人
    for (const e of this.enemies) {
      if (this.blight) {
        const m = this.blight.getModsAt(e.x, e.y);
        e.blightDmgBonus = m.dmgBonus;
        e.blightSpeedBonus = m.speedBonus;
        e.inBlight = m.inBlight;
      }
      e.update(time, delta, this.player);
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
    if (this.shade && !this.shade.dead) this.shade.update(time, delta, this.player);

    // 每帧推 HUD（瘴/掉血连续可见）
    this.updateStats();

    // 听声反馈
    if (s.listening && !this.prevListening) this.sfx.ear();
    this.prevListening = s.listening;
    this.applyListening();
    if (s.listening && time - this.lastRipple > (this.balance.listen.rippleIntervalMs || 220)) {
      this.lastRipple = time;
      this.spawnRipple(this.player.sprite.x, this.player.sprite.y, this.currentListenRadius);
    }

    const slow = s.listening ? this.balance.listen.slowFactor || 0.85 : 1;
    this.physics.world.timeScale = 1 / slow;
    this.tweens.timeScale = slow;
    this.time.timeScale = slow;

    if (this.blight) {
      if (this.player.inBlight && !this.prevInBlight) this.sfx.blightHum();
      this.prevInBlight = this.player.inBlight;
      this.hud.setBlight(this.player.inBlight);
    }

    const status = [
      s.attacking ? '攻击' : null,
      s.pouncing ? '扑袭' : null,
      s.iframe ? '无敌' : null,
      this.player.dead ? '已死' : null,
      this.player.airPounceCharges > 0 ? '二段扑✓' : null,
      this.blight && this.player.inBlight ? '瘴' : null,
    ].filter(Boolean).join('/') || 'idle';

    this.hud.update(
      this.player.sprite.x,
      this.player.sprite.y,
      this.game.loop.actualFps,
      status,
      { listening: s.listening, listenRevealed: s.listenRevealed, listenProgress: s.listenProgress, hitstun: s.hitstun }
    );
  }
}
