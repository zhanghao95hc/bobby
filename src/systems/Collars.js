// Collars：项圈系统（GDD 4.6）。装备槽位(Notches) + 派生效果计算。
// 所有数值来自 balance.collar.catalog，不硬编码。
// 派生维度：clawDamage(爪伤) / maxHP(鱼心，可为负) / moteMult(灵毛产率) /
//           fishMult(小鱼干产率) / listenThresholdMult·listenRadiusMult(听声) / nineLife(九命)
export class CollarSystem {
  constructor(balance) {
    this.balance = balance || {};
    const cs = this.balance.collar || {};
    this.catalog = cs.catalog || {};
    this.notches = cs.notches ?? 3;
    this.owned = new Set();
    this.equipped = new Set();
    this.maskLevel = 0; // 面具升级（+1 最大鱼心/级），来自商店
  }

  applyProfile(profile) {
    this.owned = new Set(profile.ownedCollars || []);
    this.equipped = new Set(profile.equippedCollars || []);
    this.maskLevel = profile.maskLevel || 0;
    // 防脏数据：装备的必须已拥有
    for (const id of [...this.equipped]) if (!this.owned.has(id)) this.equipped.delete(id);
  }

  toProfile() {
    return {
      ownedCollars: [...this.owned],
      equippedCollars: [...this.equipped],
      maskLevel: this.maskLevel,
    };
  }

  slotsUsed() {
    let s = 0;
    for (const id of this.equipped) s += this.catalog[id]?.slots || 0;
    return s;
  }

  slotsTotal() {
    return this.notches;
  }

  // 能否装备：已拥有 + 未装备 + 槽位够 + 无互斥冲突
  canEquip(id) {
    if (!this.owned.has(id)) return false;
    if (this.equipped.has(id)) return false;
    const cost = this.catalog[id]?.slots || 0;
    const conflicts = this.catalog[id]?.conflicts || [];
    for (const ex of this.equipped) if (conflicts.includes(ex)) return false;
    return this.slotsUsed() + cost <= this.slotsTotal();
  }

  equip(id) {
    if (this.canEquip(id)) {
      this.equipped.add(id);
      return true;
    }
    return false;
  }

  unequip(id) {
    this.equipped.delete(id);
  }

  owns(id) {
    return this.owned.has(id);
  }

  buy(id) {
    if (this.owned.has(id)) return false;
    this.owned.add(id);
    return true;
  }

  // 计算最终派生属性（GDD 4.6）
  derive() {
    const base = this.balance.player || {};
    let claw = base.clawDamage ?? 1;
    let maxHP = (base.maxHP ?? 5) + (this.maskLevel || 0);
    let moteMult = 1;
    let fishMult = 1;
    let listenThresholdMult = 1; // <1 = 显形更快
    let listenRadiusMult = 1; // >1 = 范围更大
    let nineLife = false;
    let blightResist = 0; // 寂瘴减伤（0..1，多项圈可叠加但外部钳制）
    for (const id of this.equipped) {
      const c = this.catalog[id];
      if (!c) continue;
      claw += c.clawDamage || 0;
      maxHP += c.maxHP || 0;
      moteMult *= c.moteMult || 1;
      fishMult *= c.fishMult || 1;
      listenThresholdMult *= c.listenThresholdMult || 1;
      listenRadiusMult *= c.listenRadiusMult || 1;
      if (c.nineLife) nineLife = true;
      blightResist += c.blightResist || 0;
    }
    maxHP = Math.max(1, Math.min(9, maxHP)); // 钳制到 GDD 5.2 区间 [3,9] 内取下限
    blightResist = Math.max(0, Math.min(0.9, blightResist)); // 最多减伤 90%
    return {
      clawDamage: claw,
      maxHP,
      moteMult,
      fishMult,
      listenThresholdMult,
      listenRadiusMult,
      nineLife,
      blightResist,
      slotsUsed: this.slotsUsed(),
      slotsTotal: this.slotsTotal(),
    };
  }
}
