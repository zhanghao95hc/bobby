// MapView：解锁式区域图浮层（GDD 第6节 / 阶段10 地图交付）。
// 从猫窝菜单进入；按 profile.regions[id]>=100 点亮节点，连线，高亮当前区域。
// 纯键盘浮层（Q/Esc 关闭），不依赖鼠标；pause 由场景侧负责（见 FuzzNest.openMap）。
export class MapView {
  constructor(scene, opts) {
    this.scene = scene;
    this.opts = opts || {};
    this.open_ = false;
    this.objs = [];
    const kb = scene.input.keyboard;
    this.keys = { cancel: kb.addKey('Q'), esc: kb.addKey('ESC') };
    kb.addCapture(['Q', 'ESC']);
    this.W = scene.scale.width;
    this.H = scene.scale.height;
  }

  isOpen() {
    return this.open_;
  }

  open() {
    if (this.open_) return;
    this.open_ = true;
    this._render();
  }

  close() {
    if (!this.open_) return;
    this.open_ = false;
    this._destroy();
    if (this.opts.onClose) this.opts.onClose();
  }

  _destroy() {
    for (const o of this.objs) o.destroy();
    this.objs = [];
  }

  _render() {
    const W = this.W, H = this.H;
    const map = this.opts.mapData || {};
    const regions = (this.opts.getRegions && this.opts.getRegions()) || {};
    const nodes = map.nodes || [];
    const current = map.current;

    const pw = 640, ph = 330, px = W / 2 - pw / 2, py = H / 2 - ph / 2;
    const g = this.scene.add.graphics().setScrollFactor(0).setDepth(130);
    g.fillStyle(0x140e22, 0.96).fillRoundedRect(px, py, pw, ph, 14);
    g.lineStyle(2, 0xb9a7e0, 0.8).strokeRoundedRect(px, py, pw, ph, 14);
    this.objs.push(g);

    const title = this.scene.add
      .text(W / 2, py + 16, '绒 光 猫 国 · 区 域 图', { fontFamily: 'monospace', fontSize: '16px', color: '#e7d4ff' })
      .setOrigin(0.5, 0).setScrollFactor(0).setDepth(131);
    this.objs.push(title);

    const ox = px + 50, oy = py + 70;
    const pos = {};
    for (const n of nodes) pos[n.id] = { x: ox + n.x, y: oy + n.y };

    // 连线（去重，按 lit 状态着色）
    const drawn = new Set();
    for (const n of nodes) {
      for (const lk of n.links || []) {
        const a = pos[n.id], b = pos[lk];
        if (!a || !b) continue;
        const key = [n.id, lk].sort().join('|');
        if (drawn.has(key)) continue;
        drawn.add(key);
        const lit = regions[n.id] >= 100 && regions[lk] >= 100;
        g.lineStyle(3, lit ? 0x6b5a86 : 0x332a44, lit ? 0.95 : 0.6);
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.strokePath();
      }
    }

    // 节点
    for (const n of nodes) {
      const p = pos[n.id];
      if (!p) continue;
      const lit = regions[n.id] != null && regions[n.id] >= 100;
      const cur = current === n.id;
      if (cur) {
        g.lineStyle(2, 0xffd866, 0.9);
        g.strokeCircle(p.x, p.y, 22);
      }
      g.fillStyle(lit ? 0xffd866 : 0x2a2438, 1);
      g.fillCircle(p.x, p.y, 14);
      if (!lit) {
        g.lineStyle(2, 0x4a4460, 1);
        g.strokeCircle(p.x, p.y, 14);
      }
      const label = lit ? n.name : '？';
      const t = this.scene.add
        .text(p.x, p.y + 26, label, { fontFamily: 'monospace', fontSize: '12px', color: lit ? '#ffd866' : '#5a5a6a' })
        .setOrigin(0.5, 0).setScrollFactor(0).setDepth(131);
      this.objs.push(t);
      if (cur) {
        const ct = this.scene.add
          .text(p.x, p.y - 30, '● 你在这里', { fontFamily: 'monospace', fontSize: '11px', color: '#ffd866' })
          .setOrigin(0.5, 1).setScrollFactor(0).setDepth(131);
        this.objs.push(ct);
      }
    }

    const foot = this.scene.add
      .text(W / 2, py + ph - 18, 'Q / Esc 关闭 · 点亮区域随探索解锁', { fontFamily: 'monospace', fontSize: '12px', color: '#8a7aa8' })
      .setOrigin(0.5, 1).setScrollFactor(0).setDepth(131);
    this.objs.push(foot);
  }

  update() {
    if (!this.open_) return;
    const JD = Phaser.Input.Keyboard.JustDown;
    if (JD(this.keys.cancel) || JD(this.keys.esc)) this.close();
  }
}
