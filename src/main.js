// 入口：创建 Phaser.Game，注册场景。
// 注意：Phaser 为全局变量（由 index.html 的 CDN script 提供）。
import { BootScene } from './scenes/BootScene.js';
import { FuzzNestScene } from './scenes/FuzzNestScene.js';
import { CombatTestScene } from './scenes/CombatTestScene.js';
import { BlightTestScene } from './scenes/BlightTestScene.js';
import { BossScene } from './scenes/BossScene.js';
import { GameScene } from './scenes/GameScene.js';
import { AltarScene } from './scenes/AltarScene.js';
import { TempleScene } from './scenes/TempleScene.js';
import { LordScene } from './scenes/LordScene.js';

const config = {
  type: Phaser.AUTO,
  width: 960,
  height: 540,
  parent: 'game',
  backgroundColor: '#0a0a12',
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 900 }, debug: false },
  },
  scene: [BootScene, FuzzNestScene, CombatTestScene, BlightTestScene, BossScene, GameScene, AltarScene, TempleScene, LordScene],
};

// 暴露到 window，方便调试与后续系统接入。
window.game = new Phaser.Game(config);
