// Rng：种子化随机（mulberry32）。用于肉鸽重组（GDD 第3节）：同一 seed 必产同一布局，便于调试复现。
// 支持数字/字符串种子；返回 [0,1) 的纯函数 rnd()。另提供 range/int/pick 便捷封装。
export class Rng {
  // seed: number | string。字符串走 xfnv1a 散列成 32 位整数种子。
  constructor(seed) {
    this.seed = Rng.normalize(seed);
    this._s = this.seed >>> 0;
  }

  static normalize(seed) {
    if (typeof seed === 'number') return seed >>> 0;
    if (typeof seed === 'string') return Rng.hashString(seed);
    return (Date.now() >>> 0) ^ 0x9e3779b9;
  }

  static hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // 主生成器：mulberry32
  next() {
    let t = (this._s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // [min, max) 浮点
  range(min, max) {
    return min + this.next() * (max - min);
  }

  // [min, max] 整数（含端点）
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  // 从数组随机取一个
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }

  // 打乱（Fisher–Yates），返回新数组
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

// 便捷构造：无种子则取随机种子（用于"每次重进重组"）。
export function makeSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0);
}
