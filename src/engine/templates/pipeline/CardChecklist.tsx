/** Compact per-card checklist progress row (moved verbatim from PipelineTemplate.tsx). */
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { TINT_VAR } from '@/lib/tints'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { cn } from '@/lib/utils'
import type { ChecklistItem } from './types'
import { MISSING_STYLE, STATUS_META, isComplete } from './utils'
import { itemViewable, viewItemDoc } from './viewDoc'

type DocRec = { id: string; name?: string; resumeLink?: string; phone?: string }

// Mini icon+status dot with a native tooltip (label · owner · status).
function MiniDot({ item, rec }: { item: ChecklistItem; rec?: DocRec }) {
  const m = STATUS_META[item.status] ?? STATUS_META.pending
  const Icon = m.icon
  const canView = itemViewable(rec, item)
  const look = cn('grid h-[18px] w-[18px] place-items-center rounded-full', m.bg, m.fg)
  const body = <Icon size={10} strokeWidth={2.4} />
  if (!canView || !rec) {
    return (
      <span
        title={`${item.label} · ${item.owner ?? 'Unassigned'} · ${m.tooltip}`}
        aria-label={`${item.label}: ${m.tooltip}`}
        className={look}
        style={item.status === 'missing' ? MISSING_STYLE : undefined}
      >
        {body}
      </span>
    )
  }
  return (
    <button
      type="button"
      title={`${item.label} · ${item.owner ?? 'Unassigned'} · ${m.tooltip} — click to open`}
      aria-label={`Open ${item.label}`}
      onClick={(e) => { e.stopPropagation(); void viewItemDoc(rec, item.id, item.label) }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(look, 'transition-transform duration-150 hover:scale-110')}
    >
      {body}
    </button>
  )
}

// Compact checklist progress on a card, scoped to the record's CURRENT stage group ("what's left to do right now")…
export function CardChecklist({ items, stageId, rec }: { items: ChecklistItem[]; stageId: string; rec?: DocRec }) {
  const phone = String(rec?.phone ?? '').trim()
  const phoneTag = phone ? (
    <a
      href={`tel:${phone.replace(/\D/g, '')}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      title="Call this number"
      className="ml-auto shrink-0 text-[11px] tabular-nums text-text-3 hover:text-primary"
    >
      {formatPhoneDisplay(phone)}
    </a>
  ) : null

  const group = items.filter((i) => i.stage === stageId)
  if (group.length === 0) {
    if (items.length > 0 && items.every(isComplete)) {
      return (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-tint-fg-mint">
          <Check size={12} strokeWidth={2.5} aria-hidden /> All documents complete
          {phoneTag}
        </div>
      )
    }
    // Nothing owed at this stage and nothing to celebrate — the number alone is still worth the line (Hired and…
    return phoneTag ? <div className="mt-1.5 flex items-center">{phoneTag}</div> : null
  }
  const done = group.filter(isComplete).length
  if (group.length <= 3) {
    return (
      <div className="mt-1.5 flex items-center gap-1">
        {group.map((it) => (
          <MiniDot key={it.id} item={it} rec={rec} />
        ))}
        <span className="ml-1 text-[11px] tabular-nums text-text-3">
          {done}/{group.length} docs
        </span>
        {phoneTag}
      </div>
    )
  }
  const pct = Math.round((done / group.length) * 100)
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: TINT_VAR.mint }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
        />
      </div>
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-text-2">
        {done}/{group.length} docs
      </span>
      {phoneTag}
    </div>
  )
}
