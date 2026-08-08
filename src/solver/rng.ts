/**
 * seed 固定の決定的 PRNG（mulberry32）。
 *
 * Python プロトタイプは `random.Random`（Mersenne Twister）を使っているが、
 * 同じ乱数列を JS 側で再現することはできない。よって「Python と同一の解」は
 * 移植の目標にせず、TS 内での再現性のみを担保する。
 * 解の正しさは制約違反ゼロ・均等性という性質でテストする。
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** [0, 1) の実数 */
  float(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** [0, n) の整数 */
  int(n: number): number {
    return Math.floor(this.float() * n)
  }
}
