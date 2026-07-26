// CombatTestScene：战斗沙盒（GDD 4.4 灵毛与灵影 + 基础敌人 + 阶段6 猫窝/项圈/商店）。
// 单屏：打怪攒灵毛、被摸死、灵影回收；猫窝存档/回血/换装、老猫商店买卖、九命原地复活。
import { Player } from '../entities/Player.js';
import { Hud } from '../ui/Hud.js';
import { Sfx } from '../systems/Sfx.js';
import { Enemy } from '../entities/Enemy.js';
import { Shade } from '../entities/Shade.js';
import { Save } from '../systems/Save.js';
import { CollarSystem } from '../systems/Collars.js';
import { Menu } from '../ui/Menu.js';

const WORLD_W = 960;
const WORLD_H = 540;

export class CombatTestScene extends Phaser.Scene {
  constructor() {
    super('Combat');
  }

  create() {
    this.balance = this.registry.get('balance') || {};
    const p = this.balance.player || {};

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor('#0c0a14');

    this.ground = this.add.rectangle(WORLD_W / 2, 520, WORLD_W, 40, 0x222233).setOrigin(0.5);
    this.physics.add.existing(this.ground, true);

    // —— 元数据 ——
    this.ensureMeta();
    this.cap = p.motePoolMax ?? 33;
    this.motes = 0;
    this.fish = this.profile.fish;
    this.fluff = this.profile.fluff;
    this.nineLifeCharge = false; // 休窝后首次死亡原地复活（GDD 4.6 九命项圈）

    this.player = new Player(this, 120, 430, this.balance, this.derived);
    this.physics.add.collider(this.player.sprite, this.ground);
    this.player.onDeath = () => this.onPlayerDeath();

    this.enemies = [];
    this.hittables = [];
    [380, 560, 720].forEach((ex) => this.spawnEnemy(ex, 470));

    this.shade = null;

    // —— 猫窝（复活点 + 菜单）——
    this.bed = this.add.rectangle(860, 472, 70, 46, 0x3a2f4a).setDepth(4);
    this.add.rectangle(860, 466, 62, 14, 0x6b5a86).setDepth(4);
    this.physics.add.overlap(this.player.sprite, this.bed, () => {
      this.respawnPoint = { x: 860, y: 430 };
      this.bedTouched = true;
    });
    this.respawnPoint = { x: 120, y: 430 };

    // —— 老猫商店 NPC ——
    this.makeShopNpc(760, 472);

    // —— 输入 ——
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    this.attackKey = this.input.keyboard.addKey('J');
    this.pounceKey = this.input.keyboard.addKey('K');
    this.jumpKey = this.input.keyboard.addKey('SPACE');
    this.listenKey = this.input.keyboard.addKey('L');
    this.interactKey = this.input.keyboard.addKey('E');
    this.collarKey = this.input.keyboard.addKey('I');
    this.atonementKey = this.input.keyboard.addKey('B');
    this.sandboxKey = this.input.keyboard.addKey('G');
    this.tutorialKey = this.input.keyboard.addKey('T');
    this.restartKey = this.input.keyboard.addKey('R');
    this.input.keyboard.addCapture(['SPACE', 'UP', 'L']);

    this.sfx = new Sfx();
    this.prevListening = false;
    this.player.onClawHit = (obj, info) => this.handleHit(obj, info);

    // 菜单
    this.denMenu = this.makeDenMenu();
    this.collarMenu = this.makeCollarMenu();
    this.shopMenu = this.makeShopMenu();
    this.menu = null;

    this.hud = new Hud(this);
    this.hud.setRegions([{ name: '绒毛巢', lit: true }, { name: '沉眠回廊', lit: true }]);
    this.hud.setRegionName('战斗沙盒');
    this.applyRegionLights();
    this.updateStats();

    this.add
      .text(480, 16, '战 斗 沙 盒 · 灵毛 / 灵 影 / 猫窝 / 商店', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#e0b0b0',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(90);
    this.add
      .text(480, 96, 'A/D 移动 · 空格 跳 · J 爪击(空中=下扑) · K 扑袭 · E 猫窝/商店 · I 项圈 · 被打死掉灵影 · B 远程赎罪', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#7d8aa8',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(90);

    this.lastRipple = 0;
    this.currentListenRadius = 0;
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
    this.derived = this.collars.derive();
  }

  recomputeDerived() {
    this.derived = this.collars.derive();
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

  equippedCollarNames() {
    const names = [];
    for (const id of this.collars.equipped) names.push(this.collars.catalog[id]?.name || id);
    return names.length ? names.join('/') : '无';
  }

  regionLines() {
    const r = this.profile.regions || {};
    const lines = [Object.keys(r).map((k) => `${k} ${r[k]}%`).join(' · ')];
    lines.push(`项圈槽 ${this.derived.slotsUsed}/${this.derived.slotsTotal} · 面具+${this.collars.maskLevel}`);
    if (this.shade && !this.shade.dead) lines.push(`灵影在此：携 ${this.shade.carried} 灵毛`);
    return lines;
  }

  // —— 猫窝菜单（含远程赎罪）——
  makeDenMenu() {
    const m = new Menu(this, {
      title: '猫 窝',
      getLines: () => this.regionLines(),
      items: [
        {
          label: '休窝存档（写本地 + 充能九命）',
          onSelect: () => {
            this.nineLifeCharge = true; // 休窝后首次死亡原地复活充能
            this.syncProfile();
            this.floatText(this.player.sprite.x, this.player.sprite.y - 24, '已休窝 · 存档 ✓', '#aee9ff');
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
          label: '远程赎罪（耗小鱼干回收灵影）',
          hidden: () => !this.shade || this.shade.dead,
          onSelect: () => {
            this.remoteAtonement();
            m.close();
          },
        },
      ],
      onClose: () => this.onMenuClose(m),
    });
    return m;
  }

  makeCollarMenu() {
    const self = this;
    const m = new Menu(this, {
      title: '项 圈 装 备',
      getLines: () => [`槽位 ${self.derived.slotsUsed}/${self.derived.slotsTotal}`, `爪伤 ${self.derived.clawDamage} · 最大鱼心 ${self.derived.maxHP}`],
      items: [],
      onClose: () => this.onMenuClose(m),
    });
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
    return false;
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
      this.player.hp = this.derived.maxHP;
      this.floatText(this.player.sprite.x, this.player.sprite.y - 24, `面具升级! 最大鱼心 ${this.derived.maxHP}`, '#ff9aa0');
    }
    this.syncProfile();
    this.sfx.chime();
    this.updateStats();
    menu.rebuild();
  }

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

  makeShopNpc(x, y) {
    const cat = this.add.rectangle(x, y, 30, 36, 0x8a8a96).setDepth(8);
    this.add.rectangle(x - 8, y - 20, 8, 12, 0x8a8a96).setDepth(8);
    this.add.rectangle(x + 8, y - 20, 8, 12, 0x8a8a96).setDepth(8);
    this.add.rectangle(x - 5, y - 4, 4, 4, 0x202028).setDepth(9);
    this.add.rectangle(x + 5, y - 4, 4, 4, 0x202028).setDepth(9);
    this.add.text(x, y - 34, '老猫商店', { fontFamily: 'monospace', fontSize: '11px', color: '#ffd866' }).setOrigin(0.5).setDepth(9);
    this.shopNpc = cat;
  }

  spawnEnemy(x, y) {
    const e = new Enemy(this, x, y, this.balance, () => {});
    this.enemies.push(e);
    this.hittables.push(e.sprite);
    this.physics.add.collider(e.sprite, this.ground);
    this.physics.add.overlap(this.player.sprite, e.sprite, () => {
      if (!e.dead) this.player.takeDamage(e.contactDamage, e.x);
    });
    return e;
  }

  handleHit(obj, info) {
    const mm = this.derived.moteMult || 1;
    const fm = this.derived.fishMult || 1;
    if (obj.kind === 'enemy') {
      const e = obj.ref;
      const dmg = this.player.clawDamage; // 取项圈派生爪伤
      const killed = e.takeHit(dmg, this.player.sprite.x);
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
      const sh = obj.ref;
      sh.takeHit(this.player.clawDamage, this.player.sprite.x);
      this.sfx.pop();
      this.updateStats();
    }
  }

  addMotes(n) {
    this.motes = Math.min(this.cap, this.motes + n);
  }

  // —— 死亡循环（含九命项圈原地复活）——
  onPlayerDeath() {
    const carried = this.motes;
    const sx = this.player.sprite.x;
    const sy = this.player.sprite.y;

    // 九命项圈：休窝后首次死亡原地复活一次（保留灵毛，不化灵影）
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
    this.spawnShade(sx, sy, total);
    this.floatText(sx, sy - 24, '灵影诞生 · 携走灵毛', '#c9a8ff');
    // 死亡柔化层：显示灵影方向/距离/携带量 + 赎罪提示（反差萌：软壳裹硬核）
    const distM = Math.max(1, Math.round(Math.abs(sx - this.respawnPoint.x) / (this.balance.listen.pxPerMeter || 32)));
    const dir = sx < this.respawnPoint.x ? '左' : '右';
    const fishCost = Math.ceil(total * (this.balance.shade?.atonementFactor ?? 0.5));
    this.hud.showDeath({ carried: total, dir, distM, fishCost });
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
    this.syncProfile();
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

  getBlightFactor(x, y) {
    return this.blight ? this.blight.getBlightFactor(x, y) : 1;
  }

  update(time, delta) {
    if (this.menu && this.menu.isOpen()) {
      this.menu.update();
      return;
    }

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
    if (Phaser.Input.Keyboard.JustDown(this.collarKey)) {
      this.openMenu(this.collarMenu);
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.atonementKey)) {
      this.remoteAtonement();
    }

    // 猫窝 / 商店交互
    this.tryBed();
    this.tryShop();

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

    for (const e of this.enemies) e.update(time, delta, this.player);
    if (this.shade && !this.shade.dead) this.shade.update(time, delta, this.player);

    const status = [
      s.attacking ? '攻击' : null,
      s.pouncing ? '扑袭' : null,
      s.iframe ? '无敌' : null,
      this.player.dead ? '已死' : null,
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
    this.hud.setStats({
      motes: this.motes,
      fish: this.fish,
      fluff: this.fluff,
      cap: this.cap,
      hp: this.player.hp,
      maxHP: this.player.maxHP,
      collars: this.equippedCollarNames(),
    });
    this.updateHint();
  }

  tryBed() {
    if (!this.bed) return;
    const near = Phaser.Math.Distance.Between(this.player.sprite.x, this.player.sprite.y, this.bed.x, this.bed.y) < 95;
    if (near && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.openMenu(this.denMenu);
    }
  }

  tryShop() {
    if (!this.shopNpc) return;
    const near = Phaser.Math.Distance.Between(this.player.sprite.x, this.player.sprite.y, this.shopNpc.x, this.shopNpc.y) < 90;
    if (near && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.openMenu(this.shopMenu);
    }
  }

  updateHint() {
    if (this.player.dead) {
      this.hud.setHint('倒下了…你的灵毛化为灵影。即将在猫窝复活点重生');
      return;
    }
    if (this.shade && !this.shade.dead) {
      this.hud.setHint(`灵影在此！去击杀它回收灵毛（卡住就按 B 远程赎罪，耗小鱼干）`);
      return;
    }
    if (this.cap - this.motes <= 0) {
      this.hud.setHint('灵毛池已满 — 去放猫之技艺或回窝存毛');
      return;
    }
    this.hud.setHint('打怪攒灵毛：每击+1 每杀+3 · 死亡掉灵影 · 猫窝可存档/回血/换装 · 老猫可买卖');
  }
}
