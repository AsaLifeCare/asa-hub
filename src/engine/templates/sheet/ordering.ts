/** Row-ordering constants + pure helpers (moved verbatim from SheetTemplate.tsx). */
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical, Shuffle } from 'lucide-react'
import type { OrderingMode } from './types'

export const ORDERING_MODES: { key: OrderingMode; label: string; short?: string; hint?: string; icon: typeof ArrowUpDown }[] = [
  { key: 'default', label: 'Default', icon: ArrowUpDown },
  { key: 'az', label: 'A → Z', icon: ArrowUp },
  { key: 'za', label: 'Z → A', icon: ArrowDown },
  { key: 'random', label: 'Random', icon: Shuffle },
  { key: 'manual', label: 'Manual (this session)', short: 'Manual', hint: 'Resets when you leave', icon: GripVertical },
]

/** mulberry32 — deterministic PRNG for stable random shuffles. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function loadOrder(key: string): string[] {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return []
    const p = JSON.parse(raw)
    return Array.isArray(p) ? p.filter((x: any) => typeof x === 'string') : []
  } catch {
    return []
  }
}
