// THE RIGHT PANEL — the 384px slide-over under the top bar that holds any content: a shift, a request, a form.
// It is the same shell DetailPanel and ShiftCellPanel draw (scrim below xl, spring 320/34, Escape closes, a bottom…
import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useMediaQuery } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { useFileViewerStore } from '@/stores/useFileViewerStore'

/** Escape closes an open panel. */
export function usePanelEscape(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return
    // a document open in the centred viewer takes Escape first, and so does a confirm (DialogHost cancels it and…
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !useFileViewerStore.getState().file) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
}

/** The shade behind the panel below xl; a press on it closes the panel. */
export function PanelScrim({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }} onClick={onClose} data-panel-scrim=""
      className="fixed inset-0 z-30 bg-black/25 xl:hidden"
    />
  )
}

export default function SidePanel({ open, onClose, label, title, children, footer, badge, overline, titleAside, widthPx }: {
  open: boolean
  onClose: () => void
  /** the small-caps word in the header, and the panel's accessible name */
  label: string
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** ignored: every side panel opens at the one standard width */
  wide?: boolean
  /** a status pill in the header, left of the close button */
  badge?: ReactNode
  /** a small label over the title (it is then drawn large) */
  overline?: ReactNode
  /** beside the title, on the right: one button */
  titleAside?: ReactNode
  /** a width the operator chose for one panel by name (Locations › Edit house); every other panel stays at 384px */
  widthPx?: number
}) {
  /** a phone: the panel rises from the bottom, 90% of the screen, with a handle */
  const phone = useMediaQuery('(max-width: 639px)')
  const heading = useRef<HTMLHeadingElement | null>(null)
  usePanelEscape(open, onClose)

  useEffect(() => {
    if (open) heading.current?.focus()
  }, [open, title])

  return (
    <AnimatePresence>
      {open && (
        <>
          <PanelScrim onClose={onClose} />
          <motion.aside
            initial={phone ? { y: '100%' } : { x: (widthPx ?? 384) + 16 }} animate={phone ? { y: 0 } : { x: 0 }}
            exit={phone ? { y: '100%' } : { x: (widthPx ?? 384) + 16 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            aria-label={label}
            style={!phone && widthPx ? { width: `min(100%, ${widthPx}px)` } : undefined}
            className={cn('fixed z-30 flex flex-col border-border bg-bg shadow-3',
              phone ? 'border-t max-sm:inset-x-0 max-sm:bottom-0 max-sm:h-[90vh] max-sm:rounded-t-[16px]'
                : 'bottom-0 right-0 top-[calc(68px+var(--hub-strip-h,0px))] w-full border-l sm:w-[384px]')}
          >
            {phone && <span aria-hidden className="mx-auto mt-1.5 h-1 w-10 shrink-0 rounded-full bg-text-3/40" />}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">{label}</span>
              <span className="flex items-center gap-2">
                {badge}
                <button type="button" onClick={onClose} aria-label={`Close ${label.toLowerCase()} panel`}
                  className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
                  <X size={15} />
                </button>
              </span>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {overline && <p className="text-[12.5px] text-text-3">{overline}</p>}
                  <h2 ref={heading} tabIndex={-1}
                    className={cn('font-display font-semibold text-text-1 outline-none',
                      overline ? 'mt-0.5 break-words text-[22px] leading-7' : 'text-[17px] leading-6')}>
                    {title}
                  </h2>
                </div>
                {titleAside && <div className="shrink-0">{titleAside}</div>}
              </div>
              {children}
            </div>
            {footer && <div className="shrink-0 border-t border-border p-4">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
