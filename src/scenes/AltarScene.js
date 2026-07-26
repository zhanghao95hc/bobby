// AltarScene：猫神祭坛（GDD 4.8 记忆绒毛消费端）。
// 在祭坛花"记忆绒毛"解锁永久能力：项圈槽+1 / 灵毛池上限+ / 新移动技（二段扑·滑翔）。
// 元进度树数据化于 balance.metaTree；已解锁等级存 profile.meta.unlocked。解锁即持久化，返回主世界即生效。
import { Sfx } from '../systems/Sfx.js';
import { Save } from '../systems/Save.js';
import { Menu } from '../ui/Menu.js';
import { MetaProgress } from '../systems/MetaProgress.js';

export class AltarScene extends Phaser.Scene {
  constructor() {
    super('Altar');
  }

  create() {
    this.balance = this.registry.get('balance') || {};
    this.ensureMeta();

    this.cameras.main.setBackgroundColor('#120a1c');
    this.add.rectangle(480, 270, 960, 540, 0x241338, 0.5).setDepth(-10);

    // 祭坛视觉（占位：中央发光猫神轮廓）
    this.add.rectangle(480, 300, 90, 120, 0x6b5a86, 0.85).setDepth(2);
    this.add.rectangle(480, 250, 70, 30, 0x8a78b0, 0.9).setDepth(2);
    this.add.circle(480, 240, 26, 0xffe7c2, 0.25).setDepth(3);

    this.add
      .text(480, 28, '猫 神 祭 坛', { fontFamily: 'monospace', fontSize: '24px', color: '#e7d4ff' })
      .setOrigin(0.5)
      .setDepth(90);
    this.add
      .text(480, 60, '用记忆绒毛解锁永久能力 · 能力跨周目保留（肉鸽重组不影响元进度）', {
        fontFamily: 'monospace', fontSize: '12px', color: '#9a86c0',
      })
      .setOrigin(0.5)
      .setDepth(90);

    this.sfx = new Sfx();

    // 延迟场景切换（避免在 menu.update() 调用栈内直接 scene.start 造成重入死锁）
    this.pendingStart = null;

    // 返回键
    this.backKey = this.input.keyboard.addKey('T');
    this.input.keyboard.addCapture(['SPACE', 'UP', 'DOWN', 'W', 'S', 'E', 'Q']);

    this.menu = this.makeAltarMenu();
    this.menu.open();
  }

  ensureMeta() {
    let profile = this.registry.get('profile');
    if (!profile) {
      profile = Save.load(this.balance);
      this.registry.set('profile', profile);
    }
    this.profile = profile;
    this.meta = MetaProgress.resolve(this.profile, this.balance);
  }

  syncProfile() {
    Save.save(this.profile);
    this.registry.set('profile', this.profile);
  }

  makeAltarMenu() {
    const self = this;
    const tree = MetaProgress.tree(this.balance);
    const m = new Menu(this, {
      title: '元 进 度 树',
      getLines: () => [
        `记忆绒毛 ✦ ${self.profile.fluff}`,
        `项圈槽 ${self.meta.collarNotches} · 灵毛池上限 ${self.meta.motePoolMax}`,
        `移动技: ${self.meta.skills.size ? [...self.meta.skills].join('/') : '无'}`,
      ],
      items: [],
      onClose: () => { this.pendingStart = 'FuzzNest'; },
    });

    m._buildItems = function () {
      const items = [];
      for (const id of Object.keys(tree)) {
        const node = tree[id];
        const st = MetaProgress.statusOf(id, self.profile, self.balance);
        const rankTxt = st.maxRank > 1 ? ` [Lv${st.rank || 0}/${st.maxRank}]` : '';
        let hint, disabled;
        if (st.state === 'maxed') {
          hint = () => '已满级';
          disabled = () => true;
        } else if (st.state === 'prereq') {
          const needName = tree[st.need]?.name || st.need;
          hint = () => `需先解锁:${needName}`;
          disabled = () => true;
        } else if (st.state === 'fluff') {
          hint = () => `✦${st.cost}(不足)`;
          disabled = () => true;
        } else {
          hint = () => `✦${st.cost}`;
          disabled = () => false;
        }
        items.push({
          label: `${node.name}${rankTxt}`,
          hint,
          disabled,
          onSelect: () => self.tryUnlock(id, m),
        });
      }
      items.push({ label: '— 返回教学区 —', onSelect: () => { self.pendingStart = 'FuzzNest'; } });
      m.items = items;
    };
    return m;
  }

  tryUnlock(id, menu) {
    const res = MetaProgress.unlock(id, this.profile, this.balance);
    if (!res.ok) {
      const msg =
        res.reason === 'fluff' ? `记忆绒毛不足(需✦${res.cost})` :
        res.reason === 'prereq' ? '前置未解锁' :
        res.reason === 'maxed' ? '已满级' : '无法解锁';
      this.floatText(msg, '#ff8888');
      return;
    }
    // 解锁成功：刷新派生并持久化
    this.meta = MetaProgress.resolve(this.profile, this.balance);
    this.syncProfile();
    const node = MetaProgress.tree(this.balance)[id];
    this.sfx.chime();
    this.floatText(`解锁成功: ${node.name} ✦-${res.cost}`, '#aee9ff');
    menu.rebuild();
  }

  floatText(msg, color) {
    const t = this.add
      .text(480, 470, msg, { fontFamily: 'monospace', fontSize: '15px', color })
      .setOrigin(0.5)
      .setDepth(95);
    this.tweens.add({ targets: t, y: 442, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
  }

  update() {
    // 延迟场景切换：仅在 update 最顶层、menu 逻辑之外执行，避免重入死锁
    if (this.pendingStart) {
      const key = this.pendingStart;
      this.pendingStart = null;
      if (this.menu && this.menu.isOpen()) this.menu.close();
      this.scene.start(key);
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.backKey)) {
      this.pendingStart = 'FuzzNest';
      return;
    }
    if (this.menu.isOpen()) this.menu.update();
  }
}
