# 波比 · 阶段8 验收：区域1 小 Boss「锈齿鼠王」

> 参考 GDD v0.1 第7节（进度曲线骨架）。实现 Boss 战框架，验证 2 阶段 + 招式表驱动。
> 验收日期：2026-07-26

## 交付清单

| 文件 | 作用 |
|------|------|
| `src/entities/Boss.js` | 鼠王实体：2 阶段、招式表驱动、阶段切换、受击/硬直、死亡回调 |
| `src/scenes/BossScene.js` | Boss 房：进房锁门、阶段2召唤幼鼠、击败掉落、禁用猫窝安窝、死亡循环（灵影+远程赎罪） |
| `src/ui/Hud.js` | 新增 `showBossBar(name,hp,maxHP,phase)` / `hideBossBar()` |
| `src/systems/Sfx.js` | 新增 `growl / bite / dash / summon / phaseShift` 占位音 |
| `data/balance.json` | `boss.rustooth` 块：HP/阈值/招式表/奖励全可读 |
| `src/main.js` | 注册 `BossScene` |
| `src/scenes/FuzzNestScene.js` | 教学区加 `B` 键进 Boss 战 |

## 对照需求逐项

1. **Boss 房锁门** ✅
   - 玩家 x>220 踏过竞技场中线 → `lockArena()`：左侧落下铁闸（物理碰撞）+ 屏震 + 低吼 → Boss 激活。
   - 击败后铁闸消失（开门），可离开。

2. **2 阶段（HP 120，阈值 50%）** ✅
   - `boss.rustooth.hp = 120`，`phase2Threshold = 0.5`（均读 `balance.json`，标注 `[PLACEHOLDER]`）。
   - 血量 ≤ 60 自动 `enterPhase2()`：短无敌(1.2s) + 全屏闪 + 低吼 + 顶部提示「第二阶段」。

3. **每阶段一套招式 + 招式表数据** ✅
   - 招式完全由 `balance.boss.rustooth.moves` 驱动：
     - 阶段1：`["dashBite"]`（冲刺咬）
     - 阶段2：`["dashBite","summon"]`（冲刺咬 + 召唤 2 只幼鼠）
   - 每个招式参数独立成块（`dashBite.*` / `summon.*`：telegraph/active/recover 时长、speed、damage、count 等）。
   - 招式调度：telegraph（红框+方向箭头预警）→ active（执行）→ recover → 冷却 → 随机下一招。
   - **v0.2 扩展点**：在 `moves.p2` 追加招式名 + 在 `cfg` 加对应参数块 + 在 `Boss.update` 的 `enterActive` 加一个分支即可，无需改框架。终局多阶段只需把 `phase2Threshold` 思路推广成 N 阶段数组。

4. **击败掉落：小鱼干 + 记忆绒毛接口** ✅
   - `fishReward = 25` 立即进小鱼干；`fluffReward = 1` 记入 `this.fluff`（已是三层货币之一，持久化到 localStorage）。
   - 记忆绒毛的**消费端（猫神祭坛）**留待阶段9；此处只负责「掉+记」，并在提示行写明「阶段9接入祭坛」——满足「先留接口/字段」。

5. **Boss 房禁用猫窝安窝** ✅
   - `BossScene` 不创建猫窝实体/菜单（GDD 4.5 边界）。
   - 死亡循环仍兼容：死亡 → 灵影携灵毛在死亡点生成 → 700ms 后在房门口重生（非猫窝）；可按 `B` 远程赎罪（防死锁兜底）。

6. **手感：紧张但不劝退** ✅
   - 冲刺咬仅在 active 阶段造成伤害，玩家可贴脸爪击、可空中下扑踩王弹起（pogo）。
   - 招式前摇 520ms 红框+箭头预警，给反应窗口；阶段1 冷却 1.5s 留喘息。
   - 占位音：低吼/咬/冲刺 whoosh/召唤/阶段切换钢声；命中极轻屏震。

## 操作（Boss 房）
- `A/D` 移动 · `空格` 跳 · `J` 爪击(空中=下扑踩王弹起) · `K` 扑袭 · `B` 远程赎罪（灵影）
- 进房后**向右走**触发锁门开战；`T` 回教学区 · `R` 再战

## 测试路径建议
1. 教学区按 `B` 进 Boss 房 → 右走到中线看门落锁 + Boss 苏醒。
2. 爪击消耗 120 HP（每击=项圈派生爪伤，默认1）；注意冲刺咬的红框预警，预警时撤退/跳跃躲避。
3. 血量到 60 看阶段切换（闪红 + 低吼 + 召唤 2 幼鼠）。
4. 击败 → 门开 + 小鱼干+25、记忆绒毛+1 → 按 `T` 回教学区（记忆绒毛已存档）。
5. 故意送死 → 灵影生成 + 门口重生；按 `B` 赎罪或走回去杀灵影回收。

## 已知边界 / 后续
- 招式表目前仅 2 招；冲刺咬为直线，幼鼠为复用 Enemy，手感待实测调时长和 speed。
- 记忆绒毛暂无消费端（阶段9 祭坛）。
- Boss 无独立美术（占位锈棕方块+王冠+尖牙）；阶段13 换皮。
- `fluffReward` 已落 currency 层，阶段9 只需在祭坛读取 `profile.fluff` 即可花费。
