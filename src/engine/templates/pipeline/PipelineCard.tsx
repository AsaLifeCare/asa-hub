/** Pipeline card + its @dnd-kit draggable wrapper (moved verbatim from PipelineTemplate.tsx). */
// applied-at is an instant → Ohio wall-clock for every viewer
import { ohioDay } from '@/lib/ohio'
import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { motion } from 'framer-motion'
import { ArrowRight, Ban, Flame, GripVertical, MessageSquare, MoreHorizontal } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import DragPerson from '@/components/shared/DragPerson'
import { writePersonDrag } from '@/lib/focus'
import { Badge } from '@/components/shared/Badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TINT_BG_VAR, TINT_VAR } from '@/lib/tints'
import { cn } from '@/lib/utils'
import type { TintName } from '@/engine/types'
import type { ConfigAction } from '@/engine/configActions'
import { CardActions } from '@/engine/templates/cardActions'
import type { CardMenu, Stage } from './types'
import { agingClass, cardItem } from './utils'
import { CardChecklist } from './CardChecklist'
import UrgencyChip from './UrgencyChip'
import OnboardingWindowChip, { type OnboardingWindow } from './OnboardingWindowChip'
import { PacketChip, InternalDocsChip, type PacketChipValue, type InternalDocsValue } from './PacketChip'
import { ScorecardChip } from './ScorecardChip'
import { docOnFile, viewItemDoc } from './viewDoc'

// A LINE THAT CLAMPS SAYS ITSELF ON HOVER — asked twice: hovering over the ellipsis has to show the complete name.
function Clamped({
  text,
  className,
  onClick,
  children,
}: {
  text: string
  className?: string
  onClick?: (e: MouseEvent) => void
  children: ReactNode
}) {
  const body = (
    <div onClick={onClick} title={text} className={className}>
      {children}
    </div>
  )
  if (!text.trim()) return body
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={4}
        className="max-w-[320px] border border-border bg-surface text-[12px] text-text-1 shadow-2"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

// TWO TAPS, NEVER A BROWSER DIALOG: the first arms, the second commits.
function StartActivities({ rec, onStart, busy }: { rec: any; onStart: (rec: any) => Promise<void> | void; busy: boolean }) {
  const [armed, setArmed] = useState(false)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        if (!armed) { setArmed(true); return }
        void onStart(rec)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={busy}
      className={cn(
        'mt-2 w-full rounded-md px-2 py-1.5 text-[12px] font-bold transition-colors',
        armed ? 'bg-success text-white' : 'bg-primary text-on-primary',
        busy && 'opacity-50',
      )}
    >
      {busy ? 'Starting…' : armed ? 'Confirm — begin activities' : 'Start activities'}
    </button>
  )
}

function RatingDots({ value, max, tint }: { value: number; max: number; tint: TintName }) {
  return (
    <span className="flex items-center gap-1" aria-label={`Rated ${value} of ${max}`}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full"
          style={{ background: i < value ? TINT_VAR[tint] : 'var(--surface-3)' }}
        />
      ))}
    </span>
  )
}

export function PipelineCard({
  rec,
  fields,
  tint,
  celebrate,
  stageId,
  menu,
  rowActions,
  onAction,
  canDo,
  onPerson,
  onSource,
  onStart,
  startBusy,
}: {
  rec: any
  fields: any
  tint: TintName
  celebrate?: boolean
  stageId?: string
  menu?: CardMenu
  // Config-driven card row actions (config.rowActions) — optional: a page that declares none renders nothing here.
  rowActions?: ConfigAction[]
  onAction?: (a: ConfigAction, rec: Record<string, unknown>) => void
  canDo?: (perm?: string) => boolean
  // Name/avatar → the full profile page.
  onPerson?: (rec: any) => void
  // The tag chip → who is behind that source.
  onSource?: (rec: any, tag: string) => void
  // THE LAST GESTURE (ported onto this card so the Flow board can be deleted): a card at Ready to start leaves the…
  onStart?: (rec: any) => Promise<void> | void
  startBusy?: boolean
}) {
  const title = rec[fields.title]
  const scoreKey = fields.score?.key
  const tagVal = fields.tags?.key ? rec[fields.tags.key] : null
  const days = rec.daysInStage ?? 0
  const ownerName = fields.owner?.nameKey ? rec[fields.owner.nameKey] : fields.owner?.fallbackName
  const ownerAvatar = fields.owner?.avatarKey ? rec[fields.owner.avatarKey] : fields.owner?.fallbackAvatar
  // Click, not drag: the card's own onClick opens the panel, so a person click must stop there before it bubbles.
  const personClick = onPerson
    ? (e: MouseEvent) => {
        e.stopPropagation()
        onPerson(rec)
      }
    : undefined
  // THE CHIP ANSWERS FOR ITSELF — clicking Direct shows the modal with the details of who made that direct.
  const tagBadge = (t: string) => (
    <Badge label={t} tint={fields.tags?.tintBy?.[t] ?? 'blue'} className="text-[10px]" />
  )
  const renderTag = (t: string) =>
    onSource ? (
      <button
        key={t}
        type="button"
        title={`Where ${String(title ?? 'this card')} came from`}
        onClick={(e) => {
          e.stopPropagation()
          onSource(rec, t)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="inline-flex rounded-full transition-shadow duration-150 hover:shadow-1"
      >
        {tagBadge(t)}
      </button>
    ) : (
      <span key={t} className="inline-flex">
        {tagBadge(t)}
      </span>
    )
  return (
    <div
      className={cn(
        // THE CONTENT SITS FURTHER LEFT — pulled a little further left inside the square, because there was room to…
        'group/card relative flex h-full items-center gap-2.5 rounded-[16px] border border-border py-3 pl-3 pr-3.5 shadow-1 transition-shadow duration-150',
        celebrate ? 'border-transparent' : 'bg-surface',
      )}
      style={celebrate ? { background: TINT_BG_VAR[tint] } : undefined}
    >
      {/* The handle is ABSOLUTE: invisible until hover, it used to hold a
          column of its own on every card forever. Out of the flow it costs
          nothing and still appears exactly where the hand reaches for it. */}
      <GripVertical
        size={15}
        className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-text-3 opacity-0 transition-opacity group-hover/card:opacity-100"
        style={{ transitionDuration: '120ms' }}
        aria-hidden
      />
      {/* The avatar is the focus handle. The card body belongs to @dnd-kit
          (stage-to-stage), and a native draggable on the same node would fight
          it — so the person's face carries the person, which is also the thing
          someone reaches for. */}
      {fields.avatar && (
        <span
          title={personClick
            ? `Click for ${String(title ?? 'their')}'s profile · drag to the top-left to focus the workspace`
            : `Drag ${String(title ?? 'them')} to the top-left to focus the workspace on them`}
          onPointerDown={(e) => e.stopPropagation()}
          ref={(el) => {
            if (!el) return
            el.draggable = true
            el.ondragstart = (e) => {
              if (!e.dataTransfer) return
              e.stopPropagation()
              e.dataTransfer.setData('text/plain', String(title ?? ''))
              writePersonDrag(e.dataTransfer, {
                type: 'staff',
                id: String(rec.id ?? ''),
                name: String(title ?? ''),
                avatar: rec[fields.avatar],
                subtitle: String(rec[fields.subtitle] ?? ''),
              })
            }
          }}
          onClick={personClick}
          className="shrink-0 cursor-grab active:cursor-grabbing"
        >
          <Avatar src={rec[fields.avatar]} name={String(title ?? '?')} size="md" className="h-11 w-11" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        {/* A NARROW CARD CLAMPS: the hover says the whole word — passing the
            mouse over a word ending in "..." shows it in full. */}
        {/* THE NOTA RIDES BESIDE THE NAME — the score card belongs on the
            pipeline card, in blue, in front of the name. It
            was only ever drawn on the Flow board, behind a chevron — the
            board people actually work never showed it. The name still takes
            the width it can and clamps; the chip never shrinks, because a
            half-cut score is worse than none. */}
        <div className="flex items-center gap-1.5">
          {/* THE NAME IS A HANDLE TOO. The avatar above has carried the focus
              drag since the start — but a board that declares no avatar field
              had nothing draggable on the card at all, and even with one the
              name was inert. `fields.avatar` stays the gate: this template
              also serves boards whose cards are not people.
              pointerdown is stopped for the same reason the ⋯ menu stops it —
              the card body is the @dnd-kit drag target, and a press meant for
              the name must not start a stage-to-stage move. */}
          <span
            onPointerDown={fields.avatar ? (e) => e.stopPropagation() : undefined}
            className="flex min-w-0 flex-1"
          >
            <DragPerson
              name={fields.avatar ? String(title ?? '') : ''}
              id={String(rec.id ?? '')}
              avatar={fields.avatar ? rec[fields.avatar] : undefined}
              subtitle={String(rec[fields.subtitle] ?? '')}
              title={String(title ?? '')}
              className="min-w-0 flex-1"
            >
              <Clamped
                text={String(title ?? '')}
                onClick={personClick}
                className={cn('clamp-1 min-w-0 flex-1 text-[14px] font-semibold leading-5 text-text-1', personClick && 'cursor-pointer hover:underline')}
              >
                {title}
              </Clamped>
            </DragPerson>
          </span>
          {typeof rec.resumeScorecard === 'number' && <ScorecardChip score={rec.resumeScorecard} />}
        </div>
        <Clamped
          className="clamp-1 text-[13px] leading-5 text-text-2"
          text={[
            rec[fields.subtitle],
            (fields.meta ?? []).includes('daysInStage') ? `${days}d in stage` : '',
          ].filter(Boolean).join(' · ')}
        >
          {rec[fields.subtitle]}
          {(fields.meta ?? []).includes('daysInStage') && (
            <span className={cn('font-medium', agingClass(days))}>
              {' · '}{days}d in stage
              {days > 14 && <Flame size={11} className="mb-0.5 ml-0.5 inline" aria-label="Aging" />}
            </span>
          )}
        </Clamped>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {Array.isArray(tagVal) && tagVal.map((t: string) => renderTag(t))}
          {typeof tagVal === 'string' && tagVal && renderTag(tagVal)}
          {scoreKey != null && rec[scoreKey] != null && (
            <RatingDots value={Number(rec[scoreKey]) || 0} max={fields.score.max ?? 5} tint={tint} />
          )}
          <PacketChip
            packet={rec.packet as PacketChipValue | undefined}
            hold={rec.packetHold as { phase?: string } | undefined}
            onOpen={
              // only when the PDF is actually here — signed in Dropbox Sign is not the same as on file with us, and…
              docOnFile(rec, 'new-hire-packet')
                ? () => void viewItemDoc(rec, 'new-hire-packet', 'New Hire Packet')
                : undefined
            }
          />
          {/* RED sits beside amber rather than replacing it: they say different
              things — "the packet is missing" and "the extra time somebody
              granted has run out" — and on a card that is both, hiding one
              loses the half that tells you what to do.
              The packet is passed in so this chip can tell whether PacketChip
              is already showing amber and step aside; it decides, rather than
              this card deciding for it. */}
          <UrgencyChip
            urgency={rec.urgency}
            why={rec.urgencyWhy}
            source={rec.urgencySource}
            packet={rec.packet as PacketChipValue | undefined}
            hold={rec.packetHold as { phase?: string } | undefined}
          />
          {/* Only ever present at Onboarding, and only when it has something
              to say — see the component. */}
          <OnboardingWindowChip window={rec.onboardingWindow as OnboardingWindow | undefined} />
          {/* Only once it is somebody's business — a card at New has no
              Employee Database row to be waiting on. */}
          {/* the retired/merged stage ids stay in this list on purpose: a
              slice built before a stage change can still be served for
              fifteen minutes, and a card whose stage the client does not
              recognise renders nothing. 'ready' joined at the merge where
              Hired absorbed Becoming Staff. */}
          {['hired', 'ready', 'becoming-staff', 'internal-docs'].includes(String(rec.stage)) && (
            <InternalDocsChip docs={rec.internalDocs as InternalDocsValue | undefined} />
          )}
          {/* THEY ASKED US TO STOP. It sits on the card because this is the
              screen somebody is looking at when they press a button that
              texts — the send is refused either way, but being told after
              the fact is not the same as knowing before. */}
          {!!rec.optedOut && (
            <span
              title={String(rec.optedOut)}
              className="inline-flex items-center gap-1 rounded-full bg-tint-pink px-2 py-0.5 text-[10px] font-semibold text-tint-fg-pink"
            >
              <Ban size={10} /> Asked us to stop
            </span>
          )}
        </div>
        {/* THE LAST THING THEY WROTE. It was being recorded and shown on a
            settings page, which is not where anybody works a candidate. */}
        {!!(rec.lastReply as { body?: string } | null)?.body && (
          <p
            className={cn(
              'mt-1.5 flex items-start gap-1.5 rounded-md px-2 py-1 text-[11.5px] leading-4',
              (rec.lastReply as { unread?: number }).unread
                ? 'bg-tint-primary text-tint-fg-primary'
                : 'bg-surface-2 text-text-2',
            )}
          >
            <MessageSquare size={11} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={(rec.lastReply as { body: string }).body}>
              {(rec.lastReply as { body: string }).body}
            </span>
          </p>
        )}
        {fields.checklist?.key && Array.isArray(rec[fields.checklist.key]) && stageId && (
          <CardChecklist items={rec[fields.checklist.key]} stageId={stageId} rec={rec} />
        )}
        {onStart && stageId === 'ready' && <StartActivities rec={rec} onStart={onStart} busy={!!startBusy} />}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {menu && (
          <span onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} className="inline-flex">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Card actions"
                  className="grid h-6 w-6 place-items-center rounded-sm text-text-3 opacity-0 transition-opacity duration-150 hover:bg-surface-2 hover:text-text-1 group-hover/card:opacity-100"
                >
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={menu.onOpen}>Open details</DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!menu.canEdit || !menu.nextStageLabel}
                  title={
                    !menu.canEdit
                      ? 'Requires hiring.edit — ask an admin'
                      : !menu.nextStageLabel
                        ? 'Already at the final stage'
                        : undefined
                  }
                  onClick={menu.onAdvance}
                >
                  <ArrowRight size={13} className="mr-1.5 text-text-3" />
                  <span className="flex-1">Move to {menu.nextStageLabel ?? 'next stage'}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )}
        {/* Config row actions (config.rowActions) — the same shared quick
            buttons + ⋯ menu the board renders, beside the card's own menu.
            pointerdown is stopped like the menu's: the drag sensor must not
            claim a press that was meant for a button. Absent without config. */}
        {rowActions && rowActions.length > 0 && onAction && canDo && (
          <span onPointerDown={(e) => e.stopPropagation()} className="inline-flex">
            <CardActions rec={rec} actions={rowActions} onAction={onAction} canDo={canDo} />
          </span>
        )}
        {rec.appliedAt && !isNaN(new Date(rec.appliedAt).getTime()) && (
          <span className="text-[11px] text-text-3">{ohioDay(rec.appliedAt)}</span>
        )}
        {/* The owner is a SECOND person on the card — the recruiter it belongs
            to, not the candidate — and their face was the only one here that
            went nowhere. No id: `rec.id` is the candidate's, and the owner
            column carries a name, never a person id. */}
        {ownerName && (
          <span onPointerDown={(e) => e.stopPropagation()} className="inline-flex">
            <DragPerson
              name={String(ownerName)}
              avatar={typeof ownerAvatar === 'string' ? ownerAvatar : undefined}
              subtitle="Card owner"
              title={`Owner: ${ownerName} · drag to the top-left to focus the workspace on them`}
              className="inline-flex"
            >
              <Avatar src={ownerAvatar} name={String(ownerName)} size="xs" />
            </DragPerson>
          </span>
        )}
        {(fields.meta ?? []).includes('source') && <span className="text-[11px] text-text-3">{rec.source}</span>}
      </div>
    </div>
  )
}

export function DraggableCard({
  rec,
  fields,
  stage,
  stages,
  canEdit,
  clickable,
  dimmed,
  onOpen,
  onAdvance,
  rowActions,
  onAction,
  canDo,
  onPerson,
  onSource,
  onStart,
  startBusy,
  className,
}: {
  rec: any
  fields: any
  stage: Stage
  stages: Stage[]
  canEdit: boolean
  clickable: boolean
  dimmed?: boolean
  onOpen: (rec: any) => void
  onAdvance: (rec: any) => void
  rowActions?: ConfigAction[]
  onAction?: (a: ConfigAction, rec: Record<string, unknown>) => void
  canDo?: (perm?: string) => boolean
  onPerson?: (rec: any) => void
  onSource?: (rec: any, tag: string) => void
  /** The Ready-to-start exit — see PipelineCard's own prop. */
  onStart?: (rec: any) => Promise<void> | void
  startBusy?: boolean
  /** The width the stage line gives each card (StageBand's CARD_W). */
  className?: string
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: rec.id,
    data: { stageId: stage.id },
  })
  const idx = stages.findIndex((s) => s.id === stage.id)
  const nextStageLabel = stages[idx + 1]?.label
  return (
    <motion.div variants={cardItem} ref={setNodeRef} {...listeners} {...attributes} className={className} style={{ opacity: isDragging ? 0.35 : dimmed ? 0.6 : 1 }}>
      <div onClick={() => onOpen(rec)} className={cn('h-full', clickable && 'cursor-pointer')}>
        <PipelineCard
          rec={rec}
          fields={fields}
          tint={stage.tint}
          celebrate={stage.celebrate}
          stageId={stage.id}
          menu={{ canEdit, nextStageLabel, onAdvance: () => onAdvance(rec), onOpen: () => onOpen(rec) }}
          rowActions={rowActions}
          onAction={onAction}
          canDo={canDo}
          onPerson={onPerson}
          onSource={onSource}
          onStart={onStart}
          startBusy={startBusy}
        />
      </div>
    </motion.div>
  )
}
