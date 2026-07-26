// Enemy：基础小怪（GDD 4.4 配套）。有 HP、受击硬直、接触伤害玩家、死亡掉小鱼干+产灵毛。
// 由场景注入 onKilled 回调（发鱼 + 产毛）。可被 Player.checkHits 命中（sprite.kind='enemy'）。
export class Enemy {
  constructor(scene, x, y, balance, onKilled) {
    this.scene = scene;
    this.balance = balance || {};
    const e = this.balance.enemy || {};
    this.maxHP = e.hp ?? 5;
    this.hp = this.maxHP;
    this.contactDamage = e.contactDamage ?? 1;
    this.hitstunMs = e.hitstunMs ?? 200;
    this.onKilled = onKilled;
    this.dead = false;
    this.hurtCooldown = 0;
    this.blightDmgBonus = 0;   // 瘴中接触伤害加成（GDD 4.7）
    this.blightSpeedBonus = 0; // 瘴中追击速度加成
    this.inBlight = false;

    this.sprite = scene.add.rectangle(x, y, 30, 34, 0xc46b5b).setDepth(10);
    scene.physics.add.existing(this.sprite);
    this.sprite.body.setCollideWorldBounds(true);
    this.sprite.kind = 'enemy';
    this.sprite.ref = this;

    this.eye = scene.add.rectangle(x, y - 5, 16, 6, 0x2a1010).setDepth(11);
    this.hpBarBg = scene.add.rectangle(x, y - 26, 30, 4, 0x222222).setDepth(11).setOrigin(0, 0.5);
    this.hpBar = scene.add.rectangle(x, y - 26, 30, 4, 0x4cd964).setDepth(12).setOrigin(0, 0.5);
  }

  get x() {
    return this.sprite.x;
  }
  get y() {
    return this.sprite.y;
  }

  // 当前接触伤害（含瘴加成），由场景 overlap 时调用
  getContactDamage() {
    return this.contactDamage * (1 + this.blightDmgBonus);
  }

  takeHit(dmg, fromX) {
    if (this.dead) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.hurtCooldown = this.hitstunMs;
    // 受击硬直：闪白 + 轻微击退
    this.sprite.setFillStyle(0xffffff);
    this.scene.time.delayedCall(90, () => {
      if (!this.dead) this.sprite.setFillStyle(0xc46b5b);
    });
    const dir = Math.sign(this.sprite.x - fromX) || 1;
    this.sprite.body.setVelocityX(dir * 120);
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
    this.sprite.setFillStyle(0x553333);
    this.scene.tweens.add({
      targets: [this.sprite, this.eye, this.hpBar, this.hpBarBg],
      alpha: 0,
      scale: 0.6,
      duration: 200,
      onComplete: () => {
        this.sprite.destroy();
        this.eye.destroy();
        this.hpBar.destroy();
        this.hpBarBg.destroy();
      },
    });
    if (this.onKilled) this.onKilled(this);
  }

  update(time, delta, player) {
    if (this.dead) return;
    if (this.hurtCooldown > 0) this.hurtCooldown -= delta;
    // 简单追击 AI（受击硬直期间不追）；瘴中提速
    if (this.hurtCooldown <= 0 && player && !player.dead) {
      const d = Phaser.Math.Distance.Between(this.x, this.y, player.sprite.x, player.sprite.y);
      const aggro = this.balance.enemy?.aggroRange ?? 300;
      const sp = (this.balance.enemy?.chaseSpeed ?? 70) * (1 + this.blightSpeedBonus);
      if (d < aggro) {
        const ang = Math.atan2(player.sprite.y - this.y, player.sprite.x - this.x);
        this.sprite.body.setVelocity(Math.cos(ang) * sp, this.sprite.body.velocity.y);
      } else {
        this.sprite.body.setVelocityX(0);
      }
    }
    // 瘴染色：染紫 + 描边（GDD 4.7 增强敌人视觉）
    if (this.inBlight) {
      this.sprite.setFillStyle(0x9b4f8f);
      this.sprite.setStrokeStyle(2, 0xd08fff);
    } else {
      this.sprite.setStrokeStyle(0);
    }
    this.eye.setPosition(this.sprite.x, this.sprite.y - 5);
    this.updateHpBar();
  }

  updateHpBar() {
    const w = Math.max(0, 30 * (this.hp / this.maxHP));
    this.hpBar.width = w;
    this.hpBar.setPosition(this.sprite.x - 15, this.sprite.y - 26);
    this.hpBarBg.setPosition(this.sprite.x - 15, this.sprite.y - 26);
  }
}
