// A FILED ROW, TWO WAYS — as a compact card inside a call ("filed from this call"), and as the whole row laid out…
// The compact card carries the few fields a person reads first, and folds the rest behind "All fields" rather than…
import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { EASE_OUT_EXPO } from '@/engine/motion'
import { cn } from '@/lib/utils'
import {
  cell, noteClient, parseStamp, stampLabel, stampLong, type LaneRecord, type Row, type ScreenRecord,
} from './join'
import { formatPhoneDisplay } from '@/lib/phoneFormat'
import { ModalityPill, Pill, QuietPill } from './ui'
import {
  LANE_FIELDS, callOffTypeTint, queueStatusTint, screenResultTint, shiftPill, urgencyTint, type FieldSpec,
} from './vocabulary'

const safeUrl = (v: string) => (/^https?:\/\//i.test(v) ? v : '')

/** Every field of a row the row actually holds, short ones in a grid, prose below. */
export function FieldList({ row, fields, extra }: { row: Row; fields: FieldSpec[]; extra?: { label: string; value: string }[] }) {
  const short = fields.filter((f) => !f.long && cell(row, f.key))
  const long = fields.filter((f) => f.long && cell(row, f.key))
  const value = (f: FieldSpec) => {
    const raw = cell(row, f.key)
    if (f.date) return stampLong(parseStamp(raw)) || raw
    if (f.phone) return formatPhoneDisplay(raw)
    return raw
  }
  if (!short.length && !long.length && !extra?.length) {
    return <p className="text-[12.5px] text-text-3">The row holds no readable fields.</p>
  }
  return (
    <div className="space-y-3">
      {(short.length > 0 || !!extra?.length) && (
        <dl className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
          {(extra ?? []).filter((e) => e.value).map((e) => (
            <div key={e.label} className="min-w-0">
              <dt className="text-[11px] text-text-3">{e.label}</dt>
              <dd className="mt-0.5 break-words text-[13px] text-text-1">{e.value}</dd>
            </div>
          ))}
          {short.map((f) => (
            <div key={f.key} className="min-w-0">
              <dt className="text-[11px] text-text-3">{f.label}</dt>
              <dd className={cn('mt-0.5 break-words text-[13px] text-text-1', (f.date || f.phone) && 'font-stat')}>
                {f.url && safeUrl(cell(row, f.key)) ? (
                  <a href={safeUrl(cell(row, f.key))} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline">
                    Open <ExternalLink size={12} />
                  </a>
                ) : value(f)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {long.map((f) => (
        <div key={f.key}>
          <p className="text-[11px] text-text-3">{f.label}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.6] text-text-1">{cell(row, f.key)}</p>
        </div>
      ))}
    </div>
  )
}

function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
          className="overflow-hidden"
        >
          <div className="mt-3 border-t border-border pt-3">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function FoldToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-medium text-text-3 transition-colors hover:text-text-1"
    >
      {open ? 'Fewer fields' : 'All fields'}
      <ChevronDown size={13} className={cn('transition-transform duration-200', open && 'rotate-180')} />
    </button>
  )
}

const cardCls = (focused: boolean) => cn(
  'rounded-[14px] border bg-surface p-3.5 transition-shadow duration-200',
  focused ? 'border-primary/40 shadow-1 ring-2 ring-primary/10' : 'border-border',
)

/** One lane row filed from a call — the fields a person reads first. */
export function FiledCard({ rec, today, focused }: { rec: LaneRecord; today: string; focused: boolean }) {
  const [open, setOpen] = useState(false)
  const r = rec.row
  let pills: ReactNode = null
  let text = ''
  let facts: { label: string; value: string }[] = []
  if (rec.lane === 'queue') {
    pills = (
      <>
        <QuietPill label={cell(r, 'type_of_request') || 'Not typed'} />
        {cell(r, 'urgency') && <Pill label={`${cell(r, 'urgency')} urgency`} tint={urgencyTint(cell(r, 'urgency'))} />}
        {cell(r, 'status') && <Pill label={cell(r, 'status')} tint={queueStatusTint(cell(r, 'status'))} />}
      </>
    )
    text = cell(r, 'description_of_request')
    facts = [{ label: 'Requestor', value: cell(r, 'requestor') }]
  } else if (rec.note) {
    const n = rec.note
    pills = (
      <>
        <QuietPill label={cell(r, 'kind_label')} />
        {cell(r, 'category_label') && <QuietPill label={cell(r, 'category_label')} />}
        {shiftPill(n.shift) && <QuietPill label={shiftPill(n.shift)} />}
      </>
    )
    text = n.response
    facts = [
      { label: 'DSP', value: n.dsp_name },
      { label: 'Client', value: noteClient(n) },
      // the reporting day as the book wrote it — a day, not an instant
      { label: 'Reporting day', value: n.reporting_date },
      { label: 'Shift', value: cell(r, 'shift_text') },
    ]
  } else if (rec.lane === 'incidents') {
    pills = (
      <>
        {cell(r, 'client_name') && <QuietPill label={cell(r, 'client_name')} />}
        {cell(r, 'incident_category') && <QuietPill label={cell(r, 'incident_category')} />}
      </>
    )
    text = cell(r, 'summary_of_incident')
    facts = [{ label: 'Reported by', value: cell(r, 'your_name') }]
  } else {
    const shift = stampLabel(parseStamp(cell(r, 'date')), today)
    pills = (
      <>
        <Pill label={cell(r, 'type') || 'Not typed'} tint={callOffTypeTint(cell(r, 'type'))} />
        {shift && <QuietPill label={`Shift ${shift}`} />}
      </>
    )
    text = cell(r, 'notes')
    facts = [{ label: 'Employee', value: cell(r, 'employee_name') }, { label: 'How late', value: cell(r, 'how_late') }]
  }
  facts = facts.filter((f) => f.value)
  return (
    <div className={cardCls(focused)}>
      <div className="flex items-center gap-2">
        <ModalityPill modality={rec.lane} />
        {rec.via === 'time' && (
          <span className="text-[11px] text-text-3" title="Incident rows carry no call id; this one was filed within two minutes of the call, and no other incident call was">
            matched by time
          </span>
        )}
        <span className="ml-auto font-stat text-[11.5px] text-text-3">{stampLabel(rec.stamp, today)}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">{pills}</div>
      {text
        ? <p className="mt-2.5 whitespace-pre-wrap break-words text-[13px] leading-[1.6] text-text-1">{text}</p>
        : <p className="mt-2.5 text-[12.5px] text-text-3">The row holds no description.</p>}
      {facts.length > 0 && (
        <p className="mt-2 text-[12px] text-text-3">
          {facts.map((f, i) => (
            <span key={f.label}>{i > 0 && ' · '}{f.label} <span className="text-text-2">{f.value}</span></span>
          ))}
        </p>
      )}
      <FoldToggle open={open} onToggle={() => setOpen((v) => !v)} />
      <Fold open={open}><FieldList row={r} fields={LANE_FIELDS[rec.lane]} /></Fold>
    </div>
  )
}

/** The hiring lane's result for a screening call. */
export function ScreenCard({ screen, candidate, today }: { screen: ScreenRecord; candidate: Row | null; today: string }) {
  const [open, setOpen] = useState(false)
  const r = screen.row
  const result = cell(r, 'final_result')
  const score = cell(r, 'screen_score')
  const report = safeUrl(cell(r, 'phone_screen_report_url'))
  const name = cell(candidate, 'name')
  return (
    <div className={cardCls(false)}>
      <div className="flex items-center gap-2">
        <ModalityPill modality="screening" label="Phone screen" />
        <span className="ml-auto font-stat text-[11.5px] text-text-3">{stampLabel(screen.stamp, today)}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Pill label={result || 'No result written'} tint={screenResultTint(result)} />
        {cell(r, 'qualification') && <QuietPill label={cell(r, 'qualification')} />}
        {score && <QuietPill label={`Score ${score}`} />}
        {cell(r, 'screen_status') && <QuietPill label={cell(r, 'screen_status')} />}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-text-2">
          {name
            ? <>Candidate <span className="font-medium text-text-1">{name}</span>{cell(candidate, 'stage') ? <span className="text-text-3"> · {cell(candidate, 'stage')}</span> : null}</>
            : <span className="text-text-3">The screen names no candidate on file.</span>}
        </p>
        {report && (
          <a href={report} target="_blank" rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[12px] font-medium text-text-2 transition-colors hover:bg-surface-2">
            Open report <ExternalLink size={12} />
          </a>
        )}
      </div>
      <FoldToggle open={open} onToggle={() => setOpen((v) => !v)} />
      <Fold open={open}><FieldList row={r} fields={LANE_FIELDS.screening} /></Fold>
    </div>
  )
}
