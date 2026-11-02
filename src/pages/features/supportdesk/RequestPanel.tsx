// One request in the standard right side panel: its status, type and urgency, the requestor, the whole description…
// Every answer is pressed twice and the first press undoes itself after four seconds; Redirect first opens the list…
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Search } from 'lucide-react'
import Avatar from '@/components/shared/Avatar'
import SidePanel from '@/components/shared/SidePanel'
import { cn } from '@/lib/utils'
import AdpChange from './AdpChange'
import { TypePill } from './RequestTable'
import {
  NOTE_MAX, PILL, VERDICT_WORDS, dateWords, historyHead, panelButtons, requestorName, searchPeople, sentence, stampWords,
  statusPill, viaWord, type Person, type Row, type Verdict, type Viewer,
} from './supportDeskModel'

const HEAD = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const CHIP = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold'
const BTN = 'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const TONE_BTN: Record<'primary' | 'outline' | 'danger', string> = {
  primary: 'bg-primary text-on-primary hover:opacity-90',
  outline: 'border border-border bg-surface text-text-1 hover:bg-surface-2',
  danger: 'border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-surface text-danger hover:bg-tint-danger',
}
// a fact this long reads better across both columns
const WIDE_FACT = 44

/** How long a first press stays armed. */
export const ARM_MS = 4000

/** The two presses: the first arms one act (and disarms on its own), the second does it. */
export function useTwoPress(): { armed: string; press: (id: string, act: () => void) => void; disarm: () => void } {
  const [armed, setArmed] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  useEffect(() => clear, [])
  return {
    armed,
    press: (id, act) => {
      clear()
      if (armed === id) { setArmed(''); act(); return }
      setArmed(id)
      timer.current = setTimeout(() => setArmed(''), ARM_MS)
    },
    disarm: () => { clear(); setArmed('') },
  }
}

export type DecideFn = (row: Row, verdict: Verdict, note: string, to?: string) => void

/** A new line in the request's history starts its decision afresh: the note emptied, the people list closed. */
export const decisionKey = (row: Row): string => `${row.ref}|${row.history.length}`

export type PanelProps = {
  row: Row | null
  viewer: Viewer
  /** the staff accounts a request may be redirected to */
  people: Person[]
  peopleWhy?: string
  busy: string
  onClose: () => void
  onDecide: DecideFn
  onAdp: (row: Row, op: 'approve' | 'undo') => void
}

export default function RequestPanel({ row, viewer, people, peopleWhy = '', busy, onClose, onDecide, onAdp }: PanelProps) {
  return (
    <SidePanel open={Boolean(row)} onClose={onClose} label={row?.ref ?? 'Request'} title={row?.type.display ?? ''}>
      {row && <PanelBody row={row} viewer={viewer} busy={busy} onAdp={onAdp} />}
      {row && <DecisionBlock key={decisionKey(row)} row={row} people={people} peopleWhy={peopleWhy} busy={busy} onDecide={onDecide} />}
    </SidePanel>
  )
}

function urgencyPill(urgency: string): string {
  const u = urgency.toLowerCase()
  if (u === 'high' || u === 'urgent') return PILL.danger
  if (u === 'medium') return PILL.amber
  return PILL.slate
}

export function PanelBody({ row, viewer, busy, onAdp }: { row: Row; viewer: Viewer; busy: string; onAdp: (row: Row, op: 'approve' | 'undo') => void }) {
  const adpPress = useTwoPress()
  const name = requestorName(row)
  // the urgency is a chip at the top; it is not said twice
  const facts = row.urgency ? row.details.filter((d) => d.label !== 'Urgency') : row.details
  return (
    <div className="mt-2 grid gap-3.5" data-panel={row.ref}>
      <div className="flex flex-wrap items-center gap-1.5" data-chips="">
        <span className={cn(CHIP, statusPill(row.status.tone))} data-status-word="">{row.status.word}</span>
        <TypePill row={row} />
        {row.urgency && <span className={cn(CHIP, urgencyPill(row.urgency))} data-urgency="">{row.urgency}</span>}
      </div>

      <div className="flex items-center gap-2.5" data-requestor="">
        <Avatar name={name} size="sm" />
        <div className="min-w-0 leading-5">
          <p className={cn('truncate text-[13.5px] font-semibold', row.requestor.name ? 'text-text-1' : 'text-text-3')}>{name}</p>
          <p className="text-[12px] text-text-3">{dateWords(row.date)}</p>
        </div>
      </div>
      {row.waiting_on.length > 0 && !row.completed && (
        <p className="-mt-1.5 text-[12px] text-text-2" data-waiting="">Waiting on {row.waiting_on.join(', ')}</p>
      )}
      {row.acks.length > 0 && (
        <p className="-mt-1.5 text-[12px] text-text-2" data-acks="">
          Aware: {row.acks.map((a) => `${a.name}${a.at ? ` ${stampWords(a.at)}` : ''}`).join(' · ')}
        </p>
      )}

      <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-text-1" data-full-description="">
        {row.description || 'No description was filed.'}
      </p>

      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md bg-surface-2 px-3 py-2.5" data-details="">
          {facts.map((d) => (
            <div key={`${d.label}|${d.value}`} className={cn('min-w-0', d.value.length > WIDE_FACT && 'col-span-2')}>
              <dt className={HEAD}>{d.label}</dt>
              <dd className="break-words text-[12.5px] leading-5 text-text-1">{d.value || '—'}</dd>
            </div>
          ))}
        </dl>
      )}

      {row.sched && row.sched.seats.length > 0 && (
        <div data-seats="">
          <p className={HEAD}>In Scheduling</p>
          <ul className="mt-1 grid gap-1.5">
            {row.sched.seats.map((s, i) => (
              <li key={`${s.seat}|${i}`} className="rounded-md border border-border px-2.5 py-1.5 text-[12.5px] text-text-2">
                <span className="font-semibold capitalize text-text-1">{s.seat.replace(/_/g, ' ')}</span>
                {s.house && <span className="font-semibold text-text-1" data-seat-house="">{` of ${s.house}`}</span>}
                {' · '}{s.state || 'waiting'}
                {s.to.length > 0 && <> · {s.to.join(', ')}</>}
                {s.by && <> · by {s.by}{s.at ? ` ${stampWords(s.at)}` : ''}</>}
                {s.note && <span className="block text-text-3">{s.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.adp && (
        <AdpChange adp={row.adp} canDecide={viewer.can_decide} armed={adpPress.armed} busy={busy === `adp:${row.ref}`}
          onPress={(op) => adpPress.press(op, () => onAdp(row, op))} />
      )}

      <div data-history="">
        <p className={HEAD}>History</p>
        {row.history.length === 0 ? (
          <p className="mt-0.5 text-[12.5px] text-text-3">Nothing decided yet.</p>
        ) : (
          <ol className="mt-1 grid gap-1.5">
            {row.history.map((h, i) => {
              const head = historyHead(h)
              return (
                <li key={`${h.at}|${i}`} className="flex items-start gap-2" data-history-line={h.verdict}>
                  <Avatar name={h.by || 'Platform'} size="xs" />
                  <div className="min-w-0 text-[12.5px] leading-5">
                    <p className="text-text-1">
                      <span className="font-semibold">{head.verdict}</span>
                      {head.by && <> by {head.by}</>}
                      {h.verdict === 'redirected'
                        ? h.note && <span className="break-words text-text-2"> · {h.note}</span>
                        : h.via && <span className="text-text-3"> · {viaWord(h.via)}</span>}
                    </p>
                    {h.at && <p className="text-[11.5px] text-text-3">{stampWords(h.at)}</p>}
                    {h.verdict !== 'redirected' && h.note && <p className="break-words text-text-2">{h.note}</p>}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}

/** The searchable list of staff accounts a request is redirected to, each behind a round avatar. */
export function RedirectPicker({ people, why, chosen, onChoose, initialQuery = '' }: {
  people: Person[]
  why: string
  chosen: Person | null
  onChoose: (p: Person) => void
  initialQuery?: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const shown = useMemo(() => searchPeople(people, query), [people, query])
  return (
    <div className="rounded-md border border-border bg-surface" data-picker="">
      <label className="flex items-center gap-2 border-b border-border px-2.5">
        <Search size={13} className="shrink-0 text-text-3" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people" aria-label="Search people"
          data-picker-search="" className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] text-text-1 outline-none placeholder:text-text-3" />
      </label>
      <ul className="scroll-thin max-h-[208px] overflow-y-auto py-1" aria-label="Redirect to">
        {shown.map((p) => {
          const on = chosen?.uid === p.uid
          return (
            <li key={p.uid}>
              <button type="button" data-person={p.uid} aria-pressed={on} onClick={() => onChoose(p)}
                className={cn('flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[12.5px] hover:bg-surface-2',
                  on ? 'font-semibold text-text-1' : 'text-text-1')}>
                <Avatar name={p.name} size="xs" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {on && <Check size={13} className="shrink-0 text-primary" />}
              </button>
            </li>
          )
        })}
        {shown.length === 0 && (
          <li className="px-2.5 py-2 text-[12px] text-text-3" data-picker-empty="">
            {people.length ? 'Nobody matches the search.' : 'Nobody can be listed to redirect it to.'}
          </li>
        )}
      </ul>
      {why && <p className="border-t border-border px-2.5 py-1.5 text-[11.5px] leading-4 text-text-3" data-people-why="">{sentence(why)}</p>}
    </div>
  )
}

// The decision, right under the request: the note, then the row's answers two by two.
export function DecisionBlock({ row, people, peopleWhy = '', busy, onDecide, initiallyPicking = false }: {
  row: Row
  people: Person[]
  peopleWhy?: string
  busy: string
  onDecide: DecideFn
  initiallyPicking?: boolean
}) {
  const [note, setNote] = useState('')
  const [picking, setPicking] = useState(initiallyPicking)
  const [to, setTo] = useState<Person | null>(null)
  const two = useTwoPress()
  const { buttons, why } = panelButtons(row)
  if (!buttons.length) {
    return <p className="mt-4 border-t border-border pt-3 text-[12.5px] text-text-3" data-closed="">{row.completed ? 'This request is closed.' : sentence(row.may.why)}</p>
  }
  const live = buttons.some((b) => b.on)
  const pressing = busy === `decide:${row.ref}`
  const sendId = to ? `redirect:${to.uid}` : ''
  return (
    <section className="mt-4 grid gap-2.5 border-t border-border pt-3" data-decision="" aria-label="Decision">
      {live && (
        <label className="block">
          <span className={HEAD}>Note (optional)</span>
          <textarea value={note} maxLength={NOTE_MAX} rows={2} onChange={(e) => setNote(e.target.value)} data-note=""
            placeholder="Kept with the decision"
            className="mt-1 w-full resize-none rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12.5px] text-text-1 outline-none placeholder:text-text-3 focus:border-primary" />
          <span className="block text-right text-[11px] tabular-nums text-text-3">{note.length}/{NOTE_MAX}</span>
        </label>
      )}
      <div className="grid grid-cols-2 gap-2" data-verdicts="">
        {buttons.map(({ verdict: v, on }) => {
          const w = VERDICT_WORDS[v]
          const span = buttons.length === 1 ? 'col-span-2' : ''
          const off = !on || pressing
          if (v === 'redirect') {
            return (
              <button key={v} type="button" data-verdict={v} aria-expanded={picking} disabled={off}
                aria-describedby={on ? undefined : `why-${row.ref}`}
                onClick={() => { two.disarm(); setPicking(!picking) }}
                className={cn(BTN, span, picking ? 'border border-primary bg-primary-soft text-primary' : TONE_BTN[w.tone])}>
                {w.label}
              </button>
            )
          }
          const armed = two.armed === v
          return (
            <button key={v} type="button" data-verdict={v} data-armed={armed ? '' : undefined} disabled={off}
              aria-describedby={on ? undefined : `why-${row.ref}`}
              onClick={() => two.press(v, () => onDecide(row, v, note))}
              className={cn(BTN, span, armed ? 'bg-danger text-white' : TONE_BTN[w.tone])}>
              {pressing && armed && <Loader2 size={13} className="animate-spin" />}
              {armed ? w.armed : w.label}
            </button>
          )
        })}
      </div>
      {picking && (
        <div className="grid gap-2" data-redirect="">
          <RedirectPicker people={people} why={peopleWhy} chosen={to} onChoose={(p) => { two.disarm(); setTo(p) }} />
          <button type="button" data-redirect-send={to?.uid ?? ''} data-armed={two.armed === sendId && to ? '' : undefined}
            disabled={!to || pressing}
            onClick={() => { if (to) two.press(sendId, () => onDecide(row, 'redirect', note, to.uid)) }}
            className={cn(BTN, two.armed === sendId && to ? 'bg-danger text-white' : TONE_BTN.primary)}>
            {pressing && two.armed === sendId && <Loader2 size={13} className="animate-spin" />}
            {!to ? 'Choose who to redirect it to' : two.armed === sendId ? `Press again to redirect to ${to.name}` : `Redirect to ${to.name}`}
          </button>
        </div>
      )}
      {two.armed && <button type="button" onClick={two.disarm} className="justify-self-start text-[12px] text-text-3 hover:text-text-1">Not yet</button>}
      {why && <p id={`why-${row.ref}`} className="text-[12px] leading-5 text-text-3" data-why="">{sentence(why)}</p>}
    </section>
  )
}
