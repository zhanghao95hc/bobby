// FuzzNestScene：区域1「绒毛巢」教学区（GDD 第6节 新手引导 + 世界观）。
// 全流程零真伤、可玩通；末段猫窝/老猫商店接入 GDD 4.5/4.6/5.1。
// 占位美术：圆润蓝灰方块+折耳（Player 自带），绒球/假人/鱼堆/老猫用纯色方块，阶段13 换美术。
import { Player } from '../entities/Player.js';
import { Hud } from '../ui/Hud.js';
import { Sfx } from '../systems/Sfx.js';
import { Save } from '../systems/Save.js';
import { CollarSystem } from '../systems/Collars.js';
import { Menu } from '../ui/Menu.js';
import { MapView } from '../ui/MapView.js';
import { Shade } from '../entities/Shade.js';
import { MetaProgress } from '../systems/MetaProgress.js';

const WORLD_W = 2640;
const WORLD_H = 540;
const GROUND_TOP = 500;

export class FuzzNestScene extends Phaser.Scene {
  constructor() {
    super('FuzzNest');
  }

  create() {
    this.balance = this.registry.get('balance') || {};
    const L = this.balance.listen || {};
    const T = this.balance.tutorial || {};

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor('#0c0a14');
    this.add.rectangle(WORLD_W / 2, WORLD_H / 2, WORLD_W, WORLD_H, 0x2a1f2e, 0.25).setDepth(-10);

    const ground = this.add.rectangle(WORLD_W / 2, 520, WORLD_W, 40, 0x222233).setOrigin(0.5);
    this.ground = ground;
    this.physics.add.existing(ground, true);

    // —— 元数据（存档/货币/项圈派生 + 元进度）——
    this.ensureMeta();
    this.motes = 0;
    this.fish = this.profile.fish;
    this.fluff = this.profile.fluff;
    this.cap = this.meta.motePoolMax; // 元进度可提升灵毛池上限（GDD 4.8）
    this.onboarding = this.profile.onboarding; // 引导 6 项进度（持久化）
    this.shade = null; // 灵影教学用

    this.add
      .text(WORLD_W / 2, 70, '绒 毛 巢 · 教 学 区', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#b9a7e0',
      })
      .setOrigin(0.5)
      .setDepth(90)
      .setScrollFactor(0.0);

    // —— 可击中物列表（hittables）——
    this.hittables = [];
    this.makeToy(320, 478); // ① 起手伪敌：软萌绒球，必中零伤
    this.makeDummy(560, 478); // 练习假人
    this.makeDummy(820, 478); // 下扑(pogo)练习对象
    this.makeFishPile(1400, 476); // ④ 无文字隐藏小鱼干堆（乱扑发现）

    // —— ③ 听声引导暗道 ——
    this.add.rectangle(1080, 430, 26, 150, 0x4a4458, 0.9).setDepth(5);
    this.add.rectangle(1080, 400, 30, 10, 0x6a6480, 0.9).setDepth(5);
    this.add.rectangle(1080, 470, 30, 10, 0x6a6480, 0.9).setDepth(5);
    const secretPlat = this.add.rectangle(1180, 392, 120, 18, 0x88c0ff).setAlpha(0);
    this.physics.add.existing(secretPlat, true);
    const secretFish = this.add.rectangle(1180, 366, 16, 12, 0xffd866).setAlpha(0).setDepth(20);
    this.secretFish = secretFish;
    this.secrets = [
      { obj: secretPlat, type: 'platform', revealed: false },
      { obj: secretFish, type: 'fish', revealed: false },
    ];

    // —— ⑤ 猫窝（区域末端，互动触发菜单/钩子）——
    const bed = this.add.rectangle(2440, 472, 78, 46, 0x3a2f4a).setDepth(4);
    this.add.rectangle(2440, 466, 70, 14, 0x6b5a86).setDepth(4);
    this.bed = bed;

    // —— 老猫商店 NPC（占位）——
    this.makeShopNpc(2280, 472);

    // ⑤-⑥ 灵影教学台（安全模拟死亡，引导第6项；探索可发现，不靠文字）
    this.teachPad = this.add.rectangle(1750, 472, 54, 30, 0x6b5a86, 0.9).setDepth(4);
    this.add.circle(1750, 472, 22, 0xc9a8ff, 0.18).setDepth(3);
    this.add
      .text(1750, 438, '记忆残响\n按 E 试试?', { fontFamily: 'monospace', fontSize: '11px', color: '#c9a8ff', align: 'center' })
      .setOrigin(0.5).setDepth(20);

    // 波比（带项圈/面具派生属性）
    this.player = new Player(this, 120, 430, this.balance, this.derived);
    this.physics.add.collider(this.player.sprite, ground);
    this.physics.add.collider(this.player.sprite, secretPlat);
    this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);

    this.physics.add.overlap(this.player.sprite, secretFish, () => {
      const sec = this.secrets.find((s) => s.obj === secretFish);
      if (sec && sec.revealed && !secretFish._taken) {
        secretFish._taken = true;
        this.fish += 1;
        this.markOnboarding('explore');
        this.floatText(secretFish.x, secretFish.y, '小鱼干 +1（听声发现）', '#ffd866');
        this.sfx.chime();
        secretFish.setVisible(false);
        this.updateStats();
      }
    });

    // —— 输入 ——
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.attackKey = this.input.keyboard.addKey('J');
    this.pounceKey = this.input.keyboard.addKey('K');
    this.jumpKey = this.input.keyboard.addKey('SPACE');
    this.listenKey = this.input.keyboard.addKey('L');
    this.interactKey = this.input.keyboard.addKey('E');
    this.collarKey = this.input.keyboard.addKey('I'); // 直接开项圈菜单
    this.sandboxKey = this.input.keyboard.addKey('G');
    this.combatKey = this.input.keyboard.addKey('C');
    this.blightKey = this.input.keyboard.addKey('V'); // 进寂瘴测试区
    this.bossKey = this.input.keyboard.addKey('B'); // 进小 Boss 战（锈齿鼠王）
    this.altarKey = this.input.keyboard.addKey('M'); // 进猫神祭坛（花绒毛解锁元进度）
    this.templeKey = this.input.keyboard.addKey('N'); // 进猫神殿（重组挑战）
    this.tideKey = this.input.keyboard.addKey('H'); // 进寂瘴潮（重组挑战·瘴）
    this.lordKey = this.input.keyboard.addKey('Y'); // 进终局 寂灭之眼（沉眠之主）
    this.restartKey = this.input.keyboard.addKey('R');
    this.input.keyboard.addCapture(['SPACE', 'UP', 'L']);

    this.sfx = new Sfx();
    this.prevListening = false;
    this.firstClawDone = false;
    this.hookDone = this.profile.firstRunDone; // 已玩过则不再触发首局钩子

    // 菜单：猫窝 / 项圈 / 商店
    this.denMenu = this.makeDenMenu();
    this.collarMenu = this.makeCollarMenu();
    this.shopMenu = this.makeShopMenu();
    this.menu = null;

    this.player.onClawHit = (obj, info) => this.handleHit(obj, info);

    this.hud = new Hud(this);
    this.hud.setRegions([{ name: '绒毛巢', lit: true }, { name: '沉眠回廊', lit: false }]);
    this.applyRegionLights();
    this.hud.setRegionName('绒毛巢');
    this.mapView = new MapView(this, {
      getRegions: () => this.profile.regions,
      mapData: this.balance.regionsMap,
      onClose: () => this.physics.resume(),
    });
    this.updateStats();

    // —— 左侧竖向控制说明（HUD 面板下方，与面板分离）——
    this.controlsText = this.add
      .text(12, 142, [
        'A/D 移动',
        '空格 跳',
        'J 爪击(空中=下扑)',
        'K 扑袭',
        '长按 L 听声',
        'E 猫窝/商店',
        'I 项圈',
        'M 祭坛(绒毛解锁)',
        'N 猫神殿',
        'H 寂瘴潮',
        'C 战斗沙盒',
        'V 寂瘴区',
        'B 小Boss',
        'R 重玩',
      ].join('\n'), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#7d8aa8',
        align: 'left',
        lineSpacing: 3,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(90);

    this.lastRipple = 0;
    this.currentListenRadius = 0;
  }

  // —— 元数据：存档/货币/项圈派生 + 元进度（GDD 4.8）——
  ensureMeta() {
    let profile = this.registry.get('profile');
    if (!profile) {
      profile = Save.load(this.balance);
      this.registry.set('profile', profile);
    }
    this.profile = profile;
    this.collars = new CollarSystem(this.balance);
    this.collars.applyProfile(profile);
    // 元进度：把已解锁节点折算成槽位/灵毛池/移动技，注入派生
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

  // 写回存档（GDD 4.5：猫窝存进度到 localStorage）
  syncProfile() {
    const p = this.profile;
    p.fish = this.fish;
    p.fluff = this.fluff;
    const c = this.collars.toProfile();
    p.ownedCollars = c.ownedCollars;
    p.equippedCollars = c.equippedCollars;
    p.maskLevel = c.maskLevel;
    p.firstRunDone = true;
    p.onboarding = this.onboarding;
    Save.save(p);
    this.registry.set('profile', p);
  }

  equippedCollarNames() {
    const names = [];
    for (const id of this.collars.equipped) names.push(this.collars.catalog[id]?.name || id);
    return names.length ? names.join('/') : '无';
  }

  regionLines() {
    const r = this.profile.regions || {};
    const lines = [];
    for (const k of Object.keys(r)) lines.push(`${k} 完成度 ${r[k]}%`);
    lines.push(`项圈槽 ${this.derived.slotsUsed}/${this.derived.slotsTotal} · 面具+${this.collars.maskLevel}`);
    if (this.shade && !this.shade.dead) lines.push(`灵影在此：携 ${this.shade.carried} 灵毛（去爪击回收）`);
    // 引导进度（GDD 第6节 6 项）
    const o = this.onboarding || {};
    const it = (k, l) => (o[k] ? '✓' : '○') + l;
    lines.push('— 引导 —');
    lines.push(`${it('claw', '爪击')} ${it('pogo', '下扑')} ${it('listen', '听声')} ${it('explore', '探索')} ${it('hook', '钩子')} ${it('shade', '灵影')}`);
    return lines;
  }

  // —— 猫窝菜单（GDD 4.5）——
  makeDenMenu() {
    const m = new Menu(this, {
      title: '猫 窝',
      getLines: () => this.regionLines(),
      items: [
        {
          label: '存档（写入本地）',
          onSelect: () => {
            this.syncProfile();
            this.floatText(this.player.sprite.x, this.player.sprite.y - 24, '已存档 ✓', '#aee9ff');
            this.sfx.chime();
            m.close();
          },
        },
        {
          label: '回血（1 小鱼干 / 鱼心）',
          disabled: () => this.player.hp >= this.player.maxHP,
          hint: () => `小鱼干 ${this.fish}`,
          onSelect: () => {
            const cost = this.balance.player.healCostFishPerHeart ?? 1;
            if (this.fish < cost) {
              this.floatText(this.player.sprite.x, this.player.sprite.y - 24, `小鱼干不足(${this.fish}/${cost})`, '#ff8888');
              return;
            }
            this.fish -= cost;
            this.player.hp = Math.min(this.player.maxHP, this.player.hp + 1);
            this.syncProfile();
            this.floatText(this.player.sprite.x, this.player.sprite.y - 24, '回血 +1 鱼心', '#ff9aa0');
            this.sfx.chime();
            this.updateStats();
            m.close();
          },
        },
        {
          label: '换装项圈',
          hint: () => `${this.derived.slotsUsed}/${this.derived.slotsTotal} 槽`,
          onSelect: () => this.openMenu(this.collarMenu),
        },
        {
          label: '查看区域地图（解锁式）',
          onSelect: () => this.openMap(),
        },
      ],
      onClose: () => this.onMenuClose(m),
    });
    return m;
  }

  // —— 项圈菜单（GDD 4.6）——
  makeCollarMenu() {
    const self = this;
    const m = new Menu(this, {
      title: '项 圈 装 备',
      getLines: () => [
        `槽位 ${self.derived.slotsUsed}/${self.derived.slotsTotal}`,
        `爪伤 ${self.derived.clawDamage} · 最大鱼心 ${self.derived.maxHP}`,
      ],
      items: [], // 动态构建（按已拥有项圈）
      onClose: () => this.onMenuClose(m),
    });
    // 动态 items：每次打开时重建
    m._buildItems = function () {
      const items = [];
      for (const id of self.collars.owned) {
        const c = self.collars.catalog[id];
        if (!c) continue;
        const equipped = self.collars.equipped.has(id);
        items.push({
          label: `${equipped ? '●' : '○'} ${c.name}`,
          hint: () => `${c.desc} (${c.slots}槽)`,
          disabled: () => !equipped && !self.collars.canEquip(id),
          onSelect: () => {
            if (equipped) self.collars.unequip(id);
            else self.collars.equip(id);
            self.recomputeDerived();
            self.syncProfile();
            self.updateStats();
            m.rebuild();
          },
        });
      }
      if (items.length === 0) items.push({ label: '（暂无可装备项圈）', onSelect: () => {} });
      m.items = items;
    };
    return m;
  }

  // —— 商店菜单（GDD 5.1 三层货币消费）——
  makeShopMenu() {
    const self = this;
    const shop = this.balance.shop || {};
    const m = new Menu(this, {
      title: '老 猫 商 店',
      getLines: () => [`持有小鱼干 ${self.fish}`],
      items: Object.keys(shop.items || {}).map((key) => {
        const it = shop.items[key];
        return {
          label: it.name,
          hint: () => `${it.price} 小鱼干`,
          disabled: () => self._shopDisabled(it),
          onSelect: () => self._buyShopItem(it, m),
        };
      }),
      onClose: () => this.onMenuClose(m),
    });
    return m;
  }

  _shopDisabled(it) {
    if (it.type === 'collar') return this.collars.owns(it.id);
    if (it.type === 'map') return !!this.profile.mapBought;
    return false; // mask 永远可买（升级堆叠）
  }

  _buyShopItem(it, menu) {
    if (it.type === 'collar' && this.collars.owns(it.id)) return;
    if (it.type === 'map' && this.profile.mapBought) return;
    if (this.fish < it.price) {
      this.floatText(this.player.sprite.x, this.player.sprite.y - 24, `小鱼干不足(${this.fish}/${it.price})`, '#ff8888');
      return;
    }
    this.fish -= it.price;
    if (it.type === 'collar') {
      this.collars.buy(it.id);
      this.floatText(this.player.sprite.x, this.player.sprite.y - 24, `购买 ${it.name}`, '#ffd866');
    } else if (it.type === 'map') {
      this.profile.mapBought = true;
      for (const k of Object.keys(this.profile.regions || {})) this.profile.regions[k] = 100;
      this.applyRegionLights();
      this.floatText(this.player.sprite.x, this.player.sprite.y - 24, '购买 区域地图 · 全部点亮', '#ffd866');
    } else if (it.type === 'mask') {
      this.collars.maskLevel += 1;
      this.recomputeDerived();
      this.player.maxHP = this.derived.maxHP;
      this.player.hp = this.derived.maxHP; // 升级即回满
      this.floatText(this.player.sprite.x, this.player.sprite.y - 24, `面具升级! 最大鱼心 ${this.derived.maxHP}`, '#ff9aa0');
    }
    this.syncProfile();
    this.sfx.chime();
    this.updateStats();
    menu.rebuild();
  }

  // 区域地图点亮（HUD 右上）
  applyRegionLights() {
    const r = this.profile.regions || {};
    const list = Object.keys(r).map((k) => ({ name: k, lit: r[k] >= 100 }));
    this.hud.setRegions(list);
  }

  openMenu(m) {
    if (this.menu && this.menu !== m) this.menu.close();
    this.menu = m;
    m.open();
    this.physics.pause();
    this.physics.world.timeScale = 1;
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;
  }

  onMenuClose(m) {
    if (this.menu === m) this.menu = null;
    this.physics.resume();
  }

  // —— 商店 NPC 视觉 ——
  makeShopNpc(x, y) {
    const cat = this.add.rectangle(x, y, 30, 36, 0x8a8a96).setDepth(8);
    this.add.rectangle(x - 8, y - 20, 8, 12, 0x8a8a96).setDepth(8); // 耳
    this.add.rectangle(x + 8, y - 20, 8, 12, 0x8a8a96).setDepth(8);
    this.add.rectangle(x - 5, y - 4, 4, 4, 0x202028).setDepth(9);
    this.add.rectangle(x + 5, y - 4, 4, 4, 0x202028).setDepth(9);
    this.add.text(x, y - 34, '老猫商店', { fontFamily: 'monospace', fontSize: '11px', color: '#ffd866' }).setOrigin(0.5).setDepth(9);
    this.shopNpc = cat;
  }

  // —— 可击中物工厂 ——
  makeToy(x, y) {
    const r = this.add.rectangle(x, y, 38, 34, 0xffb3c8).setDepth(10);
    this.add.rectangle(x - 8, y - 6, 4, 4, 0x402030).setDepth(11);
    this.add.rectangle(x + 8, y - 6, 4, 4, 0x402030).setDepth(11);
    r.kind = 'toy';
    this.hittables.push(r);
    return r;
  }

  makeDummy(x, y) {
    const r = this.add.rectangle(x, y, 30, 42, 0x9b5b5b).setDepth(10);
    r.kind = 'dummy';
    this.hittables.push(r);
    return r;
  }

  makeFishPile(x, y) {
    const r = this.add.rectangle(x, y, 40, 28, 0xe0b070).setDepth(10);
    this.add.rectangle(x - 10, y, 3, 14, 0xb08840).setDepth(11);
    this.add.rectangle(x + 10, y, 3, 14, 0xb08840).setDepth(11);
    r.kind = 'fishpile';
    r.noBounce = true;
    this.hittables.push(r);
    return r;
  }

  // —— 命中分发（应用项圈产率修正）——
  handleHit(obj, info) {
    const mm = this.derived.moteMult || 1;
    const fm = this.derived.fishMult || 1;
    if (info && info.pogo) this.markOnboarding('pogo');
    const kind = obj.kind;
    if (kind === 'toy') {
      this.motes = Math.min(this.cap, this.motes + Math.round(1 * mm));
      this.firstClawDone = true;
      this.markOnboarding('claw');
      this.squish(obj);
      this.sfx.pop();
      this.floatText(obj.x, obj.y, '灵毛 +1', '#aee9ff');
      this.cameras.main.shake(50, 0.003);
    } else if (kind === 'dummy') {
      this.motes = Math.min(this.cap, this.motes + Math.round(1 * mm));
      this.sfx.pop();
      obj.setFillStyle(0xffffff);
      this.time.delayedCall(80, () => obj.setFillStyle(0x9b5b5b));
      this.floatText(obj.x, obj.y, '灵毛 +1', '#aee9ff');
      this.cameras.main.shake(50, 0.003);
    } else if (kind === 'fishpile') {
      const triggered = info && (info.diving || info.pogo);
      if (triggered && !obj._taken) {
        obj._taken = true;
        const amt = Math.round((this.balance.tutorial?.fishPileAmount || 5) * fm);
        this.fish += amt;
        this.floatText(obj.x, obj.y - 14, `小鱼干 +${amt}  发现隐藏鱼堆!`, '#ffd866');
        this.sfx.chime();
        this.burst(obj.x, obj.y);
        obj.setVisible(false);
      }
    } else if (kind === 'shade') {
      const sh = obj.ref;
      if (sh && !sh.dead) sh.takeHit(this.player.clawDamage, this.player.sprite.x);
      this.sfx.pop();
      this.updateStats();
      return;
    }
    this.updateStats();
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
      .setOrigin(0.5)
      .setDepth(50);
    this.tweens.add({ targets: t, y: y - 32, alpha: 0, duration: 600, onComplete: () => t.destroy() });
  }

  squish(obj) {
    this.tweens.add({ targets: obj, scaleY: 0.6, duration: 70, yoyo: true });
  }

  burst(x, y) {
    for (let i = 0; i < 7; i++) {
      const p = this.add.rectangle(x, y, 5, 5, 0xffd866).setDepth(50);
      const a = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 70;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(a) * sp,
        y: y + Math.sin(a) * sp,
        alpha: 0,
        duration: 420,
        onComplete: () => p.destroy(),
      });
    }
  }

  getBlightFactor(x, y) {
    return this.blight ? this.blight.getBlightFactor(x, y) : 1;
  }

  update(time, delta) {
    // 菜单打开：冻结世界，仅驱动菜单
    if (this.menu && this.menu.isOpen()) {
      this.menu.update();
      return;
    }
    // 区域地图浮层打开：冻结世界，仅驱动地图
    if (this.mapView && this.mapView.isOpen()) {
      this.mapView.update();
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.sandboxKey)) {
      this.scene.start('Game');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.combatKey)) {
      this.scene.start('Combat');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.blightKey)) {
      this.scene.start('Blight');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.bossKey)) {
      this.scene.start('Boss');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.altarKey)) {
      this.scene.start('Altar');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.templeKey)) {
      this.scene.start('Temple', { mode: 'temple' });
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.tideKey)) {
      this.scene.start('Temple', { mode: 'blight' });
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.lordKey)) {
      this.scene.start('Lord');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.collarKey)) {
      this.openMenu(this.collarMenu);
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      this.scene.restart();
      return;
    }

    // 猫窝 / 商店 / 灵影教学台 交互
    this.tryBed(time);
    this.tryShop();
    this.tryTeach();

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

    const s = this.player.update(time, delta, input);
    if (s.listenRevealed) this.markOnboarding('listen');

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

    const status = [s.attacking ? '攻击' : null, s.pouncing ? '扑袭' : null, s.iframe ? '无敌' : null]
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

  tryBed(time) {
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const near = Phaser.Math.Distance.Between(px, py, this.bed.x, this.bed.y) < 95;
    if (near && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      // ⑤ 首局钩子（首次回窝）：猫神低吼 + 地图点亮
      if (!this.hookDone) {
        this.hookDone = true;
        this.profile.regions['沉眠回廊'] = 100;
        this.markOnboarding('hook');
        this.applyRegionLights();
        this.sfx.growl();
        this.sfx.chime();
        this.cameras.main.flash(450, 70, 50, 100);
        this.floatText(this.bed.x, this.bed.y - 30, '猫神的低吼在远处回荡……', '#c9a8ff');
      }
      // 里程碑绒毛：首次抵达猫窝（完成教学区探索）奖励记忆绒毛（GDD 4.8 Boss/里程碑掉落）
      this.grantMilestoneFluff('nest_explore', '探索里程碑: 绒毛巢', 1);
      this.openMenu(this.denMenu);
    }
  }

  // 里程碑绒毛：每个 name 仅奖励一次；记入 profile.milestones 持久化
  grantMilestoneFluff(name, label, amount) {
    if (this.profile.milestones.includes(name)) return;
    this.profile.milestones.push(name);
    const give = amount ?? (this.balance.meta?.milestoneFluff ?? 1);
    this.fluff += give;
    this.floatText(this.player.sprite.x, this.player.sprite.y - 28, `${label} · 记忆绒毛 +${give}`, '#c9a8ff');
    this.sfx.chime();
    this.syncProfile();
    this.updateStats();
  }

  tryShop() {
    if (!this.shopNpc) return;
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const near = Phaser.Math.Distance.Between(px, py, this.shopNpc.x, this.shopNpc.y) < 90;
    if (near && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.openMenu(this.shopMenu);
    }
  }

  updateHint() {
    if (this.hookDone && this.player.sprite.x >= 2200) {
      this.hud.setHint('按 E 与老猫交易（小鱼干买项圈/地图/面具）· 走到猫窝按 E 存档/回血/换装 · 按 I 直接开项圈');
      return;
    }
    if (!this.firstClawDone) {
      this.hud.setHint('用 A/D 移动，走到粉色绒球前按 J 爪击（必中 · 零失败 · 零真伤）');
      return;
    }
    const px = this.player.sprite.x;
    if (px < 760) {
      this.hud.setHint('试试：空格 跳跃 · K 扑袭 · 空中按 J 下扑');
      return;
    }
    if (px < 1010) {
      this.hud.setHint('跳到绒垫上方，空中按 J 下扑踩它弹起（pogo）——这就是你的位移技');
      return;
    }
    if (px < 1330) {
      this.hud.setHint('裂纹墙后有动静？长按 L 折耳听声，显形暗道与隐藏小鱼干');
      return;
    }
    if (px < 2150) {
      this.hud.setHint('绒光猫国的遗迹安静得诡异……（自由乱扑，兴许藏着不靠文字的东西）');
      return;
    }
    if (px >= 1600 && px < 1960 && !this.onboarding.shade) {
      this.hud.setHint('前方有团“记忆残响”在轻颤……（好奇就走过去按 E 戳戳看）');
      return;
    }
    this.hud.setHint('走到猫窝前按 E 蜷进去；旁边老猫可交易。按 M 进猫神祭坛(花绒毛解锁永久能力) · 按 N 进猫神殿/H 进寂瘴潮(每次重组) · 按 R 重玩');
  }

  // —— 引导进度标记（持久化）——
  markOnboarding(key) {
    if (!this.onboarding || this.onboarding[key]) return;
    this.onboarding[key] = true;
    this.syncProfile();
  }

  // —— 区域地图浮层 ——
  openMap() {
    if (this.menu) {
      this.menu.close();
      this.menu = null;
    }
    if (!this.mapView) return;
    this.mapView.open();
    this.physics.pause();
  }

  // —— 灵影教学（安全模拟死亡，GDD 第6节 第6项）——
  tryTeach() {
    if (!this.teachPad || !this.teachPad.active) return;
    if (this.onboarding.shade) return; // 只教一次
    if (this.shade && !this.shade.dead) return;
    const near = Phaser.Math.Distance.Between(
      this.player.sprite.x, this.player.sprite.y, this.teachPad.x, this.teachPad.y
    ) < 90;
    if (near && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.simulateShadeDeath();
    }
  }

  simulateShadeDeath() {
    const carried = this.motes;
    const padX = this.teachPad.x;
    const padY = this.teachPad.y - 14;
    const sx = Math.min(padX + 230, WORLD_W - 80);
    const sy = 430;
    this.spawnTutorialShade(sx, sy, carried);
    this.motes = 0;
    this.player.respawnAt(padX, padY);
    const distM = Math.max(1, Math.round(Math.abs(sx - padX) / (this.balance.listen.pxPerMeter || 32)));
    this.hud.showDeath({
      teaching: true,
      carried,
      dir: '右',
      distM,
      fishCost: Math.ceil(carried * (this.balance.shade?.atonementFactor ?? 0.5)),
    });
    this.teachPad.setFillStyle(0x4a4460);
    this.sfx.growl();
    this.updateStats();
  }

  spawnTutorialShade(x, y, motes) {
    const sh = new Shade(this, x, y, motes, this.balance, (s) => this.reclaimTutorialShade(s));
    sh.contactDamage = 0; // 教学无接触伤害（低代价）
    this.shade = sh;
    this.hittables.push(sh.sprite);
    this.physics.add.collider(sh.sprite, this.ground);
    sh.label = this.add
      .text(x, y - 30, `灵影（教学）携 ${motes}`, { fontFamily: 'monospace', fontSize: '11px', color: '#c9a8ff' })
      .setOrigin(0.5).setDepth(20);
    return sh;
  }

  reclaimTutorialShade(sh) {
    const amt = sh.carried || 0;
    this.motes = Math.min(this.cap, this.motes + amt);
    if (sh.label) sh.label.destroy();
    this.floatText(this.player.sprite.x, this.player.sprite.y - 20, `灵影教学完成! 灵毛回收 +${amt}`, '#c9a8ff');
    this.sfx.chime();
    this.shade = null;
    this.markOnboarding('shade');
    this.updateStats();
  }

  applyListening() {
    const p = this.player;
    const L = this.balance.listen || {};
    const baseR = (L.radius || 6) * (L.pxPerMeter || 32) * (this.derived.listenRadiusMult || 1);
    const r = Math.max(8, baseR * this.getBlightFactor(p.sprite.x, p.sprite.y));
    this.currentListenRadius = r;

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
    const ghost = sec.type === 'fish' ? 0.6 : 0.5;
    sec.obj.setFillStyle(revealed ? (sec.type === 'fish' ? 0xffd866 : 0x88c0ff) : sec.obj.fillColor);
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
