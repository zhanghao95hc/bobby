// Save：进度存档（localStorage）。GDD 4.5/5.1：猫窝存进度、小鱼干/记忆绒毛永久保留。
// profile 结构（与 balance.collar / balance.currency 的默认值合并，缺字段回退）：
//   fish, fluff, ownedCollars[], equippedCollars[], maskLevel, regions{}, firstRunDone, mapBought,
//   bossesDefeated[], meta{unlocked:{id:rank}}, milestones[], onboarding{claw,pogo,listen,explore,hook,shade}
const KEY = 'bobby_profile_v1';

export class Save {
  static defaults(balance) {
    const c = balance?.collar || {};
    const cur = balance?.currency || {};
    return {
      fish: cur.startingFish ?? 0,
      fluff: cur.startingFluff ?? 0,
      ownedCollars: c.startingOwned ? [...c.startingOwned] : [],
      equippedCollars: c.startingOwned ? [...c.startingOwned] : [],
      maskLevel: 0,
      regions: { 绒毛巢: 100, 沉眠回廊: 0 },
      firstRunDone: false,
      mapBought: false,
      bossesDefeated: [],
      meta: { unlocked: {} },
      milestones: [],
      everLostShade: false, // 终局结局判定：是否曾遗弃过灵影(被新死亡吸收)
      ending: null, // 已触发的结局分支 id：slumber | flame | silence
      onboarding: { claw: false, pogo: false, listen: false, explore: false, hook: false, shade: false },
    };
  }

  static load(balance) {
    let p = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) p = JSON.parse(raw);
    } catch (e) {
      p = null;
    }
    const def = Save.defaults(balance);
    if (!p || typeof p !== 'object') return def;
    // 合并，保证老存档缺字段也能跑
    const meta = p.meta && typeof p.meta === 'object' ? p.meta : {};
    return {
      fish: typeof p.fish === 'number' ? p.fish : def.fish,
      fluff: typeof p.fluff === 'number' ? p.fluff : def.fluff,
      ownedCollars:
        Array.isArray(p.ownedCollars) && p.ownedCollars.length ? p.ownedCollars : def.ownedCollars,
      equippedCollars: Array.isArray(p.equippedCollars) ? p.equippedCollars : def.equippedCollars,
      maskLevel: typeof p.maskLevel === 'number' ? p.maskLevel : def.maskLevel,
      regions: p.regions && typeof p.regions === 'object' ? p.regions : def.regions,
      firstRunDone: !!p.firstRunDone,
      mapBought: !!p.mapBought,
      bossesDefeated: Array.isArray(p.bossesDefeated) ? p.bossesDefeated : def.bossesDefeated,
      meta: { unlocked: meta.unlocked && typeof meta.unlocked === 'object' ? meta.unlocked : {} },
      milestones: Array.isArray(p.milestones) ? p.milestones : def.milestones,
      everLostShade: !!p.everLostShade,
      ending: typeof p.ending === 'string' ? p.ending : null,
      onboarding: Save._mergeOnboarding(p.onboarding, def.onboarding),
    };
  }

  // 引导进度按 key 合并，老存档缺某项回退默认 false
  static _mergeOnboarding(o, def) {
    const out = { ...def };
    if (o && typeof o === 'object') {
      for (const k of Object.keys(def)) {
        if (typeof o[k] === 'boolean') out[k] = o[k];
      }
    }
    return out;
  }

  static save(profile) {
    try {
      localStorage.setItem(KEY, JSON.stringify(profile));
      return true;
    } catch (e) {
      return false;
    }
  }

  static wipe() {
    try {
      localStorage.removeItem(KEY);
    } catch (e) {}
  }
}
