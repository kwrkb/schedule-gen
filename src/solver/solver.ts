import { Rng } from './rng'

/** 休みを表すセル値。勤務は 1..S（1=早番、S=遅番）で、値の順序がそのまま勤務時間帯の順序を表す。 */
export const REST = 0

/** コスト重み。ハード制約は桁を分けて実質的に必ず解消されるようにする。 */
const W_CONSEC = 5000 // 連勤上限超過
const W_INTERVAL = 3000 // 遅番→翌日早番（勤務間インターバル11時間の近似）
const W_SHIFTVAR = 40 // シフト構成の偏り
const W_RESTGAP = 8 // 休み間隔の偏り
const W_SAME3 = 30 // 同一シフト3連続
const W_LATERUN = 150 // 遅番4連続以降（3連続までに抑えるためのソフト拘束）

/** 人数に対してシフト数をここまでしか許さない。超えると探索が破綻して連勤違反が残る。 */
const MAX_SHIFT_RATIO = 0.8

export function makeLabels(n: number): string[] {
  if (n === 1) return ['日勤']
  if (n === 2) return ['早', '遅']
  return ['早', ...Array.from({ length: n - 2 }, (_, i) => `中${i + 1}`), '遅']
}

/**
 * 勤務間インターバル（11時間）の近似。最も遅いシフト S の翌日に許すのは
 * 「休み」「遅番 S」「その1つ前 S-1（ただし早番は除く）」だけ。
 *
 * シフト数が多いと 遅(6)→中1(2) のような大きな逆行が起きうるが、
 * これは 遅→早 と実質同じ負担になるため同列に禁止する。
 * S=2 では S-1 が早番そのものなので、従来どおり 遅→早 が禁止される。
 */
export function violatesInterval(prev: number, next: number, S: number): boolean {
  if (S < 2 || prev !== S || next === REST) return false
  return next === 1 || next < S - 1
}

/**
 * この人数・日数で成立するシフト数の上限。UI の入力上限にも使う。
 *
 * - 各シフトに毎日1人以上置くと、1日の休み枠は P-S 人しかない。全体の休み枠
 *   (P-S)*D が、全員が連勤上限を守るのに必要な休み総数 P*minRest を下回るなら、
 *   どう組んでも連勤違反が残る
 * - 数学的に成立してもその境界付近は探索が解を見つけられない
 *   （7人×6シフト = 86% は理論上可能だが、実測では10シード中に連勤違反が出る）。
 *   そのため人数の8割でも頭打ちにする
 *
 * 0 以下を返す場合はその人数・日数では連勤上限を守れない（人数が足りない）。
 */
export function maxShiftsFor(P: number, D: number, maxConsec = 6): number {
  // 連勤上限を守るには、D日を「連勤 maxConsec 日 + 休み1日」の塊で割る必要がある
  const minRest = Math.max(0, Math.ceil((D - maxConsec) / (maxConsec + 1)))
  // (P - S) * D >= P * minRest  ->  S <= P - P*minRest/D
  const byRest = Math.floor(P - (P * minRest) / D)
  return Math.min(P, Math.floor(P * MAX_SHIFT_RATIO), byRest)
}

export interface SolveOptions {
  timeLimitMs?: number
  patience?: number
  minImproveRatio?: number
  maxRounds?: number
}

export interface SolveResult {
  /** P 行 × D 列。grid[person][day] が REST または 1..S */
  grid: number[][]
  score: number
  iterations: number
  rounds: number
  elapsedMs: number
  /** 停止理由（収束 / 上限到達 / 時間切れ） */
  reason: string
}

export interface Violations {
  cover: number
  consec: number
  interval: number
}

export interface Stats {
  violations: Violations
  /** 各人の出勤日数 */
  works: number[]
  /** 各人の遅番回数 */
  lates: number[]
}

export class Solver {
  readonly labels: string[]
  private readonly maxConsec: number
  private readonly rng: Rng
  /** 1日分の列構成。全日にこの列をコピーしたものが初期解になる。 */
  private readonly column: number[]

  constructor(
    readonly P: number,
    readonly S: number,
    readonly D: number,
    options: { maxConsec?: number; seed?: number } = {},
  ) {
    this.maxConsec = options.maxConsec ?? 6
    this.rng = new Rng(options.seed ?? 0)
    this.labels = makeLabels(S)
    this.column = this.buildColumn()
  }

  /**
   * 1日分の列を作る。週休2日相当になるよう休みの人数を決め、
   * 残りを各シフトへ順番に割り当てる。
   *
   * 交換探索はこの列の構成を絶対に壊さないため、
   * cover 制約（各シフト最低1人）が探索中つねに満たされる。
   */
  private buildColumn(): number[] {
    const { P, S } = this
    let rest = Math.round((P * 2) / 7)
    let workers = P - rest
    if (workers < S) {
      workers = S
      rest = P - S
    }
    const col: number[] = []
    for (let i = 0; i < workers; i++) col.push(1 + (i % S))
    // S が maxShifts() を超えると rest が負になりうるが、
    // その場合は feasible() が先に false を返すためこの列は使われない。
    for (let i = 0; i < rest; i++) col.push(REST)
    return col
  }

  /** この人数・日数で成立するシフト数の上限。@see maxShiftsFor */
  maxShifts(): number {
    return maxShiftsFor(this.P, this.D, this.maxConsec)
  }

  /** 探索前に数学的に解の有無を判定する。 */
  feasible(): { ok: boolean; message: string } {
    const max = this.maxShifts()
    if (max < 1) {
      return {
        ok: false,
        message: `${this.P}人では${this.D}日を連勤${this.maxConsec}日以内で回せません。人数を増やしてください`,
      }
    }
    if (this.S > max) {
      return {
        ok: false,
        message: `${this.P}人で組めるのは最大${max}シフトまでです（連勤${this.maxConsec}日以内と各シフト最低1人を両立できません）`,
      }
    }
    return { ok: true, message: '' }
  }

  /** 列を全日にコピーした初期解。極端に偏っているが制約違反はない。 */
  initial(): number[][] {
    const grid: number[][] = []
    for (let p = 0; p < this.P; p++) grid.push(new Array<number>(this.D).fill(this.column[p]))
    return grid
  }

  /**
   * 1人分（1行）のコスト。交換では2行しか変化しないため、
   * 全体を再計算せずこの差分だけで評価できる。
   */
  rowCost(row: number[]): number {
    const { D, S } = this
    let c = 0
    let run = 0
    let same = 1
    const rests: number[] = []
    const cnt = new Array<number>(S + 1).fill(0)

    for (let d = 0; d < D; d++) {
      const v = row[d]
      cnt[v] += 1
      if (v === REST) {
        run = 0
        rests.push(d)
      } else {
        run += 1
        if (run > this.maxConsec) c += W_CONSEC
      }
      if (d > 0) {
        const prev = row[d - 1]
        if (violatesInterval(prev, v, S)) c += W_INTERVAL
        if (v !== REST && v === prev) {
          same += 1
          if (same >= 3) c += W_SAME3
          // 遅番だけは4連続以降を重く見る（3連続までに収める）
          if (v === S && same >= 4) c += W_LATERUN
        } else {
          same = 1
        }
      }
    }

    if (rests.length >= 2) {
      const gaps: number[] = []
      for (let i = 0; i < rests.length - 1; i++) gaps.push(rests[i + 1] - rests[i])
      const m = gaps.reduce((a, b) => a + b, 0) / gaps.length
      c += W_RESTGAP * (gaps.reduce((a, g) => a + (g - m) ** 2, 0) / gaps.length)
    }

    // cnt は REST を含む S+1 要素。休みも含めた構成の均し込みとして機能する。
    const m = cnt.reduce((a, b) => a + b, 0) / cnt.length
    c += W_SHIFTVAR * (cnt.reduce((a, x) => a + (x - m) ** 2, 0) / cnt.length)
    return c
  }

  /**
   * 焼きなまし + 早期終了。
   *
   * 1ラウンド = P*D 回の交換試行。patience ラウンド連続で改善率が
   * minImproveRatio 未満なら打ち切る。ただし冷却が終わるまでは打ち切らない
   * （高温中の「改善が止まった」は誤判定になるため）。
   */
  solve(options: SolveOptions = {}): { result: SolveResult | null; message: string } {
    const timeLimitMs = options.timeLimitMs ?? 3000
    const patience = options.patience ?? 8
    const minImproveRatio = options.minImproveRatio ?? 0.001
    const maxRounds = options.maxRounds ?? 400

    const { ok, message } = this.feasible()
    if (!ok) return { result: null, message }

    const { P, D } = this
    const rng = this.rng
    const grid = this.initial()
    const rowCosts = grid.map((row) => this.rowCost(row))
    let cur = rowCosts.reduce((a, b) => a + b, 0)
    let best = cur
    let bestGrid = grid.map((row) => row.slice())

    const roundSize = Math.max(2000, P * D)
    // 冷却しきるまでの反復数は問題規模に比例させる
    const coolIters = Math.max(30000, P * D * 60)
    const T_START = 300
    const T_END = 0.2

    const t0 = performance.now()
    let it = 0
    let stale = 0
    let rounds = 0
    let prevBest = best
    let reason: string

    for (;;) {
      for (let i = 0; i < roundSize; i++) {
        const frac = Math.min(1, it / coolIters)
        const T = T_START * (T_END / T_START) ** frac
        it += 1

        const d = rng.int(D)
        const a = rng.int(P)
        const b = rng.int(P)
        if (a === b) continue
        const va = grid[a][d]
        const vb = grid[b][d]
        if (va === vb) continue

        grid[a][d] = vb
        grid[b][d] = va
        const na = this.rowCost(grid[a])
        const nb = this.rowCost(grid[b])
        const delta = na - rowCosts[a] + (nb - rowCosts[b])

        if (delta <= 0 || rng.float() < Math.exp(-delta / Math.max(T, 1e-9))) {
          rowCosts[a] = na
          rowCosts[b] = nb
          cur += delta
          if (cur < best - 1e-9) {
            best = cur
            bestGrid = grid.map((row) => row.slice())
          }
        } else {
          grid[a][d] = va
          grid[b][d] = vb
        }
      }

      rounds += 1
      const improve = (prevBest - best) / Math.max(Math.abs(prevBest), 1)
      stale = improve < minImproveRatio ? stale + 1 : 0
      prevBest = best

      const cooled = it >= coolIters
      if (cooled && stale >= patience) {
        reason = `収束(${rounds}R)`
        break
      }
      if (rounds >= maxRounds) {
        reason = `上限到達(${rounds}R)`
        break
      }
      if (performance.now() - t0 > timeLimitMs) {
        reason = `時間切れ(${rounds}R)`
        break
      }
    }

    return {
      result: {
        grid: bestGrid,
        score: best,
        iterations: it,
        rounds,
        elapsedMs: performance.now() - t0,
        reason,
      },
      message: '',
    }
  }

  /** 解の検証用。ハード制約違反数と、出勤日数・遅番回数の分布を返す。 */
  stats(grid: number[][]): Stats {
    const { P, S, D } = this
    const violations: Violations = { cover: 0, consec: 0, interval: 0 }

    for (let d = 0; d < D; d++) {
      const cnt = new Array<number>(S + 1).fill(0)
      for (let p = 0; p < P; p++) cnt[grid[p][d]] += 1
      for (let s = 1; s <= S; s++) if (cnt[s] === 0) violations.cover += 1
    }

    const works: number[] = []
    const lates: number[] = []
    for (let p = 0; p < P; p++) {
      const row = grid[p]
      let run = 0
      for (let d = 0; d < D; d++) {
        if (row[d] !== REST) {
          run += 1
          if (run > this.maxConsec) violations.consec += 1
        } else {
          run = 0
        }
      }
      for (let d = 0; d < D - 1; d++) {
        if (violatesInterval(row[d], row[d + 1], S)) violations.interval += 1
      }
      works.push(row.filter((v) => v !== REST).length)
      lates.push(row.filter((v) => v === S).length)
    }

    return { violations, works, lates }
  }
}
