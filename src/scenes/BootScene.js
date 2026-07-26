// BootScene：加载平衡表（GDD 初值）与进度存档，存入 registry，再进入 GameScene。
import { Save } from '../systems/Save.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // 路径相对 index.html（项目根），静态服务器下为 /data/balance.json
    this.load.json('balance', 'data/balance.json');
  }

  create() {
    const balance = this.cache.json.get('balance');
    if (!balance) {
      console.error('[Boot] 未能加载 balance.json，请确认 data/balance.json 存在且可访问。');
    }
    // 全局可读的平衡数据源（后续阶段从 registry 取，不要硬编码）
    this.registry.set('balance', balance);
    // 进度存档（GDD 4.5/5.1）：猫窝存进度、小鱼干/记忆绒毛永久保留
    if (!this.registry.get('profile')) {
      // Save 延迟引入以避免循环依赖风险（纯静态方法，安全）
      const profile = Save.load(balance);
      this.registry.set('profile', profile);
    }
    this.scene.start('FuzzNest');
  }
}
