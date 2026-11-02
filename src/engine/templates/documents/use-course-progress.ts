/** Course progress hook (localStorage, per user) — moved verbatim from DocumentsTemplate.tsx. */
import { useState } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import type { Doc } from '@/engine/types'
import { modulesOf } from './utils'

const COURSE_PROGRESS_KEY = 'asa-course-progress'
type ProgressMap = Record<string, string[]> // docId → checked module ids

const readProgressStore = (): Record<string, ProgressMap> => {
  try {
    return JSON.parse(localStorage.getItem(COURSE_PROGRESS_KEY) ?? '{}') as Record<string, ProgressMap>
  } catch {
    return {}
  }
}

export function useCourseProgress() {
  const userId = useAuthStore((s) => s.user?.id ?? 'anon')
  const [mine, setMine] = useState<ProgressMap>(() => readProgressStore()[userId] ?? {})
  const toggle = (docId: string, moduleId: string) =>
    setMine((prev) => {
      const cur = new Set(prev[docId] ?? [])
      if (cur.has(moduleId)) cur.delete(moduleId)
      else cur.add(moduleId)
      const next = { ...prev, [docId]: [...cur] }
      const all = readProgressStore()
      all[userId] = next
      try {
        localStorage.setItem(COURSE_PROGRESS_KEY, JSON.stringify(all))
      } catch {
        /* storage full — progress stays in-memory */
      }
      return next
    })
  const pctOf = (d: Doc) => {
    const mods = modulesOf(d)
    if (mods.length === 0) return 0
    const done = (mine[d.id] ?? []).filter((id) => mods.some((m) => m.id === id)).length
    return Math.round((done / mods.length) * 100)
  }
  return { mine, toggle, pctOf }
}
