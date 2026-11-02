/** PageHeader quick actions: view-only chip, Message staff, Publish week, nav, view tabs, New event (moved verbatim from ScheduleTemplate.tsx). */
import { ChevronLeft, ChevronRight, Lock, Megaphone, MessageCirclePlus, Plus } from 'lucide-react'
import SegmentedTabs from '@/components/shared/SegmentedTabs'
import { useFeatureAllowed } from '@/lib/featureAccess'

export function ToolbarActions({
  canEdit,
  view,
  allowViews,
  setView,
  setMsgOpen,
  publishWeek,
  nav,
  goToday,
  openNewEvent,
}: {
  canEdit: boolean
  view: string
  allowViews: string[]
  setView: (v: string) => void
  setMsgOpen: (open: boolean) => void
  publishWeek: () => void
  nav: (dir: number) => void
  goToday: () => void
  openNewEvent: (e: React.MouseEvent) => void
}) {
  const canMessageStaff = useFeatureAllowed('schedule.messageStaff')
  return (
    <>
      {!canEdit && (
        <span className="flex h-7 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[12px] font-medium text-text-3">
          <Lock size={13} />
          View only — ask an admin to make changes
        </span>
      )}
      {/* WHO MAY WRITE TO EVERYONE AT ONCE — the Message staff button is
          governed by ROLE BADGE. No row in the matrix leaves it where it
          has always been: open to whoever reached this page. The master fills
          a row under this app in App Control → Matrix and it narrows from there —
          lib/featureAccess, and the rule dies with the app. */}
      {canMessageStaff && (
        <button
          onClick={() => setMsgOpen(true)}
          className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
        >
          <MessageCirclePlus size={15} /> Message staff
        </button>
      )}
      {canEdit && view === 'week' && (
        <button
          onClick={publishWeek}
          className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-semibold text-text-1 transition-all duration-150 hover:bg-surface-2 active:scale-[0.98]"
        >
          <Megaphone size={15} /> Publish week
        </button>
      )}
      <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5">
        <button aria-label="Previous" onClick={() => nav(-1)} className="grid h-7 w-7 place-items-center rounded-full text-text-2 transition-colors duration-150 hover:bg-surface-2">
          <ChevronLeft size={15} />
        </button>
        <button onClick={goToday} className="h-7 rounded-full px-3 text-[12px] font-semibold text-text-1 transition-colors duration-150 hover:bg-surface-2">
          Today
        </button>
        <button aria-label="Next" onClick={() => nav(1)} className="grid h-7 w-7 place-items-center rounded-full text-text-2 transition-colors duration-150 hover:bg-surface-2">
          <ChevronRight size={15} />
        </button>
      </div>
      <SegmentedTabs
        tabs={allowViews.map((v) => ({ id: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))}
        value={view}
        onChange={setView}
      />
      {canEdit && (
        <button
          onClick={openNewEvent}
          className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
        >
          <Plus size={15} /> New event
        </button>
      )}
    </>
  )
}
