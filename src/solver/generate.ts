import { Solver } from './solver'
import type { SolveResult, Stats, Violations } from './solver'

/**
 * 単発の焼きなましは、最もタイトな構成（例: 5人×2シフト×30日）で
 * 約1〜2%の確率で局所最適に落ち、連勤上限違反を含む解を返す。
 * 反復数を増やしても抜けられないため、時間予算の範囲で解き直し、
 * 最良の解を採用する。
 */
export interface GenerateOptions {
  maxConsec?: number
  /** 基準シード。同じ値なら結果は再現する。 */
  seed?: number
  /** 多スタート全体の時間予算 */
  timeBudgetMs?: number
  maxAttempts?: number
}

export interface GenerateResult {
  labels: string[]
  grid: number[][]
  score: number
  violations: Violations
  works: number[]
  lates: number[]
  attempts: number
  elapsedMs: number
  reason: string
}

const totalViolations = (v: Violations): number => v.cover + v.consec + v.interval

/** ハード制約違反の少なさを最優先し、同数ならスコアの低い方を採る。 */
function isBetter(candidate: Stats & { score: number }, incumbent: Stats & { score: number }): boolean {
  const a = totalViolations(candidate.violations)
  const b = totalViolations(incumbent.violations)
  if (a !== b) return a < b
  return candidate.score < incumbent.score
}

export function generate(
  P: number,
  S: number,
  D: number,
  options: GenerateOptions = {},
): { result: GenerateResult | null; message: string } {
  const timeBudgetMs = options.timeBudgetMs ?? 800
  const maxAttempts = options.maxAttempts ?? 12
  const baseSeed = options.seed ?? 0

  const probe = new Solver(P, S, D, {
    ...(options.maxConsec === undefined ? {} : { maxConsec: options.maxConsec }),
  })
  const { ok, message } = probe.feasible()
  if (!ok) return { result: null, message }

  const t0 = performance.now()
  let best: (Stats & { score: number; run: SolveResult; solver: Solver }) | null = null
  let attempts = 0

  while (attempts < maxAttempts) {
    const remaining = timeBudgetMs - (performance.now() - t0)
    if (attempts > 0 && remaining <= 0) break

    const solver = new Solver(P, S, D, {
      ...(options.maxConsec === undefined ? {} : { maxConsec: options.maxConsec }),
      seed: baseSeed + attempts,
    })
    const { result } = solver.solve({ timeLimitMs: Math.max(remaining, 100) })
    attempts += 1
    if (result === null) break

    const stats = solver.stats(result.grid)
    const candidate = { ...stats, score: result.score, run: result, solver }
    if (best === null || isBetter(candidate, best)) best = candidate
  }

  if (best === null) return { result: null, message: '解が得られませんでした' }

  return {
    result: {
      labels: best.solver.labels,
      grid: best.run.grid,
      score: best.score,
      violations: best.violations,
      works: best.works,
      lates: best.lates,
      attempts,
      elapsedMs: performance.now() - t0,
      reason: best.run.reason,
    },
    message: '',
  }
}
