// One time off request in the right panel: its details, a new request, new dates, or a withdrawal.
// Every write goes through the Time Off doors, and each is pressed twice.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { toast } from '@/stores/useToastStore'
import { cn } from '@/lib/utils'
import {
  approvedViewOf, askedLine, daysBetween, filedLine, mayFile, nextPress, previewFor, type Detail, type Preview,
} from '@/pages/features/timeoff/timeOffModel'
import { readDetail } from '@/pages/features/timeoff/useTimeOff'
import ApprovedTimeOffPanel from '@/pages/features/timeoff/ApprovedTimeOff'
import { RecordPanel } from '@/pages/features/timeoff/TimeOffPanel'
import type { ApprovedView } from '@/pages/features/timeoff/approvedModel'
import {
  addFor, dayHead, daysWords, fileFor, fileTestLine, filedForLine, pillClass, rangeWords, reasonRefusal, rowActs, sentence,
  whoseDays, type CheckAnswer, type MyCalendarView, type PanelAsk, type RequestRow,
} from './myCalendarModel'
import { changeDates, checkDates, fileAdd, heldVacationRoute, isRouted, previewAdd, withdrawRequest } from './useMyCalendar'
import { useTestWarningsHidden } from '@/lib/myWorkHides'

/** Said on your own new request while Scheduling takes it. */
export const ROUTED_LINE = 'This request goes to the directors in Scheduling: at least 7 days’ notice, and the first answer decides.'

const FIELD = 'h-10 w-full rounded-[12px] border border-border bg-surface px-3 text-[13px] text-text-1 outline-none transition-colors focus:border-primary'
const LABEL = 'mb-1 block text-[12.5px] font-medium text-text-2'
const HEAD = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-3'
const SECONDARY = 'inline-flex h-10 items-center rounded-full border border-border bg-surface px-4 text-[13px] font-medium text-text-1 hover:bg-surface-2'
const PRIMARY = 'inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40'

/** The panel's title for each kind of request ask. */
export function requestPanelTitle(ask: PanelAsk): string {
  if (ask.kind === 'add') return 'Add Time Off Request'
  if (ask.kind !== 'request') return ''
  if (ask.mode === 'edit') return 'Edit Time Off Request'
  if (ask.mode === 'withdraw') return 'Withdraw Time Off Request'
  return 'Time Off Request'
}

/* ---------- an approved request ---------- */

/** An approved request opens in the operator's layout, read from Time Off's record; Edit (its approvers only) opens
 * the whole record here, never a visit to Time Off. Its person keeps Withdraw under it while the server allows it
 * (not started yet). */
export function ApprovedRequest({ row, person, view, acting, onAsk, onClose }: {
  row: RequestRow
  person: string
  view: MyCalendarView
  acting: boolean
  onAsk: (ask: PanelAsk) => void
  onClose: () => void
}) {
  const [got, setGot] = useState<{ d: Detail | null; failed: string }>({ d: null, failed: '' })
  const [managing, setManaging] = useState(false)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    let live = true
    if (!reads) setGot({ d: null, failed: '' })
    readDetail(row.ref)
      .then((d) => { if (live) setGot({ d, failed: '' }) })
      .catch((e: unknown) => { if (live) setGot({ d: null, failed: (e instanceof Error ? e.message : String(e)) || 'no answer' }) })
    return () => { live = false }
  }, [row.ref, reads])
  if (managing && got.d?.may.edit) {
    return <RecordPanel refId={row.ref} d={got.d} failed="" focus="" onClose={onClose}
      onDone={() => setReads((n) => n + 1)} onBack={() => setManaging(false)} />
  }
  const withdraw = row.may.withdraw ? (
    <GatedButton gate={rowActs(row, acting, view).withdraw} label="Withdraw" id={`my-calendar-panel-withdraw-${row.ref}`}
      onPress={() => onAsk({ kind: 'request', mode: 'withdraw', ref: row.ref })} />
  ) : undefined
  return <ApprovedRequestView row={row} person={person} d={got.d} failed={got.failed} onClose={onClose}
    onEdit={() => setManaging(true)} footer={withdraw} />
}

export function ApprovedRequestView({ row, person, d, failed, onClose, onEdit, footer }: {
  row: RequestRow
  person: string
  d: Detail | null
  failed: string
  onClose: () => void
  onEdit: () => void
  /** the person's own Withdraw, under the layout */
  footer?: ReactNode
}) {
  const view: ApprovedView = d ? approvedViewOf(d)
    : { person, start: row.start, end: row.end, requested: '', days: row.days, reason: undefined, facts: null,
        factsWhy: failed ? `this request could not be read — ${failed}` : '', reading: !failed }
  return <ApprovedTimeOffPanel open view={view} mayEdit={Boolean(d?.may.edit)} onEdit={onEdit} onClose={onClose}
    footer={footer} />
}

/* ---------- details ---------- */

export function RequestDetail({ row, view, acting, onAsk }: {
  row: RequestRow
  view: MyCalendarView
  acting: boolean
  onAsk: (ask: PanelAsk) => void
}) {
  const acts = rowActs(row, acting, view)
  return (
    <div className="grid gap-4 pt-1" data-request-panel={row.ref}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold', pillClass(row))}>{row.word}</span>
        <span className="text-[13px] text-text-2">{rangeWords(row.start, row.end)} · {daysWords(row.days)}</span>
        <span className="font-mono text-[11px] text-text-3">{row.ref}</span>
      </div>
      {row.status_why && <p className="text-[12.5px] leading-5 text-text-2">{sentence(row.status_why)}</p>}
      {row.filed_by_other && (
        <p className="text-[12px] text-text-3">
          {view.person.own ? 'Somebody else filed this request for you.' : 'Somebody else filed this request for this person.'}
        </p>
      )}
      <dl className="grid gap-3">
        {row.details.map((d) => (
          <div key={d.label} className="min-w-0">
            <dt className={HEAD}>{d.label}</dt>
            <dd className="mt-0.5 break-words text-[13px] leading-5 text-text-1">{d.value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-2 border-t border-border pt-3">
        <GatedButton gate={acts.edit} label="Change dates" id={`my-calendar-panel-edit-${row.ref}`}
          onPress={() => onAsk({ kind: 'request', mode: 'edit', ref: row.ref })} />
        <GatedButton gate={acts.withdraw} label="Withdraw" id={`my-calendar-panel-withdraw-${row.ref}`}
          onPress={() => onAsk({ kind: 'request', mode: 'withdraw', ref: row.ref })} />
      </div>
    </div>
  )
}

function GatedButton({ gate, label, id, onPress }: { gate: { allowed: boolean; why: string }; label: string; id: string; onPress: () => void }) {
  return (
    <div>
      <button type="button" disabled={!gate.allowed} onClick={() => gate.allowed && onPress()} data-gated={label}
        aria-describedby={gate.allowed ? undefined : `${id}-why`}
        className={cn(SECONDARY, 'h-9 disabled:cursor-not-allowed disabled:opacity-50')}>
        {label}
      </button>
      {!gate.allowed && <p id={`${id}-why`} className="mt-1 text-[11.5px] leading-[1.45] text-text-3">{gate.why}</p>}
    </div>
  )
}

/* ---------- a new request ---------- */

export function AddForm({ view, acting, prefill, onFiled, onCancel }: {
  view: MyCalendarView
  acting: boolean
  prefill?: { start?: string; end?: string; reason?: string; note?: string }
  onFiled: () => void
  onCancel: () => void
}) {
  const form = view.form
  const add = addFor(view, acting)
  const person = fileFor(view)
  const [start, setStart] = useState(prefill?.start ?? '')
  const [end, setEnd] = useState(prefill?.end ?? '')
  const [reason, setReason] = useState(prefill?.reason ?? '')
  const noTest = useTestWarningsHidden()
  const [checked, setChecked] = useState<{ key: string; preview: Preview } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [failed, setFailed] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  const endValue = end || start
  const ready = add.allowed && Boolean(start && endValue)
  const key = JSON.stringify([start, endValue, reason, person])
  const preview = previewFor(checked, key)
  const tooLong = reasonRefusal(reason, form.reason_max)

  useEffect(() => {
    setArmed('')
    setFailed('')
    if (!ready || tooLong) { setChecked(null); return }
    const mine = ++seq.current
    const timer = setTimeout(() => {
      setPreviewing(true)
      previewAdd(start, endValue, reason, person)
        .then((p) => { if (mine === seq.current) setChecked({ key, preview: p }) })
        .catch((e) => {
          if (mine !== seq.current) return
          setChecked(null)
          setFailed(e instanceof Error ? e.message : String(e))
        })
        .finally(() => { if (mine === seq.current) setPreviewing(false) })
    }, 350)
    return () => clearTimeout(timer)
  }, [ready, tooLong, start, endValue, reason, person, key])

  const may = mayFile(ready && !tooLong, preview, previewing, busy)

  const submit = async () => {
    const press = nextPress(armed, 'file')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await fileAdd(start, endValue, reason, person)
      toast({ type: 'success', title: `Time off asked — ${got.ref}`, body: isRouted(got) ? got.said : filedLine(got.asked) })
      onFiled()
    } catch (e) {
      toast({ type: 'danger', title: 'Not filed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const testLine = noTest ? '' : fileTestLine(view.test_mode)
  const own = view.person.own
  return (
    <div className="grid gap-4 pt-1" data-add-form="">
      <p className="text-[13px] text-text-2">{whoseDays(view)}</p>
      {prefill?.note && (
        <p role="alert" className="rounded-lg border-2 border-[#8b0000] bg-[#8b0000]/5 px-3 py-2 text-[12.5px] font-semibold text-text-1" data-orphan="">
          {prefill.note}
        </p>
      )}
      {!add.allowed && <p className="text-[12.5px] text-[var(--warning)]" data-add-why="">{add.why}</p>}
      <DateFields start={start} end={end} earliest={form.earliest} disabled={!add.allowed} onStart={setStart} onEnd={setEnd} />
      <ReasonField reason={reason} max={form.reason_max} disabled={!add.allowed} onReason={setReason}
        hint={own ? 'Only your house manager and the directors read this.' : 'Only their house manager and the directors read this.'} />
      {tooLong && <p className="text-[12.5px] font-semibold text-danger">{tooLong}</p>}

      {ready && !tooLong && (
        <div className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2" data-preview="">
          {!preview && !failed && <p className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Checking…</p>}
          {failed && <p className="text-danger">The check could not be made, so it cannot be filed yet — {failed}</p>}
          {preview && (
            <>
              <p className="font-semibold text-text-1">
                {rangeWords(start, endValue)} · {daysWords(preview.days ?? daysBetween(start, endValue))}
              </p>
              {!own && <p className="font-semibold text-text-1" data-filed-for="">{filedForLine(preview.person || person)}</p>}
              {preview.asked && <p>{askedLine(preview.asked)}</p>}
              {preview.asked?.hm_why && <p className="text-text-3">{preview.asked.hm_why}</p>}
              {(preview.touches ?? []).map((t) => (
                <p key={`${t.location}|${t.col_iso}`}>
                  On the calendar {dayHead(t.col_iso)} {t.value} at {t.label}. If approved, that shift is put up as an open
                  shift for the house manager.
                </p>
              ))}
              <Refusals list={preview.refusals ?? []} />
            </>
          )}
        </div>
      )}

      {testLine && <p className="rounded-lg bg-tint-amber px-3 py-2 text-[12px] leading-5 text-tint-fg-amber" data-test-mode="">{testLine}</p>}
      {person === '' && heldVacationRoute()?.on && (
        <p className="rounded-lg bg-tint-blue px-3 py-2 text-[12px] leading-5 text-tint-fg-blue" data-routed="">{ROUTED_LINE}</p>
      )}

      <Buttons armed={armed === 'file'} busy={busy} disabled={!may} label="File request" armedLabel="File request — press again to send it"
        onPress={() => void submit()} onDisarm={() => setArmed('')} onCancel={onCancel} />
    </div>
  )
}

/* ---------- new dates ---------- */

export function EditForm({ view, row, acting, onDone, onOrphan, onCancel }: {
  view: MyCalendarView
  row: RequestRow
  acting: boolean
  onDone: () => void
  /** the withdrawal landed and the new dates did not: the panel becomes a new request with them */
  onOrphan: (ask: Extract<PanelAsk, { kind: 'add' }>) => void
  onCancel: () => void
}) {
  const form = view.form
  const gate = rowActs(row, acting, view).edit
  const person = fileFor(view)
  // the check names the chosen roster row; the relay derives the spelling from it
  const chosen = view.person.own ? '' : view.scope.person
  const [start, setStart] = useState(row.start)
  const [end, setEnd] = useState(row.end)
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState<{ key: string; answer: CheckAnswer } | null>(null)
  const [checking, setChecking] = useState(false)
  const [failed, setFailed] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  const endValue = end || start
  const changed = start !== row.start || endValue !== row.end || reason.trim() !== ''
  const ready = gate.allowed && Boolean(start && endValue)
  const key = JSON.stringify([start, endValue, chosen])
  // a check counts only for the very dates it checked
  const answer = checked && checked.key === key ? checked.answer : null
  const tooLong = reasonRefusal(reason, form.reason_max)

  useEffect(() => {
    setArmed('')
    setFailed('')
    if (!ready) { setChecked(null); return }
    const mine = ++seq.current
    const timer = setTimeout(() => {
      setChecking(true)
      checkDates(row.ref, start, endValue, chosen)
        .then((a) => { if (mine === seq.current) setChecked({ key, answer: a }) })
        .catch((e) => {
          if (mine !== seq.current) return
          setChecked(null)
          setFailed(e instanceof Error ? e.message : String(e))
        })
        .finally(() => { if (mine === seq.current) setChecking(false) })
    }, 350)
    return () => clearTimeout(timer)
  }, [ready, row.ref, start, endValue, chosen, key])

  const may = ready && changed && !tooLong && answer?.ok === true && !checking && !busy

  const save = async () => {
    const press = nextPress(armed, 'save')
    setArmed(press.armed)
    if (!press.act) return
    setBusy(true)
    try {
      const got = await changeDates(row.ref, start, endValue, reason, person)
      if (got.state === 'done') {
        toast({ type: 'success', title: `New dates asked — ${got.ref}`,
                body: `${row.ref} was withdrawn and the new dates were filed as ${got.ref}; both approvals start again.` })
        onDone()
      } else if (got.state === 'kept') {
        toast({ type: 'danger', title: 'Nothing was changed', body: got.message })
      } else {
        onOrphan({ kind: 'add', start, end: endValue, reason, note: got.message })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-edit-form={row.ref}>
      <p className="text-[13px] text-text-2">{whoseDays(view)}</p>
      {!gate.allowed && <p className="text-[12.5px] text-[var(--warning)]" data-edit-why="">{gate.why}</p>}
      {gate.allowed && row.may.edit_warns && (
        <p role="alert" className="rounded-lg border-2 border-[#8b0000] bg-[#8b0000]/5 px-3 py-2 text-[12.5px] font-semibold leading-5 text-text-1"
          data-edit-warns="">
          {row.may.edit_warns}
        </p>
      )}
      <DateFields start={start} end={end} earliest={form.earliest} disabled={!gate.allowed} onStart={setStart} onEnd={setEnd} />
      <ReasonField reason={reason} max={form.reason_max} disabled={!gate.allowed} onReason={setReason}
        hint={`The earlier reason is not carried over. Only ${view.person.own ? 'your' : 'their'} house manager and the directors read this.`} />
      {tooLong && <p className="text-[12.5px] font-semibold text-danger">{tooLong}</p>}
      <p className="text-[12px] leading-5 text-text-3">
        Saving withdraws {row.ref} and files these dates as a new request: the house manager and a director are asked again.
      </p>

      {ready && (
        <div className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 text-[12.5px] leading-[1.6] text-text-2" data-check="">
          {!answer && !failed && <p className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Checking…</p>}
          {failed && <p className="text-danger">The new dates could not be checked, so they cannot be saved yet — {failed}</p>}
          {answer && (
            <>
              <p className="font-semibold text-text-1">{rangeWords(start, endValue)} · {daysWords(answer.days || daysBetween(start, endValue))}</p>
              {answer.ok && !changed && <p className="text-text-3">These are the dates on file.</p>}
              <Refusals list={answer.refusals} />
            </>
          )}
        </div>
      )}

      <Buttons armed={armed === 'save'} busy={busy} disabled={!may} label="Save Changes" armedLabel="Save Changes — press again"
        onPress={() => void save()} onDisarm={() => setArmed('')} onCancel={onCancel} />
    </div>
  )
}

/* ---------- withdraw ---------- */

export function WithdrawForm({ row, acting, onDone, onCancel }: {
  row: RequestRow
  acting: boolean
  onDone: () => void
  onCancel: () => void
}) {
  const gate = rowActs(row, acting).withdraw
  const [note, setNote] = useState('')
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState(false)

  const press = async () => {
    const step = nextPress(armed, 'withdraw')
    setArmed(step.armed)
    if (!step.act) return
    setBusy(true)
    try {
      await withdrawRequest(row.ref, note.trim())
      toast({ type: 'success', title: `Withdrawn — ${row.ref}`, body: 'Recorded.' })
      onDone()
    } catch (e) {
      toast({ type: 'danger', title: 'Nothing was changed', body: e instanceof Error ? e.message : 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 pt-1" data-withdraw-form={row.ref}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold', pillClass(row))}>{row.word}</span>
        <span className="text-[13px] text-text-2">{rangeWords(row.start, row.end)} · {daysWords(row.days)}</span>
        <span className="font-mono text-[11px] text-text-3">{row.ref}</span>
      </div>
      {!gate.allowed && <p className="text-[12.5px] text-[var(--warning)]" data-withdraw-why="">{gate.why}</p>}
      {row.may.withdraw_warns && (
        <p className="rounded-lg border border-[#8b0000]/40 bg-[#8b0000]/5 px-3 py-2 text-[12.5px] leading-5 text-text-1" data-warns="">
          {row.may.withdraw_warns}
        </p>
      )}
      <label>
        <span className={LABEL}>Note (optional)</span>
        <textarea value={note} maxLength={500} rows={2} disabled={!gate.allowed} onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-[12px] border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none focus:border-primary disabled:opacity-60" />
      </label>
      <Buttons armed={armed === 'withdraw'} busy={busy} disabled={!gate.allowed || busy} label="Withdraw"
        armedLabel="Withdraw — press again" tone="danger" onPress={() => void press()} onDisarm={() => setArmed('')} onCancel={onCancel} />
    </div>
  )
}

/* ---------- pieces ---------- */

function DateFields({ start, end, earliest, disabled, onStart, onEnd }: {
  start: string
  end: string
  earliest: string
  disabled: boolean
  onStart: (v: string) => void
  onEnd: (v: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label>
        <span className={LABEL}>Start Date</span>
        <input type="date" value={start} min={earliest || undefined} disabled={disabled} data-field="start"
          onChange={(e) => onStart(e.target.value)} className={FIELD} />
      </label>
      <label>
        <span className={LABEL}>End Date</span>
        <input type="date" value={end} min={start || earliest || undefined} disabled={disabled} data-field="end"
          onChange={(e) => onEnd(e.target.value)} className={FIELD} />
      </label>
      <p className="col-span-2 -mt-1 text-[11.5px] text-text-3">Same as the start date if only off for one day.</p>
    </div>
  )
}

function ReasonField({ reason, max, disabled, hint, onReason }: {
  reason: string
  max: number
  disabled: boolean
  hint: string
  onReason: (v: string) => void
}) {
  return (
    <label>
      <span className={LABEL}>Reason (optional)</span>
      <textarea value={reason} maxLength={max > 0 ? max : undefined} rows={2} disabled={disabled} data-field="reason"
        onChange={(e) => onReason(e.target.value)}
        className="w-full rounded-[12px] border border-border bg-surface px-3 py-2 text-[13px] text-text-1 outline-none focus:border-primary disabled:opacity-60" />
      <span className="mt-1 flex justify-between gap-2 text-[11.5px] text-text-3">
        <span>{hint}</span>
        {max > 0 && <span className="shrink-0 tabular-nums">{reason.length}/{max}</span>}
      </span>
    </label>
  )
}

function Refusals({ list }: { list: string[] }) {
  return (
    <>
      {list.map((r) => (
        <p key={r} className="flex items-start gap-1.5 font-semibold text-danger" data-refusal=""><X size={13} className="mt-1 shrink-0" />{r}</p>
      ))}
    </>
  )
}

function Buttons({ armed, busy, disabled, label, armedLabel, tone = 'success', onPress, onDisarm, onCancel }: {
  armed: boolean
  busy: boolean
  disabled: boolean
  label: string
  armedLabel: string
  tone?: 'success' | 'danger'
  onPress: () => void
  onDisarm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
      {armed
        ? <button type="button" onClick={onDisarm} className="text-[12.5px] text-text-3 hover:text-text-1">Not yet</button>
        : <button type="button" onClick={onCancel} className={SECONDARY}>Cancel</button>}
      <button type="button" onClick={onPress} disabled={disabled} data-press={label}
        className={cn(PRIMARY, armed || tone === 'danger' ? 'bg-danger' : 'bg-[var(--success)] hover:opacity-90')}>
        {busy && <Loader2 size={14} className="animate-spin" />}
        {armed ? armedLabel : label}
      </button>
    </div>
  )
}
