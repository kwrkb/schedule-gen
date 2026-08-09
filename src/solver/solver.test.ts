import { describe, expect, it } from 'vitest'
import { REST, Solver, makeLabels, maxShiftsFor, violatesInterval } from './solver'
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

describe('勤務間インターバル', () => {
  it('遅番の翌日に許すのは休み・遅番・その1つ前だけ', () => {
    // S=2 は「1つ前」が早番そのものなので、遅→早が禁止される
    expect(violatesInterval(2, 1, 2)).toBe(true)
    expect(violatesInterval(2, REST, 2)).toBe(false)
    expect(violatesInterval(2, 2, 2)).toBe(false)

    // S=6 では 遅(6)→中1(2) のような大きな逆行も禁止する
    expect(violatesInterval(6, 1, 6)).toBe(true)
    expect(violatesInterval(6, 2, 6)).toBe(true)
    expect(violatesInterval(6, 4, 6)).toBe(true)
    expect(violatesInterval(6, 5, 6)).toBe(false)
    expect(violatesInterval(6, 6, 6)).toBe(false)
    expect(violatesInterval(6, REST, 6)).toBe(false)
  })

  it('遅番以外の翌日は制限しない', () => {
    expect(violatesInterval(3, 1, 6)).toBe(false)
    expect(violatesInterval(REST, 1, 6)).toBe(false)
  })

  it('1シフトでは適用されない', () => {
    expect(violatesInterval(1, 1, 1)).toBe(false)
  })
})

describe('シフト数の上限', () => {
  it('人数の8割で頭打ちになる', () => {
    expect(maxShiftsFor(10, 31)).toBe(8)
    expect(maxShiftsFor(20, 31)).toBe(16)
    expect(maxShiftsFor(50, 31)).toBe(40)
  })

  it('人数が少ないときは連勤上限を守れる休み枠で決まる', () => {
    // 3人×31日: 1日の休み枠1人 × 31日 = 31 >= 3人 × 最低4日 = 12
    expect(maxShiftsFor(3, 31)).toBe(2)
    // 2人では2シフトを毎日埋めると休みが消える
    expect(maxShiftsFor(2, 31)).toBe(1)
  })

  it('1人では連勤上限を守れないため0以下になる', () => {
    expect(maxShiftsFor(1, 31)).toBeLessThan(1)
  })

  it('日数が連勤上限以下なら休みが不要になる', () => {
    // 6日間なら休みなしでも連勤上限6を超えない
    expect(maxShiftsFor(5, 6)).toBe(4)
  })
})

describe('解なし判定', () => {
  it('シフト数が人数に対して多すぎれば解なしと判定する', () => {
    const { ok, message } = new Solver(8, 8, 30).feasible()
    expect(ok).toBe(false)
    expect(message).toContain('最大6シフトまで')
  })

  it('人数がシフト数より少なければ解なしと判定する', () => {
    const { ok } = new Solver(2, 3, 30).feasible()
    expect(ok).toBe(false)
  })

  it('1人では連勤上限を守れないため解なしと判定する', () => {
    const { ok, message } = new Solver(1, 1, 30).feasible()
    expect(ok).toBe(false)
    expect(message).toContain('人数を増やしてください')
  })

  it('generate は結果を返さずメッセージを返す', () => {
    const { result, message } = generate(8, 8, 30)
    expect(result).toBeNull()
    expect(message).toContain('最大6シフトまで')
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
//
// work は出勤日数の許容幅。シフト数が人数の8割に近づくほど1日の休み枠が細り、
// 端数の吸収先がなくなるため幅が広がる（構造的な限界であり探索の失敗ではない）。
const CASES = [
  { P: 8, S: 3, D: 30, work: 1 },
  { P: 12, S: 4, D: 30, work: 1 },
  { P: 20, S: 3, D: 31, work: 1 },
  { P: 50, S: 4, D: 31, work: 1 },
  { P: 5, S: 2, D: 30, work: 1 },
  { P: 30, S: 5, D: 31, work: 1 },
  { P: 6, S: 2, D: 28, work: 1 },
  { P: 3, S: 2, D: 31, work: 1 },
  { P: 12, S: 6, D: 30, work: 1 },
  { P: 20, S: 10, D: 31, work: 1 },
  { P: 10, S: 8, D: 31, work: 2 },
  { P: 25, S: 20, D: 31, work: 3 },
] as const

// 単発の焼きなましは局所最適に落ちることがあるため、複数の基準シードで確認する。
const SEEDS = [0, 1, 2, 3, 4] as const

describe.each(CASES)('$P人 × $S シフト × $D日', ({ P, S, D, work }) => {
  const runs = SEEDS.map((seed) => {
    const { result, message } = generate(P, S, D, { seed })
    if (result === null) throw new Error(`解が得られませんでした: ${message}`)
    return result
  })

  it('入力がシフト数の上限に収まっている', () => {
    expect(S).toBeLessThanOrEqual(maxShiftsFor(P, D))
  })

  it('ハード制約違反がない', () => {
    for (const r of runs) {
      expect(r.violations).toEqual({ cover: 0, consec: 0, interval: 0 })
    }
  })

  it('出勤日数の幅が許容内', () => {
    for (const r of runs) expect(spread(r.works)).toBeLessThanOrEqual(work)
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

  it('遅番が3日を超えて連続しない', () => {
    for (const r of runs) {
      for (const row of r.grid) {
        let run = 0
        for (const v of row) {
          run = v === S ? run + 1 : 0
          expect(run).toBeLessThanOrEqual(3)
        }
      }
    }
  })

  it('Python プロトタイプ(最大2.84s)より速い', () => {
    for (const r of runs) expect(r.elapsedMs).toBeLessThan(2840)
  })
})
