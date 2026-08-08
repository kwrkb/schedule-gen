import './style.css'
import { REST, generate } from './solver'
import type { GenerateResult } from './solver'

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`要素が見つかりません: ${id}`)
  return found as T
}

const form = el<HTMLFormElement>('form')
const peopleInput = el<HTMLInputElement>('people')
const shiftsInput = el<HTMLInputElement>('shifts')
const daysInput = el<HTMLInputElement>('days')
const submitButton = el<HTMLButtonElement>('submit')
const copyButton = el<HTMLButtonElement>('copy')
const statusLine = el<HTMLParagraphElement>('status')
const output = el<HTMLElement>('output')
const summary = el<HTMLParagraphElement>('summary')
const table = el<HTMLTableElement>('table')

/** 直近の結果。コピー用に保持する。 */
let current: { result: GenerateResult; days: number } | null = null

const clamp = (input: HTMLInputElement): number => {
  const value = Number(input.value)
  const min = Number(input.min)
  const max = Number(input.max)
  const fixed = Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min
  input.value = String(fixed)
  return fixed
}

/** シフト値に対応するセルの色クラス。早番と遅番だけ区別できれば十分。 */
const cellClass = (value: number, shifts: number): string => {
  if (value === REST) return 's-rest'
  if (value === 1) return 's-early'
  if (value === shifts) return 's-late'
  return 's-mid'
}

const setStatus = (message: string, isError = false): void => {
  statusLine.textContent = message
  statusLine.classList.toggle('error', isError)
  statusLine.hidden = message === ''
}

function render(result: GenerateResult, days: number): void {
  const { grid, labels, works } = result
  const shifts = labels.length

  const head = document.createElement('thead')
  const headRow = document.createElement('tr')
  headRow.appendChild(document.createElement('th'))
  for (let d = 0; d < days; d++) {
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = String(d + 1)
    headRow.appendChild(th)
  }
  const countHead = document.createElement('th')
  countHead.scope = 'col'
  countHead.textContent = '出勤'
  headRow.appendChild(countHead)
  head.appendChild(headRow)

  const body = document.createElement('tbody')
  grid.forEach((row, p) => {
    const tr = document.createElement('tr')
    const th = document.createElement('th')
    th.scope = 'row'
    th.textContent = String(p + 1)
    tr.appendChild(th)
    for (const value of row) {
      const td = document.createElement('td')
      td.className = cellClass(value, shifts)
      td.textContent = value === REST ? '休' : labels[value - 1]
      tr.appendChild(td)
    }
    const count = document.createElement('td')
    count.className = 'count'
    count.textContent = String(works[p])
    tr.appendChild(count)
    body.appendChild(tr)
  })

  table.replaceChildren(head, body)
  summary.textContent =
    `${grid.length}人 × ${labels.join('・')} × ${days}日 / ` +
    `出勤 ${Math.min(...works)}〜${Math.max(...works)}日 / ${(result.elapsedMs / 1000).toFixed(2)}秒`
  output.hidden = false
  current = { result, days }
}

/** ブラウザに「計算中」を描画させてから、同期的なソルバーに入る。 */
const yieldToPaint = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const people = clamp(peopleInput)
  const shifts = clamp(shiftsInput)
  const days = clamp(daysInput)

  submitButton.disabled = true
  setStatus('計算中…')
  await yieldToPaint()

  try {
    // 押すたびに別の案が出るよう、毎回シードを変える
    const seed = Math.floor(Math.random() * 0x7fffffff)
    const { result, message } = generate(people, shifts, days, { seed })
    if (result === null) {
      output.hidden = true
      current = null
      setStatus(message || '条件に合うシフトが見つかりませんでした', true)
      return
    }
    render(result, days)
    setStatus('')
  } finally {
    submitButton.disabled = false
  }
})

/** Excel にそのまま貼れるタブ区切りテキスト。 */
const toTsv = ({ result, days }: { result: GenerateResult; days: number }): string => {
  const header = ['', ...Array.from({ length: days }, (_, d) => String(d + 1)), '出勤']
  const rows = result.grid.map((row, p) => [
    String(p + 1),
    ...row.map((value) => (value === REST ? '休' : result.labels[value - 1])),
    String(result.works[p]),
  ])
  return [header, ...rows].map((cells) => cells.join('\t')).join('\n')
}

copyButton.addEventListener('click', async () => {
  if (current === null) return
  try {
    await navigator.clipboard.writeText(toTsv(current))
    setStatus('コピーしました。Excel に貼り付けてください。')
  } catch {
    setStatus('コピーできませんでした。表を選択して手動でコピーしてください。', true)
  }
})
