// BlightTestScene：寂瘴验证区（GDD 4.7）。
// 单屏：左安全区(对照) / 右寂瘴区(掉血+压听声+增敌)。
// 验证：① 瘴区持续掉鱼心 ② 折耳听声范围被压制(清瘴后恢复) ③ 瘴内敌人染紫、加伤、加速
//       ④ 清瘴点临时净化 ⑤ 瘴中死亡灵影落于瘴外缘(防不可达) ⑥ 戴苔语项圈减伤(控制台可试)。
import { Player } from '../entities/Player.js';
import { Hud } from '../ui/Hud.js';
import { Sfx } from '../systems/Sfx.js';
import { Enemy } from '../entities/Enemy.js';
import { Shade } from '../entities/Shade.js';
import { Blight } from '../systems/Blight.js';

const WORLD_W = 960;
const WORLD_H = 540;
const GROUND_TOP = 500;

export class BlightTestScene extends Phaser.Scene {
  constructor() {
    super('Blight');
  }

  create() {
    this.balance = this.registry.get('balance') || {};
    const p = this.balance.player || {};
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor('#0c0a14');

    const ground = this.add.rectangle(WORLD_W / 2, 520, WORLD_W, 40, 0x222233).setOrigin(0.5);
    this.physics.add.existing(ground, true);
    this.ground = ground;

    // 分界与标题
    this.add.rectangle(470, 270, 4, 540, 0x443a55).setDepth(1);
    this.add.text(230, 58, '安 全 区', { fontFamily: 'monospace', fontSize: '18px', color: '#7fb0a0' }).setOrigin(0.5).setDepth(3);
    this.add.text(710, 58, '寂 瘴 区', { fontFamily: 'monospace', fontSize: '18px', color: '#c98fff' }).setOrigin(0.5).setDepth(3);

    // —— 寂瘴系统（右侧整块）——
    this.blight = new Blight(this, this.balance, [{ x: 480, y: 40, w: 460, h: 480 }]);

    // 货币（本测试区隔离，不读存档）
    this.cap = p.motePoolMax ?? 33;
    this.motes = 0;
    this.fish = 0;
    this.fluff = 0;
    this.blightResist = 0; // 默认无瘴减伤项圈；控制台试：this.player.blightResist = 0.6

    // 玩家（带 blightResist 派生槽，默认 0）
    this.player = new Player(this, 120, 430, this.balance, { blightResist: 0 });
    this.physics.add.collider(this.player.sprite, ground);
    this.player.onDeath = () => this.onPlayerDeath();

    // 敌人：安全区1只(对照) + 瘴区2只(增强)
    this.enemies = [];
    this.hittables = [];
    this.spawnEnemy(300, 470); // 安全区
    this.spawnEnemy(640, 470); // 瘴区
    this.spawnEnemy(840, 470); // 瘴区

    // 瘴内隐藏小鱼干：验证听声压制（瘴中须贴很近才显形，清瘴后范围恢复）
    this.secretFish = this.add.rectangle(720, 300, 16, 12, 0xffd866).setAlpha(0).setDepth(20);
    this.secretFish.kind = 'blightfish';
    this.secretFish.noBounce = true;
    this.secrets = [{ obj: this.secretFish, type: 'fish', revealed: false }];
    this.physics.add.overlap(this.player.sprite, this.secretFish, () => {
      const sec = this.secrets[0];
      if (sec.revealed && !this.secretFish._taken) {
        this.secretFish._taken = true;
        this.fish += 3;
        this.floatText(this.secretFish.x, this.secretFish.y, '小鱼干 +3（听声发现·瘴中）', '#ffd866');
        this.sfx.chime();
        this.secretFish.setVisible(false);
        this.updateStats();
      }
    });

    // 清瘴点（占位交互：靠近按 E 净化附近瘴区）
    this.rune = this.add.rectangle(480, 462, 26, 26, 0x3f8f5a).setDepth(6).setStrokeStyle(2, 0x9affb0);
    this.add.text(480, 442, '清瘴点', { fontFamily: 'monospace', fontSize: '10px', color: '#9affb0' }).setOrigin(0.5).setDepth(6);

    // 猫窝（复活点 + 远程赎罪提示）
    this.bed = this.add.rectangle(70, 472, 60, 46, 0x3a2f4a).setDepth(4);
    this.physics.add.overlap(this.player.sprite, this.bed, () => {
      this.respawnPoint = { x: 120, y: 430 };
    });
    this.respawnPoint = { x: 120, y: 430 };
    this.shade = null;

    // —— 输入 ——
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.attackKey = this.input.keyboard.addKey('J');
    this.pounceKey = this.input.keyboard.addKey('K');
    this.jumpKey = this.input.keyboard.addKey('SPACE');
    this.listenKey = this.input.keyboard.addKey('L');
    this.interactKey = this.input.keyboard.addKey('E');
    this.atonementKey = this.input.keyboard.addKey('B');
    this.sandboxKey = this.input.keyboard.addKey('G');
    this.tutorialKey = this.input.keyboard.addKey('T');
    this.combatKey = this.input.keyboard.addKey('C');
    this.restartKey = this.input.keyboard.addKey('R');
    this.input.keyboard.addCapture(['SPACE', 'UP', 'L']);

    this.sfx = new Sfx();
    this.prevListening = false;
    this.prevInBlight = false;
    this.player.onClawHit = (obj, info) => this.handleHit(obj, info);

    this.hud = new Hud(this);
    this.hud.setRegions([{ name: '绒毛巢', lit: true }, { name: '沉眠回廊', lit: true }, { name: '寂瘴沼', lit: true }]);
    this.updateStats();

    this.add
      .text(480, 16, '寂 瘴 测 试 区 (GDD 4.7)', { fontFamily: 'monospace', fontSize: '20px', color: '#c98fff' })
      .setOrigin(0.5)
      .setDepth(90);
    this.add
      .text(480, 96, 'A/D 移动 · 空格 跳 · J 爪击 · K 扑袭 · 长按 L 听声(瘴中压制) · 清瘴点按 E 净化 · B 远程赎罪', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#7d8aa8',
      })
      .setOrigin(0.5)
      .setDepth(90);

    this.lastRipple = 0;
    this.currentListenRadius = 0;
  }

  spawnEnemy(x, y) {
    const e = new Enemy(this, x, y, this.balance, () => {});
    this.enemies.push(e);
    this.hittables.push(e.sprite);
    this.physics.add.collider(e.sprite, this.ground);
    this.physics.add.overlap(this.player.sprite, e.sprite, () => {
      if (!e.dead) this.player.takeDamage(e.getContactDamage(), e.x);
    });
    return e;
  }

  handleHit(obj, info) {
    if (obj.kind === 'enemy') {
      const e = obj.ref;
      const killed = e.takeHit(this.player.clawDamage, this.player.sprite.x);
      this.motes = Math.min(this.cap, this.motes + (this.balance.player.motePerHit ?? 1));
      this.sfx.pop();
      this.cameras.main.shake(50, 0.003);
      this.floatText(obj.x, obj.y, '灵毛 +1', '#aee9ff');
      if (killed) {
        this.motes = Math.min(this.cap, this.motes + (this.balance.player.motePerKill ?? 3));
        const fish = this.balance.enemy.fishDrop ?? 2;
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

  // —— 死亡循环（瘴中灵影落外缘；唯一灵影+毛量叠加；远程赎罪兜底）——
  onPlayerDeath() {
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
    // 瘴中死亡 → 灵影落瘴外缘（防不可达死锁，GDD 4.7 边界）
    const zone = this.blight.zoneAt(sx, sy);
    const pt = zone ? this.blight.edgeSpawnPoint(zone, sx, GROUND_TOP) : { x: sx, y: sy };
    this.spawnShade(pt.x, pt.y, total);
    this.floatText(pt.x, pt.y - 24, '灵影诞生 · 携走灵毛', '#c9a8ff');
    this.time.delayedCall(700, () => {
      if (this.player.dead) this.player.respawnAt(this.respawnPoint.x, this.respawnPoint.y);
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
    this.updateStats();
  }

  tryPurify() {
    if (!this.rune) return;
    const near = Phaser.Math.Distance.Between(this.player.sprite.x, this.player.sprite.y, this.rune.x, this.rune.y) < 90;
    if (near && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      const z = this.blight.purifyAt(this.rune.x, this.rune.y);
      if (z) {
        this.floatText(this.rune.x, this.rune.y - 24, '清瘴！寂瘴暂退', '#9affb0');
        this.sfx.chime();
      } else {
        this.floatText(this.rune.x, this.rune.y - 24, '附近无可净化的瘴', '#ff8888');
      }
    }
  }

  updateStats() {
    this.hud.setStats({
      motes: this.motes,
      fish: this.fish,
      fluff: this.fluff,
      cap: this.cap,
      hp: this.player.hp,
      maxHP: this.player.maxHP,
      collars: '无(测试区)',
    });
  }

  floatText(x, y, msg, color) {
    const t = this.add
      .text(x, y, msg, { fontFamily: 'monospace', fontSize: '13px', color })
      .setOrigin(0.5)
      .setDepth(50);
    this.tweens.add({ targets: t, y: y - 32, alpha: 0, duration: 600, onComplete: () => t.destroy() });
  }

  applyListening() {
    const L = this.balance.listen || {};
    const baseR = (L.radius || 6) * (L.pxPerMeter || 32);
    const r = Math.max(8, baseR * this.blight.getBlightFactor(this.player.sprite.x, this.player.sprite.y));
    this.currentListenRadius = r;
    if (this.player.listenRevealed) {
      for (const sec of this.secrets) {
        const d = Phaser.Math.Distance.Between(this.player.sprite.x, this.player.sprite.y, sec.obj.x, sec.obj.y);
        this.setSecret(sec, d <= r);
      }
    } else {
      for (const sec of this.secrets) this.setSecret(sec, false);
    }
  }

  setSecret(sec, revealed) {
    if (sec.revealed === revealed) return;
    sec.revealed = revealed;
    sec.obj.setFillStyle(revealed ? 0xffd866 : sec.obj.fillColor);
    this.tweens.add({ targets: sec.obj, alpha: revealed ? 0.6 : 0, duration: 180 });
  }

  spawnRipple(x, y, radius) {
    const ring = this.add
      .circle(x, y, Math.max(8, radius), 0x9fe0ff, 0)
      .setStrokeStyle(2, 0x9fe0ff, 0.7)
      .setDepth(30);
    ring.setScale(0.12).setAlpha(0.7);
    this.tweens.add({ targets: ring, scale: 1, alpha: 0, duration: 560, onComplete: () => ring.destroy() });
  }

  updateHint() {
    if (this.player.dead) {
      this.hud.setHint('倒下了…灵影已生成（瘴中死亡会落在瘴外缘）。即将在猫窝复活点重生');
      return;
    }
    if (this.shade && !this.shade.dead) {
      this.hud.setHint('灵影在此！去击杀回收灵毛（卡住按 B 远程赎罪，耗小鱼干）');
      return;
    }
    if (this.player.inBlight) {
      this.hud.setHint('瘴中：鱼心持续流失 · 听声被压制(显形范围变小) · 敌人更强。走到清瘴点按 E 净化');
      return;
    }
    this.hud.setHint('走进右侧紫色瘴区体验掉血/压听声/增敌 · 长按 L 听声找瘴内隐藏小鱼干 · 清瘴点按 E');
  }

  update(time, delta) {
    if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      this.scene.restart();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.sandboxKey)) {
      this.scene.start('Game');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.tutorialKey)) {
      this.scene.start('FuzzNest');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.combatKey)) {
      this.scene.start('Combat');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.atonementKey)) {
      this.remoteAtonement();
    }

    this.tryPurify();

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
      attackJust,
      pounceJust,
      listenDown: this.listenKey.isDown,
      hittables: this.hittables,
    };

    const s = this.player.update(time, delta, input);

    // 寂瘴：玩家掉血 + 视觉更新（读取 player.blightResist，控制台可试 this.player.blightResist=0.6）
    this.blight.tickPlayer(this.player, delta, this.player.blightResist);
    this.blight.update();

    // 敌人：注入瘴增益
    for (const e of this.enemies) {
      const m = this.blight.getModsAt(e.x, e.y);
      e.blightDmgBonus = m.dmgBonus;
      e.blightSpeedBonus = m.speedBonus;
      e.inBlight = m.inBlight;
      e.update(time, delta, this.player);
    }
    if (this.shade && !this.shade.dead) this.shade.update(time, delta, this.player);

    // 每帧刷新 HUD：寂瘴 drainHP 实时改 player.hp，若不每帧推给 HUD，
    // 血条会停在上次事件(满血)直到死亡瞬间才闪现 0（即本 bug）。
    this.updateStats();

    // 听声反馈
    if (s.listening && !this.prevListening) this.sfx.ear();
    this.prevListening = s.listening;
    this.applyListening();
    if (s.listening && time - this.lastRipple > (this.balance.listen.rippleIntervalMs || 220)) {
      this.lastRipple = time;
      this.spawnRipple(this.player.sprite.x, this.player.sprite.y, this.currentListenRadius);
    }

    // 慢动作（听声时）
    const slow = s.listening ? this.balance.listen.slowFactor || 0.85 : 1;
    this.physics.world.timeScale = 1 / slow;
    this.tweens.timeScale = slow;
    this.time.timeScale = slow;

    // 进入瘴提示音
    if (this.player.inBlight && !this.prevInBlight) this.sfx.blightHum();
    this.prevInBlight = this.player.inBlight;
    this.hud.setBlight(this.player.inBlight);

    const status = [
      s.attacking ? '攻击' : null,
      s.pouncing ? '扑袭' : null,
      s.iframe ? '无敌' : null,
      this.player.dead ? '已死' : null,
      this.player.inBlight ? '瘴' : null,
    ]
      .filter(Boolean)
      .join('/') || 'idle';

    this.hud.update(
      this.player.sprite.x,
      this.player.sprite.y,
      this.game.loop.actualFps,
      status,
      { listening: s.listening, listenRevealed: s.listenRevealed, listenProgress: s.listenProgress, hitstun: s.hitstun }
    );
    this.updateHint();
  }
}
