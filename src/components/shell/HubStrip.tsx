// THE STRIP AT THE TOP — "New version launched, transferring...".
// lib/hubStatus decides when; this only draws it: a thin dark band over every route (public pages, login and the…
import { useEffect, useLayoutEffect, useState } from 'react'
import { useAuthStore } from '@/auth/useAuthStore'
import {
  BE_ANOTHER_VAR, HUB_STRIP_HEIGHT_PX, HUB_STRIP_TEXT, SHELL_OFFSET_VAR, loadNewBuildNow, useHubStatusStore,
  writeShellOffset,
} from '@/lib/hubStatus'

/** The height the shell makes room for; unset while the strip is down. */
export const HUB_STRIP_VAR = SHELL_OFFSET_VAR
/** How long the refusal note stands before the button is offered again. */
export const HUB_STRIP_REFUSAL_MS = 6000

/** The strip's state and its effects on the page, apart from what it draws. */
export function useHubStrip(): { shown: boolean; web: string; refused: boolean; onLoad: () => void; under: boolean } {
  const shown = useHubStatusStore((s) => s.shown)
  const web = useHubStatusStore((s) => s.webPending)
  // the Be Another band (shell/BeAnotherBar) stands above the strip while acting
  const under = useAuthStore((s) => Boolean(s.beAnother?.acting))
  const [refused, setRefused] = useState(false)

  // before paint: the frame that draws the strip already has the shell moved — both bands, one writer
  useLayoutEffect(() => {
    const root = typeof document !== 'undefined' ? document.documentElement : null
    if (!root) return
    writeShellOffset(root.style, shown, under)
  }, [shown, under])

  // the refusal is asked again, never remembered: saved or closed, the next click loads
  useEffect(() => {
    if (!refused) return
    const t = setTimeout(() => setRefused(false), HUB_STRIP_REFUSAL_MS)
    return () => clearTimeout(t)
  }, [refused])

  return {
    shown,
    web,
    refused,
    under,
    onLoad: () => {
      if (loadNewBuildNow() === 'draft') setRefused(true)
    },
  }
}

export default function HubStrip() {
  return <HubStripBar {...useHubStrip()} />
}

// The band itself.
export function HubStripBar({ shown, web, refused, onLoad, under = false }: {
  shown: boolean
  web: string
  refused: boolean
  onLoad: () => void
  under?: boolean
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={shown
        ? 'fixed inset-x-0 top-0 z-[35] flex items-center justify-center gap-2 border-b border-white/10 bg-sidebar px-3 pt-safe text-[11.5px] font-medium leading-none text-white/85 print:hidden'
        : 'sr-only'}
      style={shown
        ? (under
          ? { top: `var(${BE_ANOTHER_VAR}, 0px)`, height: `${HUB_STRIP_HEIGHT_PX}px`, paddingTop: 0 }
          : { height: `var(${HUB_STRIP_VAR}, ${HUB_STRIP_HEIGHT_PX}px)` })
        : undefined}
    >
      {shown && (
        <>
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
          {/* the words asked for never give way: the note and the button do */}
          <span className="shrink-0 whitespace-nowrap">{HUB_STRIP_TEXT}</span>
          {web && (refused ? (
            <span className="min-w-0 truncate text-white/60">Save your work first.</span>
          ) : (
            <button
              type="button"
              onClick={onLoad}
              className="min-w-0 truncate rounded px-1.5 py-0.5 font-semibold text-white underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/60"
            >
              Load it now
            </button>
          ))}
        </>
      )}
    </div>
  )
}
