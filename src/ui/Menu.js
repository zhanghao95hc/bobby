// Menu：轻量键盘驱动列表菜单（GDD 4.5/4.6 猫窝与项圈 UI 用）。
// 纯占位美术（文本面板），无鼠标依赖。导航：↑/↓ 或 W/S；确认 E/Enter；取消 Q/Esc。
// 场景在 update 中检测 menu.isOpen() → 调用 menu.update() 并冻结玩家输入。
export class Menu {
  constructor(scene, opts) {
    this.scene = scene;
    this.opts = opts; // { title, getLines?, items:[{label, hint?, disabled?, hidden?, onSelect?}], onClose? }
    this.items = [];
    this.sel = 0;
    this.open_ = false;
    this.depth = 120;
    this.txt = null;
    const kb = scene.input.keyboard;
    this.keys = {
      up: kb.addKey('UP'),
      down: kb.addKey('DOWN'),
      w: kb.addKey('W'),
      s: kb.addKey('S'),
      conf: kb.addKey('E'),
      enter: kb.addKey('ENTER'),
      cancel: kb.addKey('Q'),
      esc: kb.addKey('ESC'),
    };
    kb.addCapture(['UP', 'DOWN', 'W', 'S', 'E', 'Q']);
    this.W = scene.scale.width;
    this.H = scene.scale.height;
  }

  isOpen() {
    return this.open_;
  }

  open() {
    if (this.open_) return;
    this.open_ = true;
    this.sel = 0;
    this._buildItems();
    this.txt = this.scene.add
      .text(this.W / 2, this.H / 2, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#dce8ff',
        align: 'left',
        backgroundColor: '#06060f',
        padding: { x: 16, y: 14 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(this.depth);
    this.render();
  }

  close() {
    if (!this.open_) return;
    this.open_ = false;
    if (this.txt) {
      this.txt.destroy();
      this.txt = null;
    }
    if (this.opts.onClose) this.opts.onClose();
  }

  // 装备/购买后刷新列表（menu 仍打开时调用）
  rebuild() {
    this._buildItems();
    this.render();
  }

  _buildItems() {
    this.items = (this.opts.items || []).filter((it) => !(it.hidden && it.hidden()));
  }

  render() {
    const lines = [`=== ${this.opts.title} ===`];
    this.items.forEach((it, i) => {
      const mark = i === this.sel ? '▶' : ' ';
      const dis = it.disabled && it.disabled() ? '  [不可]' : '';
      const hint = it.hint ? `   ${it.hint()}` : '';
      lines.push(`${mark} ${it.label}${dis}${hint}`);
    });
    if (this.opts.getLines) lines.push('———————————', ...this.opts.getLines());
    lines.push('E/Enter 确认 · Q/Esc 退出');
    if (this.txt) this.txt.setText(lines.join('\n'));
  }

  update() {
    if (!this.open_) return;
    const k = this.keys;
    const JD = Phaser.Input.Keyboard.JustDown;
    if (JD(k.up) || JD(k.w)) {
      this.sel = (this.sel - 1 + this.items.length) % this.items.length;
      this.render();
    } else if (JD(k.down) || JD(k.s)) {
      this.sel = (this.sel + 1) % this.items.length;
      this.render();
    } else if (JD(k.conf) || JD(k.enter)) {
      const it = this.items[this.sel];
      if (it && !(it.disabled && it.disabled())) {
        if (it.onSelect) it.onSelect();
        else this.close();
      }
    } else if (JD(k.cancel) || JD(k.esc)) {
      this.close();
    }
  }
}
