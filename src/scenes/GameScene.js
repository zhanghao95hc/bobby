// GameScene：阶段2 战斗验证 + 阶段3 折耳听声测试房。
// 含：波比、地面、训练假人、爪击/扑袭/pogo 反馈、HUD、
//     折耳听声系统（慢动作+声波纹+显形）、隐藏平台(暗道)+隐形敌人测试房。
import { Player } from '../entities/Player.js';
import { Hud } from '../ui/Hud.js';
import { Sfx } from '../systems/Sfx.js';

export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create() {
    this.balance = this.registry.get('balance') || {};
    const L = this.balance.listen || {};

    this.physics.world.setBounds(0, 0, 960, 540);

    // 地面
    const ground = this.add.rectangle(480, 520, 960, 40, 0x222233).setOrigin(0.5);
    this.physics.add.existing(ground, true);

    // 训练假人（占位敌人，仅用于验证爪击/下扑/pogo；真实敌人在阶段5）
    this.dummies = [];
    const mkDummy = (x) => {
      const d = this.add.rectangle(x, 479, 30, 42, 0x9b5b5b);
      this.dummies.push(d);
      return d;
    };
    mkDummy(520);
    mkDummy(700);

    // —— 阶段3 测试房：隐藏平台(暗道) ——
    // 实体重力碰撞体始终存在，仅视觉隐藏，听声后显形（蓝猫可站立其上）。
    const secretPlat = this.add.rectangle(740, 400, 130, 20, 0x88c0ff).setAlpha(0);
    this.physics.add.existing(secretPlat, true);

    // 平台顶上的"小鱼干"奖励（常显，提示这里有可去之处）
    this.add.rectangle(740, 378, 16, 12, 0xffd866).setDepth(20);

    // —— 阶段3 测试房：隐形敌人 ——
    // 默认 alpha 0（隐形），听声后显形；即使隐形也会追逐并攻击玩家（用于验证锁①）。
    const enemy = this.add.rectangle(600, 430, 30, 36, 0xff6b6b).setAlpha(0);
    this.physics.add.existing(enemy);
    enemy.body.setCollideWorldBounds(true);
    enemy.lastHit = 0;
    this.secretEnemy = enemy;

    this.secrets = [
      { obj: secretPlat, type: 'platform', revealed: false },
      { obj: enemy, type: 'enemy', revealed: false },
    ];

    // 波比
    this.player = new Player(this, 200, 400, this.balance);
    this.physics.add.collider(this.player.sprite, ground);
    this.physics.add.collider(this.player.sprite, secretPlat);
    this.physics.add.collider(this.secretEnemy, ground);

    // 隐形敌人接触玩家 → 打断听声 + 硬直（双锁①）
    this.physics.add.overlap(this.player.sprite, this.secretEnemy, () => {
      if (this.time.now - this.secretEnemy.lastHit > 800) {
        this.secretEnemy.lastHit = this.time.now;
        this.player.takeHit(this.secretEnemy.x);
      }
    });

    // 输入
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.attackKey = this.input.keyboard.addKey('J');
    this.pounceKey = this.input.keyboard.addKey('K');
    this.jumpKey = this.input.keyboard.addKey('SPACE');
    this.listenKey = this.input.keyboard.addKey('L'); // 折耳听声
    // 防止空格/方向键/听声键滚动浏览器页面
    this.input.keyboard.addCapture(['SPACE', 'UP', 'L']);

    // 占位音效
    this.sfx = new Sfx();
    this.prevListening = false;

    // 爪击命中反馈：灵毛+1 飘字 / 极轻屏震 / 噗声 / 假人闪白
    this.player.onClawHit = (dummy, info) => {
      const pogo = info && info.pogo;
      const x = dummy.x;
      const y = dummy.y;
      const label = pogo ? '灵毛 +1  pogo!' : '灵毛 +1';
      const t = this.add
        .text(x, y, label, { fontFamily: 'monospace', fontSize: '13px', color: '#aee9ff' })
        .setDepth(50);
      this.tweens.add({
        targets: t,
        y: y - 32,
        alpha: 0,
        duration: 600,
        onComplete: () => t.destroy(),
      });
      this.cameras.main.shake(60, 0.004); // 极轻屏震
      this.sfx.pop();
      dummy.setFillStyle(0xffffff);
      this.time.delayedCall(80, () => dummy.setFillStyle(0x9b5b5b));
    };

    // HUD
    this.hud = new Hud(this);
    this.hud.setRegionName('听声沙盒');
    this.hud.setStats({
      hp: this.player.hp, maxHP: this.player.maxHP,
      motes: 0, cap: this.balance.player?.motePoolMax ?? 33,
      fish: 0, collars: '无',
    });

    // 操作提示
    this.add
      .text(
        480,
        16,
        '方向/A·D 移动 · 空格 跳跃 · J 爪击 · 空中J 下扑(踩假人pogo) · K 扑袭 · 长按 L 折耳听声',
        { fontFamily: 'monospace', fontSize: '13px', color: '#8aa0c0' }
      )
      .setOrigin(0.5, 0)
      .setDepth(100);

    // 测试房引导
    this.add
      .text(
        480,
        38,
        '测试房：长按 L 折耳听声 → 显形右侧暗道(隐藏平台)与隐形敌人。听声中受击会被打断+硬直，别贴脸听！',
        { fontFamily: 'monospace', fontSize: '12px', color: '#c8b0ff' }
      )
      .setOrigin(0.5, 0)
      .setDepth(100);

    this.lastRipple = 0;
    this.currentListenRadius = 0;
  }

  // 阶段7接入：根据坐标返回听声衰减系数(0..1)。当前无瘴区，恒定返回 1（不影响）。
  getBlightFactor(x, y) {
    return this.blight ? this.blight.getBlightFactor(x, y) : 1;
  }

  update(time, delta) {
    const attackJust = Phaser.Input.Keyboard.JustDown(this.attackKey);
    const pounceJust = Phaser.Input.Keyboard.JustDown(this.pounceKey);

    // 跳跃：空格为主，W/↑ 作为备用；点按起跳
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
      dummies: this.dummies,
    };

    const s = this.player.update(time, delta, input);

    // 听声开始瞬间播一声轻柔"叮"
    if (s.listening && !this.prevListening) this.sfx.ear();
    this.prevListening = s.listening;

    // 隐形敌人追逐（简单 AI）
    this.updateEnemy();

    // 显形结算 + 记录当前听声半径（含浓瘴衰减接口）
    this.applyListening();

    // 听声中：周遭泛起声波纹
    if (s.listening && time - this.lastRipple > (this.balance.listen.rippleIntervalMs || 220)) {
      this.lastRipple = time;
      this.spawnRipple(this.player.sprite.x, this.player.sprite.y, this.currentListenRadius);
    }

    // 慢动作：听声时整体轻微降速（用真实 delta 计听声时长，不受此影响）
    const slow = s.listening ? this.balance.listen.slowFactor || 0.85 : 1;
    this.physics.world.timeScale = 1 / slow;
    this.tweens.timeScale = slow;
    this.time.timeScale = slow;

    const status = [
      s.attacking ? '攻击' : null,
      s.pouncing ? '扑袭' : null,
      s.iframe ? '无敌' : null,
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
  }

  updateEnemy() {
    const e = this.secretEnemy;
    if (!e) return;
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const d = Phaser.Math.Distance.Between(px, py, e.x, e.y);
    const aggro = this.balance.enemy?.aggroRange || 300;
    if (d < aggro) {
      const ang = Math.atan2(py - e.y, px - e.x);
      const sp = this.balance.enemy?.chaseSpeed || 70;
      e.body.setVelocity(Math.cos(ang) * sp, Math.sin(ang) * sp);
    } else {
      e.body.setVelocity(0, 0);
    }
  }

  // 显形/隐藏结算（仅在状态变化时补间 alpha，避免每帧重设）
  applyListening() {
    const p = this.player;
    const L = this.balance.listen || {};
    const baseR = (L.radius || 6) * (L.pxPerMeter || 32);
    const r = baseR * this.getBlightFactor(p.sprite.x, p.sprite.y);
    this.currentListenRadius = Math.max(8, r);

    if (p.listenRevealed) {
      for (const sec of this.secrets) {
        const d = Phaser.Math.Distance.Between(p.sprite.x, p.sprite.y, sec.obj.x, sec.obj.y);
        this.setSecret(sec, d <= r);
      }
    } else {
      for (const sec of this.secrets) this.setSecret(sec, false);
    }
  }

  setSecret(sec, revealed) {
    if (sec.revealed === revealed) return;
    sec.revealed = revealed;
    const ghost = this.balance.listen?.ghostAlpha || 0.5;
    sec.obj.setFillStyle(revealed ? (sec.type === 'enemy' ? 0xff6b6b : 0x88c0ff) : sec.obj.fillColor);
    this.tweens.add({ targets: sec.obj, alpha: revealed ? ghost : 0, duration: 180 });
  }

  spawnRipple(x, y, radius) {
    const ring = this.add
      .circle(x, y, Math.max(8, radius), 0x9fe0ff, 0)
      .setStrokeStyle(2, 0x9fe0ff, 0.7)
      .setDepth(30);
    ring.setScale(0.12).setAlpha(0.7);
    this.tweens.add({
      targets: ring,
      scale: 1,
      alpha: 0,
      duration: 560,
      onComplete: () => ring.destroy(),
    });
  }
}
