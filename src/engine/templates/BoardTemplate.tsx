// `board` template (wave-2 · ops-apps) — the classic horizontal kanban.
// Columns flow left → right (Backlog → … → Done) with tinted headers + counts; cards show title, assignee avatar…
import { useEffect, useMemo, useRef, useState } from 'react'
import { format, formatDistanceToNow, isPast } from 'date-fns'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { motion } from 'framer-motion'
import { CalendarDays, GripVertical, Plus, Trash2, X } from 'lucide-react'
import type { TemplateProps } from '@/engine/PageRenderer'
import PageHeader from '@/components/shared/PageHeader'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { Badge } from '@/components/shared/Badge'
import { api } from '@/lib/api'
import { toast } from '@/stores/useToastStore'
import { useDetailPanelStore } from '@/stores/useDetailPanelStore'
import { askConfirm } from '@/stores/useDialogStore'
import { useAuthStore } from '@/auth/useAuthStore'
import type { Permission } from '@/auth/types'
import { personById } from '@/lib/people-lookup'
import { TINT_BG, TINT_BG_VAR, TINT_FG, TINT_VAR } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import { CardActions } from '@/engine/templates/cardActions'
import { runConfigAction, type ConfigAction } from '@/engine/configActions'
// instants wear Ohio wall-clock for every viewer; due DAYS keep date-fns format() over dueDate()'s local-noon parse
import { ohioDateTime, ohioDay, ohioTime } from '@/lib/ohio'
import type { OpsTask, TaskPriority } from '@/lib/seed-ops'
import type { TintName } from '@/engine/types'

type Stage = { id: string; label: string; tint: TintName; description?: string }

const colContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}
const colItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT_EXPO } },
}
const cardItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT_EXPO } },
}

const PRIORITY_TINT: Record<TaskPriority, TintName> = { high: 'pink', normal: 'blue', low: 'mint' }

/* ---------- card ---------- */

// Card row actions live in `templates/cardActions.tsx` — shared with the pipeline, which renders the same…

function TaskCard({
  rec,
  stages,
  actions,
  onAction,
  canDo,
}: {
  rec: OpsTask
  stages: Stage[]
  actions?: ConfigAction[]
  onAction?: (a: ConfigAction, rec: OpsTask) => void
  canDo?: (perm?: string) => boolean
}) {
  const person = personById(rec.assigneeId)
  const due = dueDate(rec.due)
  const overdue = rec.column !== 'done' && due !== null && isPast(due)
  // the last edit's moment — the sheet stamps it on every write; dueDate() already tolerates both ISO and day-only…
  const updated = dueDate(rec.updatedAt)
  return (
    <div className="group/card rounded-[14px] border border-border bg-surface p-3.5 shadow-1 transition-shadow duration-150 hover:shadow-2">
      <div className="flex items-start gap-2">
        <GripVertical
          size={14}
          className="-ml-1 mt-0.5 shrink-0 text-text-3 opacity-0 transition-opacity group-hover/card:opacity-100"
          style={{ transitionDuration: '120ms' }}
          aria-hidden
        />
        <p className="min-w-0 flex-1 text-[13.5px] font-medium leading-5 text-text-1">{rec.title}</p>
        {actions && actions.length > 0 && onAction && canDo && (
          <CardActions rec={rec} actions={actions} onAction={onAction} canDo={canDo} />
        )}
      </div>
      {rec.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-4">
          {rec.labels.map((l) => (
            <Badge key={l} label={l} tint={(rec.tint as TintName) ?? 'blue'} className="text-[10px]" />
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2 pl-4">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold capitalize" style={{ color: TINT_VAR[PRIORITY_TINT[rec.priority]] }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TINT_VAR[PRIORITY_TINT[rec.priority]] }} />
          {rec.priority}
        </span>
        {due !== null && (
          <span className={cn('inline-flex items-center gap-1 text-[11px]', overdue ? 'font-semibold text-danger' : 'text-text-3')}>
            <CalendarDays size={11} />
            {format(due, 'MMM d')}
            {overdue && ' · overdue'}
          </span>
        )}
        {updated !== null && (
          <span className="ml-auto text-[10.5px] text-text-3" title={`Last edited ${ohioDateTime(updated)}`}>
            {/* relative "x ago" is timezone-free; the hover stamp is Ohio */}
            {formatDistanceToNow(updated, { addSuffix: true })}
          </span>
        )}
        {/* The assignee is the only person on a kanban card, and their face was
            a label. pointerdown is stopped because the card sits inside
            DraggableCard's @dnd-kit listeners — a press meant for the person
            must not start a column move. */}
        <span
          onPointerDown={(e) => e.stopPropagation()}
          className={cn('inline-flex', updated === null && 'ml-auto')}
          title={person?.name ?? rec.assigneeId}
        >
          <DragPerson
            name={String(person?.name ?? rec.assigneeId ?? '')}
            id={String(person?.id ?? rec.assigneeId ?? '')}
            avatar={person?.avatar}
            subtitle={person?.role}
            title={`${person?.name ?? rec.assigneeId} · drag to the top-left to focus the workspace on them`}
            className="inline-flex"
          >
            <Avatar src={person?.avatar} name={person?.name ?? rec.assigneeId} size="xs" />
          </DragPerson>
        </span>
      </div>
      <span className="sr-only">{stages.find((s) => s.id === rec.column)?.label}</span>
    </div>
  )
}

function DraggableCard({
  rec,
  stages,
  onOpen,
  dimmed,
  actions,
  onAction,
  canDo,
}: {
  rec: OpsTask
  stages: Stage[]
  onOpen: (rec: OpsTask) => void
  dimmed?: boolean
  actions?: ConfigAction[]
  onAction?: (a: ConfigAction, rec: OpsTask) => void
  canDo?: (perm?: string) => boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: rec.id,
    data: { columnId: rec.column },
  })
  return (
    <motion.div variants={cardItem} ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: isDragging ? 0.35 : dimmed ? 0.6 : 1 }}>
      <div onClick={() => onOpen(rec)} className="cursor-pointer">
        <TaskCard rec={rec} stages={stages} actions={actions} onAction={onAction} canDo={canDo} />
      </div>
    </motion.div>
  )
}

/* ---------- column ---------- */

function BoardColumn({
  stage,
  cards,
  stages,
  onOpen,
  draggingColumnId,
  composerOpen,
  onToggleComposer,
  onCreateCard,
  canAdd,
  actions,
  onAction,
  canDo,
}: {
  stage: Stage
  cards: OpsTask[]
  stages: Stage[]
  onOpen: (rec: OpsTask) => void
  draggingColumnId: string | null
  composerOpen: boolean
  onToggleComposer: () => void
  onCreateCard: (stageId: string, title: string) => void
  canAdd: boolean
  actions?: ConfigAction[]
  onAction?: (a: ConfigAction, rec: OpsTask) => void
  canDo?: (perm?: string) => boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const [draft, setDraft] = useState('')

  const submit = () => {
    const title = draft.trim()
    if (!title) return
    onCreateCard(stage.id, title)
    setDraft('')
    onToggleComposer()
  }

  return (
    <motion.section
      variants={colItem}
      ref={setNodeRef}
      className={cn(
        'flex max-h-[calc(100dvh-220px)] w-[296px] shrink-0 flex-col rounded-lg border transition-colors duration-150',
        isOver ? 'border-transparent' : 'border-border bg-surface/60',
      )}
      style={isOver ? { background: TINT_BG_VAR[stage.tint], borderStyle: 'dashed', borderWidth: 2, borderColor: TINT_VAR[stage.tint] } : undefined}
    >
      {/* tinted header + count */}
      <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold', TINT_BG[stage.tint], TINT_FG[stage.tint])}>
          {stage.label}
        </span>
        <motion.span
          key={cards.length}
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="text-[12px] font-bold tabular-nums text-text-3"
        >
          {cards.length}
        </motion.span>
        <button
          aria-label={`Add card to ${stage.label}`}
          title={canAdd ? `Add card to ${stage.label}` : 'Sign in to add cards'}
          onClick={onToggleComposer}
          className="ml-auto grid h-7 w-7 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
        >
          <Plus size={15} />
        </button>
      </div>

      {/* cards */}
      <div className="scroll-thin flex-1 space-y-2.5 overflow-y-auto px-3 pb-3">
        <motion.div variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }} initial="hidden" animate="show" className="space-y-2.5">
          {cards.length === 0 && !composerOpen && (
            <div className="rounded-md border border-dashed border-border-strong px-4 py-6 text-center text-[12px] text-text-3">
              No cards — drag one in or add one below.
            </div>
          )}
          {cards.map((rec) => (
            <DraggableCard key={rec.id} rec={rec} stages={stages} onOpen={onOpen} dimmed={draggingColumnId === stage.id} actions={actions} onAction={onAction} canDo={canDo} />
          ))}
        </motion.div>

        {composerOpen ? (
          <div className="rounded-[14px] border border-border bg-surface p-2.5 shadow-1">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
                if (e.key === 'Escape') onToggleComposer()
              }}
              rows={2}
              placeholder="Card title…"
              aria-label={`New card title for ${stage.label}`}
              className="w-full resize-none rounded-sm bg-surface-2 px-2.5 py-2 text-[13px] text-text-1 outline-none placeholder:text-text-3"
            />
            <div className="mt-2 flex items-center gap-1.5">
              <button
                onClick={submit}
                disabled={!draft.trim()}
                className="flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
              >
                <Plus size={13} /> Add card
              </button>
              <button
                aria-label="Cancel"
                onClick={onToggleComposer}
                className="grid h-8 w-8 place-items-center rounded-sm text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={onToggleComposer}
            className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-[12.5px] font-medium text-text-3 transition-colors hover:bg-surface-2 hover:text-text-1"
          >
            <Plus size={14} /> Add card
          </button>
        )}
      </div>
    </motion.section>
  )
}

/* ---------- template ---------- */

const BIN_ID = '__bin__'

/** The bin. Appears while a card is being dragged, and nowhere else. */
function BoardBin() {
  const { setNodeRef, isOver } = useDroppable({ id: BIN_ID })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mb-3 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed py-3 text-[13px] font-semibold transition-colors',
        isOver ? 'border-danger bg-tint-pink text-danger' : 'border-border text-text-3',
      )}
    >
      <Trash2 size={16} /> {isOver ? 'Release to delete' : 'Drag here to delete'}
    </div>
  )
}

// Rows that came from a SHEET carry strings where the board expects structure: `labels` is a serialized cell ("[]"…
function normalizeTask(raw: any): OpsTask {
  let labels: string[] = []
  const rawLabels = raw?.labels
  if (Array.isArray(rawLabels)) {
    labels = rawLabels.map(String).filter(Boolean)
  } else {
    const s = String(rawLabels ?? '').trim()
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s)
        labels = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
      } catch {
        labels = []
      }
    } else if (s) {
      labels = s.split(/\s*[;,]\s*/).filter(Boolean)
    }
  }
  const priority = ['low', 'normal', 'high', 'urgent'].includes(String(raw?.priority)) ? raw.priority : 'normal'
  return { ...raw, labels, priority } as OpsTask
}

// A sheet cell may hold no date at all — never let format() throw over it.
function dueDate(v: unknown): Date | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (dayOnly) return new Date(+dayOnly[1], +dayOnly[2] - 1, +dayOnly[3], 12, 0, 0)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

// The day an existing value falls on, in the reader's own timezone, ready for an `<input type="date">`.
function dueInputValue(v: unknown): string {
  const d = dueDate(v)
  return d ? format(d, 'yyyy-MM-dd') : ''
}

export default function BoardTemplate({ config, data, schema, onRows }: TemplateProps) {
  const stages = (config.stages ?? []) as Stage[]
  const stageField = (config.stageField as string) ?? 'column'
  const [records, setRecords] = useState<OpsTask[]>((data as any[]).map(normalizeTask))
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null)
  const [composerColumn, setComposerColumn] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const prevRef = useRef<OpsTask[]>((data as any[]).map(normalizeTask))
  const openDetail = useDetailPanelStore((s) => s.openDetail)
  const closeDetail = useDetailPanelStore((s) => s.closeDetail)
  const user = useAuthStore((s) => s.user)
  const authCan = useAuthStore((s) => s.can)

  // Card row actions — the same ConfigAction vocabulary the sheet renders, run through the generic runner against…
  const rowActions = useMemo(() => (config.rowActions ?? []) as ConfigAction[], [config.rowActions])
  const canDo = (perm?: string) => !perm || authCan(user, perm as Permission)
  const runAction = (a: ConfigAction, rec: OpsTask) =>
    void runConfigAction(a, rec, { resource: schema.dataSource.resource })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // press-and-hold to drag cards on touch, so board scrolling stays free
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  // the read `records` were last rebuilt from
  const [recordsFrom, setRecordsFrom] = useState<unknown[]>(data)
  useEffect(() => {
    setRecords((data as any[]).map(normalizeTask))
    setRecordsFrom(data)
  }, [data])

  // the cards as they stand now — a drag, an add or a delete included — for a header drawn over this board.
  useEffect(() => {
    if (recordsFrom !== data) return
    onRows?.({ rows: records as unknown as Record<string, unknown>[] })
  }, [onRows, records, recordsFrom, data])

  const byStage = useMemo(() => {
    const map = new Map<string, OpsTask[]>()
    stages.forEach((s) => map.set(s.id, []))
    records.forEach((r) => map.get((r as any)[stageField])?.push(r))
    return map
  }, [records, stages, stageField])

  const sheetPerCard = Boolean((schema.config as { sheetPerCard?: boolean } | undefined)?.sheetPerCard)
  // ONE DELETE, TWO DOORS — deleting a card from the Task Board Sheet has to be possible, and read as possible.
  const deleteCard = (rec: OpsTask) => {
    const id = String(rec.id)
    setRecords((rs) => rs.filter((r) => r.id !== id))
    setAnnouncement(`${rec.title} deleted`)
    api.remove(schema.dataSource.resource, id)
      .then(() => toast({ type: 'success', title: `${rec.title} deleted` }))
      .catch(() => {
        setRecords(prevRef.current)
        toast({ type: 'danger', title: 'Could not delete', body: 'The card is back on the board.' })
      })
  }
  const openCard = (rec: OpsTask) => {
    const person = personById(rec.assigneeId)
    const stage = stages.find((s) => s.id === (rec as any)[stageField])
    openDetail({
      config: {
        header: {
          title: 'title',
          subtitle: 'description',
          statusChip: { label: stage?.label ?? rec.column, tint: stage?.tint ?? 'blue' },
        },
        // ONE BODY OR THE OTHER.
        ...(sheetPerCard
          ? { sheetField: { action: 'sheetBoardCreate', label: 'This card’s spreadsheet' } }
          : {
              notesField: {
                field: 'description',
                resource: schema.dataSource.resource,
                label: 'Activity / notes',
                placeholder: 'Type what this card is about, or log what happened…',
              },
            }),
        // THESE ARE KEYS, NOT VALUES.
        stats: [
          { label: 'Priority', value: 'priority', icon: 'flag', tint: PRIORITY_TINT[rec.priority] },
          { label: 'Due', value: 'dueShort', icon: 'calendar-days', tint: 'blue' },
          { label: 'Labels', value: rec.labels.length, icon: 'tag', tint: rec.tint },
          { label: 'Column', value: 'columnLabel', icon: 'square-kanban', tint: stage?.tint ?? 'blue' },
        ],
        sections: [
          {
            kind: 'fields',
            title: 'Details',
            fields: [
              { icon: 'user', label: 'Assignee', value: 'assigneeName', avatarNameKey: 'assigneeName', avatarKey: 'assigneeAvatar' },
              { icon: 'flag', label: 'Priority', value: 'priority' },
              { icon: 'calendar-days', label: 'Due', value: 'dueText' },
              { icon: 'tag', label: 'Labels', value: 'labelsText' },
              { icon: 'history', label: 'Edited', value: 'updatedText' },
            ],
          },
          // images and PDFs on the card — renders nothing when the card carries none
          { kind: 'attachments', title: 'Attachments', itemsField: 'attachments' },
          {
            kind: 'timeline',
            title: 'Timeline',
            entries: [
              { time: 'Now', text: `Currently in ${stage?.label ?? rec.column}`, tint: stage?.tint ?? 'blue' },
              ...(dueDate(rec.updatedAt)
                ? [{ time: `${ohioDay(dueDate(rec.updatedAt) as Date)}, ${ohioTime(dueDate(rec.updatedAt) as Date)}`, text: 'Last edited', tint: 'mint' as const }]
                : []),
              { time: dueDate(rec.due) ? format(dueDate(rec.due) as Date, 'MMM d') : '—', text: rec.column === 'done' ? 'Completed ahead of archive' : 'Due date set', tint: 'amber' },
              { time: dueDate(rec.createdAt) ? `${ohioDay(dueDate(rec.createdAt) as Date)}, ${ohioTime(dueDate(rec.createdAt) as Date)}` : 'Earlier', text: 'Card created', tint: 'lavender' },
            ],
          },
        ],
      // Edited through the door the platform already has (EditRecordModal via the footer), so the write goes out on…
      editForm: {
        title: 'Edit card',
        description: 'Yours alone — nobody else can see or change this card.',
        resource: schema.dataSource.resource,
        perm: 'tasks.edit',
        submitLabel: 'Save card',
        fields: [
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'] },
          { key: 'due', label: 'Due', type: 'date' },
          { key: 'labels', label: 'Labels', type: 'tags', placeholder: 'Comma-separated, e.g. Billing, Urgent' },
          // images and PDFs on the card — the file bytes go through taskFileStore; the list rides THIS gated write
          { key: 'attachments', label: 'Attachments (images & PDFs)', type: 'attachments' },
          // The column is the same field a drag writes.
          { key: stageField, label: 'Column', type: 'select', options: stages.map((s) => s.id) },
        ],
      },
      footer: [
        { label: 'Edit card', icon: 'pencil', variant: 'primary', edit: true },
        {
          label: 'Delete card',
          icon: 'trash-2',
          danger: true,
          // asks first, in the platform's own dialog — never the browser's
          onClick: async () => {
            const ok = await askConfirm({
              title: `Delete “${rec.title}”?`,
              body: sheetPerCard
                ? 'The card goes. Its spreadsheet stays in your Drive folder — nothing in Drive is deleted.'
                : 'The card and everything typed on it go.',
              confirmLabel: 'Delete',
              tone: 'danger',
            })
            if (!ok) return
            closeDetail()
            deleteCard(rec)
          },
        },
      ],
      // The panel saves; the BOARD has to agree, or a card edited in the drawer sits in its old column until…
      onSaved: (row: any) => setRecords((rs) => rs.map((r) => (r.id === row.id ? normalizeTask({ ...r, ...row }) : r))),
      },
      record: {
        ...rec,
        assigneeName: person?.name ?? rec.assigneeId,
        assigneeAvatar: person?.avatar,
        // `due` is handed to the panel as the calendar day it falls on, so the date input opens on the right day…
        due: dueInputValue(rec.due),
        dueShort: dueDate(rec.due) ? format(dueDate(rec.due) as Date, 'MMM d') : '',
        dueText: dueDate(rec.due) ? format(dueDate(rec.due) as Date, 'MMM d, yyyy') : '—',
        columnLabel: stage?.label ?? rec.column,
        labelsText: rec.labels.length ? rec.labels.join(', ') : '—',
        updatedText: dueDate(rec.updatedAt) ? ohioDateTime(dueDate(rec.updatedAt) as Date) : '—',
      },
    })
  }

  const onDragStart = (e: DragStartEvent) => {
    prevRef.current = records
    setActiveId(String(e.active.id))
    setDraggingColumnId((e.active.data.current as any)?.columnId ?? null)
  }

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    setDraggingColumnId(null)
    const target = e.over?.id ? String(e.over.id) : null

    // Dropped on the bin.
    if (target === BIN_ID) {
      const id = String(e.active.id)
      const rec = records.find((r) => r.id === id)
      if (!rec) return
      deleteCard(rec)
      return
    }

    if (!target || !stages.some((s) => s.id === target)) return
    const id = String(e.active.id)
    const rec = records.find((r) => r.id === id)
    if (!rec || (rec as any)[stageField] === target) return
    const stageLabel = stages.find((s) => s.id === target)?.label ?? target
    // optimistic move
    setRecords((rs) => rs.map((r) => (r.id === id ? ({ ...r, [stageField]: target } as OpsTask) : r)))
    setAnnouncement(`${rec.title} moved to ${stageLabel}`)
    toast({ type: 'success', title: `${rec.title} → ${stageLabel}` })
    api.update(schema.dataSource.resource, id, { [stageField]: target })
      // the server row carries the fresh updatedAt — without this merge the card's "edited" time stays stale until…
      .then((row) => setRecords((rs) => rs.map((r) => (r.id === id ? normalizeTask({ ...r, ...(row as object) }) : r))))
      .catch(() => {
        setRecords(prevRef.current)
        toast({ type: 'danger', title: 'Move failed', body: 'The card was restored to its column.' })
      })
  }

  const createCard = async (stageId: string, title: string) => {
    const stage = stages.find((s) => s.id === stageId)
    const payload = {
      title,
      description: '',
      [stageField]: stageId,
      assigneeId: user?.id ?? 'p-01',
      priority: 'normal' as TaskPriority,
      due: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      tint: stage?.tint ?? 'blue',
      labels: [],
    }
    try {
      const created = await api.create<OpsTask>(schema.dataSource.resource, payload)
      setRecords((rs) => [...rs, created])
      setAnnouncement(`${title} added to ${stage?.label ?? stageId}`)
      toast({ type: 'success', title: `Card added to ${stage?.label ?? stageId}`, body: title })
    } catch {
      toast({ type: 'danger', title: 'Could not add card', body: 'Please try again.' })
    }
  }

  const activeRec = activeId ? records.find((r) => r.id === activeId) : null

  return (
    <div className="w-full">
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <PageHeader
        title={(config.title as string) ?? schema.title}
        subtitle={`${records.length} cards · ${stages.length} columns`}
      />

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setDraggingColumnId(null) }}>
        {/* Only while a card is in the air: a permanent delete target sitting
            under a board invites the accident it exists to allow. */}
        {activeId && <BoardBin />}
        <motion.div variants={colContainer} initial="hidden" animate="show" className="scroll-thin flex items-start gap-4 overflow-x-auto pb-4">
          {stages.map((s) => (
            <BoardColumn
              key={s.id}
              stage={s}
              cards={byStage.get(s.id) ?? []}
              stages={stages}
              onOpen={openCard}
              draggingColumnId={draggingColumnId}
              composerOpen={composerColumn === s.id}
              onToggleComposer={() => setComposerColumn((c) => (c === s.id ? null : s.id))}
              onCreateCard={createCard}
              canAdd={!!user}
              actions={rowActions}
              onAction={runAction}
              canDo={canDo}
            />
          ))}
        </motion.div>
        <DragOverlay dropAnimation={{ duration: 0.26, easing: 'cubic-bezier(.22,1,.36,1)' }}>
          {activeRec && (
            <motion.div initial={{ scale: 1.02, rotate: 0.5 }} animate={{ scale: 1.02, rotate: 0.5 }} className="w-[272px] shadow-3">
              <TaskCard rec={activeRec} stages={stages} />
            </motion.div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
