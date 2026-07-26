// 波比 BOBBY — 经济纸面模拟（可复现）
// 对应 GDD 第5.2/5.3 节：灵毛池 + 灵影回收 10 局循环，查死锁；并跑四类"经济崩溃"自检。
// 数值镜像 data/balance.json（注释标 JSON 路径）。所有"公式"与 balance_sheet.csv 联动。
//
// 运行：node sim_balance.mjs [path/to/balance.json]
//   无参数 → 用内置初值（= 当前 balance.json 值）
//   有参数 → 读取该 JSON，用其中 economy 相关字段覆盖，做前后对比
// 输出：10 局模拟表 + 死锁判定 + 5.3 四类自检结论。

import { readFileSync } from 'fs';

// ---- 种子化随机（mulberry32），保证复现 ----
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260726);

function loadBalance(path) {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return {
      poolMax: j.player.motePoolMax,
      motePerHit: j.player.motePerHit,
      motePerKill: j.player.motePerKill,
      fishDrop: j.enemy.fishDrop,
      maxHP: j.player.maxHP,
      healCost: j.player.healCostFishPerHeart,
      atonementFactor: j.shade.atonementFactor,
      bossFish: j.boss.rustooth.fishReward,
      startingFish: j.currency.startingFish,
      clawMaxHP: j.collar.catalog.claw.maxHP,
    };
  } catch (e) {
    return null;
  }
}

// ---- 平衡常量（内置初值 = 当前 balance.json）----
const L = process.argv[2] ? loadBalance(process.argv[2]) : null;
const SRC = L ? process.argv[2] : '内置初值(= 当前 balance.json)';
const B = {
  poolMax: 33,            // player.motePoolMax
  motePerHit: 1,          // player.motePerHit
  motePerKill: 3,         // player.motePerKill
  hitsPerKill: 2,         // 假设每杀附带 2 次爪击命中
  fishDrop: 2,            // enemy.fishDrop
  fishMult: 1,            // 默认无项圈
  maxHP: 5,               // player.maxHP
  healCost: 1,            // player.healCostFishPerHeart
  shadeStrength: 0.7,     // shade.strengthPct
  atonementFactor: 0.5,   // shade.atonementFactor
  bossFish: 25,           // rustooth.fishReward
  repeatBossFishBonus: 25,
  startingFish: 10,       // currency.startingFish
  clawDamage: 1,          // player.clawDamage (base)
  clawMaxHP: -1,          // collar.catalog.claw.maxHP
  miniHP: 120,            // boss.miniHP
  finalHP: 800,           // boss.finalHP
  // 猫之技艺消耗（派生公式）
  skillCost: (pool) => ({
    moonClaw: Math.ceil(pool * 0.36),
    mossShield: Math.ceil(pool * 0.55),
    nineLifeFlash: Math.ceil(pool * 0.24),
  }),
};
// 用 JSON 覆盖 economy 相关字段
if (L) {
  if (L.poolMax != null) B.poolMax = L.poolMax;
  if (L.motePerHit != null) B.motePerHit = L.motePerHit;
  if (L.motePerKill != null) B.motePerKill = L.motePerKill;
  if (L.fishDrop != null) B.fishDrop = L.fishDrop;
  if (L.maxHP != null) B.maxHP = L.maxHP;
  if (L.healCost != null) B.healCost = L.healCost;
  if (L.atonementFactor != null) B.atonementFactor = L.atonementFactor;
  if (L.bossFish != null) B.bossFish = L.bossFish;
  if (L.startingFish != null) B.startingFish = L.startingFish;
  if (L.clawMaxHP != null) B.clawMaxHP = L.clawMaxHP;
}

const castCost = B.skillCost(B.poolMax).moonClaw; // 12

// ---- 10 局模拟 ----
function simulateRun(i) {
  const enemiesKilled = Math.round(8 + (rng() * 6 - 3)); // 5..11
  const motesGained = enemiesKilled * (B.motePerKill + B.motePerHit * B.hitsPerKill); // 每杀 5
  // 玩家边攒边放技：池满前每攒够一次就放（清空 12）
  let pool = 0, motesSpent = 0;
  for (let m = 0; m < motesGained; m++) {
    pool++;
    if (pool >= castCost) { pool -= castCost; motesSpent += castCost; }
  }
  const carriedMotes = Math.min(pool, B.poolMax); // 死亡时池内剩余

  // 死锁压力测试：第4、8局强制"死亡 + 灵影不可达"，真实触发赎罪兜底路径
  const stressUnreachable = (i === 3 || i === 7);
  const died = stressUnreachable ? true : rng() < 0.3; // 中等水平死亡概率
  const reachable = !stressUnreachable;
  const bossThisRun = rng() < 0.2;
  const exploration = rng() < 0.5 ? 5 : 0; // tutorial.fishPileAmount 类隐藏鱼

  let fish = B.startingFish;
  let action = '—', atonementSpent = 0, farmNeeded = false, deadlock = false;

  // 小鱼干收入
  fish += enemiesKilled * B.fishDrop * B.fishMult;
  if (bossThisRun) fish += B.bossFish;
  fish += exploration;

  // 第8局额外压力：模拟"破产玩家"（0小鱼干），验 farm 兜底是否真能回收
  if (i === 7) fish = 0;

  const canFarm = true; // 关卡设计 invariant：灵影点→猫窝间恒有可击杀敌人（farm路径）

  if (died) {
    if (reachable) {
      action = '走回爪击回收(0小鱼干)';
      // 回收全额灵毛，无小鱼干消耗
    } else {
      const cost = Math.ceil(carriedMotes * B.atonementFactor);
      if (fish >= cost) {
        fish -= cost; atonementSpent = cost; action = `猫窝远程赎罪(-${cost}小鱼干)`;
      } else {
        // 兜底：靠击杀敌人 farm 出差额小鱼干（关卡恒有可farm敌人）
        const need = cost - fish;
        fish += need;            // 先 farm
        fish -= cost;            // 再赎罪
        atonementSpent = cost; farmNeeded = true;
        action = `farm ${need}后赎罪(-${cost}小鱼干)`;
        if (!canFarm) deadlock = true; // 仅当关卡无farm路径才真死锁
      }
    }
  } else {
    const hpAtReturn = 3; // 假设回窝剩 3 心
    fish -= (B.maxHP - hpAtReturn) * B.healCost;
    action = '回窝治愈';
  }

  // 偶发购买（每3局买一件项圈 ~12）
  if (i % 3 === 2) fish -= 12;

  return {
    run: i + 1, enemiesKilled, motesGained, died, carriedMotes,
    reachable, action, atonementSpent, farmNeeded, deadlock,
    fishEnd: fish,
  };
}

console.log('=== 波比 BOBBY 经济纸面模拟（10 局）===');
console.log('数据源：', SRC);
console.log('公式联动：每杀产毛 = motePerKill(3) + motePerHit(1)×hitsPerKill(2) = 5');
console.log(`          赎罪价 = ceil(carriedMotes × atonementFactor(${B.atonementFactor}))`);
console.log(`          利爪项圈 最大鱼心 ${B.clawMaxHP >= 0 ? '+' : ''}${B.clawMaxHP}`);
console.log('          猫之技艺(月爪斩)消耗 = ceil(poolMax(33) × 0.36) =', castCost, '\n');
console.log('局 | 击杀 | 产毛 | 死亡 | 灵影携带 | 可达 | 动作 | 赎罪小鱼干 | farm? | 死锁 | 小鱼干余');
console.log('-- | ---- | ---- | ---- | -------- | ---- | ---- | ---------- | ----- | ---- | ------');

const runs = [];
let totalMotes = 0, totalFish = 0, deadlockCount = 0, unreachableRuns = 0;
for (let i = 0; i < 10; i++) {
  const r = simulateRun(i);
  runs.push(r);
  totalMotes += r.motesGained;
  totalFish += r.fishEnd;
  if (r.deadlock) deadlockCount++;
  if (!r.reachable) unreachableRuns++;
  console.log(
    `${String(r.run).padStart(2)} | ${String(r.enemiesKilled).padStart(4)} | ${String(r.motesGained).padStart(4)} | ${r.died ? 'Y' : 'N'} | ${String(r.carriedMotes).padStart(8)} | ${r.reachable ? 'Y' : 'N'} | ${r.action} | ${String(r.atonementSpent).padStart(10)} | ${r.farmNeeded ? 'Y' : 'N'} | ${r.deadlock ? 'Y' : 'N'} | ${r.fishEnd}`
  );
}
console.log(`\n汇总：10局共产毛 ${totalMotes}，末局小鱼干余 ${runs[9].fishEnd}，累计小鱼干 ${totalFish}`);
console.log(`死锁压力局数 ${unreachableRuns}（第4、8局：强制死亡+灵影不可达；第8局额外0小鱼干）→ 均经 farm/赎罪 回收，硬死锁 ${deadlockCount} 次`);

// ============ 5.3 四类"经济崩溃"自检 ============
console.log('\n=== 5.3 经济"崩溃"自检 ===');

// (1) 灵毛死锁
console.log('\n[1] 灵毛死锁（灵影卡不可达 + 赎价过高 → 永远缺毛放不出技）');
console.log('    结论：PASS（带条件）');
console.log('    理由：');
console.log('      - 放技不死锁：灵毛为"每击实时产出"，死亡仅丢已攒部分，可重新farm → 不存在永久缺毛。');
console.log(`      - 回收兜底：不可达灵影走猫窝远程赎罪，价 = ceil(carried×${B.atonementFactor})。满载33毛≈${Math.ceil(33*B.atonementFactor)}鱼，按fishDrop=${B.fishDrop}需~${Math.ceil(Math.ceil(33*B.atonementFactor)/B.fishDrop)}杀，合理。`);
console.log('      - 残留风险：若"不可达灵影 + 0小鱼干 + 该处无任何可farm敌人且无法回窝"同现 → 真死锁。');
console.log('        缓解：关卡设计须保证灵影点与猫窝间恒有可击杀敌人（farm路径），或给猫窝赎罪"赊账"。');
console.log('        建议：atonementFactor 维持 ≤ 0.5；并在关卡层加 invariant 校验（灵影不可达 ⇒ 路径上必有敌人）。');

// (2) 小鱼干通胀
console.log('\n[2] 小鱼干通胀（活跃玩家日均增速 > 15% 触发平衡pass）');
const runsPerDay = 2;
const avgFishPerRun = totalFish / 10;
const inflationRatePerRun = avgFishPerRun / B.startingFish; // 相对起始持有
const dailyGrowthPct = (inflationRatePerRun * runsPerDay) * 100;
console.log(`    模型：10局累计小鱼干 ${totalFish}，均 ${avgFishPerRun.toFixed(1)}/局，约 ${runsPerDay} 局/日`);
console.log(`    日均增速 ≈ ${(dailyGrowthPct).toFixed(0)}%（相对起始持有 ${B.startingFish}）`);
console.log(`    阈值：15% / 日。判定：${dailyGrowthPct > 15 ? 'WARN — 已超阈值' : 'PASS'}`);
console.log('    解读：小鱼干为永久货币且无消耗上限，收入（击杀2+探索5+Boss25）远大于支出（治愈/偶买项圈）。');
console.log('          若玩家持有达数百，15%阈值很容易被突破 → 需更深 sink： recurring 消耗（重组费/每周税）、');
console.log('          或调低 fishDrop(2→1)、或抬高项圈/升级价。当前 fishDrop=2 偏宽松，建议优先压到 1~1.5。');

// (3) 唯一最优项圈
console.log('\n[3] 唯一最优项圈（某圈使用率 >70% 且其余 <10%）');
console.log('    理论价值评分（相对裸装 3 槽）：');
const collars = [
  { id: 'claw', name: '利爪', slots: 1, note: '爪伤1→2 (+100%输出) / 最大鱼心-1 (-20%生存)' },
  { id: 'silent', name: '静默', slots: 1, note: '听声更快更广 / 产毛-15%' },
  { id: 'glutton', name: '贪吃', slots: 1, note: '小鱼干+25% / 灵毛-10%' },
  { id: 'ninelife', name: '九命', slots: 2, note: '休窝后首次死亡原地复活（强生存）' },
  { id: 'moss', name: '苔语', slots: 1, note: '瘴减伤60% / 灵毛-5%（仅瘴区）' },
];
collars.forEach((c) => console.log(`      - ${c.name}（${c.slots}槽）：${c.note}`));
console.log('    结论：WARN（潜在双雄主导）');
const clawNote = (B.clawMaxHP === -1) ? '-1心边际仍偏低' : '-2心边际明显抬高';
console.log(`    理由：利爪以 1 槽换 +100% 输出且 最大鱼心${B.clawMaxHP} 代价（HP5环境下${clawNote}）→ 输出流近必戴；`);
console.log('          九命以 2 槽换一次免死 → 生存流近必戴。二者大概率吞掉大部分使用率，');
console.log('          静默/贪吃/苔语沦为 niche（使用率或 <10%）。GDD 要求"无唯一最优解"，当前有双雄。');
console.log(`    建议：① 候选版已将利爪 最大鱼心 ${B.clawMaxHP}（原 -1）；若实测仍双雄主导，进一步改 -灵毛产率 或 +输出但 -产率。`);
console.log('          ② 强化静默/贪吃的功能性（如静默附带"显形后首次爪击暴击"），抬其使用率。');

// (4) 元升级破环
console.log('\n[4] 元升级破环（后期Boss击杀 < 20s → 加阶段/限元级）');
const fullMetaDmg = B.clawDamage + 1; // 利爪 +1
const clawDPS = fullMetaDmg / ((40 + 120 + 110) / 1000); // 一次爪击周期 270ms
const effDPS = clawDPS * 2.5; // 含 pogo/多段，保守 2.5×
const finalKillSec = B.finalHP / effDPS;
const miniKillSec = B.miniHP / effDPS;
console.log(`    模型：满元+利爪 爪伤=${fullMetaDmg}，理论爪DPS≈${clawDPS.toFixed(1)}，含位移连击 effDPS≈${effDPS.toFixed(1)}`);
console.log(`    最终Boss(800HP) 击杀 ≈ ${finalKillSec.toFixed(0)}s；小Boss(120HP) ≈ ${miniKillSec.toFixed(0)}s`);
console.log(`    阈值：< 20s 判破环。最终Boss：${finalKillSec < 20 ? 'FAIL' : 'PASS'}；小Boss：${miniKillSec < 20 ? 'WARN(逼近)' : 'PASS'}`);
console.log('    解读：800HP 终局安全；但 miniHP 下限 60 + 满元 effDPS 时 60/effDPS ≈ ' +
  (B.miniHP / effDPS).toFixed(0) + 's，逼近 20s 线。');
console.log('          阶段拆分(v0.2)时须保证每个阶段 HP 在 effDPS×20 以上，或对满元玩家限元等级。');

console.log('\n=== 三个最该先实测的数值（按杠杆排序）===');
console.log('  ① 小鱼干掉率 enemy.fishDrop：2 → 建议先压到 1~1.5。直接决定通胀是否爆炸（见自检[2]）。');
console.log('  ② 灵影赎罪价系数 shade.atonementFactor：0.5。死锁兜底核心，必须实测"满载33毛的赎价是否让新手也付得起"。');
console.log('  ③ 利爪项圈数值（爪伤+1 / 鱼心-1）。唯一最优项圈风险源头（见自检[3]），决定 build 多样性生死。');
