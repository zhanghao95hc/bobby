// MetaProgress：元进度树（GDD 4.8 记忆绒毛 + 第3节 元进度）。
// 树定义在 balance.metaTree；已解锁等级存 profile.meta.unlocked{id:rank}。
// resolve()：把已解锁节点折算成有效加成（项圈槽/灵毛池上限/已解锁移动技）。
// unlock()：校验花费与前置、扣绒毛、记等级（在 AltarScene 调用后由场景负责 Save.save）。
import { Save } from './Save.js';

export class MetaProgress {
  // 树定义（来自 balance.metaTree），过滤掉 _comment 等下划线开头的元字段
  static tree(balance) {
    const raw = (balance && balance.metaTree) || {};
    const out = {};
    for (const k of Object.keys(raw)) {
      if (typeof k === 'string' && k.startsWith('_')) continue;
      out[k] = raw[k];
    }
    return out;
  }

  // 解析当前有效加成。返回 { notchBonus, poolBonus, skills:Set, motePoolMax, collarNotches, unlocked }
  static resolve(profile, balance) {
    const tree = MetaProgress.tree(balance);
    const unlocked = (profile && profile.meta && profile.meta.unlocked) || {};
    let notchBonus = 0;
    let poolBonus = 0;
    const skills = new Set();
    for (const id in unlocked) {
      const node = tree[id];
      if (!node) continue;
      const rank = unlocked[id] || 0;
      if (rank <= 0) continue;
      if (node.effect === 'collarNotch') notchBonus += (node.bonus || 1) * rank;
      else if (node.effect === 'motePoolMax') poolBonus += (node.bonus || 12) * rank;
      else if (node.effect === 'moveSkill' && node.skill) skills.add(node.skill);
    }
    const basePool = (balance && balance.player && balance.player.motePoolMax) ?? 33;
    const baseNotch = (balance && balance.collar && balance.collar.notches) ?? 3;
    return {
      unlocked,
      notchBonus,
      poolBonus,
      skills,
      motePoolMax: basePool + poolBonus,
      collarNotches: baseNotch + notchBonus,
    };
  }

  // 把元进度折算后的派生值并入 CollarSystem.derive() 的结果（不污染 balance）。
  // 直接修改并返回传入的 derived 对象。
  static applyToDerived(derived, meta) {
    if (!derived || !meta) return derived;
    derived.notches = meta.collarNotches; // 供槽位上限使用（若场景读取 derived.notches）
    derived.motePoolMax = meta.motePoolMax;
    derived.airPounces = meta.skills.has('doublepounce') ? 1 : 0;
    derived.glide = meta.skills.has('glide');
    derived.metaSkills = [...meta.skills];
    return derived;
  }

  // 给 CollarSystem 设置元进度槽位
  static applyNotches(collarSystem, meta) {
    if (collarSystem && meta) collarSystem.notches = meta.collarNotches;
  }

  // 尝试解锁某节点。返回 { ok, reason, cost, rank }。reason: 'no_node'|'maxed'|'prereq'|'fluff'|'ok'
  static unlock(nodeId, profile, balance) {
    const tree = MetaProgress.tree(balance);
    const node = tree[nodeId];
    if (!node) return { ok: false, reason: 'no_node' };
    const meta = MetaProgress.resolve(profile, balance);
    const unlocked = profile.meta && profile.meta.unlocked ? profile.meta.unlocked : (profile.meta = { unlocked: {} }).unlocked;
    const rank = unlocked[nodeId] || 0;
    const maxRank = node.maxRank || 1;
    if (rank >= maxRank) return { ok: false, reason: 'maxed' };

    // 前置校验
    const reqs = node.requires || [];
    for (const r of reqs) {
      if (!(unlocked[r] >= 1)) return { ok: false, reason: 'prereq', need: r };
    }

    // 花费：随等级递增（rank 从 0 开始，第 rank+1 级花费 cost*(rank+1)）
    const cost = (node.cost || 1) * (rank + 1);
    if ((profile.fluff || 0) < cost) return { ok: false, reason: 'fluff', cost };

    // 扣费 + 记等级
    profile.fluff -= cost;
    unlocked[nodeId] = rank + 1;
    return { ok: true, cost, rank: rank + 1, node };
  }

  // 可解锁状态查询（供 AltarScene 渲染禁用/提示），不修改 profile。
  static statusOf(nodeId, profile, balance) {
    const tree = MetaProgress.tree(balance);
    const node = tree[nodeId];
    if (!node) return { state: 'no_node' };
    const unlocked = (profile && profile.meta && profile.meta.unlocked) || {};
    const rank = unlocked[nodeId] || 0;
    const maxRank = node.maxRank || 1;
    if (rank >= maxRank) return { state: 'maxed', rank, maxRank };
    for (const r of node.requires || []) {
      if (!(unlocked[r] >= 1)) return { state: 'prereq', need: r, rank, maxRank };
    }
    const cost = (node.cost || 1) * (rank + 1);
    if ((profile.fluff || 0) < cost) return { state: 'fluff', cost, rank, maxRank };
    return { state: 'ready', cost, rank, maxRank };
  }
}
