// Blight：寂瘴环境危险系统（GDD 4.7）。
// 管理多个瘴区矩形、听声压制因子、敌人/玩家增益、清瘴点临时净化、瘴中死亡外缘落点。
// 视觉：紫色半透覆盖 + 缓慢起伏；净化后转绿淡出，到期复原。
// 所有数值来自 balance.blight，不硬编码。
export class Blight {
  constructor(scene, balance, zones) {
    this.scene = scene;
    this.balance = balance || {};
    const B = this.balance.blight || {};
    this.dps = B.dps ?? 0.5;
    this.listenSuppress = B.listenSuppress ?? 0.35;
    this.enemyDmgBonus = B.enemyDmgBonus ?? 0.5;
    this.enemySpeedBonus = B.enemySpeedBonus ?? 0.4;
    this.purifyRadius = B.purifyRadius ?? 70;
    this.purifyDurationMs = B.purifyDurationMs ?? 12000;

    // zones: [{x, y, w, h}] 世界坐标矩形（左上角原点）
    this.zones = (zones || []).map((z, i) => {
      const mesh = scene.add
        .rectangle(z.x, z.y, z.w, z.h, 0x6a3f8f, 0.22)
        .setOrigin(0, 0)
        .setDepth(2);
      return { ...z, index: i, mesh, purifiedUntil: 0, lastShown: false };
    });
  }

  now() {
    return this.scene.time.now;
  }

  // 当前含 (x,y) 的活跃瘴区（净化期内不算），否则 null
  zoneAt(x, y) {
    for (const z of this.zones) {
      if (this.now() < z.purifiedUntil) continue;
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z;
    }
    return null;
  }

  isInBlight(x, y) {
    return !!this.zoneAt(x, y);
  }

  // 听声衰减因子：瘴中返回 listenSuppress(<1)，否则 1（接阶段3 的 getBlightFactor 接口）
  getBlightFactor(x, y) {
    return this.isInBlight(x, y) ? this.listenSuppress : 1;
  }

  // 敌人/玩家增益数据
  getModsAt(x, y) {
    const z = this.zoneAt(x, y);
    if (!z)
      return { inBlight: false, dps: 0, dmgBonus: 0, speedBonus: 0 };
    return {
      inBlight: true,
      dps: this.dps,
      dmgBonus: this.enemyDmgBonus,
      speedBonus: this.enemySpeedBonus,
    };
  }

  // 瘴中死亡：灵影生成在瘴外缘（防不可达），groundY 为地面顶部世界坐标
  edgeSpawnPoint(zone, x, groundY) {
    const leftD = x - zone.x;
    const rightD = zone.x + zone.w - x;
    const ex = leftD <= rightD ? zone.x - 26 : zone.x + zone.w + 26;
    return { x: ex, y: groundY - 36 };
  }

  // 清瘴：净化 (x,y) 附近 purifyRadius 内最近的活跃瘴区；返回被净化的 zone 或 null
  purifyAt(x, y) {
    let best = null;
    let bestD = Infinity;
    for (const z of this.zones) {
      const cx = Math.max(z.x, Math.min(x, z.x + z.w));
      const cy = Math.max(z.y, Math.min(y, z.y + z.h));
      const d = Phaser.Math.Distance.Between(x, y, cx, cy);
      if (d < bestD) {
        bestD = d;
        best = z;
      }
    }
    if (!best || bestD > this.purifyRadius) return null;
    best.purifiedUntil = this.now() + this.purifyDurationMs;
    return best;
  }

  // 玩家持续掉血（场景每帧调用）；blightResist ∈ [0,1] 来自项圈派生
  tickPlayer(player, delta, blightResist) {
    const z = this.zoneAt(player.sprite.x, player.sprite.y);
    player.inBlight = !!z;
    if (!z) return;
    const dt = delta / 1000;
    const resist = blightResist || 0;
    const dmg = this.dps * (1 - resist) * dt;
    if (dmg > 0) player.drainHP(dmg);
  }

  // 每帧更新视觉（净化态切换 + 起伏脉动）
  update() {
    const t = this.now();
    for (const z of this.zones) {
      const purified = t < z.purifiedUntil;
      if (purified !== z.lastShown) {
        z.lastShown = purified;
        z.mesh.setFillStyle(purified ? 0x3f8f5a : 0x6a3f8f, purified ? 0.12 : 0.22);
      }
      const pulse = purified
        ? 0.05 + 0.04 * Math.sin(t / 400)
        : 0.16 + 0.08 * Math.sin(t / 500 + z.index);
      z.mesh.setAlpha(pulse);
    }
  }
}
