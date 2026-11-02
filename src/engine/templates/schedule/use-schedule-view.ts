/** Current view (week/month/day) with per-user localStorage persistence (moved verbatim from ScheduleTemplate.tsx). */
import { useState } from 'react'
import { VIEW_KEY } from './utils'

export function useScheduleView(allowViews: string[], configView: unknown) {
  const [view, setViewState] = useState<string>(() => {
    const def = allowViews.includes(configView as string) ? (configView as string) : allowViews[0]
    try {
      const stored = localStorage.getItem(VIEW_KEY)
      if (stored && allowViews.includes(stored)) return stored
    } catch {
      /* localStorage unavailable */
    }
    return def
  })
  const setView = (v: string) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* localStorage unavailable */
    }
  }
  return [view, setView] as const
}
