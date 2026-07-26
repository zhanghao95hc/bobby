# 波比 (BOBBY) — 开发工程

银河恶魔城 × 元进度肉鸽。阶段 1：项目骨架（Phaser 3 + HTML5）。

## 目录结构

```
Bobby/
├── index.html              # 入口，CDN 加载 Phaser 3，挂载 #game
├── README.md               # 本文件
├── data/
│   └── balance.json        # GDD 平衡表初值（唯一数值源，后续不要硬编码）
├── src/
│   ├── main.js             # 创建 Phaser.Game，注册场景
│   ├── scenes/
│   │   ├── BootScene.js    # 加载 balance.json 存入 registry
│   │   └── GameScene.js    # 空场景：黑底 + 波比方块 + 地面 + HUD
│   ├── entities/
│   │   └── Player.js       # 波比占位实体（移动/跳跃）
│   ├── systems/            # 后续系统（战斗/经济/听声…）放这里
│   └── ui/
│       └── Hud.js          # 调试 HUD（坐标 + FPS）
└── assets/
    ├── sprites/            # 占位美术（后续替换）
    ├── audio/
    └── tiles/
```

## 本地启动

任意静态服务器即可（ES 模块需经 http 提供，不能直接 file:// 打开）。

使用内置 Python（推荐，无需安装）：

```bash
cd Bobby
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

或 Node：

```bash
cd Bobby
npx serve -l 8000
```

## 当前可玩内容

- 黑色背景 + 蓝灰占位方块（波比）+ 地面平台
- 方向键 / WASD 移动，上 / W 跳跃
- 左上角 HUD 显示坐标与 FPS
- balance.json 已被 BootScene 加载进 `registry.balance`，后续阶段直接读取

## 下一步（阶段 2）

在 `src/entities/Player.js` 扩展爪击 / 扑袭，数值从 `registry.balance` 读取，详见 GDD 第 4.1/4.2 节。
