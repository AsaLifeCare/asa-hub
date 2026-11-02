/** The ledger's month and money spellings — shared by Client Finances and the client record's Finances tab. */
import { ohioToday } from '@/lib/ohio'

export const money = (n: number) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** This month on OHIO's calendar, the same day `finLedger` defaults to — never the reader's or UTC's. */
export function thisMonth(): string {
  return ohioToday().slice(0, 7)
}
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
/** A stored 'YYYY-MM-DD' read as a LOCAL day: new Date() of that string is midnight UTC, a day early in Ohio. */
export function dayLabel(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return d || '—'
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
