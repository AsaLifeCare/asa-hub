// Right contextual detail panel (§7.4) — 384px slide-over hosting a `detail` page-type instance (DetailTemplate).
// Scrim below 1280px only.
import { Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Crosshair, X } from 'lucide-react'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { useContextStore, type Focus } from '@/stores/useContextStore'
import { toast } from '@/stores/useToastStore'
import Skeleton from '@/components/shared/Skeleton'
import { lazyPage } from '@/lib/lazyPage'

// the panel is shell; the template (charts, actions, modals) arrives the first time a panel opens
const DetailTemplate = lazyPage(() => import('@/engine/templates/DetailTemplate'))

type OwnPanel = ComponentType<{ row: Record<string, unknown> | null; onClose: () => void }>
// A detailPanel config may name an app's own side panel (`ownPanel`), drawn instead of this shell and its template: the
// Incident Log's reports open in Support Requests' panel pattern (IncidentPanel), never the template's dark header.
const OWN_PANELS: Record<string, LazyExoticComponent<OwnPanel>> = {
  incident: lazyPage<OwnPanel>(() => import('@/pages/features/supportdesk/IncidentPanel')),
}

/** The own panel a detailPanel config names, '' for the template (an unknown name too). */
export function ownPanelOf(config: Record<string, unknown> | undefined): string {
  const kind = String(config?.ownPanel ?? '')
  return Object.hasOwn(OWN_PANELS, kind) ? kind : ''
}

// Person Focus Mode (context-mode): when a sheet row injects `config.focusAction` (see SheetTemplate focusDrag…
function FocusAction({ focus }: { focus: Focus }) {
  const setFocus = useContextStore((s) => s.setFocus)
  return (
    <button
      onClick={() => {
        setFocus(focus)
        toast({
          type: 'success',
          title: `Workspace focused on ${focus.name}`,
          body: 'The sidebar now shows only their apps — click the person chip at the top to exit.',
        })
      }}
      className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-[12px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
    >
      <Crosshair size={13} /> Focus workspace on {focus.name}
    </button>
  )
}

export default function DetailPanel() {
  const { panel, closeDetail } = useDetailPanelStore()
  const own = ownPanelOf(panel?.config)
  // an own panel stays mounted once opened, so it slides out as it slid in
  const [mounted, setMounted] = useState<string[]>([])
  useEffect(() => {
    if (own && !mounted.includes(own)) setMounted((m) => [...m, own])
  }, [own, mounted])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeDetail()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeDetail])

  return (
    <>
    {mounted.map((kind) => {
      const Own = OWN_PANELS[kind]
      return (
        <Suspense key={kind} fallback={null}>
          <Own row={own === kind ? panel?.record ?? null : null} onClose={closeDetail} />
        </Suspense>
      )
    })}
    <AnimatePresence>
      {panel && !own && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={closeDetail}
            className="fixed inset-0 z-30 bg-black/25 xl:hidden"
          />
          <motion.aside
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            aria-label="Detail panel"
            // under the Topbar, and under the strip at the top while it is up
            className="fixed bottom-0 right-0 top-[calc(68px+var(--hub-strip-h,0px))] z-30 flex w-full flex-col border-l border-border bg-bg shadow-3 sm:w-[384px]"
          >
            <div className="flex h-12 items-center justify-between border-b border-border px-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Details</span>
              <button onClick={closeDetail} aria-label="Close detail panel" className="grid h-7 w-7 place-items-center rounded-sm text-text-3 hover:bg-surface-2 hover:text-text-1">
                <X size={15} />
              </button>
            </div>
            {Boolean((panel.config as Record<string, unknown>).focusAction) && (
              <div className="border-b border-border px-4 pb-3 pt-1">
                <FocusAction focus={(panel.config as Record<string, unknown>).focusAction as Focus} />
              </div>
            )}
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
              <Suspense fallback={<div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>}>
                <DetailTemplate config={panel.config} record={panel.record} data={[]} schema={{ id: 'panel', type: 'detail', title: 'Detail', dataSource: { resource: 'activity' }, config: panel.config }} />
              </Suspense>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
    </>
  )
}
