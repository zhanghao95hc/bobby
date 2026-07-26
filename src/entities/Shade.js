// Shade：灵影（GDD 4.4）。玩家死亡时在死亡点生成，携带未消耗灵毛；击杀回收。
// 强度=生前 70%（contactDamage*strengthPct）；可被 Player 爪击击杀（sprite.kind='shade'）。
// 死锁兜底：① 再次死亡时由场景把旧灵影毛量并入新灵影（见 CombatTestScene.onPlayerDeath）
//          ② 卡不可达时由场景提供"远程赎罪"接口（花费小鱼干回收，见 remoteAtonement）
export class Shade {
  constructor(scene, x, y, motes, balance, onKilled) {
    this.scene = scene;
    this.balance = balance || {};
    const sh = this.balance.shade || {};
    this.carried = motes; // 携带的灵毛（回收时返还）
    this.strengthPct = sh.strengthPct ?? 0.7;
    this.maxHP = sh.selfHP ?? 4;
    this.hp = this.maxHP;
    this.contactDamage = (this.balance.enemy?.contactDamage ?? 1) * this.strengthPct;
    this.onKilled = onKilled;
    this.dead = false;
    this.hurtCooldown = 0;

    this.sprite = scene.add.rectangle(x, y, 26, 30, 0x9b6bff, 0.85).setDepth(10);
    this.sprite.setStrokeStyle(2, 0xd0b0ff);
    scene.physics.add.existing(this.sprite);
    this.sprite.body.setCollideWorldBounds(true);
    this.sprite.kind = 'shade';
    this.sprite.ref = this;

    this.hpBarBg = scene.add.rectangle(x, y - 22, 26, 4, 0x222222).setDepth(11).setOrigin(0, 0.5);
    this.hpBar = scene.add.rectangle(x, y - 22, 26, 4, 0xbb88ff).setDepth(12).setOrigin(0, 0.5);
  }

  get x() {
    return this.sprite.x;
  }
  get y() {
    return this.sprite.y;
  }

  takeHit(dmg, fromX) {
    if (this.dead) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.hurtCooldown = 150;
    this.sprite.setFillStyle(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (!this.dead) this.sprite.setFillStyle(0x9b6bff);
    });
    this.updateHpBar();
    if (this.hp <= 0) {
      this.kill();
      return true;
    }
    return false;
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.sprite.destroy();
    this.hpBar.destroy();
    this.hpBarBg.destroy();
    if (this.onKilled) this.onKilled(this);
  }

  update(time, delta, player) {
    if (this.dead) return;
    if (this.hurtCooldown > 0) this.hurtCooldown -= delta;
    // 缓慢飘向玩家，可被击杀回收
    if (player && !player.dead) {
      const d = Phaser.Math.Distance.Between(this.x, this.y, player.sprite.x, player.sprite.y);
      if (d < 360) {
        const ang = Math.atan2(player.sprite.y - this.y, player.sprite.x - this.x);
        const sp = 40;
        this.sprite.body.setVelocity(Math.cos(ang) * sp, this.sprite.body.velocity.y);
      } else {
        this.sprite.body.setVelocityX(0);
      }
    }
    this.updateHpBar();
  }

  updateHpBar() {
    const w = Math.max(0, 26 * (this.hp / this.maxHP));
    this.hpBar.width = w;
    this.hpBar.setPosition(this.sprite.x - 13, this.sprite.y - 22);
    this.hpBarBg.setPosition(this.sprite.x - 13, this.sprite.y - 22);
  }
}
