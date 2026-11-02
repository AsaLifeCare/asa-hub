// Sheet mode as a button: swaps the page body for the pinned Render Sheet grid of the same tab.
// Used by AppRoutePage (SHEET_MODE) and Calendar Builder's Shifts & Coverage.
import { Suspense, useState } from 'react'
import { LayoutList, Table2 } from 'lucide-react'
import type { PageSchema } from '@/engine/types'
import { PageSkeleton } from '@/components/shared/Skeleton'
import { lazyPage } from '@/lib/lazyPage'

// both bodies are chunks of their own (lib/lazyPage); SHEET_MODE stays in the shell
const PageRenderer = lazyPage(() => import('@/engine/PageRenderer'))
const RenderSheetPage = lazyPage(() => import('@/pages/features/rendersheet/RenderSheetPage'))

/** `<app>/<page>` → the Render Sheet pin its sheet mode opens. */
export const SHEET_MODE: Record<string, { pin: string; pinTitle?: string }> = {
  'mar/mar': { pin: 'mar_entries', pinTitle: 'MAR entries' },
  'projects/board': { pin: 'projects', pinTitle: 'Projects' },
  'diseases/registry': { pin: 'diseases', pinTitle: 'Diseases' },
  'house-repair/orders': { pin: 'workOrders', pinTitle: 'Repair orders' },
  'dr-appointments/upcoming': { pin: 'drAppointments', pinTitle: 'Dr appointments' },
  'travel/trips': { pin: 'travelTrips', pinTitle: 'Travel trips' },
  // the old app's address (kept unlisted) and its Calendar Builder page
  'shifts/coverage': { pin: 'shifts', pinTitle: 'Shifts' },
  'calendarbuilder/coverage': { pin: 'shifts', pinTitle: 'Shifts' },
}

export default function SheetModePage({ page, pin, pinTitle }: { page: PageSchema; pin: string; pinTitle?: string }) {
  const [sheetOn, setSheetOn] = useState(false)
  return (
    <div className="w-full">
      {/* its own slim row, never over the page's own header buttons */}
      <div className="mb-2 flex justify-end">
        <button
          onClick={() => setSheetOn((v) => !v)}
          title={sheetOn ? 'Back to the normal view' : 'The same rows as the sheet itself, with the sheet toolkit'}
          className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-colors hover:bg-surface-2"
        >
          {sheetOn ? <LayoutList size={14} /> : <Table2 size={14} />}
          {sheetOn ? 'Normal view' : 'Sheet mode'}
        </button>
      </div>
      {/* the button above stays up while either body's code arrives */}
      <Suspense fallback={<PageSkeleton type="sheet" />}>
        {sheetOn ? <RenderSheetPage pin={pin} pinTitle={pinTitle} /> : <PageRenderer schema={page} />}
      </Suspense>
    </div>
  )
}
