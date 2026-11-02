/** A page's one header Refresh: the header counts presses, each screen under it re-reads via `usePageRefresh`. */
import { createContext, useContext, useEffect, useRef } from 'react'

/** How many times the header's Refresh was pressed. 0 outside a provider. */
export const PageRefreshTick = createContext(0)

/** Run `reload` on each Refresh press, never on mount. */
export function usePageRefresh(reload: () => void): void {
  const tick = useContext(PageRefreshTick)
  const seen = useRef(tick)
  const latest = useRef(reload)
  useEffect(() => { latest.current = reload })
  useEffect(() => {
    if (tick === seen.current) return
    seen.current = tick
    latest.current()
  }, [tick])
}
