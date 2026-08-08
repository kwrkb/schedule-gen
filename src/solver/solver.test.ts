import { describe, expect, it } from 'vitest'
import { REST, Solver, makeLabels } from './solver'
import { generate } from './generate'

const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs)

describe('makeLabels', () => {
  it('シフト数に応じて順序性のあるラベルを返す', () => {
    expect(makeLabels(1)).toEqual(['日勤'])
    expect(makeLabels(2)).toEqual(['早', '遅'])
    expect(makeLabels(3)).toEqual(['早', '中1', '遅'])
    expect(makeLabels(5)).toEqual(['早', '中1', '中2', '中3', '遅'])
  })
})

describe('解なし判定', () => {
  it('人数がシフト数より少なければ解なしと判定する', () => {
    const { ok, message } = new Solver(2, 3, 30).feasible()
    expect(ok).toBe(false)
    expect(message).toContain('全シフトを埋められません')
  })

  it('generate は結果を返さずメッセージを返す', () => {
    const { result, message } = generate(2, 3, 30)
    expect(result).toBeNull()
    expect(message).toContain('全シフトを埋められません')
  })
})

describe('決定性', () => {
  it('同じ seed なら同じ解を返す', () => {
    const run = () => generate(8, 3, 30, { seed: 1 }).result?.grid
    expect(run()).toEqual(run())
  })
})

// VISION 記載の検証ケース。Python プロトタイプと同一の乱数列は再現できないため、
// 「ハード制約違反ゼロ」「出勤日数・遅番回数がほぼ均等」という性質で検証する。
const CASES = [
  { P: 8, S: 3, D: 30 },
  { P: 12, S: 4, D: 30 },
  { P: 20, S: 3, D: 31 },
  { P: 50, S: 4, D: 31 },
  { P: 5, S: 2, D: 30 },
  { P: 30, S: 5, D: 31 },
  { P: 6, S: 2, D: 28 },
] as const

// 単発の焼きなましは局所最適に落ちることがあるため、複数の基準シードで確認する。
const SEEDS = [0, 1, 2, 3, 4] as const

describe.each(CASES)('$P人 × $S シフト × $D日', ({ P, S, D }) => {
  const runs = SEEDS.map((seed) => {
    const { result } = generate(P, S, D, { seed })
    if (result === null) throw new Error('解が得られませんでした')
    return result
  })

  it('ハード制約違反がない', () => {
    for (const r of runs) {
      expect(r.violations).toEqual({ cover: 0, consec: 0, interval: 0 })
    }
  })

  it('出勤日数の幅が1日以内', () => {
    for (const r of runs) expect(spread(r.works)).toBeLessThanOrEqual(1)
  })

  it('遅番回数の幅が1回以内', () => {
    for (const r of runs) expect(spread(r.lates)).toBeLessThanOrEqual(1)
  })

  it('グリッドの形と値域が正しい', () => {
    for (const r of runs) {
      expect(r.grid).toHaveLength(P)
      expect(r.labels).toHaveLength(S)
      for (const row of r.grid) {
        expect(row).toHaveLength(D)
        for (const v of row) {
          expect(v).toBeGreaterThanOrEqual(REST)
          expect(v).toBeLessThanOrEqual(S)
        }
      }
    }
  })

  it('各シフトに毎日1人以上いる', () => {
    for (const r of runs) {
      for (let d = 0; d < D; d++) {
        const present = new Set(r.grid.map((row) => row[d]))
        for (let s = 1; s <= S; s++) expect(present).toContain(s)
      }
    }
  })

  it('Python プロトタイプ(最大2.84s)より速い', () => {
    for (const r of runs) expect(r.elapsedMs).toBeLessThan(2840)
  })
})
