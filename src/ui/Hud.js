// Hud：反差萌 UI 壳 + 沉重内核。
// 布局（屏幕固定，scrollFactor 0）：
//   左上圆角柔色面板：小猫 mascot + 区域名 + 鱼心(HP) + 灵毛池(进度条) + 小鱼干 + 项圈槽
//   右上：解锁式区域图（setRegions）
//   顶部居中：当前区域名横幅（setRegionName，可选）
//   底部居中：情境教学提示（setHint）
//   死亡柔化层（showDeath）：显示灵影方向/距离/携带量 + 赎罪提示，弱化挫败
// 占位美术，但信息一眼可读。
export class Hud {
  constructor(scene) {
    this.scene = scene;
    this.W = scene.scale.width;
    this.H = scene.scale.height;
    const W = this.W, H = this.H;

    // —— 左上柔色面板（反差萌壳）——
    this.panelG = scene.add.graphics().setScrollFactor(0).setDepth(94);
    this.panelG.fillStyle(0x171122, 0.82).fillRoundedRect(8, 8, 262, 122, 12);
    this.panelG.lineStyle(1.5, 0xb9a7e0, 0.7).strokeRoundedRect(8, 8, 262, 122, 12);

    this._drawMascot();

    const base = { fontFamily: 'monospace', fontSize: '13px' };
    this.regionNameText = scene.add
      .text(58, 18, '绒毛巢', { ...base, color: '#e7d4ff', fontStyle: 'bold' })
      .setScrollFactor(0).setDepth(100);
    this.hpText = scene.add
      .text(58, 40, '', { ...base, color: '#ff9aa8' })
      .setScrollFactor(0).setDepth(100);
    this.moteText = scene.add
      .text(58, 62, '', { ...base, color: '#aee9ff' })
      .setScrollFactor(0).setDepth(100);
    this.moteBarG = scene.add.graphics().setScrollFactor(0).setDepth(99);
    this.fishText = scene.add
      .text(58, 84, '', { ...base, color: '#ffd866' })
      .setScrollFactor(0).setDepth(100);
    this.collarText = scene.add
      .text(58, 106, '', { ...base, color: '#c8b0ff' })
      .setScrollFactor(0).setDepth(100);

    // —— 顶部居中区域名横幅（可选）——
    this.regionBanner = scene.add
      .text(W / 2, 12, '', {
        fontFamily: 'monospace', fontSize: '13px', color: '#d8c8ff',
        backgroundColor: '#1d1530cc', padding: { x: 10, y: 3 },
      })
      .setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);

    // —— 底部居中情境提示 ——
    this.hint = scene.add
      .text(W / 2, H - 24, '', {
        fontFamily: 'monospace', fontSize: '13px', color: '#c8b0ff',
        align: 'center', backgroundColor: '#00000088', padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 1).setScrollFactor(0).setDepth(100);

    // —— 左下角调试（弱化为开发信息，不抢主视觉）——
    this.debugText = scene.add
      .text(10, H - 16, '', { fontFamily: 'monospace', fontSize: '11px', color: '#5a5a6a' })
      .setScrollFactor(0).setDepth(100);

    // —— 右上区域地图（解锁式）——
    this.regions = [];
    this.regionTexts = [];

    // —— 寂瘴横幅 ——
    this.blightBanner = scene.add
      .text(W / 2, 40, '', {
        fontFamily: 'monospace', fontSize: '15px', color: '#d6a8ff',
        backgroundColor: '#2a0f3a88', padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0).setScrollFactor(0).setDepth(100).setVisible(false);

    // 死亡层对象
    this.deathObjs = null;
    this.deathTimer = null;
  }

  // 小猫 mascot（波比吉祥物，反差萌壳）
  _drawMascot() {
    const g = this.scene.add.graphics().setScrollFactor(0).setDepth(96);
    const cx = 30, cy = 30;
    g.fillStyle(0x6b8fb5, 1);
    g.fillTriangle(cx - 11, cy - 5, cx - 3, cy - 19, cx - 2, cy - 1); // 左耳
    g.fillTriangle(cx + 11, cy - 5, cx + 3, cy - 19, cx + 2, cy - 1); // 右耳
    g.fillCircle(cx, cy, 12); // 脸
    g.fillStyle(0x0c0a14, 1);
    g.fillCircle(cx - 4, cy - 1, 1.6); // 眼
    g.fillCircle(cx + 4, cy - 1, 1.6);
    g.fillStyle(0xff9aa8, 1);
    g.fillCircle(cx, cy + 4, 1.6); // 鼻
  }

  setRegionName(name) {
    if (this.regionBanner) this.regionBanner.setText(name ? `区域 · ${name}` : '');
  }

  setBlight(on) {
    this.blightBanner.setVisible(!!on);
    if (on) this.blightBanner.setText('⚠ 寂瘴中 · 持续掉鱼心 · 听声被压制');
  }

  update(x, y, fps, status, listen) {
    const st = status ? `  [${status}]` : '';
    let extra = '';
    if (listen) {
      if (listen.hitstun) extra += '   受击硬直!';
      else if (listen.listening)
        extra += listen.listenRevealed ? '   听声·显形✓' : `   听声… ${(listen.listenProgress * 100).toFixed(0)}%`;
    }
    this.debugText.setText(`FPS ${fps.toFixed(0)}${st}${extra}`);
  }

  setStats(o) {
    o = o || {};
    const maxHP = o.maxHP ?? 5;
    const hp = o.hp ?? maxHP;
    const full = Math.max(0, Math.min(maxHP, Math.floor(hp)));
    const empty = Math.max(0, maxHP - full);
    this.hpText.setText(`鱼心 ${'♥'.repeat(full)}${'♡'.repeat(empty)} ${hp.toFixed(1)}/${maxHP}`);

    const motes = o.motes ?? 0;
    const cap = o.cap;
    this.moteText.setText(`灵毛 ${motes}${cap != null ? '/' + cap : ''}`);

    // 灵毛池进度条
    this.moteBarG.clear();
    if (cap != null) {
      const bx = 150, by = 60, bw = 108, bh = 10;
      this.moteBarG.fillStyle(0x223044, 1).fillRoundedRect(bx, by, bw, bh, 4);
      const frac = Math.max(0, Math.min(1, cap > 0 ? motes / cap : 0));
      if (frac > 0) this.moteBarG.fillStyle(0x7fd0ff, 1).fillRoundedRect(bx, by, Math.max(4, bw * frac), bh, 4);
    }

    this.fishText.setText(`小鱼干 ${o.fish ?? 0}`);
    this.collarText.setText(`项圈 ${o.collars ?? '无'}`);
  }

  // regions: [{name, lit}] —— 右上角解锁式区域图
  setRegions(regions) {
    this.regions = regions;
    this.regionTexts.forEach((t) => t.destroy());
    this.regionTexts = [];
    const startX = this.W - 12;
    const startY = 12;
    regions.forEach((r, i) => {
      const mark = r.lit ? '●' : '○';
      const t = this.scene.add
        .text(startX, startY + i * 20, `${mark} ${r.name}`, {
          fontFamily: 'monospace', fontSize: '13px',
          color: r.lit ? '#ffd866' : '#5a5a6a',
        })
        .setOrigin(1, 0).setScrollFactor(0).setDepth(100);
      this.regionTexts.push(t);
    });
  }

  setHint(s) {
    this.hint.setText(s || '');
  }

  // —— 死亡柔化层（反差萌：软壳裹硬核）——
  // opts: { carried, dir('左'|'右'|''), distM, fishCost, teaching }
  showDeath(opts = {}) {
    this.hideDeath();
    const carried = opts.carried ?? 0;
    const dir = opts.dir || '';
    const distM = opts.distM ?? 0;
    const fishCost = opts.fishCost ?? 0;
    const teaching = !!opts.teaching;
    const W = this.W, H = this.H;
    const objs = [];

    const bg = this.scene.add
      .rectangle(W / 2, H / 2, W, H, 0x0a0612, 0.74)
      .setScrollFactor(0).setDepth(200);
    objs.push(bg);

    const pw = 470, ph = 206, px = W / 2 - pw / 2, py = H / 2 - ph / 2 - 8;
    const g = this.scene.add.graphics().setScrollFactor(0).setDepth(201);
    g.fillStyle(0x1d1530, 0.96).fillRoundedRect(px, py, pw, ph, 16);
    g.lineStyle(2, 0xc9a8ff, 0.9).strokeRoundedRect(px, py, pw, ph, 16);
    objs.push(g);

    const mk = (y, msg, color, size) => {
      const t = this.scene.add
        .text(W / 2, y, msg, {
          fontFamily: 'monospace', fontSize: (size || 14) + 'px', color,
          align: 'center', wordWrap: { width: pw - 44 },
        })
        .setOrigin(0.5, 0).setScrollFactor(0).setDepth(202);
      objs.push(t);
      return t;
    };
    mk(py + 20, teaching ? '波比打了个盹…' : '波比睡着了…', '#e7d4ff', 22);
    mk(py + 58, '灵影替你把没花完的灵毛收好了', '#b9a7e0', 14);
    const info = carried > 0
      ? `灵影在${dir}边约 ${distM} 米处 · 携 ${carried} 灵毛`
      : '这次没丢灵毛，轻装上阵';
    mk(py + 88, info, '#aee9ff', 14);
    mk(py + 116, `走回去轻轻一爪就能唤回它 · 嫌远就按 B 在猫窝远程赎罪（约 ${fishCost} 小鱼干）`, '#ffd866', 12);
    mk(py + 150, '—— 死亡不是终点，是绒光的低语 ——', '#c9a8ff', 12);
    mk(py + 172, '（即将在猫窝 / 复活点醒来）', '#6a5a7a', 11);

    this.deathObjs = objs;
    this.deathTimer = this.scene.time.delayedCall(1900, () => this.hideDeath());
  }

  hideDeath() {
    if (this.deathTimer) { this.deathTimer.remove(false); this.deathTimer = null; }
    if (this.deathObjs) {
      for (const o of this.deathObjs) o.destroy();
      this.deathObjs = null;
    }
  }

  // —— Boss 血条（顶部居中）——
  showBossBar(name, hp, maxHP, phase) {
    if (!this.bossBarBg) {
      const w = 520;
      const x = this.W / 2 - w / 2;
      this.bossBarBg = this.scene.add
        .rectangle(x, 64, w, 12, 0x2a1414).setOrigin(0, 0.5).setScrollFactor(0).setDepth(101);
      this.bossBarFill = this.scene.add
        .rectangle(x + 1, 64, w - 2, 9, 0xff6b6b).setOrigin(0, 0.5).setScrollFactor(0).setDepth(102);
      this.bossBarText = this.scene.add
        .text(this.W / 2, 46, '', {
          fontFamily: 'monospace', fontSize: '13px', color: '#ffcaca',
        })
        .setOrigin(0.5, 1).setScrollFactor(0).setDepth(102);
    }
    const w = 520 - 2;
    const frac = Math.max(0, Math.min(1, hp / maxHP));
    this.bossBarFill.width = w * frac;
    this.bossBarFill.setFillStyle(this.bossBarFill.width / w < 0.5 ? 0xff4d4d : 0xff8c6b);
    this.bossBarText.setText(`${name}  ·  阶段 ${phase}  ·  HP ${Math.ceil(hp)}/${maxHP}`);
  }

  hideBossBar() {
    if (this.bossBarBg) this.bossBarBg.setVisible(false);
    if (this.bossBarFill) this.bossBarFill.setVisible(false);
    if (this.bossBarText) this.bossBarText.setVisible(false);
  }
}
