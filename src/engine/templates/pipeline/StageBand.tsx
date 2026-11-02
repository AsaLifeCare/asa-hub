/** One vertical funnel stage band: header, options menu, card list (moved verbatim from PipelineTemplate.tsx). */
import { unwiredAction } from '@/engine/templates/unwired'
import { useMemo, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, MoreHorizontal, PartyPopper, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TINT_BG, TINT_FG, TINT_VAR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { ConfigAction } from '@/engine/configActions'
import type { Stage } from './types'
import { bandItem } from './utils'
import { DraggableCard } from './PipelineCard'

// How wide one card stands in the horizontal stage line.
const CARD_W = 'w-[340px] max-w-[85vw] shrink-0'

export function StageBand({
  stage,
  stages,
  cards,
  fields,
  canEdit,
  clickable,
  onOpen,
  onAdvance,
  collapsed,
  onToggleCollapse,
  onAdd,
  canInsert,
  sortDesc,
  onToggleSort,
  sortAlpha,
  onToggleAlpha,
  draggingStageId,
  emptyText,
  rowActions,
  onAction,
  canDo,
  onPerson,
  onSource,
  onStart,
  startingId,
}: {
  stage: Stage
  stages: Stage[]
  cards: any[]
  fields: any
  canEdit: boolean
  clickable: boolean
  onOpen: (rec: any) => void
  onAdvance: (rec: any) => void
  collapsed: boolean
  onToggleCollapse: () => void
  /** Opens the same intake modal the header's primary action opens. */
  onAdd?: () => void
  // false hides the + entirely.
  canInsert?: boolean
  sortDesc: boolean
  onToggleSort: () => void
  sortAlpha: boolean
  onToggleAlpha: () => void
  draggingStageId: string | null
  emptyText: string
  /** Config-driven card row actions (config.rowActions) — optional pass-through. */
  rowActions?: ConfigAction[]
  onAction?: (a: ConfigAction, rec: Record<string, unknown>) => void
  canDo?: (perm?: string) => boolean
  /** Name/avatar → full profile — optional pass-through. */
  onPerson?: (rec: any) => void
  /** Source chip → who is behind it — optional pass-through. */
  onSource?: (rec: any, tag: string) => void
  /** Ready-to-start exit — optional pass-through. */
  onStart?: (rec: any) => Promise<void> | void
  /** Which card is mid-flight, so only that one says "Starting…". */
  startingId?: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const [expanded, setExpanded] = useState(false)
  // Seven across before the line folds into "N more" — at most seven per line on the Pipeline.
  const limit = stage.limit ?? 7
  const ordered = useMemo(
    () =>
      // sweep: per-stage alpha sort (A→Z on the card title) alongside the existing days-in-stage sort — list…
      sortAlpha
        ? [...cards].sort((a, b) => String(a[fields.title] ?? '').localeCompare(String(b[fields.title] ?? '')))
        : sortDesc
          ? [...cards].sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0))
          : cards,
    [cards, sortDesc, sortAlpha, fields.title],
  )
  const visible = expanded ? ordered : ordered.slice(0, limit)
  const hiddenCount = ordered.length - visible.length
  const avgDays = cards.length ? Math.round(cards.reduce((s, c) => s + (c.daysInStage ?? 0), 0) / cards.length) : 0

  return (
    <motion.section
      variants={bandItem}
      id={`stage-${stage.id}`}
      ref={setNodeRef}
      className={cn('rounded-lg border border-l-[3px] transition-colors duration-150', isOver ? TINT_BG[stage.tint] : 'border-border bg-surface/60')}
      style={
        isOver
          ? { borderColor: TINT_VAR[stage.tint], borderStyle: 'dashed', borderWidth: 2 }
          : { borderLeftColor: TINT_VAR[stage.tint] }
      }
    >
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TINT_VAR[stage.tint] }} />
        <h2 className="font-display text-[17px] font-bold text-text-1">{stage.label}</h2>
        <motion.span
          key={cards.length}
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.2 }}
          className={cn('inline-flex min-w-[20px] items-center justify-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] font-bold leading-4', TINT_BG[stage.tint], TINT_FG[stage.tint])}
        >
          {cards.length}
          {stage.celebrate && <PartyPopper size={11} aria-hidden />}
        </motion.span>
        {stage.description && !collapsed && (
          <p className="hidden min-w-0 flex-1 truncate text-[13px] text-text-3 lg:block">{stage.description}</p>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {cards.length > 0 && <span className="mr-1 hidden text-[12px] tabular-nums text-text-3 sm:block">days avg: {avgDays}d</span>}
          {/* The same door as the header's Add candidate. Two controls that
              add a person must open the same thing, or one of them is a lie —
              this one used to answer with a demo toast. Where the candidate
              lands is not this button's business: intake always creates them
              at New, whichever column was clicked.
              
              AND IT IS ABSENT WHERE NOBODY CAN BE INSERTED — inserting a
              person here is simply impossible. The backend
              has always refused Hired and everything past it — hubIntake
              accepts only REFERRAL_STAGE_ORDER, because Hired is the door to
              a staff account and it is opened by finishing onboarding, never
              by typing somebody into it. The button was offered anyway, which
              is a screen promising what the server declines. */}
          {canInsert !== false && (
            <button
              aria-label={`Add to ${stage.label}`}
              onClick={() =>
                onAdd
                  ? onAdd()
                  : unwiredAction(`Add to ${stage.label}`)
              }
              className="grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
            >
              <Plus size={15} />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="Stage options" className="grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1">
                <MoreHorizontal size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onToggleCollapse}>{collapsed ? 'Expand stage' : 'Collapse stage'}</DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleSort}>
                <span className="flex-1">Sort by days in stage</span>
                {sortDesc && <Check size={14} className="text-primary" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleAlpha}>
                <span className="flex-1">Sort A → Z</span>
                {sortAlpha && <Check size={14} className="text-primary" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => unwiredAction(`Move all from ${stage.label}`)}>
                Move all…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {collapsed ? (
          <motion.p
            key="summary"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="px-4 pb-4 pt-1 text-[12px] text-text-3"
          >
            {cards.length} {cards.length === 1 ? 'card' : 'cards'} · avg {avgDays}d
          </motion.p>
        ) : (
          <motion.div
            key="cards"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="overflow-hidden"
          >
            {/* THE STAGE READS ACROSS, NOT DOWN — horizontal instead of
                vertical, so New reads well and Phone Screen reads well.
                Every card keeps everything it
                carried; it is the WIDTH that was cut, because a full-width row
                spent most of itself on empty middle. The cards stand in one
                line at a fixed width and the line scrolls sideways when they
                stop fitting — `overflow-x-auto` shows that bar only when there
                is something to scroll, and `scroll-fade` keeps it out of the
                way until the pointer is inside the stage. */}
            <motion.div
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
              initial="hidden"
              animate="show"
              className="scroll-fade flex items-stretch gap-3 overflow-x-auto p-4"
            >
              {cards.length === 0 && (
                <div className="flex-1 rounded-md border border-dashed border-border-strong px-4 py-6 text-center text-[12px] text-text-3">
                  {emptyText}
                </div>
              )}
              {visible.map((rec) => (
                <DraggableCard
                  key={rec.id}
                  rec={rec}
                  fields={fields}
                  stage={stage}
                  stages={stages}
                  canEdit={canEdit}
                  clickable={clickable}
                  onOpen={onOpen}
                  onAdvance={onAdvance}
                  dimmed={draggingStageId === stage.id}
                  rowActions={rowActions}
                  onAction={onAction}
                  canDo={canDo}
                  onPerson={onPerson}
                  onSource={onSource}
                  onStart={onStart}
                  startBusy={startingId === rec.id}
                  className={CARD_W}
                />
              ))}
              {/* the two show-more controls are cards in the line now — a
                  full-width button under a row that scrolls sideways would
                  belong to nothing */}
              {hiddenCount > 0 && (
                <button
                  onClick={() => setExpanded(true)}
                  className="flex w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-[16px] border border-dashed border-border-strong text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
                >
                  <ChevronDown size={14} className="-rotate-90" />
                  {hiddenCount} more
                </button>
              )}
              {expanded && ordered.length > limit && (
                <button
                  onClick={() => setExpanded(false)}
                  className="flex w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-[16px] border border-dashed border-border-strong text-[12px] font-semibold text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
                >
                  <ChevronDown size={14} className="rotate-90" />
                  Show less
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}
