/** Shared helpers for the ops-apps feature pages (expenses / inventory). */
import type { ExpenseCategory, ExpenseStatus } from '@/lib/seed-ops'
import type { TintName } from '@/engine/types'

export const fmtMoney = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export const EXPENSE_CATEGORY_TINT: Record<ExpenseCategory, TintName> = {
  Mileage: 'blue',
  Supplies: 'peach',
  Training: 'lavender',
  'Client activities': 'mint',
  Meals: 'amber',
  Medical: 'pink',
}

export const EXPENSE_STATUS_TINT: Record<ExpenseStatus, TintName> = {
  pending: 'amber',
  approved: 'mint',
  rejected: 'pink',
}

export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_TINT) as ExpenseCategory[]

/** Days from now until an ISO date (negative = past). */
export function daysUntil(isoDate: string): number {
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86_400_000)
}

/** Expiry presentation: past → pink "Expired", ≤30d → amber, else neutral. */
export function expiryState(isoDate?: string): { label: string; tint: TintName; danger: boolean } | null {
  if (!isoDate) return null
  const d = daysUntil(isoDate)
  if (d < 0) return { label: `Expired ${Math.abs(d)}d ago`, tint: 'pink', danger: true }
  if (d <= 30) return { label: `${d}d left`, tint: 'amber', danger: false }
  return { label: '', tint: 'blue', danger: false }
}
